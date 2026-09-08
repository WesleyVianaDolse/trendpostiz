jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);

import { InstagramWebhookEventsService } from './instagram-webhook-events.service';

describe('InstagramWebhookEventsService', () => {
  const repository = {
    record: jest
      .fn()
      .mockImplementation((event) =>
        Promise.resolve({ id: `event-${event.externalCommentId || 'invalid'}` })
      ),
  };
  const integrationService = {
    resolveActiveInstagramWebhook: jest.fn(),
  };
  const service = new InstagramWebhookEventsService(
    repository as any,
    integrationService as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
    integrationService.resolveActiveInstagramWebhook.mockResolvedValue({
      status: 'found',
      integration: { id: 'integration-1', internalId: 'account-1' },
    });
  });

  it('interprets and records a comments payload', async () => {
    const result = await service.receive({
      object: 'instagram',
      entry: [
        {
          id: 'account-1',
          time: 123,
          changes: [
            {
              field: 'comments',
              value: {
                id: 'comment-1',
                from: { id: 'author-1', username: 'visitor' },
                text: 'hello',
                media: { id: 'media-1', media_product_type: 'FEED' },
              },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      events: 1,
      eventIds: ['event-comment-1'],
    });
    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        externalCommentId: 'comment-1',
        integrationId: 'integration-1',
        instagramAccountId: 'account-1',
        mediaId: 'media-1',
        authorId: 'author-1',
        authorUsername: 'visitor',
        commentText: 'hello',
        status: 'RECEIVED',
      })
    );
  });

  it('ignores an unknown payload without throwing', async () => {
    await expect(service.receive({ object: 'unknown' })).resolves.toEqual({
      events: 0,
      eventIds: [],
    });
    expect(repository.record).not.toHaveBeenCalled();
  });

  it('handles multiple entries and changes', async () => {
    const result = await service.receive({
      object: 'instagram',
      entry: [
        {
          id: 'account-1',
          changes: [
            { field: 'comments', value: { id: 'comment-1' } },
            { field: 'other', value: { id: 'ignored' } },
            { field: 'comments', value: { id: 'comment-2' } },
          ],
        },
        {
          id: 'account-2',
          changes: [{ field: 'comments', value: { id: 'comment-3' } }],
        },
      ],
    });

    expect(result).toEqual({
      events: 3,
      eventIds: ['event-comment-1', 'event-comment-2', 'event-comment-3'],
    });
    expect(repository.record).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['not_found', 'UNMATCHED'],
    ['ambiguous', 'AMBIGUOUS'],
  ])('stores %s integration resolution safely', async (resolution, status) => {
    integrationService.resolveActiveInstagramWebhook.mockResolvedValue({
      status: resolution,
    });

    await service.receive({
      object: 'instagram',
      entry: [
        {
          id: 'account-1',
          changes: [{ field: 'comments', value: { id: 'comment-1' } }],
        },
      ],
    });

    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({ status, integrationId: undefined })
    );
  });

  it('persists but does not dispatch an unmatched event', async () => {
    integrationService.resolveActiveInstagramWebhook.mockResolvedValue({
      status: 'not_found',
    });

    await expect(
      service.receive({
        object: 'instagram',
        entry: [
          {
            id: 'account-1',
            changes: [{ field: 'comments', value: { id: 'comment-1' } }],
          },
        ],
      })
    ).resolves.toEqual({ events: 1, eventIds: [] });
    expect(repository.record).toHaveBeenCalled();
  });

  it('routes a Facebook/BM Page payload and normalizes the Instagram account ID', async () => {
    integrationService.resolveActiveInstagramWebhook.mockResolvedValue({
      status: 'found',
      integration: { id: 'facebook-integration', internalId: 'ig-business-1' },
    });

    await service.receive(
      {
        object: 'instagram',
        entry: [
          {
            id: 'facebook-page-1',
            changes: [
              {
                field: 'comments',
                value: { id: 'comment-1', media: { id: 'media-1' } },
              },
            ],
          },
        ],
      },
      ['facebook']
    );

    expect(
      integrationService.resolveActiveInstagramWebhook
    ).toHaveBeenCalledWith('facebook-page-1', ['facebook']);
    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: 'facebook-integration',
        instagramAccountId: 'ig-business-1',
        status: 'RECEIVED',
      })
    );
  });
});
