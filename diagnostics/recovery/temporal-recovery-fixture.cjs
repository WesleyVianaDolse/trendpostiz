// Synthetic fixtures only. Called by the owned-container harness, never alone
// with a production URL. No .env, application bootstrap or real provider APIs.
const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict'),
  Module = require('node:module');
const { randomUUID } = require('node:crypto');
const root = process.argv[2],
  dbUrl = new URL(process.argv[3]),
  address = process.argv[4];
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.username, 'guard_test');
assert.equal(dbUrl.pathname, '/guard_test');
assert.match(address, /^127\.0\.0\.1:\d+$/);
const req = Module.createRequire(path.join(root, 'package.json'));
req('reflect-metadata');
req('ts-node').register({
  project: path.join(root, 'tsconfig.base.json'),
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2020', incremental: false },
});
const aliases = {
  '@gitroom/nestjs-libraries/': 'libraries/nestjs-libraries/src/',
  '@gitroom/helpers/': 'libraries/helpers/src/',
  '@gitroom/orchestrator/': 'apps/orchestrator/src/',
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  for (const [prefix, base] of Object.entries(aliases))
    if (name.startsWith(prefix))
      name = path.join(root, base, name.slice(prefix.length));
  return resolve.call(this, name, parent, ...rest);
};
// Decorator-only dependencies are replaced at module loading; the activities,
// guards, repositories, Instagram strategies and DB transactions remain real.
const typeOnly = {
  'automation-recovery/publication-completion.service': ['PublicationCompletionService'],
  'database/prisma/posts/posts.service': ['PostsService'],
  'database/prisma/notifications/notification.service': ['NotificationService'],
  'integrations/integration.manager': ['IntegrationManager'],
  'database/prisma/integrations/integration.service': ['IntegrationService'],
  'integrations/refresh.integration.service': ['RefreshIntegrationService'],
  'database/prisma/webhooks/webhooks.service': ['WebhooksService'],
  'database/prisma/subscriptions/subscription.service': ['SubscriptionService'],
  'openai/openai.service': ['OpenaiService'],
};
const load = Module._load;
Module._load = function (name, parent, isMain) {
  const key = name.replace('@gitroom/nestjs-libraries/', '');
  if (typeOnly[key])
    return Object.fromEntries(typeOnly[key].map((n) => [n, class {}]));
  return load.call(this, name, parent, isMain);
};
const { PrismaClient } = req('@prisma/client'),
  { Worker, NativeConnection, bundleWorkflowCode, Runtime, DefaultLogger } =
    req('@temporalio/worker'),
  { Connection, Client } = req('@temporalio/client');
Runtime.install({ logger: new DefaultLogger('ERROR') });
const get = (file) =>
  req(path.join(root, 'libraries/nestjs-libraries/src/', file + '.ts'));
const { AutomationRecoveryService } = get(
  'automation-recovery/automation-recovery.service'
);
const { PublicationSchedulingService } = get(
  'automation-recovery/publication-scheduling.service'
);
const { PublicationMutationGuard } = get(
  'automation-recovery/publication-mutation-guard'
);
const { PublicationReconciliationService } = get(
  'automation-recovery/publication-reconciliation.service'
);
const {
  recoveryKey,
  publicationRequestHash,
  nextFixedOccurrence,
  RecoveryHold,
} = get('automation-recovery/recovery-policy');
const { PlatformService } = get('database/prisma/platform/platform.service');
const { PostsRepository } = get('database/prisma/posts/posts.repository');
const { InstagramCommentAutomationRepository } = get(
  'database/prisma/instagram-comment-automations/instagram-comment-automation.repository'
);
const { InstagramCommentAutomationService } = get(
  'instagram-comment-automation/instagram-comment-automation.service'
);
const { InstagramWebhookEventsRepository } = get(
  'database/prisma/instagram-webhooks/instagram-webhook-events.repository'
);
const {
  InstagramFacebookCommentMessagingStrategy,
  InstagramCommentMessagingService,
} = get('integrations/social/instagram-comment-messaging.service');
const { InstagramStandaloneMessagingService } = get(
  'integrations/social/instagram-standalone-messaging.service'
);
const { InstagramCommentAutomationDispatcherService } = get(
  'instagram-comment-automation/instagram-comment-automation-dispatcher.service'
);
const { PostActivity } = req(
  path.join(root, 'apps/orchestrator/src/activities/post.activity.ts')
);
const { RecoveryPublicationActivity } = req(
  path.join(
    root,
    'apps/orchestrator/src/activities/recovery-publication.activity.ts'
  )
);
const { InstagramCommentAutomationActivity } = req(
  path.join(
    root,
    'apps/orchestrator/src/activities/instagram-comment-automation.activity.ts'
  )
);
const db = new PrismaClient({ datasources: { db: { url: dbUrl.href } } }),
  recovery = new AutomationRecoveryService(db),
  platform = new PlatformService(db),
  mutation = new PublicationMutationGuard();
const postRepository = new PostsRepository(
  ...Array.from({ length: 6 }, () => ({ model: db })),
  db,
  mutation
);
const reconciliation = new PublicationReconciliationService(db),
  events = new InstagramWebhookEventsRepository({ model: db });
