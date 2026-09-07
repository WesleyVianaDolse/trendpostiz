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
});
