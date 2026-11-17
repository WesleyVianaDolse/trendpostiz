const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  { spawn } = require('node:child_process');
const [root, url, address] = process.argv.slice(2),
  u = new URL(url);
assert.equal(u.hostname, '127.0.0.1');
assert.equal(u.username, 'guard_test');
assert.equal(u.pathname, '/guard_test');
assert.match(address, /^127\.0\.0\.1:\d+$/);
let endpoint,
  currentCase = 'setup',
  delay = 100,
  mode = 'ok',
  observed = 10,
  observations = [],
  server,
  client,
  connection,
  native,
  bundle,
  scheduling,
  recovery,
  derived,
  postActivity,
  recoveryActivity,
  sequence = 0,
  crashMode,
  actor = '100';
const results = [],
  calls = [],
  histories = [],
  workers = [],
  running = [],
  attempts = [];
const crashExits = [];
const T0 = new Date(Date.now() - 60_000),
  did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
  cid = 'bafyreid2jizgijv7ey3ebgop2zzhyswq6poct3j5hj6g6lqxxvfv6pwnay';
const key = () => `derived-fixture-${++sequence}`,
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
const parentId = (provider) =>
  provider === 'bluesky'
    ? `at://${did}/app.bsky.feed.post/parent`
    : provider.startsWith('linkedin')
    ? 'urn:li:share:100'
    : '100';
let env, db, manager, get, req, Context, IntegrationService, reconciliation;
const effects = () => calls.filter((c) => c.caseId === currentCase && c.effect),
  mutations = () => calls.filter((c) => c.caseId === currentCase && c.mutation);
