jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { ConflictException } from '@nestjs/common';
import { IntegrationRepository } from './integration.repository';
import { IntegrationService } from './integration.service';

const connected = (providerIdentifier: string, organizationId = 'org-1') => ({
  id: `integration-${providerIdentifier}`,
  internalId: 'ig-1',
  organizationId,
  providerIdentifier,
  token: `unchanged-${providerIdentifier}-token`,
});

const makeRepository = (existing: any = null) => {
  const integration = {
    findUnique: jest.fn().mockResolvedValue(existing),
    create: jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: 'created', ...data })
      ),
    update: jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ ...existing, ...data })
      ),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(),
  };
  const repository = new IntegrationRepository(
    { model: { integration } } as any,
    { model: { post: { updateMany: jest.fn() } } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { repository, integration };
};

const connect = (
  repository: IntegrationRepository,
  provider: 'instagram' | 'instagram-standalone',
  organizationId = 'org-1'
) =>
  repository.createOrUpdateIntegration(
    undefined,
    false,
    organizationId,
    'Instagram account',
    undefined,
    'social',
    'ig-1',
    provider,
    `new-${provider}-token`
  );

describe('Instagram multi-provider connection safety', () => {
  it.each(['instagram', 'instagram-standalone'] as const)(
    'connects %s normally without requiring a Facebook Page ID',
    async (provider) => {
      const { repository, integration } = makeRepository();
      await connect(repository, provider);
      expect(integration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          internalId: 'ig-1',
          rootInternalId: 'ig-1',
          providerIdentifier: provider,
          token: `new-${provider}-token`,
        }),
      });
      expect(
        integration.create.mock.calls[0][0].data.facebookPageId
      ).toBeUndefined();
    }
  );

  it.each([
    ['instagram-standalone', 'instagram'],
    ['instagram', 'instagram-standalone'],
  ] as const)(
    'rejects an existing %s connection when %s is requested',
    async (existingProvider, requestedProvider) => {
      const existing = connected(existingProvider);
      const { repository, integration } = makeRepository(existing);

      await expect(
        connect(repository, requestedProvider)
      ).rejects.toBeInstanceOf(ConflictException);
      expect(integration.update).not.toHaveBeenCalled();
      expect(existing.token).toBe(`unchanged-${existingProvider}-token`);
      expect(existing.providerIdentifier).toBe(existingProvider);
    }
  );

  it('keeps canonical account checks isolated by organization', async () => {
    const { repository, integration } = makeRepository();
    await connect(repository, 'instagram-standalone', 'org-2');
    expect(integration.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_internalId: {
          organizationId: 'org-2',
          internalId: 'ig-1',
        },
      },
    });
  });

  it('blocks the final Facebook page selection before replacing Standalone credentials', async () => {
    const existing = connected('instagram-standalone');
    const { repository, integration } = makeRepository(existing);
    await expect(
      repository.updateIntegration('temporary-facebook-login', {
        organizationId: 'org-1',
        internalId: 'ig-1',
        providerIdentifier: 'instagram',
        token: 'new-page-token',
        facebookPageId: 'page-1',
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(integration.update).not.toHaveBeenCalled();
    expect(existing.token).toBe('unchanged-instagram-standalone-token');
  });
});

describe('Instagram multi-provider webhook candidate safety', () => {
  it('routes a Facebook signature by Page ID and active state only', async () => {
    const { repository, integration } = makeRepository();
    await repository.findActiveInstagramWebhookCandidates('page-1', [
      'facebook',
    ]);
    expect(integration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              providerIdentifier: 'instagram',
              facebookPageId: 'page-1',
            },
          ],
          deletedAt: null,
          disabled: false,
          refreshNeeded: false,
          webhookCommentsSubscribed: true,
        }),
      })
    );
  });

  it('routes an Instagram signature only to Standalone internal IDs', async () => {
    const { repository, integration } = makeRepository();
    await repository.findActiveInstagramWebhookCandidates('ig-1', [
      'instagram',
    ]);
    expect(integration.findMany.mock.calls[0][0].where.OR).toEqual([
      {
        providerIdentifier: 'instagram-standalone',
        internalId: 'ig-1',
      },
    ]);
  });
});

describe('IntegrationService Facebook Page persistence', () => {
  it('persists facebookPageId after selecting a traditional Instagram account', async () => {
    const repository = {
      getIntegrationById: jest.fn().mockResolvedValue({
        id: 'temporary',
        organizationId: 'org-1',
        providerIdentifier: 'instagram',
        inBetweenSteps: true,
        token: 'facebook-user-token',
      }),
      checkForDeletedOnceAndUpdate: jest.fn(),
      updateIntegration: jest.fn().mockImplementation((_, data) =>
        Promise.resolve({
          id: 'traditional-integration',
          ...data,
          providerIdentifier: 'instagram',
        })
      ),
    };
    const manager = {
      getSocialIntegration: jest.fn().mockReturnValue({
        fetchPageInformation: jest.fn().mockResolvedValue({
          id: 'ig-1',
          name: 'Account',
          picture: undefined,
          access_token: 'page-token',
          username: 'account',
          facebookPageId: 'page-1',
        }),
      }),
    };
    const subscriptions = { subscribeComments: jest.fn() };
    const service = new IntegrationService(
      repository as any,
      {} as any,
      manager as any,
      {} as any,
      {} as any,
      {} as any,
      subscriptions as any
    );

    await service.saveProviderPage('org-1', 'temporary', {
      id: 'ig-1',
      pageId: 'page-1',
    });

    expect(repository.updateIntegration).toHaveBeenCalledWith(
      'temporary',
      expect.objectContaining({
        organizationId: 'org-1',
        internalId: 'ig-1',
        providerIdentifier: 'instagram',
        token: 'page-token',
        facebookPageId: 'page-1',
      })
    );
    expect(
      repository.updateIntegration.mock.calls[0][1].rootInternalId
    ).toBeUndefined();
    expect(subscriptions.subscribeComments).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'traditional-integration',
        internalId: 'ig-1',
        facebookPageId: 'page-1',
        token: 'page-token',
      })
    );
  });
});
