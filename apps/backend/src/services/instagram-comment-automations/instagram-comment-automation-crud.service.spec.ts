import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InstagramCommentAutomationCrudService } from './instagram-comment-automation-crud.service';

const integration = {
  id: 'integration-1',
  organizationId: 'org-1',
  providerIdentifier: 'instagram-standalone',
  token: 'token',
  tokenExpiration: null,
  facebookPageId: null,
  disabled: false,
  deletedAt: null,
  refreshNeeded: false,
  webhookCommentsSubscribed: true,
  webhookMessagesSubscribed: true,
};
const dto = {
  integrationId: 'integration-1',
  mediaId: 'media-1',
  matchType: 'CONTAINS' as const,
  triggers: ['EU QUERO'],
  publicReplyEnabled: true,
  publicReplyText: 'Veja o Direct',
  privateReplyEnabled: true,
  privateReplyText: 'Aqui está',
  enabled: true,
};

const makeService = (overrides: any = {}) => {
  const prisma: any = {
    integration: {
      findFirst: jest.fn().mockResolvedValue(integration),
      findMany: jest.fn(),
    },
    instagramCommentAutomation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    instagramCommentAutomationExecution: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
    ...overrides,
  };
  const media: any = {
    get: jest.fn().mockResolvedValue({ id: 'media-1' }),
    list: jest.fn(),
  };
  return {
    service: new InstagramCommentAutomationCrudService(prisma, media),
    prisma,
    media,
  };
};

