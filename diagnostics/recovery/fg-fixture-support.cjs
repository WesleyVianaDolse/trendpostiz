const path = require('node:path'),
  Module = require('node:module');
module.exports = function (root, url, endpoint, options = {}) {
  const stage = options.onStage || (() => {});
  const env = require('./derived-fixture-support.cjs')(root, url, endpoint, undefined, undefined, false);
  stage('base-dependencies-loaded');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (name, parent, ...rest) {
    if (name.startsWith('@gitroom/backend/'))
      name = path.join(
        root,
        'apps/backend/src',
        name.slice('@gitroom/backend/'.length)
      );
    return originalResolve.call(this, name, parent, ...rest);
  };
  const originalLoad = Module._load;
  const stubs = {
    // Media methods use the explicit fixture adapter below. Loading its DI
    // type must not also load unrelated video-generation SDKs in each child.
    '@gitroom/nestjs-libraries/database/prisma/media/media.service':
      'MediaService',
    '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service':
      'OrganizationService',
    '@gitroom/nestjs-libraries/database/prisma/users/users.service':
      'UsersService',
    '@gitroom/nestjs-libraries/agent/agent.graph.service': 'AgentGraphService',
    '@gitroom/nestjs-libraries/short-linking/short.link.service':
      'ShortLinkService',
  };
  Module._load = function (name, parent, isMain) {
    if (name === '@gitroom/nestjs-libraries/redis/redis.service')
      return { ioRedis: {} };
    if (stubs[name]) return { [stubs[name]]: class {} };
    return originalLoad.call(this, name, parent, isMain);
  };
  const { db, get } = env;
  const recovery = new env.AutomationRecoveryService(db);
  const { PublicationMutationGuard } = get(
    'automation-recovery/publication-mutation-guard'
  );
  const { PostsRepository } = get('database/prisma/posts/posts.repository');
  stage('post-repository-loaded');
  const repository = new PostsRepository(
    ...Array.from({ length: 6 }, () => ({ model: db })),
    db,
    new PublicationMutationGuard()
  );
  const youtube = {
    editor: 'normal',
    post: async (_id, _token, details) => {
      const detail = details[0];
      let videoId = detail.youtubeUpload?.videoId;
      if (!videoId) {
        videoId = (
          await (
            await fetch(endpoint + '/youtube/insert', {
              method: 'POST',
              body: JSON.stringify({ id: detail.id }),
            })
          ).json()
        ).videoId;
        if (options.youtubeCrash === 'before-checkpoint') process.exit(88);
        await detail.youtubeUpload.onUploaded(videoId);
        if (options.youtubeCrash === 'after-checkpoint') process.exit(88);
      }
      return [
        {
          id: detail.id,
          postId: videoId,
          releaseURL: `https://www.youtube.com/watch?v=${videoId}`,
          status: 'posted',
        },
      ];
    },
  };
  const manager = {
    getSocialIntegration: (name) =>
      name === 'youtube'
        ? youtube
        : {
            editor: 'normal',
            post: async (_id, _token, details) =>
              (
                await fetch(endpoint + '/publication/ok', {
                  method: 'POST',
                  body: JSON.stringify({ id: details[0].id }),
                })
              ).json(),
            comment: async (_id, _parent, _last, _token, details) =>
              (
                await fetch(endpoint + '/publication/comment', {
                  method: 'POST',
                  body: JSON.stringify({ id: details[0].id }),
                })
              ).json(),
          },
    getAllPlugs: () => [],
    getInternalPlugs: () => ({ internalPlugs: [] }),
  };
  let client;
  const temporal = { client: { getRawClient: () => client } };
  const derived = new env.DerivedPublicationService(db, recovery, manager);
  const scheduling = new env.PublicationSchedulingService(
    db,
    recovery,
    temporal,
    derived
  );
  const { PostsService } = get('database/prisma/posts/posts.service');
  stage('post-service-loaded');
  const { PlatformService } = get('database/prisma/platform/platform.service');
  const platform = new PlatformService(db);
  const integrations = {
    getPlugs: (organizationId, integrationId) =>
      db.plugs.findMany({
        where: { organizationId, integrationId, activated: true },
      }),
  };
  const posts = new PostsService(
    repository,
    manager,
    integrations,
    {},
    {},
    {},
    temporal,
    {},
    platform,
    scheduling
  );
  // Media reads/updates are orthogonal to recovery. Retain real scheduling,
  // mutation, reconciler and webhook-reader methods on this service instance.
  posts.updateTags = async (_org, p) => p;
  posts.updateMedia = async () => [];
  const notification = {
    inAppNotification: async (
      orgId,
      subject,
      message,
      sendEmail,
      digest,
      type,
      post
    ) => {
      const r = await fetch(endpoint + '/notification', {
        method: 'POST',
        body: JSON.stringify({
          orgId,
          type,
          post,
          subject,
          message,
          sendEmail,
          digest,
        }),
      });
      if (!r.ok) throw Error('Synthetic notification failure');
    },
  };
  const webhooks = {
    getWebhooks: async (orgId) => [
      { id: 'fg-hook', url: endpoint + '/webhook', integrations: [] },
    ],
  };
  const { PublicationCompletionService } = get(
    'automation-recovery/publication-completion.service'
  );
  stage('completion-service-loaded');
  const completion = new PublicationCompletionService(
    db,
    recovery,
    scheduling,
    notification,
    webhooks,
    posts,
    manager,
    temporal
  );
  const { PostActivity } = env.req(
    path.join(root, 'apps/orchestrator/src/activities/post.activity.ts')
  );
  stage('post-activity-loaded');
  const { YoutubePublicationService } = get(
    'integrations/youtube-publication.service'
  );
  const ytService = new YoutubePublicationService(db, manager, {}, temporal);
  const postActivity = new PostActivity(
    posts,
    notification,
    manager,
    {},
    {},
    webhooks,
    temporal,
    {},
    platform,
    recovery,
    ytService
  );
  const { RecoveryPublicationActivity } = env.req(
    path.join(
      root,
      'apps/orchestrator/src/activities/recovery-publication.activity.ts'
    )
  );
  const recoveryActivity = new RecoveryPublicationActivity(
    scheduling,
    recovery,
    postActivity,
    derived,
    completion
  );
  const activities = {};
  for (const instance of [postActivity, recoveryActivity])
    for (const name of Object.getOwnPropertyNames(
      Object.getPrototypeOf(instance)
    ))
      if (name !== 'constructor' && typeof instance[name] === 'function')
        activities[name] = instance[name].bind(instance);
  activities.setStreak = async (organizationId, type) =>
    db.organization.updateMany({
      where: {
        id: organizationId,
        ...(type === 'start' ? { streakSince: null } : {}),
      },
      data: { streakSince: type === 'start' ? new Date() : null },
    });
  return {
    ...env,
    recovery,
    repository,
    manager,
    scheduling,
    completion,
    posts,
    activities,
    webhooks,
    platform,
    setClient: (v) => {
      client = v;
    },
  };
};
