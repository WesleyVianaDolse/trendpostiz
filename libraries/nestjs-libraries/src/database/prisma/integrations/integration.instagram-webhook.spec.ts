jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { IntegrationService } from './integration.service';

describe('IntegrationService Instagram webhook resolution', () => {
  const repository = {
    findActiveInstagramStandaloneByInternalId: jest.fn(),
    findActiveInstagramWebhookCandidates: jest.fn(),
  };
  const service = new IntegrationService(
    repository as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns exactly one active integration', async () => {
    repository.findActiveInstagramStandaloneByInternalId.mockResolvedValue([
      { id: 'integration-1' },
    ]);
    await expect(
      service.resolveActiveInstagramStandalone('account-1')
    ).resolves.toEqual({
      status: 'found',
      integration: { id: 'integration-1' },
    });
  });

  it('returns not_found when there is no integration', async () => {
    repository.findActiveInstagramStandaloneByInternalId.mockResolvedValue([]);
    await expect(
      service.resolveActiveInstagramStandalone('account-1')
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('returns ambiguous instead of selecting the first integration', async () => {
    repository.findActiveInstagramStandaloneByInternalId.mockResolvedValue([
      { id: 'integration-1' },
      { id: 'integration-2' },
    ]);
    await expect(
      service.resolveActiveInstagramStandalone('account-1')
    ).resolves.toEqual({ status: 'ambiguous' });
  });

  it('routes a Facebook-signed Page object only through Facebook candidates', async () => {
    repository.findActiveInstagramWebhookCandidates.mockResolvedValue([
      {
        id: 'integration-facebook',
        internalId: 'ig-business-1',
        facebookPageId: 'page-1',
        organizationId: 'org-1',
        providerIdentifier: 'instagram',
      },
    ]);
    await expect(
      service.resolveActiveInstagramWebhook('page-1', ['facebook'])
    ).resolves.toMatchObject({
      status: 'found',
      integration: { id: 'integration-facebook' },
    });
    expect(
      repository.findActiveInstagramWebhookCandidates
    ).toHaveBeenCalledWith('page-1', ['facebook']);
  });

  it('does not choose across organizations when a webhook object is ambiguous', async () => {
    repository.findActiveInstagramWebhookCandidates.mockResolvedValue([
      { id: 'one', organizationId: 'org-1' },
      { id: 'two', organizationId: 'org-2' },
    ]);
    await expect(
      service.resolveActiveInstagramWebhook('shared-object', [
        'instagram',
        'facebook',
      ])
    ).resolves.toEqual({ status: 'ambiguous' });
  });
});