const test = async (name, fn) => {
  currentCase = name;
  mode = 'ok';
  observed = 10;
  observations = [];
  delay = 100;
  crashMode = undefined;
  try {
    await fn();
    results.push({
      name,
      result: 'PASS',
      effects: effects().length,
      mutations: mutations().length,
    });
    console.log('PASS', name);
  } catch (e) {
    let cause = e;
    const messages = [];
    for (let n = 0; cause && n < 5; n++, cause = cause.cause)
      messages.push(String(cause.message));
    results.push({
      name,
      result: 'FAIL',
      error: messages.join(' / ').slice(0, 1800),
    });
    console.error('FAIL', name, messages.join(' / ').slice(0, 1800));
  }
};
async function rootFixture(provider, method, internal = false, options = {}) {
  const integrationId = key();
  actor = String(100 + sequence);
  await db.integration
    .create({
      data: {
        id: integrationId,
        organizationId: 'org-a',
        internalId: actor,
        name: 'Synthetic',
        type: 'social',
        providerIdentifier: provider,
        token: 'synthetic:synthetic',
        customInstanceDetails: null,
      },
    })
    .catch(async (error) => {
      throw error;
    });
  if (provider === 'bluesky') {
    const Auth = req(
      path.join(root, 'libraries/helpers/src/auth/auth.service.ts')
    ).AuthService;
    await db.integration.update({
      where: { id: integrationId },
      data: {
        customInstanceDetails: Auth.fixedEncryption(
          JSON.stringify({
            service: endpoint,
            identifier: 'synthetic.test',
            password: 'synthetic-only',
          })
        ),
      },
    });
  }
  const settings = {};
  let identifier, plugId;
  if (internal) {
    const meta = manager
      .getInternalPlugs(provider)
      .internalPlugs.find((p) => p.methodName === method);
    assert(meta, `Missing real internal metadata ${provider}/${method}`);
    identifier = meta.identifier;
    Object.assign(settings, {
      [`plug--${identifier}--active`]: true,
      [`plug--${identifier}--integrations`]: [{ id: integrationId }],
      [`plug--${identifier}--delay`]: 0,
      [`plug--${identifier}--comment`]: 'Synthetic comment',
    });
  } else {
    plugId = key();
    await db.plugs.create({
      data: {
        id: plugId,
        organizationId: 'org-a',
        integrationId,
        plugFunction: method,
        activated: true,
        data: JSON.stringify([
          { name: 'likesAmount', value: '2' },
          { name: 'post', value: 'Synthetic post' },
        ]),
      },
    });
  }
  const post = await db.post.create({
    data: {
      id: key(),
      organizationId: 'org-a',
      integrationId,
      content: 'Synthetic parent',
      settings: JSON.stringify(settings),
      image: '[]',
      group: key(),
      publishDate: options.at || new Date(Date.now() - 1000),
      scheduleRevision: 1,
      state: 'QUEUE',
      intervalInDays: options.recurring ? 1 : null,
    },
  });
  const descriptor = await scheduling.stagePost('org-a', post.id);
  const occurrence = await db.publicationOccurrence.findFirstOrThrow({
    where: { postId: post.id, scheduledAt: post.publishDate },
  });
  const actions = await derived.plan('org-a', occurrence.id);
  assert.equal(actions.length, 1);
  if (options.parent !== false) {
    await db.automationEffectAttempt.create({
      data: {
        id: key(),
        organizationId: 'org-a',
        subjectKey: 'occurrence:' + occurrence.id,
        actionKey: `publication:${post.id}`,
        requestHash: 'synthetic-positive-parent',
        occurrenceId: occurrence.id,
        postId: post.id,
        claimId: randomUUID(),
        generation: 1,
        phase: 'CONFIRMED',
        remoteId: parentId(provider),
        receipt: [
          {
            id: post.id,
            postId: parentId(provider),
            releaseURL: 'https://example.test/parent',
            status: 'posted',
          },
        ],
      },
    });
    await db.publicationOccurrence.update({
      where: { id: occurrence.id },
      data: { outcome: 'CONFIRMED', attemptState: 'CONFIRMED' },
    });
    await db.post.update({
      where: { id: post.id },
      data: {
        state: 'PUBLISHED',
        releaseId: parentId(provider),
        releaseURL: 'https://example.test/parent',
      },
    });
  }
  return {
    post,
    descriptor,
    occurrence,
    action: actions[0],
    plugId,
    identifier,
    provider,
  };
}
async function startDerived(f) {
  const actions = await scheduling.derivedPlan('org-a', f.occurrence.id);
  const handle = await client.workflow.start('derivedPublicationWorkflow', {
    workflowId: `derived-${f.occurrence.id}`,
    taskQueue: 'main',
    args: [
      {
        organizationId: 'org-a',
        rootOccurrenceId: f.occurrence.id,
        taskQueue: 'instagram',
        actions,
      },
    ],
    workflowExecutionTimeout: '90 seconds',
  });
  return handle;
}
async function finish(handle) {
  await handle.result();
  const history = await handle.fetchHistory();
  assert(history.events.some((e) => e.workflowTaskCompletedEventAttributes));
  histories.push({ id: handle.workflowId, history });
  return history;
}
async function action(f) {
  return db.publicationDerivedAction.findUniqueOrThrow({
    where: { id: f.action.id },
  });
}
async function ledger(f) {
  return db.automationEffectAttempt.findMany({
    where: { subjectKey: `derived:${f.action.id}` },
    orderBy: { actionKey: 'asc' },
  });
}
(async () => {
  try {
    server = http.createServer(async (request, response) => {
      let raw = '';
      for await (const b of request) raw += b;
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {}
      const pathname = new URL(request.url, 'http://fixture').pathname;
      const effect =
        request.method === 'POST' &&
        (pathname.endsWith('threads_publish') ||
          pathname === '/rest/posts' ||
          pathname.endsWith('/comments') ||
          pathname === '/x/retweet' ||
          pathname === '/x/tweet' ||
          pathname === '/xrpc/com.atproto.repo.createRecord' ||
          pathname === '/publication');
      const mutation =
        effect ||
        (request.method === 'POST' && pathname === '/v1.0/me/threads');
      calls.push({
        caseId: request.headers['x-fixture-case'] || currentCase,
        method: request.method,
        path: pathname,
        effect,
        mutation,
        at: Date.now(),
      });
      response.setHeader('content-type', 'application/json');
      if (effect && mode === 'lost') {
        request.socket.destroy();
        return;
      }
      if (effect && mode === '500') {
        response.statusCode = 500;
        response.end('{}');
        return;
      }
      const metric =
        pathname.endsWith('/insights') ||
        pathname === '/x/likes' ||
        pathname === '/xrpc/app.bsky.feed.getPostThread' ||
        (pathname.startsWith('/v2/socialActions/') && request.method === 'GET');
      const count =
        metric && observations.length ? observations.shift() : observed;
      if (pathname.endsWith('/insights')) {
        response.end(
          JSON.stringify({
            data: [{ name: 'likes', values: [{ value: count }] }],
          })
        );
        return;
      }
      if (pathname === '/v1.0/me/threads') {
        response.end('{"id":"500"}');
        return;
      }
      if (pathname.endsWith('/threads_publish')) {
        response.end(mode === 'no-id' ? '{}' : '{"id":"501"}');
        return;
      }
      if (
        pathname.startsWith('/v2/socialActions/') &&
        request.method === 'GET'
      ) {
        response.end(JSON.stringify({ likesSummary: { totalLikes: count } }));
        return;
      }
      if (pathname === '/rest/posts') {
        response.statusCode = 201;
        if (mode !== 'no-id')
          response.setHeader('x-restli-id', 'urn:li:share:501');
        response.end('{}');
        return;
      }
      if (pathname.endsWith('/comments')) {
        response.statusCode = 201;
        response.end(
          JSON.stringify(
            mode === 'no-id'
              ? { object: 'parent-only' }
              : { id: '601', object: 'parent-only' }
          )
        );
        return;
      }
      if (pathname === '/x/me') {
        response.end(JSON.stringify({ data: { id: actor } }));
        return;
      }
      if (pathname === '/x/likes') {
        response.end(JSON.stringify({ meta: { result_count: count } }));
        return;
      }
      if (pathname === '/x/retweet') {
        response.end(JSON.stringify({ data: { retweeted: mode !== 'no-id' } }));
        return;
      }
      if (pathname === '/x/tweet') {
        response.end(mode === 'no-id' ? '{}' : '{"data":{"id":"701"}}');
        return;
      }
      if (pathname === '/xrpc/com.atproto.server.createSession') {
        const sign = req('jsonwebtoken').sign;
        response.end(
          JSON.stringify({
            did,
            handle: 'synthetic.test',
            accessJwt: sign(
              { sub: did, scope: 'com.atproto.access' },
              'synthetic-only',
              { expiresIn: '1 hour' }
            ),
            refreshJwt: sign(
              { sub: did, scope: 'com.atproto.refresh' },
              'synthetic-only',
              { expiresIn: '1 hour' }
            ),
          })
        );
        return;
      }
      if (pathname === '/xrpc/app.bsky.feed.getPostThread') {
        response.end(
          JSON.stringify({
            thread: {
              $type: 'app.bsky.feed.defs#threadViewPost',
              post: {
                uri: parentId('bluesky'),
                cid,
                author: { did, handle: 'synthetic.test' },
                record: {
                  $type: 'app.bsky.feed.post',
                  text: 'Synthetic',
                  createdAt: new Date().toISOString(),
                },
                indexedAt: new Date().toISOString(),
                likeCount: count,
              },
            },
          })
        );
        return;
      }
      if (pathname === '/xrpc/com.atproto.repo.createRecord') {
        if (mode === 'expired-token') {
          response.statusCode = 400;
          response.end(
            '{"error":"ExpiredToken","message":"Synthetic rejection"}'
          );
          return;
        }
        response.end(
          JSON.stringify({
            uri: `at://${did}/${body.collection}/synthetic${sequence}`,
            cid,
          })
        );
        return;
      }
      if (pathname === '/publication') {
        response.end(
          JSON.stringify([
            {
              id: body.id,
              postId: body.parentId,
              releaseURL: 'https://example.test/parent',
              status: 'posted',
            },
          ])
        );
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${server.address().port}`;
    env = require('./derived-fixture-support.cjs')(
      root,
      url,
      endpoint,
      () => currentCase,
      () => delay
    );
    ({ db, manager, get, req } = env);
    const {
        Runtime,
        DefaultLogger,
        Worker,
        NativeConnection,
        bundleWorkflowCode,
      } = req('@temporalio/worker'),
      { Connection, Client } = req('@temporalio/client');
    ({ Context } = req('@temporalio/activity'));
    Runtime.install({ logger: new DefaultLogger('ERROR') });
    recovery = new env.AutomationRecoveryService(db);
    derived = new env.DerivedPublicationService(db, recovery, manager);
    connection = await Connection.connect({ address });
    native = await NativeConnection.connect({ address });
    client = new Client({ connection, namespace: 'default' });
    scheduling = new env.PublicationSchedulingService(
      db,
      recovery,
      { client: { getRawClient: () => client } },
      derived
    );
    await db.organization.create({ data: { id: 'org-a', name: 'Synthetic' } });
    await db.user.create({
      data: {
        id: 'admin',
        email: 'synthetic@example.test',
        providerName: 'LOCAL',
        timezone: 0,
      },
    });
    await db.userOrganization.create({
      data: { userId: 'admin', organizationId: 'org-a', role: 'ADMIN' },
    });
    await db.automationRecoveryRun.create({
      data: {
        id: 'synthetic-run',
        cutoffAt: T0,
        protocolVersion: 1,
        phase: 'VERIFIED',
        authorizedById: 'synthetic-operator',
        authorizedAt: new Date(+T0 - 1),
        manifestHash: 'synthetic-reviewed-manifest',
      },
    });
    await db.automationRecoveryControl.update({
      where: { id: 'global' },
      data: { phase: 'OPEN', runId: 'synthetic-run', generation: 1 },
    });
    await require('./signed-policy-fixture.cjs')(db,url);
    const { PostActivity } = req(
        path.join(root, 'apps/orchestrator/src/activities/post.activity.ts')
      ),
      { RecoveryPublicationActivity } = req(
        path.join(
          root,
          'apps/orchestrator/src/activities/recovery-publication.activity.ts'
        )
      );
    const { PlatformService } = get(
      'database/prisma/platform/platform.service'
    );
    ({ IntegrationService } = get(
      'database/prisma/integrations/integration.service'
    ));
    const platform = new PlatformService(db);
    reconciliation = new (get(
      'automation-recovery/publication-reconciliation.service'
    ).PublicationReconciliationService)(db);
    const integrationService = new IntegrationService(
      {},
      {},
      manager,
      {},
      {},
      {},
      undefined,
      platform,
      recovery,
      derived
    );
    const mainProvider = {
      editor: 'normal',
      post: async (_id, _token, details, integration) =>
        (
          await fetch(endpoint + '/publication', {
            method: 'POST',
            body: JSON.stringify({
              id: details[0].id,
              parentId: parentId(integration.providerIdentifier),
            }),
          })
        ).json(),
    };
    postActivity = new PostActivity(
      {
        getPostById: (id, org) =>
          db.post.findFirst({
            where: { id, organizationId: org },
            include: { integration: true },
          }),
        getPostsRecursively: async (id, _include, org) => [
          await db.post.findFirstOrThrow({
            where: { id, organizationId: org },
            include: { integration: true },
          }),
        ],
        updateTags: async (_org, posts) => posts,
        updateMedia: async () => [],
      },
      { inAppNotification: async () => {} },
      { getSocialIntegration: () => mainProvider },
      integrationService,
      {},
      {},
      {
        client: {
          getRawClient: () => ({ workflow: { start: async () => {} } }),
        },
      },
      {},
      platform,
      recovery
    );
    recoveryActivity = new RecoveryPublicationActivity(
      scheduling,
      recovery,
      postActivity,
      derived,
      {run:async()=>({completionNotCertifiedByDerivedFixture:true})}
    );
    const activities = {};
    for (const instance of [postActivity, recoveryActivity])
      for (const name of Object.getOwnPropertyNames(
        Object.getPrototypeOf(instance)
      ))
        if (name !== 'constructor' && typeof instance[name] === 'function')
          activities[name] = instance[name].bind(instance);
    activities.internalPlugs = async () => [];
    activities.sendWebhooks = async () => {};
    activities.globalPlugs = async (integration) => {
      const context = {
        ...Context.current().info.workflowExecution,
        protocolVersion: 1,
      };
      const rootIntent = await db.publicationScheduleIntent.findUniqueOrThrow({
        where: { workflowId: context.workflowId },
      });
      const actions = await derived.plan('org-a', rootIntent.occurrenceId);
      for (const a of actions)
        for (const check of a.schedule) {
          const canonical = await derived.bind(context, a.id, check.index);
          const binding = await db.automationWorkflowBinding.findUniqueOrThrow({
            where: {
              workflowId_runId_actionKey: {
                workflowId: context.workflowId,
                runId: context.runId,
                actionKey: canonical,
              },
            },
          });
          // Synthetic equivalent of reviewed legacy bindings, not a production upgrade.
          const delayMs =
            +new Date(check.scheduledAt) -
            +(
              await db.publicationOccurrence.findUniqueOrThrow({
                where: { id: rootIntent.occurrenceId },
              })
            ).scheduledAt;
          await db.automationWorkflowBinding.create({
            data: {
              ...binding,
              id: randomUUID(),
              actionKey: `${
                (
                  await action({ action: a })
                ).actionKey
              }:delay:${delayMs}`,
            },
          });
        }
      const plug = await db.plugs.findFirstOrThrow({
        where: { integrationId: integration.id, activated: true },
      });
      return [{ type: 'global', plugId: plug.id, delay: 100, totalRuns: 3 }];
    };
    const deliver = activities.recoveryDerivedDeliver;
    activities.recoveryDerivedDeliver = async (...args) => {
      const info = Context.current().info;
      attempts.push({ caseId: currentCase, attempt: info.attempt });
      if (crashMode && info.attempt === 1) {
        const childEnv = Object.fromEntries(
          [
            'SystemRoot',
            'WINDIR',
            'PATH',
            'PATHEXT',
            'TEMP',
            'TMP',
            'UPLOAD_DIRECTORY',
            'STORAGE_PROVIDER',
            'JWT_SECRET',
            'RECOVERY_APPROVAL_PUBLIC_KEY_FILE',
          ]
            .filter((k) => process.env[k])
            .map((k) => [k, process.env[k]])
        );
        const child = spawn(
          process.execPath,
          [
            path.join(root, 'diagnostics/recovery/derived-crash-child.cjs'),
            root,
            url,
            endpoint,
            JSON.stringify({
              context: { ...info.workflowExecution, protocolVersion: 1 },
              actionId: args[2],
              rootOccurrenceId: args[1],
              caseId: currentCase,
              mode: crashMode,
            }),
          ],
          {
            env: childEnv,
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe'],
          }
        );
        let stderr = '';
        child.stderr.on('data', (data) => {
          stderr += data;
        });
        const result = await new Promise((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', resolve);
        });
        crashExits.push({caseId:currentCase,mode:crashMode,exitCode:result});
        assert.equal(result, 86, stderr);
        throw Error('Synthetic effect subprocess crash');
      }
      return deliver(...args);
    };
    bundle = await bundleWorkflowCode({
      workflowsPath: path.join(
        root,
        'diagnostics/recovery/fixture-workflows.ts'
      ),
      webpackConfigHook: (c) => {
        c.resolve.alias = {
          ...c.resolve.alias,
          ...Object.fromEntries(
            Object.entries(env.aliases).map(([k, v]) => [
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
    });
    for (const queue of [
      'main',
      'instagram',
      'linkedin',
      'threads',
      'bluesky',
      'x',
    ]) {
      const worker = await Worker.create({
        connection: native,
        namespace: 'default',
        taskQueue: queue,
        workflowBundle: bundle,
        activities,
      });
      workers.push(worker);
      running.push(worker.run());
    }
    const globals = [
      ['threads', 'autoPlugPost'],
      ['linkedin-page', 'autoRepostPost'],
      ['linkedin-page', 'autoPlugPost'],
      ['bluesky', 'autoRepostPost'],
      ['bluesky', 'autoPlugPost'],
      ['x', 'autoRepostPost'],
      ['x', 'autoPlugPost'],
    ];
    const internals = [
      ['linkedin', 'addComment'],
      ['linkedin', 'repostPostUsers'],
      ['linkedin-page', 'addComment'],
      ['linkedin-page', 'repostPostUsers'],
      ['x', 'repostPostUsers'],
    ];
    for (const [p, m] of globals)
      await test(`R27 confirmed ${p}/${m}`, async () => {
        const f = await rootFixture(p, m);
        await finish(await startDerived(f));
        assert.equal((await action(f)).phase, 'CONFIRMED');
        assert.equal((await ledger(f))[0].phase, 'CONFIRMED');
        assert.equal(effects().length, 1);
        const receipt = (await ledger(f))[0].receipt;
        assert.equal(receipt.kind, 'CONFIRMED');
        if (p === 'threads') assert.equal(receipt.receipt.remoteId, '501');
      });
    for (const [p, m] of internals)
      await test(`R27 confirmed internal ${p}/${m}`, async () => {
        const f = await rootFixture(p, m, true);
        await finish(await startDerived(f));
        assert.equal((await action(f)).phase, 'CONFIRMED');
        assert.equal(effects().length, 1);
      });
    for (const [p, m] of globals)
      await test(`R27 no effect ${p}/${m}`, async () => {
        observed = 0;
        const f = await rootFixture(p, m);
        await finish(await startDerived(f));
        const rows = await ledger(f);
        assert.equal(rows.length, 3);
        assert(
          rows.every(
            (r) =>
              r.phase === 'NOT_EXECUTED' && r.receipt.evidence.observed === 0
          )
        );
        assert.equal((await action(f)).phase, 'NOT_EXECUTED');
        assert.equal(effects().length, 0);
        assert.equal(mutations().length, 0);
      });
    await test('R27 no-effect check preserves a later configured check', async () => {
      observations = [0, 10];
      const f = await rootFixture('linkedin-page', 'autoRepostPost');
      await finish(await startDerived(f));
      const rows = await ledger(f);
      assert.equal(rows[0].phase, 'NOT_EXECUTED');
      assert.equal(rows[1].phase, 'CONFIRMED');
      assert.equal(effects().length, 1);
    });
    for (const failure of ['lost', '500', 'no-id'])
      await test(`R27 uncertain ${failure} cannot retry or run another check`, async () => {
        mode = failure;
        const f = await rootFixture('linkedin-page', 'autoRepostPost');
        const handle = await startDerived(f);
        await finish(handle);
        assert.equal((await action(f)).phase, 'UNCERTAIN');
        const before = calls.length;
        const context = {
          workflowId: handle.workflowId,
          runId: handle.firstExecutionRunId,
          protocolVersion: 1,
        };
        await derived.executeScheduled(
          context,
          'org-a',
          f.occurrence.id,
          f.action.id,
          0
        );
        await derived.executeScheduled(
          context,
          'org-a',
          f.occurrence.id,
          f.action.id,
          1
        );
        assert.equal(calls.length, before);
        assert.equal(mutations().length, 1);
      });
    await test('R27 LinkedIn comment parent object is not a new-comment receipt', async () => {
      mode = 'no-id';
      const f = await rootFixture('linkedin-page', 'autoPlugPost');
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'UNCERTAIN');
      assert.equal(effects().length, 1);
    });
    await test('R27 atproto mutation rejection cannot enter SDK refresh and resend', async () => {
      mode = 'expired-token';
      const f = await rootFixture('bluesky', 'autoRepostPost');
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'UNCERTAIN');
      assert.equal(effects().length, 1);
      assert(
        !calls.some(
          (c) =>
            c.caseId === currentCase &&
            c.path === '/xrpc/com.atproto.server.refreshSession'
        )
      );
    });
    for (const crash of [
      'before-reservation',
      'after-reservation',
      'before-confirmation',
      'after-confirmation',
    ])
      await test(`R27 actual process crash ${crash}`, async () => {
        crashMode = crash;
        const f = await rootFixture('linkedin-page', 'autoRepostPost');
        await finish(await startDerived(f));
        assert(
          attempts.some((a) => a.caseId === currentCase && a.attempt > 1),
          'Temporal retry must have actually run'
        );
        const row = (await ledger(f))[0];
        assert.equal(
          row.phase,
          ['before-reservation', 'after-confirmation'].includes(crash)
            ? 'CONFIRMED'
            : crash === 'after-reservation'
            ? 'CLAIMED'
            : 'CLAIMED'
        );
        assert.equal(effects().length, crash === 'after-reservation' ? 0 : 1);
        assert(crashExits.some(e=>e.caseId===currentCase&&e.mode===crash&&e.exitCode===86),'Actual controlled crash must occur, not just an activity retry');
      });
    await test('R27 concurrent consumers reserve one logical effect', async () => {
      const f = await rootFixture('linkedin-page', 'autoRepostPost');
      const context = {
        workflowId: `derived-${f.occurrence.id}`,
        runId: randomUUID(),
        protocolVersion: 1,
      };
      const values = await Promise.all(
        Array.from({ length: 8 }, () =>
          derived.executeScheduled(
            context,
            'org-a',
            f.occurrence.id,
            f.action.id,
            0
          )
        )
      );
      assert(values.some((v) => v.kind === 'CONFIRMED'));
      assert.equal(effects().length, 1);
    });
    await test('R27 expired parent and derived slots produce zero HTTP', async () => {
      const f = await rootFixture('linkedin-page', 'autoRepostPost', false, {
        at: new Date(+T0 - 1000),
        parent: false,
      });
      assert.equal(f.descriptor, null);
      await finish(await startDerived(f));
      assert.equal(calls.filter((c) => c.caseId === currentCase).length, 0);
      assert.equal(
        (await db.post.findUnique({ where: { id: f.post.id } })).state,
        'ERROR'
      );
      assert.equal((await action(f)).phase, 'EXPIRED');
    });
    await test('R27 future primary and plug survive actual Temporal timers', async () => {
      const at = new Date(Date.now() + 2000),
        f = await rootFixture('linkedin-page', 'autoRepostPost', false, {
          at,
          parent: false,
        });
      const h = await client.workflow.start('postWorkflowV106', {
        workflowId: f.descriptor.workflowId,
        taskQueue: 'main',
        args: [f.descriptor],
        workflowExecutionTimeout: '90 seconds',
      });
      await pause(400);
      assert.equal(mutations().length, 0);
      await finish(h);
      const child = client.workflow.getHandle(`derived-${f.occurrence.id}`);
      await finish(child);
      assert.equal(effects().length, 2);
      assert(
        calls
          .filter((c) => c.caseId === currentCase && c.mutation)
          .every((c) => c.at >= +at)
      );
      assert.equal((await action(f)).phase, 'CONFIRMED');
    });
    await test('R27 recurring V106 preserves next slot and its configured action', async () => {
      const f = await rootFixture('linkedin-page', 'autoRepostPost', false, {
        parent: false,
        recurring: true,
      });
      await finish(
        await client.workflow.start('postWorkflowV106', {
          workflowId: f.descriptor.workflowId,
          taskQueue: 'main',
          args: [f.descriptor],
          workflowExecutionTimeout: '90 seconds',
        })
      );
      await finish(client.workflow.getHandle(`derived-${f.occurrence.id}`));
      const slots = await db.publicationOccurrence.findMany({
        where: { postId: f.post.id },
        orderBy: { scheduledAt: 'asc' },
      });
      assert.equal(slots.length, 2);
      assert.equal(+slots[1].scheduledAt - +slots[0].scheduledAt, 86400000);
      assert.equal(
        await db.publicationDerivedAction.count({
          where: { rootOccurrenceId: slots[1].id, phase: 'PENDING' },
        }),
        1
      );
      const next = await db.publicationScheduleIntent.findUnique({
        where: { occurrenceId: slots[1].id },
      });
      const history = await client.workflow
        .getHandle(next.workflowId)
        .fetchHistory();
      assert(history.events.some((e) => e.timerStartedEventAttributes));
      assert.equal(effects().length, 2);
    });
    await test('R27 changed config and obsolete revision are retained without effects', async () => {
      const f = await rootFixture('linkedin-page', 'autoRepostPost');
      await db.plugs.update({ where: { id: f.plugId }, data: { data: '[]' } });
      const frozen = await action(f);
      await recovery.withOpenPolicy(async (tx) => {
        const root = await tx.post.findUniqueOrThrow({
          where: { id: f.post.id },
          include: { integration: true },
        });
        await derived.stage(
          tx,
          root,
          f.occurrence.scheduledAt,
          f.occurrence.id
        );
      });
      assert.deepEqual(
        (await action(f)).configurationSnapshot,
        frozen.configurationSnapshot
      );
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'RETAINED');
      assert.equal(effects().length, 0);
      await db.plugs.update({
        where: { id: f.plugId },
        data: { data: frozen.configurationSnapshot.data },
      });
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'RETAINED');
      assert.equal((await action(f)).reason, 'DERIVED_CONFIGURATION_CHANGED');
      assert.equal(effects().length, 0);
    });
    await test('R27 unsupported contract retains action while primary publication succeeds', async () => {
      const f = await rootFixture(
        'linkedin-page',
        'unavailableFutureMethod',
        false,
        { parent: false }
      );
      await finish(
        await client.workflow.start('postWorkflowV106', {
          workflowId: f.descriptor.workflowId,
          taskQueue: 'main',
          args: [f.descriptor],
          workflowExecutionTimeout: '90 seconds',
        })
      );
      await finish(client.workflow.getHandle(`derived-${f.occurrence.id}`));
      assert.equal((await action(f)).phase, 'RETAINED');
      assert.equal((await action(f)).reason, 'RECEIPT_CONTRACT_UNAVAILABLE');
      assert.equal(effects().length, 1);
      const history = await reconciliation.history('org-a', f.post.id, 'admin');
      assert.equal(history.occurrences[0].automaticOutcome, 'CONFIRMED');
      assert.equal(history.occurrences[0].derivedActions[0].phase, 'RETAINED');
    });
    await test('R27 disabled metadata at admission preserves original future checks and configuration', async () => {
      const enabled = manager.getAllPlugs;
      manager.getAllPlugs = () => [];
      try {
        const f = await rootFixture('linkedin-page', 'autoRepostPost');
        const retained = await action(f);
        assert.equal(retained.phase, 'RETAINED');
        assert.equal(retained.reason, 'RECEIPT_CONTRACT_UNAVAILABLE');
        const raw = Reflect.getMetadata(
          'custom:plug',
          manager.getSocialIntegration('linkedin-page').constructor.prototype
        ).find((p) => p.methodName === 'autoRepostPost');
        assert.equal(retained.schedule.length, raw.totalRuns);
        for (const check of retained.schedule)
          assert.equal(
            +new Date(check.scheduledAt),
            +f.occurrence.scheduledAt +
              raw.runEveryMilliseconds * (check.index + 1)
          );
        assert.equal(retained.configurationSnapshot.method, 'autoRepostPost');
        assert.equal(effects().length, 0);
      } finally {
        manager.getAllPlugs = enabled;
      }
    });
    await test('R27 newly disabled provider metadata cannot bypass admission and send', async () => {
      const f = await rootFixture('linkedin-page', 'autoRepostPost');
      const enabled = manager.getAllPlugs;
      manager.getAllPlugs = () => [];
      try {
        await finish(await startDerived(f));
        assert.equal((await action(f)).phase, 'RETAINED');
        assert.equal((await action(f)).reason, 'RECEIPT_CONTRACT_UNAVAILABLE');
        assert.equal((await ledger(f)).length, 0);
        assert.equal(effects().length, 0);
      } finally {
        manager.getAllPlugs = enabled;
      }
    });
    await test('R27 missing parent proof retains future configuration without a late primary send', async () => {
      const f = await rootFixture('linkedin-page', 'autoRepostPost', false, {
        parent: false,
      });
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'RETAINED');
      assert.equal((await action(f)).reason, 'PARENT_CONFIRMATION_REQUIRED');
      assert.equal(mutations().length, 0);
      assert.equal(
        (await db.post.findUnique({ where: { id: f.post.id } })).state,
        'QUEUE'
      );
    });
    await test('R27 expired parent with manually confirmed reference preserves a future plug', async () => {
      const at = new Date(+T0 - 1000);
      delay = Date.now() - +at + 500;
      const f = await rootFixture('linkedin-page', 'autoRepostPost', false, {
        at,
        parent: false,
      });
      assert.equal(f.descriptor, null);
      await reconciliation.confirmManual('org-a', f.post.id, 'admin', {
        occurrenceId: f.occurrence.id,
        requestId: randomUUID(),
        remoteId: parentId('linkedin-page'),
        remoteUrl: 'https://example.test/manual',
        attestation: 'CONFIRM_MANUAL_PUBLICATION',
      });
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'CONFIRMED');
      assert.equal(effects().length, 1);
      assert(
        !calls.some(
          (c) => c.caseId === currentCase && c.path === '/publication'
        )
      );
      assert.equal(
        (await db.post.findUnique({ where: { id: f.post.id } })).state,
        'ERROR'
      );
    });
    await test('R27 expired check cannot suppress the next eligible configured check', async () => {
      const f = await rootFixture('linkedin-page', 'autoRepostPost', false, {
        at: new Date(+T0 - 150),
      });
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'CONFIRMED');
      assert.equal(effects().length, 1);
      assert.equal(
        await db.automationRecoveryDecision.count({
          where: {
            subjectKey: `derived:${f.action.id}`,
            action: 'EXPIRE_CHECK:0',
          },
        }),
        1
      );
    });
    await test('R27 obsolete revision cannot send or overwrite the new future schedule', async () => {
      const f = await rootFixture('linkedin-page', 'autoRepostPost'),
        at = new Date(Date.now() + 86400000);
      await db.post.update({
        where: { id: f.post.id },
        data: {
          scheduleRevision: 2,
          publishDate: at,
          state: 'QUEUE',
          releaseId: null,
          releaseURL: null,
        },
      });
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'RETAINED');
      assert.equal(effects().length, 0);
      const p = await db.post.findUnique({ where: { id: f.post.id } });
      assert.equal(p.scheduleRevision, 2);
      assert.equal(+p.publishDate, +at);
      assert.equal(p.state, 'QUEUE');
    });
    await test('R27 persisted expiry survives an inconsistent cutoff rollback without resend', async () => {
      observed = 0;
      const f = await rootFixture('linkedin-page', 'autoRepostPost', false, {
        at: new Date(+T0 - 150),
      });
      await finish(await startDerived(f));
      assert.equal((await action(f)).phase, 'NOT_EXECUTED');
      assert.equal(effects().length, 0);
      assert.equal(
        await db.automationRecoveryDecision.count({
          where: {
            subjectKey: `derived:${f.action.id}`,
            action: 'EXPIRE_CHECK:0',
          },
        }),
        1
      );
      // Malformed operator state is synthetic. Persisted expiry must still win.
      await db.automationRecoveryRun.update({
        where: { id: 'synthetic-run' },
        data: { cutoffAt: new Date(+T0 - 10000) },
      });
      observed = 10;
      try {
        await finish(await startDerived(f));
        assert.equal(effects().length, 0);
        assert.equal((await ledger(f)).length, 2);
      } finally {
        await db.automationRecoveryRun.update({
          where: { id: 'synthetic-run' },
          data: { cutoffAt: T0 },
        });
      }
    });
    for (const version of [101, 102, 103, 104, 105])
      await test(`R27 legacy V${version} no-effect then confirmed without new commands`, async () => {
        observations = [0, 10];
        const f = await rootFixture('linkedin-page', 'autoRepostPost', false, {
          parent: false,
        });
        const h = await client.workflow.start(`postWorkflowV${version}`, {
          workflowId: f.descriptor.workflowId,
          taskQueue: 'legacy-derived-paused',
          args: [
            {
              taskQueue: 'instagram',
              postId: f.post.id,
              organizationId: 'org-a',
            },
          ],
          workflowExecutionTimeout: '90 seconds',
        });
        await scheduling.bind(
          {
            workflowId: h.workflowId,
            runId: h.firstExecutionRunId,
            protocolVersion: 1,
          },
          f.descriptor,
          f.post.id
        );
        const w = await Worker.create({
          connection: native,
          namespace: 'default',
          taskQueue: 'legacy-derived-paused',
          workflowBundle: bundle,
          activities,
        });
        const run = w.run();
        try {
          await finish(h);
        } finally {
          w.shutdown();
          await run;
        }
        const rows = await ledger(f);
        assert.equal(rows[0].phase, 'NOT_EXECUTED');
        assert.equal(rows[1].phase, 'CONFIRMED');
        assert.equal(effects().length, 2);
      });
    await test('R27 replay real successful legacy and V106 histories without network', async () => {
      const types = new Set(
        histories.map(
          (h) =>
            h.history.events.find(
              (e) => e.workflowExecutionStartedEventAttributes
            ).workflowExecutionStartedEventAttributes.workflowType.name
        )
      );
      for (const v of [101, 102, 103, 104, 105, 106])
        assert(types.has('postWorkflowV' + v), 'Missing actual history V' + v);
      const before = calls.length;
      for (const h of histories)
        await Worker.runReplayHistory(
          { workflowBundle: bundle },
          h.history,
          h.id
        );
      assert.equal(calls.length, before);
    });
    const report = {
      scope: 'ISOLATED_R27',
      postgres: '17.11',
      temporal: '1.28.2',
      sdk: req('@temporalio/worker/package.json').version,
      results,
      crashExits,
      actualWorkflowTasks: histories.reduce(
        (n, h) =>
          n +
          h.history.events.filter((e) => e.workflowTaskCompletedEventAttributes)
            .length,
        0
      ),
      historyCount: histories.length,
      clientApiAccess: false,
      productionAuthorized: false,
      fullR01R31Certified: false,
    };
    fs.writeFileSync(
      path.join(root, 'diagnostics/recovery/derived-recovery-results.json'),
      JSON.stringify(report, null, 2) + '\n'
    );
    console.log(
      JSON.stringify({
        tests: results.length,
        passed: results.filter((r) => r.result === 'PASS').length,
        workflowTasks: report.actualWorkflowTasks,
      })
    );
    if (results.some((r) => r.result === 'FAIL')) process.exitCode = 1;
  } catch (e) {
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    for (const w of workers) w.shutdown();
    await Promise.allSettled(running);
    if (native) await native.close();
    if (connection) await connection.close();
    if (db) await db.$disconnect();
    if (server) await new Promise((r) => server.close(r));
  }
})();
