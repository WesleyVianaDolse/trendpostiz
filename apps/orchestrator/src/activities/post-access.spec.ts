import { PostActivity } from './post.activity';
jest.mock('nestjs-temporal-core', () => ({
  Activity: () => () => {},
  ActivityMethod: () => () => {},
  TemporalService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service',
  () => ({ WebhooksService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/platform/platform.service',
  () => ({ PlatformService: class {} })
);
jest.mock('@gitroom/helpers/utils/strip.html.validation', () => ({
  stripHtmlValidation: (_: string, text: string) => text,
}));

describe('publication execution suspension', () => {
  const integration = {
    id: 'integration',
    organizationId: 'org',
    providerIdentifier: 'facebook',
  } as any;
  const posts = [
    {
      id: 'post',
      group: 'v1',
      publishDate: new Date(),
      content: 'Post',
      image: '[]',
      settings: '{}',
    },
  ] as any;
  let access: any, provider: any, postService: any, activity: PostActivity;
  beforeEach(() => {
    access = { canPublishPosts: jest.fn().mockResolvedValue(true) };
    provider = {
      editor: 'none',
      post: jest.fn().mockResolvedValue([]),
      comment: jest.fn().mockResolvedValue([]),
    };
    postService = {
      updateTags: jest.fn().mockResolvedValue(posts),
      updateMedia: jest.fn().mockResolvedValue([]),
    };
    activity = new PostActivity(
      postService,
      {} as any,
      { getSocialIntegration: () => provider } as any,
      {} as any,
      {} as any,
      {} as any,
      {
        client: { getRawClient: () => ({ workflow: { start: jest.fn() } }) },
      } as any,
      { getSubscription: jest.fn().mockResolvedValue({}) } as any,
      access
    );
  });
  it('does not publish a job already in Temporal when its organization is suspended', async () => {
    access.canPublishPosts.mockResolvedValue(false);
    await expect(activity.postSocial(integration, posts)).rejects.toMatchObject(
      { type: 'organization_suspended', nonRetryable: true }
    );
    expect(provider.post).not.toHaveBeenCalled();
    expect(postService.updateMedia).not.toHaveBeenCalled();
  });
  it('rechecks after media preparation so a suspension during processing is respected', async () => {
    access.canPublishPosts
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(activity.postSocial(integration, posts)).rejects.toMatchObject(
      { type: 'organization_suspended' }
    );
    expect(postService.updateMedia).toHaveBeenCalled();
    expect(provider.post).not.toHaveBeenCalled();
  });
  it('also prevents delayed follow-up comments', async () => {
    access.canPublishPosts.mockResolvedValue(false);
    await expect(
      activity.postComment('remote-post', undefined, integration, posts)
    ).rejects.toMatchObject({ type: 'organization_suspended' });
    expect(provider.comment).not.toHaveBeenCalled();
  });
  it('continues to publish and comment for an active, current job', async () => {
    await activity.postSocial(integration, posts);
    await activity.postComment('remote-post', undefined, integration, posts);
    expect(provider.post).toHaveBeenCalledTimes(1);
    expect(provider.comment).toHaveBeenCalledTimes(1);
  });
});