const igRepository = new InstagramCommentAutomationRepository(db, recovery);
const messaging = new InstagramCommentMessagingService(
  new InstagramStandaloneMessagingService(),
  new InstagramFacebookCommentMessagingStrategy()
);
const ig = new InstagramCommentAutomationService(
    igRepository,
    messaging,
    platform,
    recovery
  ),
  igActivity = new InstagramCommentAutomationActivity(ig);
const calls = [],
  results = [],
  actions = new Map(),
  histories = [],
  workers = [],
  runs = [];
const T0 = new Date(Date.now() - 60_000);
let sequence = 0,
  server,
  endpoint,
  connection,
  native,
  client,
  scheduling,
  postActivity,
  recoveryActivity,
  bundle;
const reject = (promise, reason) =>
  assert.rejects(promise, (e) => e.reason === reason);
const latest = (id) => db.post.findUniqueOrThrow({ where: { id } });
const event = (id) =>
  db.instagramWebhookEvent.findUniqueOrThrow({
    where: { id },
    include: { automationExecution: true },
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const id = () => `synthetic-${++sequence}`;
async function open(cutoff = T0, generation = 1) {
  generation = Math.max(generation,((await db.recoveryAuthorization.aggregate({_max:{generation:true}}))._max.generation||0)+1);
  const runId = `run-${generation}`;
  await db.automationRecoveryRun.upsert({
    where: { id: runId },
    create: {
      id: runId,
      cutoffAt: cutoff,
      phase: 'VERIFIED',
      protocolVersion: 1,
      authorizedById: 'operator',
      authorizedAt: new Date(+cutoff - 1),
      manifestHash: 'synthetic-reviewed',
    },
    update: { cutoffAt: cutoff },
  });
  await db.automationRecoveryControl.update({
    where: { id: 'global' },
    data: { phase: 'OPEN', runId, generation },
  });
  await require('./signed-policy-fixture.cjs')(db,dbUrl.href);
}
async function publication(at = new Date(+T0 + 1), extra = {}) {
  const post = await db.post.create({
    data: {
      id: id(),
      organizationId: 'org-a',
      integrationId: 'ig-a',
      group: id(),
      content: 'Synthetic',
      settings: '{}',
      image: '[]',
      publishDate: at,
      state: 'QUEUE',
      scheduleRevision: 1,
      ...extra,
    },
  });
  return post;
}
async function bound(at = new Date(+T0 + 1), extra = {}) {
  const post = await publication(at, extra),
    context = {
      organizationId: post.organizationId,
      integrationId: post.integrationId,
      workflowId: id(),
      runId: randomUUID(),
      protocolVersion: 1,
      actionKey: `publication:${post.id}`,
      snapshots: [post],
      plannedAt: at,
    };
  const occurrence = await db.publicationOccurrence.create({
    data: {
      id: id(),
      organizationId: post.organizationId,
      postId: post.id,
      groupSnapshot: post.group,
      scheduleRevision: post.scheduleRevision,
      scheduledAt: at,
    },
  });
  await db.automationWorkflowBinding.create({
    data: {
      organizationId: post.organizationId,
      workflowId: context.workflowId,
      runId: context.runId,
      actionKey: context.actionKey,
      occurrenceId: occurrence.id,
      expectedRequestHash: publicationRequestHash(context),
    },
  });
  return { post, context, occurrence };
}
async function send(f, mode = 'ok') {
  return (
    await fetch(endpoint + '/publication/' + mode, {
      method: 'POST',
      body: JSON.stringify({ id: f.post.id }),
    })
  ).json();
}
async function comment(options = {}) {
  const key = id(),
    e = await db.instagramWebhookEvent.create({
      data: {
        id: key,
        integrationId: 'ig-a',
        instagramAccountId: 'ig-synthetic',
        externalCommentId: key,
        mediaId: key,
        authorId: key,
        commentText: 'Eu quero',
        payload: {},
        status: 'RECEIVED',
        receivedAt: new Date(+T0 + 3000),
        occurredAt: new Date(+T0 + 2000),
        occurredAtSource: 'META_COMMENT_CREATED_TIME',
        ...options,
      },
    });
  return e;
}
async function automation(e, statuses) {
  const a = await db.instagramCommentAutomation.create({
    data: {
      integrationId: e.integrationId,
      mediaId: e.mediaId,
      enabled: true,
      matchType: 'EXACT',
      publicReplyEnabled: true,
      privateReplyEnabled: true,
      publicReplyText: 'Synthetic public',
      privateReplyText: 'Synthetic direct',
      triggers: {
        create: { phrase: 'Eu quero', normalizedPhrase: 'eu quero' },
      },
    },
  });
  if (!statuses) return a;
  return db.instagramCommentAutomationExecution.create({
    data: {
      automationId: a.id,
      webhookEventId: e.id,
      externalCommentId: e.externalCommentId,
      authorId: e.authorId,
      ...statuses,
    },
  });
}
async function execute(type, args, workflowId = id(), queue = 'main') {
  const handle = await client.workflow.start(type, {
    workflowId,
    taskQueue: queue,
    args,
    workflowExecutionTimeout: '90 seconds',
  });
  const value = await handle.result();
  const history = await handle.fetchHistory();
  assert(
    history.events.some((e) => e.workflowTaskStartedEventAttributes),
    'Actual WorkflowTaskStarted required'
  );
  histories.push({ id: workflowId, type, history });
  return { value, handle, history };
}
async function probe(name, fn) {
  const key = id();
  actions.set(key, fn);
  const result = await execute('recoveryFixtureWorkflow', [key]);
  actions.delete(key);
  return result;
}
async function test(name, fn) {
  const before = calls.length;
  try {
    await fn();
    results.push({
      id: name,
      result: 'PASS',
      httpRequests: calls.length - before,
    });
    console.log('PASS', name);
  } catch (error) {
    results.push({
      id: name,
      result: 'FAIL',
      error: String(error.message).slice(0, 1500),
      httpRequests: calls.length - before,
    });
    console.error('FAIL', name, String(error.message).slice(0, 1500));
  }
}
async function legacy(version, post, options = {}) {
  const workflowId = id(),
    handle = await client.workflow.start(`postWorkflowV${version}`, {
      workflowId,
      taskQueue: 'legacy-paused',
      args: [
        {
          taskQueue: 'instagram',
          organizationId: post.organizationId,
          postId: post.id,
          postNow: !!options.postNow,
        },
      ],
      workflowExecutionTimeout: '90 seconds',
    });
  const history = await handle.fetchHistory();
  assert(!history.events.some((e) => e.workflowTaskStartedEventAttributes));
  const occurrence = await db.publicationOccurrence.create({
    data: {
      id: id(),
      organizationId: post.organizationId,
      postId: post.id,
      groupSnapshot: post.group,
      scheduleRevision: post.scheduleRevision,
      scheduledAt: post.publishDate,
    },
  });
  const context = {
    organizationId: post.organizationId,
    integrationId: post.integrationId,
    workflowId,
    runId: handle.firstExecutionRunId,
    protocolVersion: 1,
    actionKey: `publication:${post.id}`,
    snapshots: [post],
    plannedAt: post.publishDate,
  };
  if (!options.unbound)
    await db.automationWorkflowBinding.create({
      data: {
        organizationId: post.organizationId,
        workflowId,
        runId: context.runId,
        actionKey: context.actionKey,
        occurrenceId: occurrence.id,
        expectedRequestHash: publicationRequestHash(context),
      },
    });
  const worker = await Worker.create({
    connection: native,
    namespace: 'default',
    taskQueue: 'legacy-paused',
    workflowBundle: bundle,
    activities,
  });
  const running = worker.run();
  try {
    await handle.result();
  } catch (error) {
    if (!options.unbound) throw error;
  } finally {
    worker.shutdown();
    await running;
  }
  const after = await handle.fetchHistory();
  assert(after.events.some((e) => e.workflowTaskStartedEventAttributes));
  histories.push({
    id: workflowId,
    type: `postWorkflowV${version}`,
    history: after,
  });
  return { handle, occurrence, context };
}
let activities;
(async () => {
  try {
    await db.$connect();
    server = http.createServer(async (request, response) => {
      let raw = '';
      for await (const b of request) raw += b;
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ method: request.method, path: request.url, id: body.id });
      if (request.url.startsWith('/publication/uncertain')) {
        request.socket.destroy();
        return;
      }
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET') {
        const parsed = new URL(request.url, 'http://fixture');
        const key = decodeURIComponent(parsed.pathname.split('/').pop());
        const e =
          key === 'absent-metadata'
            ? null
            : await db.instagramWebhookEvent.findUnique({
                where: { externalCommentId: key },
              });
        response.end(
          JSON.stringify(
            e
              ? {
                  timestamp:
                    e.commentText === 'OLD'
                      ? new Date(+T0 - 1000).toISOString()
                      : new Date(+e.receivedAt - 1000).toISOString(),
                }
              : {}
          )
        );
        return;
      }
      if (request.url.startsWith('/publication/')) {
        response.end(
          JSON.stringify([
            {
              id: body.id,
              postId: 'remote-' + body.id,
              releaseURL: 'https://example.test/' + body.id,
              status: 'published',
            },
          ])
        );
        return;
      }
      if (request.url.endsWith('/messages')) {
        response.statusCode = 400;
        response.end(
          JSON.stringify({
            error: {
              code: 10,
              message:
                "App is missing the 'instagram_manage_messages' permission",
            },
          })
        );
        return;
      }
      response.end(JSON.stringify({ id: 'reply-' + id() }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${server.address().port}`;
    const actualFetch = global.fetch;
    global.fetch = (target, options) => {
      const u = new URL(target);
      if (['graph.facebook.com', 'graph.instagram.com'].includes(u.hostname))
        return actualFetch(endpoint + u.pathname + u.search, options);
      assert.equal(u.origin, endpoint, 'External API forbidden');
      return actualFetch(target, options);
    };
    await db.organization.createMany({
      data: [
        { id: 'org-a', name: 'Synthetic A' },
        { id: 'org-b', name: 'Synthetic B' },
      ],
    });
    await db.integration.createMany({
      data: [
        {
          id: 'ig-a',
          organizationId: 'org-a',
          internalId: 'ig-synthetic',
          name: 'Synthetic',
          type: 'social',
          providerIdentifier: 'instagram',
          token: 'synthetic-only',
          facebookPageId: 'page-synthetic',
          webhookCommentsSubscribed: true,
        },
        {
          id: 'ig-s',
          organizationId: 'org-a',
          internalId: 'ig-standalone',
          name: 'Synthetic standalone',
          type: 'social',
          providerIdentifier: 'instagram-standalone',
          token: 'synthetic-only',
          webhookCommentsSubscribed: true,
          webhookMessagesSubscribed: true,
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: 'admin-a',
          email: 'admin@example.test',
          providerName: 'LOCAL',
          timezone: 0,
        },
        {
          id: 'user-b',
          email: 'user@example.test',
          providerName: 'LOCAL',
          timezone: 0,
        },
      ],
    });
    await db.userOrganization.createMany({
      data: [
        { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN' },
        { userId: 'user-b', organizationId: 'org-b', role: 'ADMIN' },
      ],
    });
    connection = await Connection.connect({ address });
    native = await NativeConnection.connect({ address });
    client = new Client({ connection, namespace: 'default' });
    const temporal = { client: { getRawClient: () => client } };
    scheduling = new PublicationSchedulingService(db, recovery, temporal);
    const provider = {
      editor: 'normal',
      comment: async (_id, _parent, _last, _token, details) =>
        send({ post: { id: details[0].id } }),
      post: async (_id, _token, details) =>
        send({ post: { id: details[0].id } }),
    };
    const postsService = {
      getPostById: (postId, org) =>
        db.post.findFirst({
          where: { id: postId, organizationId: org },
          include: { integration: true },
        }),
      getPostsRecursively: async (postId, _include, org) => [
        await db.post.findFirstOrThrow({
          where: { id: postId, organizationId: org },
          include: { integration: true },
        }),
      ],
      updateTags: async (_org, posts) => posts,
      updateMedia: async () => [],
      reconcileSafeSchedules: () => scheduling.reconcile(),
    };
    postActivity = new PostActivity(
      postsService,
      { inAppNotification: async () => {} },
      { getSocialIntegration: () => provider },
      {},
      {},
      { getWebhooks: async () => [] },
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
      undefined,
      {run:async()=>({completionNotCertifiedByGeneralFixture:true})}
    );
    activities = {
      fixtureAction: async (key) => {
        assert(actions.has(key));
        await actions.get(key)();
        return true;
      },
    };
    for (const instance of [postActivity, recoveryActivity, igActivity])
      for (const name of Object.getOwnPropertyNames(
        Object.getPrototypeOf(instance)
      ))
        if (name !== 'constructor' && typeof instance[name] === 'function')
          activities[name] = instance[name].bind(instance);
    activities.internalPlugs = async () => [];
    activities.globalPlugs = async () => [];
    activities.sendWebhooks = async () => {};
    bundle = await bundleWorkflowCode({
      workflowsPath: path.join(
        root,
        'diagnostics/recovery/fixture-workflows.ts'
      ),
      webpackConfigHook: (config) => {
        config.resolve.alias = {
          ...config.resolve.alias,
          ...Object.fromEntries(
            Object.entries(aliases).map(([k, v]) => [
              k.slice(0, -1),
              path.join(root, v),
            ])
          ),
        };
        // Source fixtures must not inherit the author's machine-specific .swcrc.
        // Production still bundles emitted JS, as before; this only configures tests.
        for (const rule of config.module.rules || []) {
          const use = Array.isArray(rule.use) ? rule.use : [rule.use];
          for (const loader of use)
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
        }
        return config;
      },
    });
    for (const queue of ['main', 'instagram']) {
      const worker = await Worker.create({
        connection: native,
        namespace: 'default',
        taskQueue: queue,
        workflowBundle: bundle,
        activities,
      });
      workers.push(worker);
      runs.push(worker.run());
    }
    await open();
    await test('R01', () =>
      probe('R01', async () => {
        const f = await bound(new Date(+T0 - 1)),
          before = calls.length;
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'BEFORE_RECOVERY_CUTOFF'
        );
        assert.equal((await latest(f.post.id)).state, 'ERROR');
        assert.equal(calls.length, before);
      }));
    await test('R02', async () => {
      for (const delta of [0, 1]) {
        const p = await publication(new Date(+T0 + delta)),
          d = await scheduling.stagePost(p.organizationId, p.id);
        const before = calls.length;
        await execute('postWorkflowV106', [d], d.workflowId);
        assert.equal((await latest(p.id)).state, 'PUBLISHED');
        assert.equal(calls.length, before + 1);
      }
    });
    await test('R03', async () => {
      const p = await publication(new Date(+T0 + 5000)),
        d = await scheduling.stagePost(p.organizationId, p.id);
      assert(+p.publishDate < Date.now());
      await execute('postWorkflowV106', [d], d.workflowId);
      assert.equal((await latest(p.id)).state, 'PUBLISHED');
    });
    await test('R04', () =>
      probe('R04', async () => {
        const f = await bound(new Date(+T0 + 1)),
          before = calls.length;
        await open(new Date(+T0 + 2), 2);
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'BEFORE_RECOVERY_CUTOFF'
        );
        assert.equal(calls.length, before);
        await open();
      }));
    await test('R05', async () => {
      for (const version of [101, 102, 103, 104, 105]) {
        const p = await publication(new Date(+T0 - 1)),
          before = calls.length;
        await legacy(version, p);
        assert.equal(calls.length, before);
        assert.equal((await latest(p.id)).state, 'ERROR');
      }
    });
    await test('R06', async () => {
      const f = await bound(new Date(+T0 - 1)),
        before = calls.length;
      const key = id();
      actions.set(key, async () => {
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'BEFORE_RECOVERY_CUTOFF'
        );
      });
      await execute('recoveryFixtureWorkflow', [key], id(), 'instagram');
      actions.delete(key);
      assert.equal(calls.length, before);
    });
    await test('R07', () =>
      probe('R07', async () => {
        const p = await publication(new Date(+T0 - 864000000)),
          before = calls.length;
        assert.equal(await scheduling.stagePost(p.organizationId, p.id), null);
        const renamed = {
          workflowId: id(),
          runId: randomUUID(),
          protocolVersion: 1,
          organizationId: p.organizationId,
          integrationId: p.integrationId,
          snapshots: [p],
          actionKey: `publication:${p.id}`,
        };
        await reject(
          recovery.executePublication(renamed, () => send({ post: p })),
          'LEGACY_BINDING_REQUIRED'
        );
        assert.equal(calls.length, before);
      }));
    await test('R08', () =>
      probe('R08', async () => {
        const f = await bound(new Date(+T0 - 1));
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'BEFORE_RECOVERY_CUTOFF'
        );
        await db.post.update({
          where: { id: f.post.id },
          data: { state: 'QUEUE' },
        });
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'OCCURRENCE_TERMINALLY_HELD'
        );
        await assert.rejects(
          scheduling.assertSimpleStatusChange('org-a', f.post.id)
        );
      }));
    await test('R09', () =>
      probe('R09', async () => {
        const f = await bound(),
          at = new Date(Date.now() + 86400000);
        await postRepository.changeDate(
          'org-a',
          f.post.id,
          at.toISOString(),
          false
        );
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'SCHEDULE_REVISION_CHANGED'
        );
        const p = await latest(f.post.id);
        assert.equal(p.scheduleRevision, 2);
        assert.equal(+p.publishDate, +at);
        assert.equal(p.state, 'QUEUE');
      }));
    await test('R10', () =>
      probe('R10', async () => {
        const f = await bound(new Date(+T0 - 1), {
            state: 'PUBLISHED',
            releaseId: 'manual-or-unknown',
            releaseURL: 'https://example.test/existing',
          }),
          before = calls.length;
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'PUBLICATION_ALREADY_CONFIRMED'
        );
        assert.equal((await latest(f.post.id)).releaseId, 'manual-or-unknown');
        assert.equal(calls.length, before);
      }));
    await test('R11', () =>
      probe('R11', async () => {
        const f = await bound(new Date(+T0 - 1));
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'BEFORE_RECOVERY_CUTOFF'
        );
        const input = {
          occurrenceId: f.occurrence.id,
          requestId: randomUUID(),
          remoteId: 'manual-proof',
          remoteUrl: 'https://example.test/manual',
          attestation: 'CONFIRM_MANUAL_PUBLICATION',
        };
        await reconciliation.confirmManual(
          'org-a',
          f.post.id,
          'admin-a',
          input
        );
        await reconciliation.confirmManual(
          'org-a',
          f.post.id,
          'admin-a',
          input
        );
        const h = await reconciliation.history('org-a', f.post.id, 'admin-a');
        assert.equal(h.occurrences[0].automaticOutcome, 'EXPIRED');
        assert.equal(h.occurrences[0].evidence.length, 1);
        assert.equal((await latest(f.post.id)).state, 'ERROR');
        await assert.rejects(
          reconciliation.confirmManual('org-b', f.post.id, 'user-b', input)
        );
      }));
    await test('R12', () =>
      probe('R12', async () => {
        const f = await bound();
        const receipt = await recovery.executePublication(f.context, () =>
          send(f)
        );
        await postRepository.changeDate(
          'org-a',
          f.post.id,
          new Date(Date.now() + 86400000).toISOString(),
          false
        );
        await recovery.projectPublication(
          f.context,
          receipt[0].postId,
          receipt[0].releaseURL
        );
        await recovery.recordWorkflowFailure(f.context, f.post.id);
        assert.equal((await latest(f.post.id)).state, 'QUEUE');
        assert.equal(
          await db.publicationEvidence.count({
            where: { occurrenceId: f.occurrence.id },
          }),
          1
        );
      }));
    await test('R13', () =>
      probe('R13', async () => {
        const f = await bound(),
          before = calls.length;
        await Promise.allSettled(
          Array.from({ length: 8 }, () =>
            recovery.executePublication(f.context, () => send(f))
          )
        );
        assert.equal(calls.length, before + 1);
        assert.equal(
          await db.automationEffectAttempt.count({
            where: { occurrenceId: f.occurrence.id },
          }),
          1
        );
      }));
    await test('R14', () =>
      probe('R14', async () => {
        const fsx = await Promise.all([
          bound(new Date(+T0 - 1)),
          bound(new Date(+T0 - 2)),
        ]);
        const crash = (mode) => {
          const env = Object.fromEntries(
            ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'RECOVERY_APPROVAL_PUBLIC_KEY_FILE']
              .filter((k) => process.env[k])
              .map((k) => [k, process.env[k]])
          );
          const r = req('node:child_process').spawnSync(
            process.execPath,
            [
              path.join(
                root,
                'diagnostics/recovery/crash-decision-fixture.cjs'
              ),
              root,
              dbUrl.href,
              JSON.stringify(fsx[0].context),
              mode,
            ],
            { env, encoding: 'utf8', windowsHide: true }
          );
          assert.equal(r.status, 86, r.stderr);
        };
        crash('before-commit');
        assert.equal(
          await db.automationRecoveryDecision.count({
            where: { subjectKey: 'crash-uncommitted' },
          }),
          0
        );
        crash('after-commit');
        assert.equal(
          await db.automationRecoveryDecision.count({
            where: {
              subjectKey: 'occurrence:' + fsx[0].occurrence.id,
              action: 'EXPIRE',
            },
          }),
          1
        );
        const restarted = new AutomationRecoveryService(db);
        for (const f of fsx)
          await assert.rejects(
            restarted.executePublication(f.context, () => send(f))
          );
        assert.equal(
          await db.automationRecoveryDecision.count({
            where: {
              subjectKey: {
                in: fsx.map((f) => 'occurrence:' + f.occurrence.id),
              },
              action: 'EXPIRE',
            },
          }),
          2
        );
      }));
    await test('R15', () =>
      probe('R15', async () => {
        const f = await bound(),
          before = calls.length;
        await assert.rejects(
          recovery.executePublication(f.context, () => send(f, 'uncertain'))
        );
        await reject(
          new AutomationRecoveryService(db).executePublication(f.context, () =>
            send(f)
          ),
          'REMOTE_EFFECT_UNCONFIRMED'
        );
        assert.equal(calls.length, before + 1);
        const y = await bound();
        await assert.rejects(
          recovery.executePublication(y.context, async () => {
            await recovery.checkpointPublication(
              y.context,
              'youtube-known',
              'https://www.youtube.com/watch?v=synthetic'
            );
            throw Error('Synthetic crash after checkpoint');
          })
        );
        assert.equal(
          (
            await db.automationEffectAttempt.findFirst({
              where: { occurrenceId: y.occurrence.id },
            })
          ).remoteId,
          'youtube-known'
        );
        await reject(
          recovery.executePublication(y.context, () => send(y)),
          'REMOTE_EFFECT_UNCONFIRMED'
        );
      }));
    await test('R16', () =>
      probe('R16', async () => {
        const anchor = new Date(+T0 - 3 * 86400000 + 1000),
          p = await publication(anchor, { intervalInDays: 1 }),
          d = await scheduling.stagePost('org-a', p.id);
        assert.equal(+new Date(d.scheduledAt), +T0 + 1000);
        assert.equal((await latest(p.id)).intervalInDays, 1);
        assert.equal(
          await db.publicationOccurrence.count({
            where: { postId: p.id, outcome: 'EXPIRED' },
          }),
          1
        );
        assert.equal(
          await db.automationEffectAttempt.count({ where: { postId: p.id } }),
          0
        );
      }));
    await test('R17', async () => {
      const p = await publication(new Date(+T0 - 1));
      const before = calls.length;
      await legacy(105, p, { postNow: true });
      assert.equal(calls.length, before);
      assert.equal((await latest(p.id)).state, 'ERROR');
    });
    await test('R18', () =>
      probe('R18', async () => {
        const p = await publication(new Date(+T0 - 86400000 + 1000), {
          intervalInDays: 1,
        });
        const values = await Promise.all([
          scheduling.stagePost('org-a', p.id),
          scheduling.stagePost('org-a', p.id),
        ]);
        assert.equal(values[0].occurrenceId, values[1].occurrenceId);
        assert.equal(
          await db.publicationScheduleIntent.count({
            where: { occurrenceId: values[0].occurrenceId },
          }),
          1
        );
        assert.equal(+new Date(values[0].scheduledAt), +T0 + 1000);
      }));
    await test('R19', () =>
      probe('R19', async () => {
        const p = await publication(new Date(+T0 - 86400000), {
          intervalInDays: 1,
          scheduleRevision: 0,
        });
        await reject(
          scheduling.stagePost('org-a', p.id),
          'LEGACY_INVENTORY_REQUIRED'
        );
        assert.equal((await latest(p.id)).intervalInDays, 1);
        assert.equal(
          await db.publicationOccurrence.count({ where: { postId: p.id } }),
          0
        );
      }));
    await test('R20', () =>
      probe('R20', async () => {
        const a = new Date('2026-03-07T12:00:00-03:00'),
          b = nextFixedOccurrence(a, 1, new Date('2026-03-09T14:59:59Z'));
        assert.equal(b.toISOString(), '2026-03-09T15:00:00.000Z');
        assert.equal(+b - +a, 2 * 86400000);
        assert.equal(
          +new Date('2026-11-15T09:00:00-03:00'),
          +new Date('2026-11-15T12:00:00Z')
        );
      }));
    await test('R21', async () => {
      const e = await comment({
          receivedAt: new Date(+T0 - 1),
          occurredAt: null,
          occurredAtSource: null,
        }),
        before = calls.length;
      await execute('instagramCommentAutomationWorkflow', [
        { webhookEventId: e.id },
      ]);
      assert.equal((await event(e.id)).status, 'SKIPPED');
      assert.equal((await event(e.id)).automationExecution, null);
      assert.equal(calls.length, before);
    });
    await test('R22', async () => {
      for (const partial of [false, true]) {
        const e = await comment({ receivedAt: new Date(+T0 - 1) });
        const x = await automation(e, {
            publicReplyStatus: partial ? 'SUCCESS' : 'PENDING',
            publicReplyId: partial ? 'already-public' : null,
            privateReplyStatus: 'PENDING',
          }),
          before = calls.length;
        await execute('instagramCommentAutomationWorkflow', [
          { webhookEventId: e.id },
        ]);
        const after = (await event(e.id)).automationExecution;
        assert.equal(after.publicReplyStatus, partial ? 'SUCCESS' : 'SKIPPED');
        assert.equal(after.privateReplyStatus, 'SKIPPED');
        assert.equal(calls.length, before);
      }
    });
    await test('R23', async () => {
      const e = await comment({ receivedAt: new Date(+T0 - 1) });
      await automation(e, {
        publicReplyStatus: 'SUCCESS',
        publicReplyId: 'confirmed',
        privateReplyStatus: 'FAILED',
        privateReplyError: 'unconfirmed',
      });
      await events.record({
        externalCommentId: e.externalCommentId,
        instagramAccountId: e.instagramAccountId,
        integrationId: e.integrationId,
        status: 'RECEIVED',
        payload: {},
      });
      const before = calls.length;
      await execute('instagramCommentAutomationWorkflow', [
        { webhookEventId: e.id },
      ]);
      assert.equal(
        (await event(e.id)).automationExecution.privateReplyStatus,
        'FAILED'
      );
      assert.equal(calls.length, before);
    });
    await test('R24', async () => {
      const e = await comment({
        commentText: 'OLD',
        occurredAt: null,
        occurredAtSource: null,
      });
      await execute('instagramCommentAutomationWorkflow', [
        { webhookEventId: e.id },
      ]);
      assert.equal((await event(e.id)).status, 'SKIPPED');
      assert.equal(
        (await event(e.id)).occurredAtSource,
        'META_COMMENT_CREATED_TIME'
      );
      const unknown = await comment({
        occurredAt: null,
        occurredAtSource: 'WEBHOOK_ENTRY_TIME',
        externalCommentId: 'absent-metadata',
      });
      await execute('instagramCommentAutomationWorkflow', [
        { webhookEventId: unknown.id },
      ]);
      assert.equal((await event(unknown.id)).automationExecution, null);
      assert.equal((await event(unknown.id)).status, 'RECEIVED');
    });
    await test('R25', async () => {
      for (const integrationId of ['ig-a', 'ig-s']) {
        const e = await comment({
          integrationId,
          occurredAt: null,
          occurredAtSource: null,
        });
        await automation(e);
        const before = calls.length;
        await execute('instagramCommentAutomationWorkflow', [
          { webhookEventId: e.id },
        ]);
        const after = await event(e.id);
        assert.equal(after.automationExecution.publicReplyStatus, 'SUCCESS');
        assert.equal(after.automationExecution.privateReplyStatus, 'FAILED');
        assert.equal(after.status, 'FAILED');
        const requests = calls.slice(before);
        assert(requests.some((r) => r.path.endsWith('/replies')));
        assert(
          requests.some(
            (r) =>
              r.path ===
              (integrationId === 'ig-a'
                ? '/v25.0/page-synthetic/messages'
                : '/v25.0/me/messages')
          )
        );
        assert.equal(
          await db.automationEffectAttempt.count({
            where: { subjectKey: `comment:${e.id}` },
          }),
          2
        );
      }
    });
    await test('R26', () =>
      probe('R26', async () => {
        const e = await comment({ receivedAt: new Date(+T0 - 1) }),
          x = await automation(e, {
            publicReplyStatus: 'SUCCESS',
            publicReplyId: 'confirmed-r26',
            privateReplyStatus: 'PENDING',
          });
        await Promise.allSettled([
          recovery.guardCommentEvent(e.id, 'org-a'),
          igRepository.finalizeExecution(x.id, e.id),
          new InstagramCommentAutomationDispatcherService(temporal, igRepository, recovery).dispatch(e.id),
          events.record({
            externalCommentId: e.externalCommentId,
            integrationId: e.integrationId,
            instagramAccountId: e.instagramAccountId,
            status: 'RECEIVED',
            payload: {},
          }),
        ]);
        const after = await event(e.id);
        assert.equal(after.recoverySkipReason, 'COMMENT_BEFORE_T0');
        assert.equal(after.automationExecution.publicReplyId, 'confirmed-r26');
        assert.equal(after.automationExecution.privateReplyStatus, 'SKIPPED');
        assert.equal(after.status, 'REPLIED');
      }));
    await test('R27', () =>
      probe('R27', async () => {
        const f = await bound(new Date(+T0 - 1)),
          before = calls.length;
        const input = {
          ...f.context,
          derived: true,
          targetIntegrationId: 'ig-s',
          parentRemoteId: 'parent-proof',
          dependencyHash: 'synthetic-configuration',
        };
        await db.automationWorkflowBinding.update({
          where: {
            workflowId_runId_actionKey: {
              workflowId: input.workflowId,
              runId: input.runId,
              actionKey: input.actionKey,
            },
          },
          data: { expectedRequestHash: publicationRequestHash(input) },
        });
        await reject(
          recovery.executePublication(input, () => send(f)),
          'BEFORE_RECOVERY_CUTOFF'
        );
        assert.equal(calls.length, before);
      }));
    await test('R28', () =>
      probe('R28', async () => {
        const f = await bound(),
          before = calls.length;
        await db.automationRecoveryControl.update({
          where: { id: 'global' },
          data: { phase: 'BLOCKED' },
        });
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'RECOVERY_CLOSED'
        );
        await open();
        await reject(
          recovery.executePublication(
            { ...f.context, protocolVersion: 0 },
            () => send(f)
          ),
          'RECOVERY_PROTOCOL_MISMATCH'
        );
        const { assertWorkerConsumptionPrepared } = get(
          'automation-recovery/worker-consumption'
        );
        assert.throws(
          assertWorkerConsumptionPrepared,
          /ACTIVATION_UNAVAILABLE/
        );
        const unavailable = new PrismaClient({
          datasources: {
            db: {
              url: 'postgresql://guard_test:synthetic-only@127.0.0.1:1/guard_test?connect_timeout=1',
            },
          },
        });
        try {
          await assert.rejects(
            new AutomationRecoveryService(unavailable).executePublication(
              f.context,
              () => send(f)
            )
          );
        } finally {
          await unavailable.$disconnect();
        }
        assert.equal(calls.length, before);
      }));
    await test('R29', () =>
      probe('R29', async () => {
        const f = await bound(new Date(+T0 - 1)),
          before = calls.length;
        await assert.rejects(
          recovery.executePublication(f.context, () => send(f))
        );
        for (let n = 0; n < 3; n++)
          await reject(
            new AutomationRecoveryService(db).executePublication(
              f.context,
              () => send(f)
            ),
            'OCCURRENCE_TERMINALLY_HELD'
          );
        const { observe } = req(
          path.join(root, 'scripts/recovery/watchdog-observe.cjs')
        );
        const observation = await observe();
        assert.equal(observation.restartEnabled, false);
        assert.equal(observation.workerActivationEnabled, false);
        assert.equal(calls.length, before);
      }));
    await test('R30', async () => {
      const before = calls.length;
      const legacyHistories = histories.filter((h) =>
        /^postWorkflowV10[1-5]$/.test(h.type)
      );
      assert.equal(new Set(legacyHistories.map((h) => h.type)).size, 5);
      for (const h of legacyHistories)
        await Worker.runReplayHistory(
          { workflowBundle: bundle },
          h.history,
          h.id
        );
      assert.equal(calls.length, before);
    });
    await test('R31', () =>
      probe('R31', async () => {
        const f = await bound(),
          before = calls.length;
        await db.organization.update({
          where: { id: 'org-a' },
          data: { suspendedAt: new Date() },
        });
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'ORGANIZATION_UNAVAILABLE'
        );
        await db.organization.update({
          where: { id: 'org-a' },
          data: { suspendedAt: null },
        });
        for (const change of [
          { adminPausedAt: new Date() },
          { deletedAt: new Date() },
        ]) {
          await db.post.update({ where: { id: f.post.id }, data: change });
          await reject(
            recovery.executePublication(f.context, () => send(f)),
            'PUBLICATION_UNAVAILABLE'
          );
          await db.post.update({
            where: { id: f.post.id },
            data: { adminPausedAt: null, deletedAt: null },
          });
        }
        await db.integration.update({
          where: { id: 'ig-a' },
          data: { disabled: true },
        });
        await reject(
          recovery.executePublication(f.context, () => send(f)),
          'PUBLICATION_UNAVAILABLE'
        );
        await db.integration.update({
          where: { id: 'ig-a' },
          data: { disabled: false },
        });
        await assert.rejects(
          reconciliation.history('org-a', f.post.id, 'user-b')
        );
        assert.equal(calls.length, before);
      }));
    const actualTasks = histories.reduce(
      (n, h) =>
        n +
        h.history.events.filter((e) => e.workflowTaskCompletedEventAttributes)
          .length,
      0
    );
    assert(actualTasks > 0);
    // A passing fixture is not sufficient to certify every obligation of a broad
    // scenario. Coverage review and missing subcases stay explicit in the report.
    fs.writeFileSync(
      path.join(root, 'diagnostics/recovery/temporal-recovery-results.json'),
      JSON.stringify(
        {
          postgres: '17.11',
          temporal: '1.28.2',
          realWorkflowTasksCompleted: actualTasks,
          httpRequests: calls.length,
          results,
          fullMatrixCertified: false,
          productionHomologated: false,
          clientApiAccess: false,
          activationAuthorized: false,
        },
        null,
        2
      ) + '\n'
    );
    console.log(
      JSON.stringify({
        tests: results.length,
        passed: results.filter((r) => r.result === 'PASS').length,
        actualTasks,
        httpRequests: calls.length,
      })
    );
    if (results.some((r) => r.result !== 'PASS')) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    for (const w of workers) w.shutdown();
    await Promise.allSettled(runs);
    if (native) await native.close();
    if (connection) await connection.close();
    await db.$disconnect();
    if (server) await new Promise((r) => server.close(r));
  }
})();