describe('InstagramCommentAutomationCrudService', () => {
  it('normalizes triggers before create and uses a transaction', async () => {
    const { service, prisma } = makeService();
    const created = { id: 'automation-1' };
    prisma.$transaction.mockImplementation((callback: any) =>
      callback({
        instagramCommentAutomation: {
          create: jest.fn().mockResolvedValue(created),
        },
      })
    );
    jest.spyOn(service, 'get').mockResolvedValue(created as any);
    await service.create('org-1', { ...dto, triggers: ['  ÉU   QUERO  '] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects normalized duplicate triggers', async () => {
    const { service } = makeService();
    await expect(
      service.create('org-1', { ...dto, triggers: ['ÉU QUERO', 'eu quero'] })
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an invalid integration', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service } = makeService({
      integration: { findFirst },
    });
    await expect(service.create('org-1', dto)).rejects.toThrow(
      NotFoundException
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'integration-1',
        organizationId: 'org-1',
        deletedAt: null,
        disabled: false,
      },
    });
  });

  it('rejects a provider outside the Instagram allowlist', async () => {
    const { service } = makeService({
      integration: {
        findFirst: jest.fn().mockResolvedValue({
          ...integration,
          providerIdentifier: 'facebook',
        }),
      },
    });
    await expect(service.create('org-1', dto)).rejects.toThrow(
      BadRequestException
    );
  });

  it('blocks active private replies without messages subscription', async () => {
    const { service } = makeService({
      integration: {
        findFirst: jest.fn().mockResolvedValue({
          ...integration,
          webhookMessagesSubscribed: false,
        }),
      },
    });
    await expect(service.create('org-1', dto)).rejects.toThrow('Direct');
  });

  it('does not bypass capabilities by saving an inactive configuration', async () => {
    const { service } = makeService({
      integration: {
        findFirst: jest.fn().mockResolvedValue({
          ...integration,
          webhookMessagesSubscribed: false,
        }),
      },
    });
    await expect(
      service.create('org-1', { ...dto, enabled: false })
    ).rejects.toThrow('Direct');
  });

  it('preserves history when delete is requested', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service as any, 'findOwned').mockResolvedValue({ id: 'a' });
    prisma.instagramCommentAutomation.update.mockResolvedValue({});
    await expect(service.remove('org-1', 'a')).resolves.toMatchObject({
      historyPreserved: true,
      enabled: false,
    });
    expect(prisma.instagramCommentAutomation.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { enabled: false },
    });
  });

  it('maps the unique media constraint to a domain conflict', async () => {
    const { service, prisma } = makeService();
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.5.0',
      })
    );
    await expect(service.create('org-1', dto)).rejects.toThrow(
      'Este post já possui uma automação.'
    );
  });

  it('propagates transaction failures without leaving a partial success', async () => {
    const { service, prisma } = makeService();
    prisma.$transaction.mockRejectedValue(new Error('rollback'));
    await expect(service.create('org-1', dto)).rejects.toThrow('rollback');
  });

  it('changes status after ownership validation', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service as any, 'findOwned').mockResolvedValue({
      integrationId: 'integration-1',
      privateReplyEnabled: false,
      publicReplyEnabled: true,
    });
    prisma.instagramCommentAutomation.update.mockResolvedValue({
      enabled: true,
    });
    await expect(service.setStatus('org-1', 'a', true)).resolves.toEqual({
      enabled: true,
    });
  });

  it('lists only sanitized account fields', async () => {
    const { service, prisma } = makeService();
    prisma.integration.findMany.mockResolvedValue([
      { ...integration, token: 'must-not-leak' },
    ]);
    const result = await service.listAccounts('org-1');
    const options = prisma.integration.findMany.mock.calls[0][0];
    expect(options.where).toMatchObject({
      organizationId: 'org-1',
      providerIdentifier: { in: ['instagram-standalone', 'instagram'] },
      disabled: false,
    });
    expect(result[0]).toMatchObject({
      id: 'integration-1',
      capabilities: { commentsWebhook: true },
      status: { comments: 'ACTIVE' },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(JSON.stringify(result)).not.toContain('providerIdentifier');
  });

  it('allows a subscribed Facebook/BM account without messages subscription', async () => {
    const { service, prisma } = makeService({
      integration: {
        findFirst: jest.fn().mockResolvedValue({
          ...integration,
          providerIdentifier: 'instagram',
          facebookPageId: 'page-1',
          webhookMessagesSubscribed: false,
        }),
      },
    });
    prisma.$transaction.mockImplementation((callback: any) =>
      callback({
        instagramCommentAutomation: {
          create: jest.fn().mockResolvedValue({ id: 'a' }),
        },
      })
    );
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'a' } as any);
    await expect(service.create('org-1', dto)).resolves.toEqual({ id: 'a' });
  });

  it('returns reconnect status for an old Facebook/BM account without Page ID', async () => {
    const { service, prisma } = makeService();
    prisma.integration.findMany.mockResolvedValue([
      {
        ...integration,
        providerIdentifier: 'instagram',
        facebookPageId: null,
        webhookMessagesSubscribed: false,
      },
    ]);
    await expect(service.listAccounts('org-1')).resolves.toEqual([
      expect.objectContaining({
        capabilities: expect.objectContaining({ reconnectRequired: true }),
        status: expect.objectContaining({
          comments: 'RECONNECT_REQUIRED',
          publicReply: 'UNAVAILABLE',
          privateReply: 'UNAVAILABLE',
        }),
      }),
    ]);
  });

  it('requires an old Facebook/BM account without Page ID to reconnect', async () => {
    const { service } = makeService({
      integration: {
        findFirst: jest.fn().mockResolvedValue({
          ...integration,
          providerIdentifier: 'instagram',
          facebookPageId: null,
          webhookMessagesSubscribed: false,
        }),
      },
    });
    await expect(service.create('org-1', dto)).rejects.toThrow(
      'Reconecte esta conta do Instagram'
    );
  });

  it.each([
    ['expired', { tokenExpiration: new Date(0) }],
    ['refresh-needed', { refreshNeeded: true }],
  ])('rejects a %s Instagram token state', async (_, state) => {
    const { service } = makeService({
      integration: {
        findFirst: jest.fn().mockResolvedValue({ ...integration, ...state }),
      },
    });
    await expect(service.create('org-1', dto)).rejects.toThrow('Reconecte');
  });

  it('paginates executions only after ownership validation', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service as any, 'findOwned').mockResolvedValue({ id: 'a' });
    prisma.instagramCommentAutomationExecution.count.mockResolvedValue(21);
    prisma.instagramCommentAutomationExecution.findMany.mockResolvedValue([]);
    await expect(
      service.executions('org-1', 'a', { page: 2, limit: 20 })
    ).resolves.toMatchObject({ total: 21, page: 2, pages: 2 });
    expect(
      prisma.instagramCommentAutomationExecution.findMany
    ).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });

  it('uses the organization relation to prevent IDOR', async () => {
    const { service, prisma } = makeService();
    prisma.instagramCommentAutomation.findFirst.mockResolvedValue(null);
    await expect(service.get('other-org', 'a')).rejects.toThrow(
      NotFoundException
    );
    expect(prisma.instagramCommentAutomation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'a',
          integration: { organizationId: 'other-org', deletedAt: null },
        },
      })
    );
  });
});
