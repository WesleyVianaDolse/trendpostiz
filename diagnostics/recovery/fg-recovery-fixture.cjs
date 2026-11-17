const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  { spawn, spawnSync } = require('node:child_process');
const [root, url, address] = process.argv.slice(2);
assert.equal(new URL(url).hostname, '127.0.0.1');
assert.equal(new URL(url).username, 'guard_test');
assert.equal(new URL(url).pathname, '/guard_test');
assert.match(address, /^127\.0\.0\.1:\d+$/);
let server,
  endpoint,
  e,
  db,
  get,
  req,
  client,
  connection,
  native,
  bundle,
  bundlePath,
  app;
let generation = 0,
  cutoff = new Date(Date.now() - 60000),
  sequence = 0;
const workers = [],
  running = [],
  children = [],
  histories = [],
  childBoots = [],
  results = [],
  calls = [],
  modes = new Map();
const key = () => `fg-${++sequence}`,
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let n = 0; n < 160; n++) {
    const v = await fn();
    if (v) return v;
    await pause(100);
  }
  throw Error('Fixture condition not reached');
};
const pubs = (postId) =>
  calls.filter(
    (c) =>
      c.path.startsWith('/publication') && (!postId || c.body.id === postId)
  );
const test = async (id, scenarios, fn) => {
  const before = calls.length;
  try {
    await fn();
    results.push({
      id,
      scenarios,
      result: 'PASS',
      httpRequests: calls.length - before,
    });
    console.log('PASS', id);
  } catch (error) {
    let cause = error;
    const messages = [];
    for (let n = 0; cause && n < 6; n++, cause = cause.cause)
      messages.push(cause.message);
    const message = messages.join(' / ').slice(0, 1800);
    results.push({ id, scenarios, result: 'FAIL', error: message });
    console.error('FAIL', id, message);
  }
};
async function open(at = new Date(Date.now() - 10000)) {
  cutoff = at;
  generation++;
  const id = key();
  await db.automationRecoveryRun.create({
    data: {
      id,
      cutoffAt: at,
      phase: 'VERIFIED',
      authorizedById: 'operator',
      authorizedAt: new Date(+at - 1),
      manifestHash: 'synthetic-only',
    },
  });
  await db.automationRecoveryControl.update({
    where: { id: 'global' },
    data: { phase: 'OPEN', runId: id, generation },
  });
  await require('./signed-policy-fixture.cjs')(db,url);
}
async function post(extra = {}) {
  return db.post.create({
    data: {
      id: key(),
      organizationId: 'org-a',
      integrationId: 'channel-a',
      group: key(),
      content: 'Synthetic body',
      image: '[]',
      settings: '{}',
      state: 'QUEUE',
      scheduleRevision: 1,
      publishDate: new Date(Date.now() - 1000),
      ...extra,
    },
  });
}
async function createOccurrence(p, at = p.publishDate, id = key()) {
  return db.publicationOccurrence.create({
    data: {
      id,
      organizationId: p.organizationId,
      postId: p.id,
      scheduleRevision: p.scheduleRevision,
      groupSnapshot: p.group,
      scheduledAt: at,
    },
  });
}
async function worker(
  queue,
  activities = e.activities,
  workflowBundle = bundle
) {
  const { Worker } = req('@temporalio/worker');
  const w = await Worker.create({
    connection: native,
    namespace: 'default',
    taskQueue: queue,
    workflowBundle,
    activities,
    maxCachedWorkflows:8,
    workflowThreadPoolSize:1,
    maxConcurrentWorkflowTaskExecutions:4,
    maxConcurrentActivityTaskExecutions:8,
  });
  workers.push(w);
  running.push(w.run());
  return w;
}
async function history(h) {
  const value = await h.fetchHistory();
  const description = await h.describe();
  histories.push({
    id: h.workflowId,
    runId: description.runId,
    history: value,
  });
  return value;
}
async function closeWorker(w) {
  const index = workers.indexOf(w);
  if (index < 0) return;
  w.shutdown();
  await running[index];
  workers.splice(index, 1);
  running.splice(index, 1);
}
async function finish(h, allowFailure = false) {
  let value;
  try {
    value = await h.result();
  } catch (err) {
    if (!allowFailure) throw err;
  }
  await history(h);
  return value;
}
async function start106(p, options = {}) {
  const descriptor = await e.scheduling.stagePost(p.organizationId, p.id);
  assert(descriptor, 'Expected future/eligible admitted occurrence');
  const h = await client.workflow.start('postWorkflowV106', {
    workflowId: descriptor.workflowId,
    taskQueue: options.queue || 'main',
    args: [descriptor],
    workflowExecutionTimeout: '90 seconds',
  });
  return { h, descriptor };
}
async function legacy(p, queue, postNow = false, version = 105) {
  const wf = key(),
    h = await client.workflow.start(`postWorkflowV${version}`, {
      workflowId: wf,
      taskQueue: 'main',
      args: [
        {
          postId: p.id,
          organizationId: p.organizationId,
          taskQueue: queue,
          postNow,
        },
      ],
      workflowExecutionTimeout: '90 seconds',
    });
  const occurrence = await createOccurrence(p);
  const { publicationRequestHash } = get('automation-recovery/recovery-policy');
  const context = {
    workflowId: wf,
    runId: h.firstExecutionRunId,
    protocolVersion: 1,
    organizationId: p.organizationId,
    integrationId: p.integrationId,
    actionKey: `publication:${p.id}`,
    snapshots: [p],
    plannedAt: p.publishDate,
  };
  await db.automationWorkflowBinding.create({
    data: {
      organizationId: p.organizationId,
      workflowId: wf,
      runId: context.runId,
      occurrenceId: occurrence.id,
      actionKey: context.actionKey,
      expectedRequestHash: publicationRequestHash(context),
    },
  });
  if (+p.publishDate > Date.now() + 200) {
    const pending = await until(async () => {
      const value = await h.fetchHistory();
      return value.events.some((v) => v.timerStartedEventAttributes)
        ? value
        : null;
    });
    const timer = pending.events.find((v) => v.timerStartedEventAttributes);
    assert(
      !pending.events.some(
        (v) =>
          String(v.timerFiredEventAttributes?.startedEventId) ===
          String(timer.eventId)
      ),
      'Actual pending legacy timer required'
    );
    histories.push({
      id: h.workflowId,
      runId: h.firstExecutionRunId,
      history: pending,
    });
  }
  await until(async () => {
    const hst = await h.fetchHistory();
    return hst.events.some(
      (v) =>
        v.activityTaskScheduledEventAttributes?.activityType?.name ===
        'postSocial'
    );
  });
  return { h, context, occurrence };
}
async function capture() {
  return get(
    'automation-recovery/recovery-inventory-source'
  ).captureRecoveryInventory(
    db,
    client,
    ['org-a', 'org-b'],
    ['main', 'linkedin', 'facebook', 'instagram']
  );
}
async function startProcess(queue, options = {}) {
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'diagnostics/recovery/fg-worker-child.cjs'),
      root,
      url,
      endpoint,
      address,
      bundlePath,
      queue,
      JSON.stringify(options),
    ],
    {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }
  );
  children.push(child);
  child.activityStarts = [];
  const spawnedAt = Date.now();
  let stderr = '',lastStage='spawned';
  child.stderr.on('data', (b) => {
    stderr += String(b);
  });
  child.stdout.on('data', () => {});
  try { await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error('Child worker readiness deadline at '+lastStage)),
      180000
    );
    child.once('error', reject);
    child.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Child worker exited: ' + stderr.slice(0, 400)));
    });
    child.on('message', (m) => {
      if(m.stage)lastStage=m.stage;
      if(m.activityStarted)child.activityStarts.push(m.activityStarted);
      if (m.ready) {
        clearTimeout(timer);
        childBoots.push(Date.now() - spawnedAt);
        resolve(m);
      }
    });
  }); } catch (error) {
    // Only this spawn-owned synthetic child may be killed. Do not let failed
    // cold starts keep consuming resources while subsequent cases execute.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    throw error;
  }
  return child;
}
async function stopProcess(c) {
  if (c.exitCode !== null || c.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error('Owned child did not stop')),
      30000
    );
    c.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    c.send('stop', (err) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
(async () => {
  try {
    server = http.createServer(async (request, response) => {
      let raw = '';
      for await (const b of request) raw += b;
      const body = raw ? JSON.parse(raw) : {};
      calls.push({
        path: request.url,
        body,
        at: Date.now(),
        idempotencyKey: request.headers['idempotency-key'],
      });
      const mode = modes.get(body.id || request.url);
      if (mode === 'lost') {
        request.socket.destroy();
        return;
      }
      if (mode === 'hold') {
        modes.set('release:' + body.id, () => {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify([
              {
                id: body.id,
                postId: 'remote-' + body.id,
                releaseURL: 'https://example.test/' + body.id,
                status: 'posted',
              },
            ])
          );
        });
        return;
      }
      response.setHeader('content-type', 'application/json');
      if (mode === '500') response.statusCode = 500;
      if (request.url === '/youtube/insert') {
        response.end(JSON.stringify({ videoId: 'video-' + body.id }));
        return;
      }
      response.end(
        request.url.startsWith('/publication')
          ? JSON.stringify([
              {
                id: body.id,
                postId: 'remote-' + body.id,
                releaseURL: 'https://example.test/' + body.id,
                status: 'posted',
              },
            ])
          : JSON.stringify({ accepted: true })
      );
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${server.address().port}`;
    e = require('./fg-fixture-support.cjs')(root, url, endpoint);
    ({ db, get, req } = e);
    await db.$connect();
    await db.organization.createMany({
      data: [
        { id: 'org-a', name: 'Synthetic A', apiKey: 'synthetic-a' },
        { id: 'org-b', name: 'Synthetic B', apiKey: 'synthetic-b' },
      ],
    });
    await db.user.createMany({
      data: [
        ['operator', true],
        ['admin-a', false],
        ['reader-a', false],
        ['admin-b', false],
      ].map(([id, isSuperAdmin]) => ({
        id,
        email: id + '@example.test',
        providerName: 'LOCAL',
        timezone: 0,
        isSuperAdmin,
      })),
    });
    await db.userOrganization.createMany({
      data: [
        { userId: 'operator', organizationId: 'org-a', role: 'SUPERADMIN' },
        { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN' },
        { userId: 'reader-a', organizationId: 'org-a', role: 'USER' },
        { userId: 'admin-b', organizationId: 'org-b', role: 'ADMIN' },
      ],
    });
    await db.integration.createMany({
      data: [
        {
          id: 'channel-a',
          internalId: 'synthetic-a',
          organizationId: 'org-a',
          name: 'Synthetic Account',
          type: 'social',
          providerIdentifier: 'linkedin',
          token: 'synthetic-only',
        },
        {
          id: 'channel-b',
          internalId: 'synthetic-b',
          organizationId: 'org-b',
          name: 'Synthetic B',
          type: 'social',
          providerIdentifier: 'linkedin',
          token: 'synthetic-only',
        },
      ],
    });
    const { Connection, Client } = req('@temporalio/client'),
      { NativeConnection, Runtime, DefaultLogger, bundleWorkflowCode, Worker } =
        req('@temporalio/worker');
    Runtime.install({ logger: new DefaultLogger('ERROR') });
    connection = await Connection.connect({ address });
    native = await NativeConnection.connect({ address });
    client = new Client({ connection, namespace: 'default' });
    e.setClient(client);
    // Same TEXT keys as the application, registered only on this owned namespace.
    await connection.operatorService.addSearchAttributes({
      namespace: 'default',
      searchAttributes: { organizationId: 1, postId: 1 },
    });
    const { RecoveryManifestService } = get(
        'automation-recovery/recovery-manifest.service'
      ),
      manifests = new RecoveryManifestService(db);
    const { inventoryHash, projectRecoveryHistory } = get(
      'automation-recovery/recovery-inventory'
    );
    const { PublicationReconciliationService } = get(
        'automation-recovery/publication-reconciliation.service'
      ),
      reconciliation = new PublicationReconciliationService(db);
    const { publicationRequestHash } = get(
      'automation-recovery/recovery-policy'
    );
    await post({
      scheduleRevision: 0,
      intervalInDays: 1,
      publishDate: new Date(Date.now() - 10 * 86400000),
    });
    await test(
      'FG01 immutable dry-run persists proposed T0, decisions and hashes; no client write',
      ['R04', 'R19'],
      async () => {
        const before = await db.post.findMany(),
          source = await capture(),
          m = await manifests.draft('operator', 'draft-1', cutoff, source, 2);
        assert.equal(m.phase, 'COMPLETE');
        assert.equal(m.cursor, m.itemCount);
        assert(
          m.items.some((i) => i.reason === 'RECURRENCE_ANCHOR_UNRESOLVED')
        );
        assert.equal(
          (
            await db.automationRecoveryControl.findUnique({
              where: { id: 'global' },
            })
          ).phase,
          'BLOCKED'
        );
        assert.equal(
          (
            await db.automationRecoveryRun.findUnique({
              where: { id: 'draft-1' },
            })
          ).authorizedAt,
          null
        );
        assert.equal(
          inventoryHash(before),
          inventoryHash(await db.post.findMany())
        );
        assert.equal(calls.length, 0);
        const check = await manifests.revalidate(
          'operator',
          m.id,
          source,
          cutoff
        );
        assert.equal(check.matches, true);
        assert.equal(check.activationAuthorized, false);
        const h = await reconciliation.history(
          'org-a',
          before[0].id,
          'admin-a'
        );
        assert(
          h.inventoryIssues.some(
            (i) => i.reason === 'RECURRENCE_ANCHOR_UNRESOLVED'
          )
        );
        assert.equal(h.occurrences.length, 0);
      }
    );
    for (const mode of ['before-commit', 'after-commit'])
      await test(
        'FG02 real process manifest crash ' + mode,
        ['R14'],
        async () => {
          const source = await capture(),
            recoveryId = key(),
            file = path.join(process.cwd(), key() + '.json');
          fs.writeFileSync(
            file,
            JSON.stringify({ source, recoveryId, cutoffAt: cutoff })
          );
          const r = spawnSync(
            process.execPath,
            [
              path.join(
                root,
                'diagnostics/recovery/fg-manifest-crash-child.cjs'
              ),
              root,
              url,
              endpoint,
              file,
              mode,
            ],
            { env: process.env, windowsHide: true, encoding: 'utf8' }
          );
          assert.equal(r.status, 87, r.stderr);
          const m = await db.recoveryManifest.findFirstOrThrow({
            where: { recoveryId },
          });
          assert.equal(m.cursor, mode === 'before-commit' ? 0 : 1);
          const resumed = await manifests.draft(
            'operator',
            recoveryId,
            cutoff,
            source,
            1
          );
          assert.equal(resumed.cursor, resumed.itemCount);
          assert.equal(resumed.phase, 'COMPLETE');
          assert.equal(
            new Set(resumed.items.map((i) => i.subjectKey)).size,
            resumed.items.length
          );
        }
      );
    await test(
      'FG03 concurrent classifiers are idempotent; unauthorized operator cannot prepare',
      ['R13', 'R31'],
      async () => {
        const source = await capture(),
          id = key(),
          [a, b] = await Promise.all([
            manifests.draft('operator', id, cutoff, source, 1),
            manifests.draft('operator', id, cutoff, source, 1),
          ]);
        assert.equal(a.id, b.id);
        assert.equal(a.manifestHash, b.manifestHash);
        await assert.rejects(
          manifests.draft('admin-a', key(), cutoff, source),
          (x) => x.reason === 'INVENTORY_OPERATOR_UNAUTHORIZED'
        );
      }
    );
    await test(
      'FG04 changed cutoff/source and tampered item invalidate a complete manifest',
      ['R04', 'R14'],
      async () => {
        let source = await capture(),
          m = await manifests.draft('operator', key(), cutoff, source);
        assert.equal(
          (
            await manifests.revalidate(
              'operator',
              m.id,
              source,
              new Date(+cutoff + 1)
            )
          ).reason,
          'CUTOFF_CHANGED_NEW_MANIFEST_REQUIRED'
        );
        m = await manifests.draft('operator', key(), cutoff, source);
        await post();
        const changed = await capture();
        assert.equal(
          (await manifests.revalidate('operator', m.id, changed, cutoff))
            .reason,
          'SOURCE_CHANGED'
        );
        m = await manifests.draft('operator', key(), cutoff, changed);
        await db.recoveryManifestItem.update({
          where: { manifestId_ordinal: { manifestId: m.id, ordinal: 0 } },
          data: { metadata: { tampered: true } },
        });
        assert.equal(
          (await manifests.revalidate('operator', m.id, changed, cutoff))
            .matches,
          false
        );
      }
    );
    await test(
      'FG05 fixed cadence inventory skips missed/manual/confirmed slots; no catch-up',
      ['R16', 'R18', 'R20'],
      async () => {
        const anchor = new Date(+cutoff - 4 * 86400000),
          p = await post({ intervalInDays: 1, publishDate: anchor });
        for (let n = 0; n <= 4; n++) {
          const o = await createOccurrence(p, new Date(+anchor + n * 86400000));
          await db.publicationScheduleIntent.create({
            data: {
              occurrenceId: o.id,
              organizationId: 'org-a',
              workflowId: key(),
              generation: 0,
              snapshot: {},
              source: 'SYNTHETIC_REVIEW',
              seriesAnchor: anchor,
              intervalDays: 1,
            },
          });
          if (n === 0)
            await db.publicationOccurrence.update({
              where: { id: o.id },
              data: { outcome: 'CONFIRMED' },
            });
          if (n === 4)
            await db.publicationEvidence.create({
              data: {
                organizationId: 'org-a',
                occurrenceId: o.id,
                origin: 'manual',
                confirmedById: 'admin-a',
                remoteId: 'manual-reference',
              },
            });
        }
        const m = await manifests.draft(
          'operator',
          key(),
          cutoff,
          await capture()
        );
        const series = m.items.find((i) => i.subjectKey === `series:${p.id}:1`);
        assert.equal(series.decision, 'PRESERVE_SERIES');
        assert.equal(
          series.metadata.nextScheduledAt,
          new Date(+cutoff + 86400000).toISOString()
        );
        assert.equal(calls.length, 0);
      }
    );
    const aliases = e.aliases;
    const options = {
      workflowsPath: path.join(
        root,
        'diagnostics/recovery/fixture-workflows.ts'
      ),
      webpackConfigHook: (c) => {
        c.resolve.alias = {
          ...c.resolve.alias,
          ...Object.fromEntries(
            Object.entries(aliases).map(([k, v]) => [
              k.slice(0, -1),
              path.join(root, v),
            ])
          ),
        };
        for (const rule of c.module.rules || [])
          for (const loader of Array.isArray(rule.use) ? rule.use : [rule.use])
            if (
              loader &&
              typeof loader === 'object' &&
              String(loader.loader).includes('swc-loader')
            )
              loader.options = {
                ...loader.options,
                swcrc: false,
                configFile: false,
              };
        return c;
      },
    };
    bundle = await bundleWorkflowCode(options);
    bundlePath = path.join(process.cwd(), 'fg-workflows.cjs');
    fs.writeFileSync(bundlePath, bundle.code);
    await open();
    await worker('main');
    await worker('linkedin');
    await test(
      'FG06 V106 preserves success notification, streak and thread webhook payload',
      ['R12', 'R27'],
      async () => {
        const p = await post({ publishDate: new Date(Date.now() + 1000) }),
          child = await post({
            group: p.group,
            parentPostId: p.id,
            publishDate: p.publishDate,
          });
        const f = await start106(p);
        await finish(f.h);
        assert.equal(pubs(p.id).length, 1);
        assert.equal(pubs(child.id).length, 1);
        const notification = calls.find(
          (c) =>
            c.path === '/notification' &&
            c.body.post?.releaseURL === 'https://example.test/' + p.id
        );
        assert(notification);
        assert.equal(notification.body.type, 'success');
        assert.equal(notification.body.post.accountName, 'Synthetic Account');
        const hook = calls.find(
          (c) => c.path === '/webhook' && c.body[0]?.id === p.id
        );
        assert(hook);
        assert(hook.idempotencyKey);
        assert.equal(hook.body[0].releaseURL, 'https://example.test/' + p.id);
        const ledger = await db.automationEffectAttempt.findMany({
          where: { subjectKey: `completion:${f.descriptor.occurrenceId}` },
        });
        assert.equal(ledger.length, 3);
        assert(ledger.every((x) => x.phase === 'ACKNOWLEDGED'));
        await until(async () => {
          const h = await client.workflow
            .getHandle('streak_org-a')
            .fetchHistory();
          return h.events.some((e) => e.timerStartedEventAttributes);
        });
      }
    );
    await test(
      'FG07 uncertain webhook cannot retry or taint confirmed primary',
      ['R13', 'R15'],
      async () => {
        modes.set('/webhook', 'lost');
        const p = await post(),
          f = await start106(p);
        await finish(f.h);
        modes.delete('/webhook');
        const context = {
            workflowId: f.h.workflowId,
            runId: f.h.firstExecutionRunId,
            protocolVersion: 1,
          },
          before = calls.filter((c) => c.path === '/webhook').length;
        await e.completion.run(context, f.descriptor, 'thread');
        assert.equal(calls.filter((c) => c.path === '/webhook').length, before);
        assert.equal(pubs(p.id).length, 1);
        const h = await reconciliation.history('org-a', p.id, 'admin-a');
        assert.equal(h.occurrences[0].automaticOutcome, 'CONFIRMED');
        assert(!h.occurrences[0].attempts.some((a) => a.phase === 'UNCERTAIN'));
        assert(
          h.occurrences[0].completionActions.some(
            (a) => a.phase === 'UNCERTAIN'
          )
        );
      }
    );
    for (const version of [101, 102, 103, 104, 105])
      await test(
        `FG08 V${version} queued legacy provider activity is expired after a second cutoff`,
        ['R06'],
        async () => {
          const queue = `fg-provider-paused-${version}`,
            p = await post({ publishDate: new Date(Date.now() + 2000) }),
            f = await legacy(p, queue, false, version);
          await history(f.h);
          await open(new Date(Date.now()));
          const w = await worker(queue);
          try {
            await finish(f.h);
          } finally {
            await closeWorker(w);
          }
          assert.equal(pubs(p.id).length, 0);
          assert.equal(
            (await db.post.findUnique({ where: { id: p.id } })).state,
            'ERROR'
          );
        }
      );
    for (const version of [101, 102, 103, 104, 105])
      await test(
        `FG09 V${version} actual activity retry rechecks T0 before any provider HTTP`,
        ['R06', 'R30'],
        async () => {
          await open();
          const queue = `fg-retry-paused-${version}`,
            p = await post(),
            f = await legacy(p, queue, false, version);
          let failed = false;
          const activities = {
            ...e.activities,
            postSocial: async (...args) => {
              if (!failed) {
                failed = true;
                throw req('@temporalio/common').ApplicationFailure.create({
                  message: 'Synthetic before-gate failure',
                  type: 'synthetic_pre_effect',
                  nextRetryDelay: '3 seconds',
                });
              }
              return e.activities.postSocial(...args);
            },
          };
          const w = await worker(queue, activities);
          await until(() => failed);
          await until(async () => {
            const d = await f.h.describe();
            return d.raw.pendingActivities?.some((a) => a.attempt >= 2);
          });
          await history(f.h);
          await open(new Date(Date.now()));
          try {
            await finish(f.h);
          } finally {
            await closeWorker(w);
          }
          assert.equal(pubs(p.id).length, 0);
        }
      );
    await test(
      'FG10 explicit future revision wins over a queued legacy activity',
      ['R09', 'R30'],
      async () => {
        await open();
        const p = await post(),
          old = await legacy(p, 'fg-edit-paused'),
          at = new Date(Date.now() + 2000);
        const edited = await e.repository.changeDate(
          'org-a',
          p.id,
          at.toISOString(),
          false,
          'schedule'
        );
        assert.equal(edited.scheduleRevision, 2);
        const future = await start106(edited);
        await worker('fg-edit-paused');
        await finish(old.h);
        await finish(future.h);
        assert.equal(pubs(p.id).length, 1);
        assert(pubs(p.id)[0].at >= +at);
        const current = await db.post.findUnique({ where: { id: p.id } });
        assert.equal(current.state, 'PUBLISHED');
        assert.equal(current.scheduleRevision, 2);
        assert.equal(+current.publishDate, +at);
      }
    );
    await test(
      'FG11 late thread receipt cannot overwrite manual proof or a new revision',
      ['R12'],
      async () => {
        const p = await post(),
          child = await post({
            group: p.group,
            parentPostId: p.id,
            publishDate: p.publishDate,
          });
        const original = e.recovery.projectPublication.bind(e.recovery);
        let release,
          entered = false;
        e.recovery.projectPublication = async (...args) => {
          if (
            args[0].snapshots[0].id === p.id &&
            args[0].snapshots[0].scheduleRevision === 1
          ) {
            entered = true;
            await new Promise((r) => {
              release = r;
            });
          }
          return original(...args);
        };
        try {
          const old = await start106(p);
          await until(() => entered);
          await reconciliation.confirmManual('org-a', p.id, 'admin-a', {
            occurrenceId: old.descriptor.occurrenceId,
            requestId: randomUUID(),
            remoteId: 'manual-old-reference',
            remoteUrl: 'https://example.test/manual',
            attestation: 'CONFIRM_MANUAL_PUBLICATION',
          });
          const at = new Date(Date.now() + 1000),
            edited = await e.repository.changeDate(
              'org-a',
              p.id,
              at.toISOString(),
              false,
              'schedule'
            );
          const next = await start106(edited);
          release();
          await finish(old.h, true);
          await finish(next.h);
          const now = await db.post.findUnique({ where: { id: p.id } });
          assert.equal(now.scheduleRevision, 2);
          assert.equal(now.state, 'PUBLISHED');
          assert.equal(+now.publishDate, +at);
          assert.equal(pubs(p.id).length, 2);
          assert.equal(pubs(child.id).length, 1);
          assert.equal(
            await db.publicationEvidence.count({
              where: {
                occurrenceId: old.descriptor.occurrenceId,
                remoteId: 'manual-old-reference',
              },
            }),
            1
          );
        } finally {
          if (release) release();
          e.recovery.projectPublication = original;
        }
      }
    );
    await test(
      'FG12 two real worker processes reserve one logical publication',
      ['R13'],
      async () => {
        await open();
        const p = await post(),
          occurrence = await createOccurrence(p),
          handles = [];
        const starts = await Promise.allSettled([
          startProcess('fg-multi'),
          startProcess('fg-multi'),
        ]);
        const failedStart = starts.find((s) => s.status === 'rejected');
        if (failedStart) {
          await Promise.all(starts.filter((s) => s.status === 'fulfilled').map((s) => stopProcess(s.value)));
          throw failedStart.reason;
        }
        const [a, b] = starts.map((s) => s.value);
        assert.notEqual(a.pid, b.pid);
        await until(async()=>{
          const queue=await client.workflowService.describeTaskQueue({namespace:'default',taskQueue:{name:'fg-multi'},taskQueueType:2});
          return queue.pollers.length>=2;
        });
        for (let n = 0; n < 2; n++) {
          const id = key(),
            h = await client.workflow.start('postWorkflowV105', {
              workflowId: id,
              taskQueue: 'fg-multi-main',
              args: [
                {
                  postId: p.id,
                  organizationId: p.organizationId,
                  taskQueue: 'fg-multi',
                  postNow: true,
                },
              ],
              workflowExecutionTimeout: '90 seconds',
            });
          const context = {
            workflowId: id,
            runId: h.firstExecutionRunId,
            protocolVersion: 1,
            organizationId: 'org-a',
            integrationId: p.integrationId,
            snapshots: [p],
            actionKey: `publication:${p.id}`,
            plannedAt: p.publishDate,
          };
          await db.automationWorkflowBinding.create({
            data: {
              organizationId: 'org-a',
              workflowId: id,
              runId: context.runId,
              occurrenceId: occurrence.id,
              actionKey: context.actionKey,
              expectedRequestHash: publicationRequestHash(context),
            },
          });
          handles.push(h);
        }
        modes.set(p.id, 'hold');
        try {
          await worker('fg-multi-main');
          // Hold the owner's remote ACK until both distinct processes have
          // entered the actual publication activity. Pollers alone do not
          // prove that both processes participated in the reservation race.
          await until(() => [a,b].every((c) => c.activityStarts.includes('postSocial')) && modes.has('release:' + p.id));
          const release = modes.get('release:' + p.id);
          modes.delete('release:' + p.id);
          release();
          await Promise.all(handles.map((h) => finish(h, true)));
        } finally {
          modes.get('release:' + p.id)?.();
          modes.delete('release:' + p.id);
          modes.delete(p.id);
          await Promise.all([stopProcess(a), stopProcess(b)]);
        }
        assert.equal(pubs(p.id).length, 1);
        assert.equal((await db.post.findUniqueOrThrow({where:{id:p.id}})).state, 'PUBLISHED');
        assert.equal(
          await db.automationEffectAttempt.count({
            where: {
              occurrenceId: occurrence.id,
              actionKey: `publication:${p.id}`,
            },
          }),
          1
        );
        const input = {
          occurrenceId: occurrence.id,
          requestId: randomUUID(),
          remoteId: 'manual-checked',
          remoteUrl: 'https://example.test/check',
          attestation: 'CONFIRM_MANUAL_PUBLICATION',
        };
        const [x, y] = await Promise.all([
          reconciliation.confirmManual('org-a', p.id, 'admin-a', input),
          reconciliation.confirmManual('org-a', p.id, 'admin-a', input),
        ]);
        assert.equal(x.id, y.id);
      }
    );
    await test(
      'FG13 actual hourly reconciler and former two-day reader cannot revive expired posts',
      ['R07'],
      async () => {
        const p = await post({ publishDate: new Date(+cutoff - 5 * 86400000) }),
          h = await client.workflow.start('missingPostWorkflow', {
            workflowId: key(),
            taskQueue: 'main',
            workflowExecutionTimeout: '90 seconds',
          });
        await until(async () => {
          const hst = await h.fetchHistory();
          return hst.events.some((v) => v.timerStartedEventAttributes);
        });
        await history(h);
        assert.equal(
          (await db.post.findUnique({ where: { id: p.id } })).state,
          'ERROR'
        );
        assert.equal(pubs(p.id).length, 0);
        const before = calls.length;
        await e.posts.searchForMissingThreeHoursPosts();
        assert.equal(calls.length, before);
      }
    );
    await test(
      'FG14 real HTTP JWT/membership, DTO and manual confirmation contract',
      ['R11', 'R31'],
      async () => {
        const { PostsController } = req(
          path.join(root, 'apps/backend/src/api/routes/posts.controller.ts')
        );
        const { AuthMiddleware } = req(
          path.join(root, 'apps/backend/src/services/auth/auth.middleware.ts')
        );
        const { Test } = req('@nestjs/testing'),
          { ValidationPipe } = req('@nestjs/common');
        const types = Reflect.getMetadata('design:paramtypes', PostsController);
        const module = await Test.createTestingModule({
          controllers: [PostsController],
          providers: types.map((provide, index) => ({
            provide,
            useValue: index === 4 ? reconciliation : {},
          })),
        }).compile();
        app = module.createNestApplication({ logger: false });
        app.use(req('cookie-parser')());
        const auth = new AuthMiddleware(
          {
            getOrgsByUserId: (userId) =>
              db.organization.findMany({
                where: { users: { some: { userId } } },
                include: {
                  users: {
                    where: { userId },
                    select: { disabled: true, role: true },
                  },
                },
              }),
            updateApiKey: async () => {
              throw Error('Synthetic orgs must already have apiKey');
            },
            getUserOrg: (id) =>
              db.userOrganization.findUnique({
                where: { id },
                include: {
                  user: true,
                  organization: { include: { users: true } },
                },
              }),
          },
          { getUserById: (id) => db.user.findUnique({ where: { id } }) }
        );
        app.use((request, response, next) =>
          Promise.resolve(auth.use(request, response, next)).catch((error) =>
            response
              .status(error.getStatus?.() || 500)
              .json({ code: 'AUTHORIZATION_DENIED' })
          )
        );
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.listen(0, '127.0.0.1');
        const base = await app.getUrl(),
          { AuthService } = req(
            path.join(root, 'libraries/helpers/src/auth/auth.service.ts')
          );
        const request = async (method, route, user, body, headers = {}) =>
          new Promise((resolve, reject) => {
            const target = new URL(route, base),
              raw = body ? JSON.stringify(body) : null;
            const r = http.request(
              target,
              {
                method,
                headers: {
                  ...(user
                    ? {
                        auth: AuthService.signJWT({
                          id: user,
                          isSuperAdmin: true,
                        }),
                      }
                    : {}),
                  ...headers,
                  ...(raw
                    ? {
                        'content-type': 'application/json',
                        'content-length': Buffer.byteLength(raw),
                      }
                    : {}),
                },
              },
              (res) => {
                let output = '';
                res.on('data', (b) => (output += b));
                res.on('end', () =>
                  resolve({
                    status: res.statusCode,
                    body: output ? JSON.parse(output) : null,
                  })
                );
              }
            );
            r.on('error', reject);
            if (raw) r.write(raw);
            r.end();
          });
        const p = await post({ publishDate: new Date(+cutoff - 1) });
        assert.equal(await e.scheduling.stagePost('org-a', p.id), null);
        const o = await db.publicationOccurrence.findFirstOrThrow({
            where: { postId: p.id },
          }),
          route = `/posts/${p.id}`,
          input = {
            occurrenceId: o.id,
            requestId: randomUUID(),
            remoteId: 'manual-http-proof',
            remoteUrl: 'https://example.test/manual',
            attestation: 'CONFIRM_MANUAL_PUBLICATION',
          };
        assert.equal(
          (await request('GET', route + '/recovery-history')).status,
          403
        );
        assert.equal(
          (
            await request('GET', route + '/recovery-history', null, null, {
              auth: 'invalid-synthetic-jwt',
            })
          ).status,
          403
        );
        assert.equal(
          (
            await request('GET', route + '/recovery-history', 'admin-b', null, {
              showorg: 'org-a',
            })
          ).status,
          404
        );
        assert.equal(
          (
            await request(
              'POST',
              route + '/manual-publication-confirmation',
              'admin-b',
              input,
              { showorg: 'org-a' }
            )
          ).status,
          404
        );
        const reader = await request(
          'GET',
          route + '/recovery-history',
          'reader-a'
        );
        assert.equal(reader.status, 200);
        assert.equal(reader.body.canConfirmManual, false);
        assert.equal(
          (
            await request(
              'POST',
              route + '/manual-publication-confirmation',
              'reader-a',
              input
            )
          ).status,
          403
        );
        for (const bad of [
          { ...input, attestation: 'NO' },
          { ...input, requestId: 'not-a-uuid' },
          { ...input, remoteUrl: 'http://example.test/no' },
          { ...input, remoteUrl: 'https://example.test/?token=secret' },
          { ...input, remoteId: 'x'.repeat(2049) },
        ])
          assert.equal(
            (
              await request(
                'POST',
                route + '/manual-publication-confirmation',
                'admin-a',
                bad
              )
            ).status,
            400
          );
        const [a, b] = await Promise.all([
          request(
            'POST',
            route + '/manual-publication-confirmation',
            'admin-a',
            { ...input, userId: 'admin-b', organizationId: 'org-b' }
          ),
          request(
            'POST',
            route + '/manual-publication-confirmation',
            'admin-a',
            input
          ),
        ]);
        assert.equal(a.status, 201);
        assert.equal(b.status, 201);
        assert.equal(a.body.id, b.body.id);
        const proof = await db.publicationEvidence.findUniqueOrThrow({
          where: { id: a.body.id },
        });
        assert.equal(proof.organizationId, 'org-a');
        assert.equal(proof.confirmedById, 'admin-a');
        const output = await request(
          'GET',
          route + '/recovery-history',
          'admin-a'
        );
        assert.equal(output.body.occurrences[0].automaticOutcome, 'EXPIRED');
        assert.equal(
          (await db.post.findUnique({ where: { id: p.id } })).state,
          'ERROR'
        );
        assert.equal(pubs(p.id).length, 0);
        await db.userOrganization.update({
          where: {
            userId_organizationId: {
              userId: 'admin-a',
              organizationId: 'org-a',
            },
          },
          data: { role: 'USER' },
        });
        assert.equal(
          (
            await request(
              'POST',
              route + '/manual-publication-confirmation',
              'admin-a',
              { ...input, requestId: randomUUID() }
            )
          ).status,
          403
        );
        await db.userOrganization.update({
          where: {
            userId_organizationId: {
              userId: 'admin-a',
              organizationId: 'org-a',
            },
          },
          data: { role: 'ADMIN' },
        });
        for (const patch of [
          { disabledAt: new Date() },
          { activated: false },
        ]) {
          await db.user.update({ where: { id: 'admin-a' }, data: patch });
          const r = await request(
            'GET',
            route + '/recovery-history',
            'admin-a'
          );
          assert([403, 423].includes(r.status));
          await db.user.update({
            where: { id: 'admin-a' },
            data: { disabledAt: null, activated: true },
          });
        }
        await db.organization.update({
          where: { id: 'org-a' },
          data: { suspendedAt: new Date() },
        });
        assert.equal(
          (await request('GET', route + '/recovery-history', 'admin-a')).status,
          423
        );
        await db.organization.update({
          where: { id: 'org-a' },
          data: { suspendedAt: null },
        });
      }
    );
    await test(
      'FG15 actual V106 future timer remains on UTC slot across timezone offsets',
      ['R20'],
      async () => {
        const at = new Date(Date.now() + 1000),
          offset = new Date(+at - 3 * 3600000)
            .toISOString()
            .replace('Z', '-03:00');
        assert.equal(+new Date(offset), +at);
        const p = await post({ publishDate: new Date(offset) }),
          f = await start106(p);
        await pause(100);
        assert.equal(pubs(p.id).length, 0);
        await finish(f.h);
        assert(pubs(p.id)[0].at >= +at);
        const intent = await db.publicationOccurrence.findUniqueOrThrow({
          where: { id: f.descriptor.occurrenceId },
        });
        assert.equal(+intent.scheduledAt, +at);
      }
    );
    for (const version of [101, 102, 103, 104, 105])
      await test(
        `FG17 V${version} legacy ABANDON child remains independently guarded after parent completion`,
        ['R17', 'R30'],
        async () => {
          const p = await post({ publishDate: new Date(+cutoff - 1) }),
            childId = key();
          const parent = await client.workflow.start('recoveryAbandonFixture', {
            workflowId: key(),
            taskQueue: 'main',
            args: [
              {
                postId: p.id,
                organizationId: p.organizationId,
                childWorkflowId: childId,
                version,
                childTaskQueue: `fg-abandon-paused-${version}`,
              },
            ],
            workflowExecutionTimeout: '90 seconds',
          });
          const childRun = await finish(parent),
            h = client.workflow.getHandle(childId, childRun),
            occurrence = await createOccurrence(p);
          const context = {
            workflowId: childId,
            runId: childRun,
            protocolVersion: 1,
            organizationId: 'org-a',
            integrationId: p.integrationId,
            snapshots: [p],
            plannedAt: p.publishDate,
            actionKey: `publication:${p.id}`,
          };
          await db.automationWorkflowBinding.create({
            data: {
              organizationId: 'org-a',
              workflowId: childId,
              runId: childRun,
              occurrenceId: occurrence.id,
              actionKey: context.actionKey,
              expectedRequestHash: publicationRequestHash(context),
            },
          });
          assert.equal(
            (await h.describe()).parentExecution.workflowId,
            parent.workflowId
          );
          assert.equal((await h.describe()).status.name, 'RUNNING');
          await history(h);
          const w = await worker(`fg-abandon-paused-${version}`);
          try {
            await finish(h);
          } finally {
            await closeWorker(w);
          }
          assert.equal(pubs(p.id).length, 0);
          assert.equal(
            (
              await db.publicationOccurrence.findUnique({
                where: { id: occurrence.id },
              })
            ).outcome,
            'EXPIRED'
          );
        }
      );
    await test(
      'FG18 expired recurring parent gets one replacement and one next child on original cadence',
      ['R18', 'R16', 'R30'],
      async () => {
        const at = new Date(Date.now() + 1500),
          anchor = new Date(+at - 86400000),
          p = await post({ publishDate: anchor, intervalInDays: 1 });
        const [a, b] = await Promise.all([
          e.scheduling.stagePost('org-a', p.id),
          e.scheduling.stagePost('org-a', p.id),
        ]);
        assert.equal(a.workflowId, b.workflowId);
        assert.equal(+new Date(a.scheduledAt), +at);
        await Promise.all([e.scheduling.enqueue(a), e.scheduling.enqueue(b)]);
        const h = client.workflow.getHandle(a.workflowId);
        await finish(h);
        const slots = await db.publicationOccurrence.findMany({
          where: { postId: p.id },
          orderBy: { scheduledAt: 'asc' },
        });
        assert.equal(slots.length, 3);
        assert.equal(slots[0].outcome, 'EXPIRED');
        assert.equal(slots[1].outcome, 'CONFIRMED');
        assert.equal(+slots[2].scheduledAt, +at + 86400000);
        assert.equal(pubs(p.id).length, 1);
        assert(pubs(p.id)[0].at >= +at);
        assert.equal(
          await db.automationEffectAttempt.count({
            where: { occurrenceId: slots[0].id },
          }),
          0
        );
        const next = await db.publicationScheduleIntent.findUnique({
            where: { occurrenceId: slots[2].id },
          }),
          nextH = client.workflow.getHandle(next.workflowId);
        await until(async () => {
          const x = await nextH.fetchHistory();
          return x.events.some((v) => v.timerStartedEventAttributes);
        });
        await history(nextH);
      }
    );
    await test(
      'FG19 all unavailable states and an administrative race preserve restrictions',
      ['R31'],
      async () => {
        const patches = [
          ['integration', { disabled: true }],
          ['integration', { refreshNeeded: true }],
          ['integration', { inBetweenSteps: true }],
          ['integration', { deletedAt: new Date() }],
          ['organization', { suspendedAt: new Date() }],
          ['post', { adminPausedAt: new Date() }],
          ['post', { deletedAt: new Date() }],
        ];
        for (const [model, patch] of patches) {
          const p = await post({ publishDate: new Date(Date.now() + 500) }),
            f = await start106(p);
          const where = {
            id:
              model === 'integration'
                ? 'channel-a'
                : model === 'organization'
                ? 'org-a'
                : p.id,
          };
          await db[model].update({ where, data: patch });
          await finish(f.h, true);
          assert.equal(pubs(p.id).length, 0);
          const row = await db[model].findUnique({ where });
          for (const k of Object.keys(patch)) assert(row[k]);
          await db[model].update({
            where,
            data: Object.fromEntries(
              Object.keys(patch).map((k) => [
                k,
                typeof patch[k] === 'boolean' ? false : null,
              ])
            ),
          });
        }
        const p = await post(),
          original = e.recovery.prisma;
        let changed = false;
        e.recovery.prisma = new Proxy(original, {
          get(target, key) {
            if (key === '$transaction')
              return async (fn, opts) => {
                let claimed = false;
                const value = await target.$transaction(
                  (tx) =>
                    fn(
                      new Proxy(tx, {
                        get(t, k) {
                          if (k === 'automationEffectAttempt')
                            return new Proxy(t[k], {
                              get(delegate, method) {
                                if (method === 'create')
                                  return async (args) => {
                                    const row = await delegate.create(args);
                                    if (
                                      args.data.actionKey ===
                                      `publication:${p.id}`
                                    )
                                      claimed = true;
                                    return row;
                                  };
                                return delegate[method];
                              },
                            });
                          return t[k];
                        },
                      })
                    ),
                  opts
                );
                if (claimed && !changed) {
                  changed = true;
                  await db.integration.update({
                    where: { id: 'channel-a' },
                    data: { disabled: true },
                  });
                }
                return value;
              };
            const v = target[key];
            return typeof v === 'function' ? v.bind(target) : v;
          },
        });
        try {
          const f = await start106(p);
          await finish(f.h, true);
          assert(changed);
          assert.equal(pubs(p.id).length, 0);
          assert.equal(
            (await db.integration.findUnique({ where: { id: 'channel-a' } }))
              .disabled,
            true
          );
        } finally {
          e.recovery.prisma = original;
          await db.integration.update({
            where: { id: 'channel-a' },
            data: { disabled: false },
          });
        }
      }
    );
    await test(
      'FG20 prior V106 history replays with completion patch disabled',
      ['R30'],
      async () => {
        const oldBundle = await bundleWorkflowCode({
          ...options,
          webpackConfigHook: (c) => {
            const config = options.webpackConfigHook(c),
              { NormalModuleReplacementPlugin } = req('webpack');
            config.plugins.push(
              new NormalModuleReplacementPlugin(
                /post\.workflow\.v1\.0\.6(?:\.ts)?$/,
                (resource) => {
                  resource.request = path.join(
                    root,
                    'diagnostics/recovery/fixtures/v106-before-completion.workflow.ts'
                  );
                }
              )
            );
            return config;
          },
        });
        await worker('fg-old-v106', e.activities, oldBundle);
        const p = await post(),
          f = await start106(p, { queue: 'fg-old-v106' });
        await finish(f.h);
        const recorded = await f.h.fetchHistory(),
          before = calls.length;
        assert(
          !recorded.events.some(
            (e) => e.markerRecordedEventAttributes?.markerName === 'core_patch'
          )
        );
        await Worker.runReplayHistory(
          { workflowBundle: bundle },
          recorded,
          f.h.workflowId
        );
        assert.equal(calls.length, before);
        assert.equal(pubs(p.id).length, 1);
      }
    );
    await test(
      'FG21 read-only complete namespace inventory captures retry/timer/ABANDON metadata without payloads',
      ['R04', 'R17', 'R19'],
      async () => {
        const source = await capture(),
          serialized = JSON.stringify(source);
        assert(!serialized.includes('synthetic-only'));
        assert(!serialized.includes('Synthetic body'));
        assert(
          source.workflows.some(
            (w) => w.workflowType === 'missingPostWorkflow'
          ),
          'Zero-argument producer activities must remain readable'
        );
        assert(
          source.workflows.some((w) =>
            w.children.some((c) => c.parentClosePolicy === 2)
          )
        );
        assert(source.workflows.some((w) => w.timers.length));
        assert(
          source.workflows.some(
            (w) => w.pendingActivities.length || w.activities.length
          )
        );
        assert(source.queues.some((q) => q.name === 'facebook'));
        const derived = source.workflows.filter((w) =>
          w.workflowType?.startsWith('postWorkflow')
        );
        assert(derived.every((w) => w.historyHash && w.lastEventId));
      }
    );
    await test(
      'FG22 external observation survives a native stall and three isolated restarts',
      ['R29'],
      async () => {
        const p = await post({ publishDate: new Date(+cutoff - 1) });
        await e.scheduling.stagePost('org-a', p.id);
        const snapshot = inventoryHash({
          control: await db.automationRecoveryControl.findUnique({
            where: { id: 'global' },
          }),
          decisions: await db.automationRecoveryDecision.findMany({
            orderBy: { id: 'asc' },
          }),
        });
        // The observer itself has no restart API; only this owned fixture kills its
        // synthetic children. No orchestrator/PM2/Docker process is restarted.
        const { observe } = req(
          path.join(root, 'scripts/recovery/watchdog-observe.cjs')
        );
        const originalFetch = global.fetch;
        global.fetch = (...args) => req('undici').fetch(...args);
        try {
          for (let n = 0; n < 3; n++) {
            const c = spawn(
              process.execPath,
              [
                path.join(root, 'diagnostics/recovery/fg-stalled-child.cjs'),
                root,
                url,
              ],
              {
                env: process.env,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
              }
            );
            children.push(c);
            let stdout = '';
            c.stdout.on('data', (b) => (stdout += b));
            c.stderr.on('data', () => {});
            try {
              const message = await new Promise((resolve, reject) => {
                const timer = setTimeout(
                  () => reject(Error('Synthetic stall readiness deadline')),
                  30000
                );
                c.once('message', (m) => {
                  clearTimeout(timer);
                  resolve(m);
                });
                c.once('error', reject);
                c.once('exit', () =>
                  reject(Error('Synthetic stalled child exited early'))
                );
              });
              assert(message.consumptionBlocked);
              const observed = await observe({
                endpoint: `http://127.0.0.1:${message.port}/health/status`,
                timeoutMs: 250,
              });
              assert.equal(observed.health, 'UNREACHABLE');
              assert.equal(observed.restartEnabled, false);
              assert.equal(observed.workerActivationEnabled, false);
              assert.equal(stdout, '');
            } finally {
              if (c.exitCode === null && c.signalCode === null)
                await new Promise((resolve) => {
                  c.once('exit', resolve);
                  c.kill();
                });
            }
            const current = inventoryHash({
              control: await db.automationRecoveryControl.findUnique({
                where: { id: 'global' },
              }),
              decisions: await db.automationRecoveryDecision.findMany({
                orderBy: { id: 'asc' },
              }),
            });
            assert.equal(current, snapshot);
          }
        } finally {
          global.fetch = originalFetch;
        }
        assert.equal(pubs(p.id).length, 0);
      }
    );
    await test(
      'FG23 artifact verification rejects old protocol and stale source; never opens workers',
      ['R28'],
      async () => {
        const { createReviewArtifact, verifyReviewArtifact } = req(
            path.join(root, 'scripts/recovery/review-artifact.cjs')
          ),
          artifact = createReviewArtifact();
        assert.equal(verifyReviewArtifact(artifact).protocolVerified, 1);
        assert.throws(() =>
          verifyReviewArtifact({ ...artifact, protocolVersion: 0 })
        );
        assert.throws(() =>
          verifyReviewArtifact({ ...artifact, sourceDigest: 'stale' })
        );
        assert.equal(
          verifyReviewArtifact(artifact).activationAuthorized,
          false
        );
        assert.throws(
          get('automation-recovery/worker-consumption')
            .assertWorkerConsumptionPrepared,
          /ACTIVATION_UNAVAILABLE/
        );
      }
    );
    for (const phase of ['before-checkpoint', 'after-checkpoint'])
      await test(
        'FG24 real YouTube publication service crash ' + phase,
        ['R15', 'R30'],
        async () => {
          await db.integration.upsert({
            where: { id: 'youtube-a' },
            create: {
              id: 'youtube-a',
              organizationId: 'org-a',
              internalId: 'synthetic-yt',
              name: 'Synthetic YouTube',
              type: 'social',
              providerIdentifier: 'youtube',
              token: 'synthetic-only',
            },
            update: {},
          });
          const p = await post({ integrationId: 'youtube-a' }),
            descriptor = await e.scheduling.stagePost('org-a', p.id),
            queue = key();
          const child = await startProcess(queue, { youtubeCrash: phase });
          const h = await client.workflow.start('recoveryDeliveryProbe', {
            workflowId: descriptor.workflowId,
            taskQueue: 'main',
            args: [{ descriptor, queue }],
            workflowExecutionTimeout: '45 seconds',
          });
          await until(() => child.exitCode === 88);
          assert.equal(child.exitCode, 88);
          await worker(queue);
          await finish(h, true);
          assert.equal(
            calls.filter(
              (c) => c.path === '/youtube/insert' && c.body.id === p.id
            ).length,
            1
          );
          const attempt = await db.automationEffectAttempt.findFirstOrThrow({
            where: {
              occurrenceId: descriptor.occurrenceId,
              actionKey: `publication:${p.id}`,
            },
          });
          assert(['CLAIMED', 'UNCERTAIN'].includes(attempt.phase));
          const current = await db.post.findUniqueOrThrow({
            where: { id: p.id },
          });
          if (phase === 'after-checkpoint') {
            assert.equal(current.youtubeVideoId, 'video-' + p.id);
            assert.equal(attempt.remoteId, 'video-' + p.id);
            assert.equal(
              await db.publicationEvidence.count({
                where: {
                  occurrenceId: descriptor.occurrenceId,
                  origin: 'automatic-checkpoint',
                },
              }),
              1
            );
          } else assert.equal(current.youtubeUploadState, 'uploading');
          const again = await client.workflow.start('recoveryDeliveryProbe', {
            workflowId: descriptor.workflowId,
            taskQueue: 'main',
            args: [{ descriptor, queue }],
            workflowExecutionTimeout: '45 seconds',
          });
          await finish(again, true);
          assert.equal(
            calls.filter(
              (c) => c.path === '/youtube/insert' && c.body.id === p.id
            ).length,
            1
          );
        }
      );
    await test(
      'FG25 superseding a partial batch preserves old audit and blocks stale resume',
      ['R14', 'R04'],
      async () => {
        const control = await db.automationRecoveryControl.findUniqueOrThrow({
          where: { id: 'global' },
        });
        await db.automationRecoveryControl.update({
          where: { id: 'global' },
          data: { phase: 'BLOCKED' },
        });
        try {
          const source = await capture(),
            recoveryId = key();
          let pauseOnce = true;
          await assert.rejects(
            manifests.draft(
              'operator',
              recoveryId,
              cutoff,
              source,
              1,
              async () => {
                if (pauseOnce) {
                  pauseOnce = false;
                  throw Error('Synthetic partial batch pause');
                }
              }
            )
          );
          const first = await db.recoveryManifest.findFirstOrThrow({
            where: { recoveryId },
          });
          assert.equal(first.cursor, 1);
          await post();
          const second = await manifests.draft(
            'operator',
            recoveryId,
            cutoff,
            await capture(),
            50
          );
          assert.equal(second.version, 2);
          assert.equal(
            (await db.recoveryManifest.findUnique({ where: { id: first.id } }))
              .phase,
            'INVALIDATED'
          );
          assert.equal(
            await db.recoveryManifestItem.count({
              where: { manifestId: first.id },
            }),
            1
          );
          await assert.rejects(
            manifests.draft('operator', recoveryId, cutoff, source),
            (err) => err.reason === 'MANIFEST_RESUME_MISMATCH'
          );
        } finally {
          await db.automationRecoveryControl.update({
            where: { id: 'global' },
            data: { phase: control.phase },
          });
        }
      }
    );
    await test(
      'FG26 failed series occurrence cannot invalidate its already scheduled future child',
      ['R18', 'R16'],
      async () => {
        await open(new Date(Date.now() - 86400000 - 1000));
        const at = new Date(Date.now() + 2500),
          p = await post({
            publishDate: new Date(+at - 86400000),
            intervalInDays: 1,
          });
        const f = await start106(p);
        await db.integration.update({
          where: { id: 'channel-a' },
          data: { disabled: true },
        });
        try {
          await finish(f.h, true);
          const old = await db.publicationOccurrence.findUniqueOrThrow({
            where: { id: f.descriptor.occurrenceId },
          });
          assert.equal(old.outcome, 'FAILED');
          assert.equal(
            (await db.post.findUnique({ where: { id: p.id } })).state,
            'QUEUE'
          );
          assert.equal(pubs(p.id).length, 0);
        } finally {
          await db.integration.update({
            where: { id: 'channel-a' },
            data: { disabled: false },
          });
        }
        const next = await db.publicationOccurrence.findFirstOrThrow({
            where: { postId: p.id, scheduledAt: at },
          }),
          intent = await db.publicationScheduleIntent.findUniqueOrThrow({
            where: { occurrenceId: next.id },
          });
        await finish(client.workflow.getHandle(intent.workflowId));
        assert.equal(pubs(p.id).length, 1);
        assert(pubs(p.id)[0].at >= +at);
        assert.equal(
          (
            await db.publicationOccurrence.findUnique({
              where: { id: next.id },
            })
          ).outcome,
          'CONFIRMED'
        );
        await open();
      }
    );
    await test(
      'FG27 competing legacy failure cannot invalidate an in-flight claimant',
      ['R13', 'R12'],
      async () => {
        const p = await post();
        modes.set(p.id, 'hold');
        const first = await start106(p);
        await until(() => modes.has('release:' + p.id));
        try {
          const workflowId = key(),
            h = await client.workflow.start('postWorkflowV105', {
              workflowId,
              taskQueue: 'main',
              args: [
                {
                  postId: p.id,
                  organizationId: 'org-a',
                  taskQueue: 'linkedin',
                  postNow: true,
                },
              ],
              workflowExecutionTimeout: '90 seconds',
            });
          const context = {
            workflowId,
            runId: h.firstExecutionRunId,
            protocolVersion: 1,
            organizationId: 'org-a',
            integrationId: p.integrationId,
            snapshots: [p],
            plannedAt: p.publishDate,
            actionKey: `publication:${p.id}`,
          };
          await db.automationWorkflowBinding.create({
            data: {
              organizationId: 'org-a',
              workflowId,
              runId: context.runId,
              occurrenceId: first.descriptor.occurrenceId,
              actionKey: context.actionKey,
              expectedRequestHash: publicationRequestHash(context),
            },
          });
          await finish(h);
          const old = await db.publicationOccurrence.findUniqueOrThrow({
            where: { id: first.descriptor.occurrenceId },
          });
          assert.equal(old.outcome, 'PENDING');
          assert.notEqual(old.attemptState, 'UNCERTAIN');
        } finally {
          modes.get('release:' + p.id)();
          modes.delete(p.id);
        }
        await finish(first.h);
        assert.equal(pubs(p.id).length, 1);
        assert.equal(
          (await db.post.findUnique({ where: { id: p.id } })).state,
          'PUBLISHED'
        );
      }
    );
    await test(
      'FG28 failed thread reply preserves primary and sends a separate failure notification',
      ['R12', 'R30'],
      async () => {
        const p = await post(),
          child = await post({
            group: p.group,
            parentPostId: p.id,
            publishDate: p.publishDate,
          });
        modes.set(child.id, 'lost');
        try {
          const f = await start106(p);
          await finish(f.h, true);
          assert.equal(pubs(p.id).length, 1);
          assert.equal(pubs(child.id).length, 1);
          const result = await reconciliation.history('org-a', p.id, 'admin-a');
          assert.equal(result.occurrences[0].automaticOutcome, 'CONFIRMED');
          assert(
            result.occurrences[0].completionActions.some(
              (a) =>
                a.actionKey === `notification-thread-failure:${child.id}` &&
                a.phase === 'ACKNOWLEDGED'
            )
          );
          assert(
            calls.some(
              (c) =>
                c.path === '/notification' &&
                c.body.type === 'fail' &&
                c.body.post?.releaseURL === 'https://example.test/' + p.id &&
                c.body.message.includes('reply')
            )
          );
          assert.equal(
            calls.filter((c) => c.path === '/webhook' && c.body[0]?.id === p.id)
              .length,
            0
          );
        } finally {
          modes.delete(child.id);
        }
      }
    );
    await test(
      'FG16 pending timers, retries and completed commands replay without HTTP',
      ['R30'],
      async () => {
        const before = calls.length;
        for (const h of histories)
          await Worker.runReplayHistory(
            { workflowBundle: bundle },
            h.history,
            h.id
          );
        assert.equal(calls.length, before);
      }
    );
    const report = {
      scope: 'ISOLATED_F_G_PREPARATION',
      postgres: '17.11',
      temporal: '1.28.2',
      results,
      actualWorkflowTasks: new Set(
        histories.flatMap((h) =>
          h.history.events
            .filter((e) => e.workflowTaskCompletedEventAttributes)
            .map((e) => `${h.id}:${h.runId}:${e.eventId}`)
        )
      ).size,
      workflowTaskCountMethod:
        'distinct workflowId/runId/eventId; repeated history snapshots are not counted twice',
      actualRuns: new Set(histories.map((h) => `${h.id}:${h.runId}`)).size,
      historyCount: histories.length,
      activityChildBootMs: childBoots,
      activityChildBootDeadlineMs: 180000,
      fullMatrixCertified: false,
      productionAuthorized: false,
      activationAuthorized: false,
    };
    fs.writeFileSync(
      path.join(root, 'diagnostics/recovery/fg-recovery-results.json'),
      JSON.stringify(report, null, 2) + '\n'
    );
    console.log(
      JSON.stringify({
        tests: results.length,
        passed: results.filter((r) => r.result === 'PASS').length,
        tasks: report.actualWorkflowTasks,
      })
    );
    if (results.some((r) => r.result === 'FAIL')) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    for (const child of children)
      if (child.exitCode === null)
        await stopProcess(child).catch(() => child.kill());
    for (const w of workers) w.shutdown();
    await Promise.allSettled(running);
    if (app) await app.close();
    if (native) await native.close();
    if (connection) await connection.close();
    if (db) await db.$disconnect();
    if (server) await new Promise((r) => server.close(r));
  }
})();
