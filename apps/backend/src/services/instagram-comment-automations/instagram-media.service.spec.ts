import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { InstagramMediaService } from './instagram-media.service';

const integration = {
  internalId: 'ig-123',
  token: 'secret-access-token',
  providerIdentifier: 'instagram-standalone',
} as any;

describe('InstagramMediaService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fetches media through Graph API v25 and returns a sanitized DTO', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'media-1',
            caption: 'Legenda',
            media_type: 'IMAGE',
            media_url: 'https://cdn/image.jpg',
            permalink: 'https://instagram.com/p/1',
            timestamp: '2026-01-01T00:00:00Z',
          },
        ],
        paging: { next: 'opaque', cursors: { after: 'cursor-2' } },
      }),
    } as Response);

    const result = await new InstagramMediaService().list(
      integration,
      'cursor-1'
    );
    const requested = new URL(String(fetchMock.mock.calls[0][0]));

    expect(requested.origin + requested.pathname).toBe(
      'https://graph.instagram.com/v25.0/ig-123/media'
    );
    expect(requested.searchParams.get('after')).toBe('cursor-1');
    expect(requested.searchParams.get('access_token')).toBeNull();
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret-access-token' },
      })
    );
    expect(result.nextCursor).toBe('cursor-2');
    expect(result.items[0]).toEqual({
      id: 'media-1',
      caption: 'Legenda',
      mediaType: 'IMAGE',
      thumbnailUrl: 'https://cdn/image.jpg',
      permalink: 'https://instagram.com/p/1',
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
  });

  it('uses video thumbnail when available', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '1',
        media_type: 'VIDEO',
        thumbnail_url: 'thumb',
      }),
    } as Response);
    await expect(
      new InstagramMediaService().get(integration, '1')
    ).resolves.toMatchObject({ thumbnailUrl: 'thumb' });
  });

  it('lists Facebook/BM media on the Facebook host with cursor pagination', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        paging: { next: 'opaque', cursors: { after: 'next-facebook' } },
      }),
    } as Response);

    const result = await new InstagramMediaService().list(
      { ...integration, providerIdentifier: 'instagram' } as any,
      'cursor-facebook'
    );
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.origin + requested.pathname).toBe(
      'https://graph.facebook.com/v25.0/ig-123/media'
    );
    expect(requested.searchParams.get('after')).toBe('cursor-facebook');
    expect(result.nextCursor).toBe('next-facebook');
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret-access-token' },
      })
    );
  });

  it('maps an invalid media response to a safe bad request', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'token secret-access-token' } }),
    } as Response);
    await expect(
      new InstagramMediaService().get(integration, 'bad')
    ).rejects.toThrow(BadRequestException);
  });

  it('maps list failures without exposing the Meta response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'token secret-access-token' } }),
    } as Response);
    await expect(new InstagramMediaService().list(integration)).rejects.toThrow(
      BadGatewayException
    );
  });
});
