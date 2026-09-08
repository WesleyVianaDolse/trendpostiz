import {
  INSTAGRAM_GRAPH_API_VERSION,
  InstagramMetaApiError,
  InstagramStandaloneMessagingService,
} from './instagram-standalone-messaging.service';

describe('InstagramStandaloneMessagingService', () => {
  const service = new InstagramStandaloneMessagingService();

  afterEach(() => jest.restoreAllMocks());

  it('replies publicly to the source comment', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'reply-1' }), { status: 200 })
      );

    await expect(
      service.replyToComment('comment-1', 'Public reply', 'secret-token')
    ).resolves.toBe('reply-1');

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}/comment-1/replies`
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ message: 'Public reply' }),
      })
    );
  });

  it('sends a private reply from the source comment on v25.0', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'message-1' }), {
        status: 200,
      })
    );

    await expect(
      service.sendPrivateReplyFromComment(
        'comment-1',
        'Private reply',
        'secret-token'
      )
    ).resolves.toBe('message-1');

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://graph.instagram.com/v25.0/me/messages'
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      recipient: { comment_id: 'comment-1' },
      message: { text: 'Private reply' },
    });
  });

  it.each([429, 500])(
    'classifies HTTP %s as transient so Temporal retries it',
    async (status) => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'try again' } }), {
          status,
        })
      );

      const promise = service.replyToComment(
        'comment-1',
        'hello',
        'secret-token'
      );
      await expect(promise).rejects.toMatchObject({ transient: true });
    }
  );

  it('classifies a non-transient 400 as permanent and sanitizes tokens', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            message: 'Invalid secret-token access_token=secret-token',
          },
        }),
        { status: 400 }
      )
    );

    try {
      await service.replyToComment('comment-1', 'hello', 'secret-token');
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InstagramMetaApiError);
      expect(error).toMatchObject({ transient: false });
      expect((error as Error).message).not.toContain('secret-token');
    }
  });

  it('does not blindly retry a private reply with an unknown network outcome', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('socket closed'));
    await expect(
      service.sendPrivateReplyFromComment(
        'comment-1',
        'Private reply',
        'secret-token'
      )
    ).rejects.toMatchObject({
      transient: false,
      message: expect.stringContaining('automatic retry suppressed'),
    });
  });
});
