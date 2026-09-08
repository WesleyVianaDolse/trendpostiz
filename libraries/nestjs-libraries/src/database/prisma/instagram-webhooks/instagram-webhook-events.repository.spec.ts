import { InstagramWebhookEventsRepository } from './instagram-webhook-events.repository';

describe('InstagramWebhookEventsRepository', () => {
  const create = jest.fn();
  const upsert = jest.fn();
  const updateMany = jest.fn();
  const repository = new InstagramWebhookEventsRepository({
    model: { instagramWebhookEvent: { create, upsert, updateMany } },
  } as any);

  beforeEach(() => jest.clearAllMocks());

  it('upserts a comment by external ID and refreshes its integration link', async () => {
    upsert.mockResolvedValue({ id: 'event-1', status: 'RECEIVED' });
    updateMany.mockResolvedValue({ count: 1 });

    await repository.record({
      externalCommentId: 'comment-1',
      integrationId: 'integration-1',
      instagramAccountId: 'account-1',
      mediaId: 'media-1',
      authorId: 'author-1',
      authorUsername: 'visitor',
      commentText: 'hello',
      payload: { field: 'comments' },
      status: 'RECEIVED',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalCommentId: 'comment-1' },
        create: expect.objectContaining({
          integrationId: 'integration-1',
          status: 'RECEIVED',
        }),
        update: expect.not.objectContaining({ status: expect.anything() }),
      })
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
        status: {
          in: ['RECEIVED', 'UNMATCHED', 'AMBIGUOUS', 'INVALID'],
        },
      },
      data: { integrationId: 'integration-1', status: 'RECEIVED' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates invalid events that do not have a comment ID', async () => {
    create.mockResolvedValue({ id: 'event-2' });

    await repository.record({
      instagramAccountId: 'unknown',
      payload: { field: 'comments' },
      status: 'INVALID',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalCommentId: undefined,
        status: 'INVALID',
      }),
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not let redelivery overwrite an automation lifecycle status', async () => {
    upsert.mockResolvedValue({ id: 'event-1', status: 'REPLIED' });
    updateMany.mockResolvedValue({ count: 0 });

    await repository.record({
      externalCommentId: 'comment-1',
      integrationId: 'integration-1',
      instagramAccountId: 'account-1',
      payload: { field: 'comments' },
      status: 'RECEIVED',
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: ['RECEIVED', 'UNMATCHED', 'AMBIGUOUS', 'INVALID'],
          },
        }),
      })
    );
  });

  it('uses one canonical event when the same comment arrives through both providers', async () => {
    upsert.mockResolvedValue({ id: 'event-1', status: 'RECEIVED' });
    updateMany.mockResolvedValue({ count: 1 });
    const base = {
      externalCommentId: 'same-comment',
      instagramAccountId: 'ig-1',
      payload: { field: 'comments' },
      status: 'RECEIVED' as const,
    };

    await repository.record({ ...base, integrationId: 'standalone' });
    await repository.record({ ...base, integrationId: 'facebook' });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(
      upsert.mock.calls.every(
        ([call]) => call.where.externalCommentId === 'same-comment'
      )
    ).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});
