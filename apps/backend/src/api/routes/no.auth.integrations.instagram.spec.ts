jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/instagram-webhook-subscription.service',
  () => ({ InstagramWebhookSubscriptionService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), del: jest.fn() },
}));

import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

describe('Instagram OAuth subscription completion', () => {
  function setup(providerIdentifier = 'instagram', reconnect = true) {
    (ioRedis.get as jest.Mock).mockImplementation(async (key: string) => {
      if (key.startsWith('login:')) return 'verifier';
      if (key.startsWith('organization:')) return 'org-1';
      if (key.startsWith('refresh:') && reconnect) return 'ig-1';
      return null;
    });
    const provider = {
      isBetweenSteps: providerIdentifier === 'instagram',
      authenticate: jest.fn().mockResolvedValue({
        id: providerIdentifier === 'instagram' ? 'fb-user' : 'ig-1',
        name: 'Account',
        accessToken: 'user-token',
        refreshToken: 'refresh-user-token',
        expiresIn: 3600,
        username: 'account',
      }),
      reConnect: jest
        .fn()
        .mockResolvedValue({
          id: 'ig-1',
          name: 'Account',
          accessToken: 'page-token',
          username: 'account',
          facebookPageId: 'page-1',
        }),
      pages: jest.fn().mockResolvedValue([]),
    };
    const integrations = {
      createOrUpdateIntegration: jest
        .fn()
        .mockImplementation(async (...args: any[]) => ({
          id: 'integration-1',
          providerIdentifier,
          internalId: args[6],
          token: args[8],
          facebookPageId: args[16],
          webhookCommentsSubscribed: false,
        })),
    };
    const subscriptions = {
      subscribeComments: jest.fn().mockResolvedValue({ success: true }),
    };
    const controller = new NoAuthIntegrationsController(
      {
        getAllowedSocialsIntegrations: () => [providerIdentifier],
        getSocialIntegration: () => provider,
      } as any,
      integrations as any,
      { startRefreshWorkflow: jest.fn().mockResolvedValue(false) } as any,
      { getOrgById: jest.fn().mockResolvedValue({ id: 'org-1' }) } as any,
      subscriptions as any
    );
    const connect = () =>
      controller.connectSocialMedia(providerIdentifier, {
        state: 'state',
        code: 'code',
        timezone: '0',
        ...(reconnect ? { refresh: 'ig-1' } : {}),
      } as any);
    return { connect, integrations, subscriptions, provider };
  }

  beforeEach(() => jest.clearAllMocks());

  it('persists the recovered Page ID, keeps OAuth expiry and retries a failed traditional subscription', async () => {
    const { connect, integrations, subscriptions } = setup();
    await expect(connect()).resolves.toMatchObject({
      webhookSubscription: { success: true },
    });
    const args = integrations.createOrUpdateIntegration.mock.calls[0];
    expect(args[6]).toBe('ig-1');
    expect(args[7]).toBe('instagram');
    expect(args[8]).toBe('page-token');
    expect(args[9]).toBe('refresh-user-token');
    expect(args[10]).toBe(3600);
    expect(args[16]).toBe('page-1');
    expect(subscriptions.subscribeComments).toHaveBeenCalledWith(
      expect.objectContaining({
        providerIdentifier: 'instagram',
        facebookPageId: 'page-1',
        internalId: 'ig-1',
        token: 'page-token',
        webhookCommentsSubscribed: false,
      })
    );
  });

  it('does not subscribe an initial Facebook user token before Page selection', async () => {
    const { connect, subscriptions, provider } = setup('instagram', false);
    await connect();
    expect(provider.reConnect).not.toHaveBeenCalled();
    expect(subscriptions.subscribeComments).not.toHaveBeenCalled();
  });

  it('keeps Standalone subscription behavior without requiring Page metadata', async () => {
    const { connect, subscriptions } = setup('instagram-standalone', false);
    await connect();
    expect(subscriptions.subscribeComments).toHaveBeenCalledWith(
      expect.objectContaining({
        providerIdentifier: 'instagram-standalone',
        token: 'user-token',
      })
    );
  });

  it('reports subscription failure separately from connection success', async () => {
    const { connect, subscriptions } = setup();
    subscriptions.subscribeComments.mockResolvedValue({
      success: false,
      reason: 'INSUFFICIENT_PERMISSIONS',
      error: 'internal details',
    } as any);
    const result = await connect();
    expect(result.webhookSubscription).toEqual({
      success: false,
      reason: 'INSUFFICIENT_PERMISSIONS',
    });
    expect(JSON.stringify(result)).not.toContain('internal details');
  });
});
