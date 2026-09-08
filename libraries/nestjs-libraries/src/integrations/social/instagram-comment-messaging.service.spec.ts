import { BadRequestException } from '@nestjs/common';
import {
  InstagramCommentMessagingService,
  InstagramFacebookCommentMessagingStrategy,
} from './instagram-comment-messaging.service';
import { InstagramMetaApiError } from './instagram-standalone-messaging.service';

const facebookIntegration = {
  providerIdentifier: 'instagram',
  internalId: 'ig-business-1',
  facebookPageId: 'page-1',
  token: 'page-token',
} as any;

describe('InstagramFacebookCommentMessagingStrategy', () => {
  const strategy = new InstagramFacebookCommentMessagingStrategy();

  afterEach(() => jest.restoreAllMocks());

  it('publishes a public reply on the Facebook host with the Page token', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'reply-1' }), { status: 200 })
      );

    await expect(
      strategy.replyToComment(facebookIntegration, 'comment-1', 'Public')
    ).resolves.toBe('reply-1');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://graph.facebook.com/v25.0/comment-1/replies'
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer page-token',
        }),
        body: JSON.stringify({ message: 'Public' }),
      })
    );
  });

  it('sends a private reply from the IG Business ID instead of /me', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'message-1' }), {
        status: 200,
      })
    );

    await expect(
      strategy.sendPrivateReplyFromComment(
        facebookIntegration,
        'comment-1',
        'Private'
      )
    ).resolves.toBe('message-1');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://graph.facebook.com/v25.0/ig-business-1/messages'
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      recipient: { comment_id: 'comment-1' },
      message: { text: 'Private' },
    });
  });

  it('classifies an explicit rate limit as transient', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 4, message: 'Slow down' } }),
        {
          status: 429,
        }
      )
    );
    await expect(
      strategy.replyToComment(facebookIntegration, 'comment-1', 'Public')
    ).rejects.toMatchObject({ transient: true });
  });

  it('treats already-replied errors as permanent and audit-safe', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 1,
            message: 'Already replied with page-token access_token=page-token',
          },
        }),
        { status: 400 }
      )
    );
    try {
      await strategy.sendPrivateReplyFromComment(
        facebookIntegration,
        'comment-1',
        'Private'
      );
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(InstagramMetaApiError);
      expect(error).toMatchObject({ transient: false });
      expect((error as Error).message).not.toContain('page-token');
    }
  });

  it('does not blindly retry a private reply with an unknown network outcome', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('socket closed'));
    await expect(
      strategy.sendPrivateReplyFromComment(
        facebookIntegration,
        'comment-1',
        'Private'
      )
    ).rejects.toMatchObject({
      transient: false,
      message: expect.stringContaining('automatic retry suppressed'),
    });
  });
});

describe('InstagramCommentMessagingService routing', () => {
  const standalone = {
    replyToComment: jest.fn().mockResolvedValue('standalone-public'),
    sendPrivateReplyFromComment: jest
      .fn()
      .mockResolvedValue('standalone-private'),
    sanitizeError: jest.fn((message) => message),
  };
  const facebook = {
    replyToComment: jest.fn().mockResolvedValue('facebook-public'),
    sendPrivateReplyFromComment: jest
      .fn()
      .mockResolvedValue('facebook-private'),
  };
  const service = new InstagramCommentMessagingService(
    standalone as any,
    facebook as any
  );

  beforeEach(() => jest.clearAllMocks());

  it('never sends a Standalone token to the Facebook strategy', async () => {
    const integration = {
      providerIdentifier: 'instagram-standalone',
      token: 'standalone-token',
    } as any;
    await service.replyToComment(integration, 'comment-1', 'Reply');
    expect(standalone.replyToComment).toHaveBeenCalledWith(
      'comment-1',
      'Reply',
      'standalone-token'
    );
    expect(facebook.replyToComment).not.toHaveBeenCalled();
  });

  it('passes the complete Facebook integration only to its strategy', async () => {
    await service.sendPrivateReplyFromComment(
      facebookIntegration,
      'comment-1',
      'Private'
    );
    expect(facebook.sendPrivateReplyFromComment).toHaveBeenCalledWith(
      facebookIntegration,
      'comment-1',
      'Private'
    );
    expect(standalone.sendPrivateReplyFromComment).not.toHaveBeenCalled();
  });

  it('rejects providers outside the explicit allowlist', async () => {
    expect(() =>
      service.replyToComment(
        { providerIdentifier: 'facebook', token: 'wrong' } as any,
        'comment-1',
        'Reply'
      )
    ).toThrow(BadRequestException);
  });
});
