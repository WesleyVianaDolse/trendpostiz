// No bootstrap/.env. Provider implementations are real; X's SDK transport is
// replaced only in this disposable test process, never in application source.
const path = require('node:path'),
  Module = require('node:module'),
  assert = require('node:assert/strict');
module.exports = function setup(
  root,
  url,
  endpoint,
  getCase = () => 'synthetic',
  getDelay = () => 100,
  loadRealProviders = true
) {
  const req = Module.createRequire(path.join(root, 'package.json'));
  req('reflect-metadata');
  req('ts-node').register({
    project: path.join(root, 'tsconfig.base.json'),
    transpileOnly: true,
    compilerOptions: {
      module: 'commonjs',
      target: 'es2020',
      incremental: false,
    },
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
  const typeOnly = {
    'automation-recovery/publication-completion.service': ['PublicationCompletionService'],
    'database/prisma/posts/posts.service': ['PostsService'],
    'database/prisma/notifications/notification.service': [
      'NotificationService',
    ],
    'integrations/integration.manager': ['IntegrationManager'],
    'database/prisma/integrations/integration.service': ['IntegrationService'],
    'integrations/refresh.integration.service': ['RefreshIntegrationService'],
    'database/prisma/webhooks/webhooks.service': ['WebhooksService'],
    'database/prisma/subscriptions/subscription.service': [
      'SubscriptionService',
    ],
    'openai/openai.service': ['OpenaiService'],
  };
  const load = Module._load;
  Module._load = function (name, parent, isMain) {
    // Resolve relative DI type imports against their caller. In particular,
    // './integration.manager' inside integrations/ is the same metadata type
    // as its alias, and must not load all 32 unrelated provider SDKs.
    const key = name.startsWith('.') && parent?.filename
      ? path.relative(path.join(root, 'libraries/nestjs-libraries/src'), path.resolve(path.dirname(parent.filename), name)).split(path.sep).join('/')
      : name.replace('@gitroom/nestjs-libraries/', '');
    const matched = typeOnly[key] || Object.entries(typeOnly).find(([suffix])=>key.endsWith('/'+suffix))?.[1];
    if (matched)
      return Object.fromEntries(matched.map((n) => [n, class {}]));
    return load.call(this, name, parent, isMain);
  };
  const get = (file) =>
    req(path.join(root, 'libraries/nestjs-libraries/src', file + '.ts'));
  const { PrismaClient } = req('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const originalFetch = global.fetch;
  global.fetch = (target, options = {}) => {
    const request = target instanceof Request ? target : null;
    const u = new URL(request ? request.url : target);
    let destination;
    if (['api.linkedin.com', 'graph.threads.net'].includes(u.hostname))
      destination = endpoint + u.pathname + u.search;
    else {
      assert.equal(u.origin, endpoint, 'Client API access forbidden');
      destination = u.href;
    }
    return originalFetch(destination, {
      ...(request
        ? {
            method: request.method,
            body: request.body,
            signal: request.signal,
            duplex: 'half',
          }
        : {}),
      ...options,
      headers: {
        ...Object.fromEntries(new Headers(options.headers || request?.headers)),
        'x-fixture-case': getCase(),
      },
    });
  };
  process.env.X_API_KEY = 'synthetic-only';
  process.env.X_API_SECRET = 'synthetic-only';
  const { TwitterApi } = req('twitter-api-v2');
  Object.defineProperty(TwitterApi.prototype, 'v2', {
    configurable: true,
    get: () => ({
      me: async () => (await fetch(endpoint + '/x/me')).json(),
      tweetLikedBy: async () => (await fetch(endpoint + '/x/likes')).json(),
      retweet: async (actor, parent) =>
        (
          await fetch(endpoint + '/x/retweet', {
            method: 'POST',
            body: JSON.stringify({ actor, parent }),
          })
        ).json(),
      tweet: async (body) =>
        (
          await fetch(endpoint + '/x/tweet', {
            method: 'POST',
            body: JSON.stringify(body),
          })
        ).json(),
    }),
  });
  // R27 uses the real providers by default. F-G supplies its own synthetic
  // provider transport and must not load unused social SDKs in every child.
  const instances = loadRealProviders ? {
    threads: new (get(
      'integrations/social/threads.provider'
    ).ThreadsProvider)(),
    'linkedin-page': new (get(
      'integrations/social/linkedin.page.provider'
    ).LinkedinPageProvider)(),
    linkedin: new (get(
      'integrations/social/linkedin.provider'
    ).LinkedinProvider)(),
    bluesky: new (get(
      'integrations/social/bluesky.provider'
    ).BlueskyProvider)(),
    x: new (get('integrations/social/x.provider').XProvider)(),
  } : {};
  const manager = {
    getSocialIntegration: (name) => instances[name],
    getAllPlugs: () =>
      Object.entries(instances).map(([identifier, provider]) => ({
        identifier,
        plugs: (
          Reflect.getMetadata('custom:plug', Object.getPrototypeOf(provider)) ||
          []
        ).map((p) => ({
          ...p,
          runEveryMilliseconds: getDelay(),
          totalRuns: 3,
        })),
      })),
    getInternalPlugs: (name) => ({
      internalPlugs:
        Reflect.getMetadata(
          'custom:internal_plug',
          Object.getPrototypeOf(instances[name])
        ) || [],
    }),
  };
  const { AutomationRecoveryService } = get(
    'automation-recovery/automation-recovery.service'
  );
  const { DerivedPublicationService } = get(
    'automation-recovery/derived-publication.service'
  );
  const { PublicationSchedulingService } = get(
    'automation-recovery/publication-scheduling.service'
  );
  return {
    req,
    get,
    db,
    manager,
    instances,
    aliases,
    AutomationRecoveryService,
    DerivedPublicationService,
    PublicationSchedulingService,
  };
};
