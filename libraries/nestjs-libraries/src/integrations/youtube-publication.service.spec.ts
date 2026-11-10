jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
    youtube: jest.fn(),
  },
}));
jest.mock('axios', () => jest.fn());
jest.mock('./integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('./refresh.integration.service', () => ({
  RefreshIntegrationService: class {},
}));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import 'reflect-metadata';
import { google } from 'googleapis';
import axios from 'axios';
import { YoutubePublicationService } from './youtube-publication.service';
import { YoutubeProvider } from './social/youtube.provider';

const integration = {
  id: 'integration',
  internalId: 'channel',
  organizationId: 'org',
  providerIdentifier: 'youtube',
  token: 'token',
  disabled: false,
  refreshNeeded: false,
} as any;
const details = [
  {
    id: 'post',
    message: 'Description',
    media: [{ path: 'https://cdn.example/video.mp4' }],
    settings: {
      title: 'Title',
      type: 'private',
      thumbnailLayout: 'short',
      thumbnail: { id: 'cover', path: 'https://cdn.example/cover.png' },
    },
  },
] as any;
const apiError = (status: number, reason = '', retryAfter?: string) => ({
  response: {
    status,
    data: { error: { errors: [{ reason }] } },
    headers: { 'retry-after': retryAfter },
  },
});

describe('durable YouTube thumbnail delivery', () => {
  let row: any;
  let prisma: any;
  let service: YoutubePublicationService;
  let insert: jest.Mock;
  let list: jest.Mock;
  let set: jest.Mock;
  let provider: YoutubeProvider;
  let start: jest.Mock;
  let refresh: jest.Mock;

  const matches = (where: any) =>
    Object.entries(where).every(([key, value]: [string, any]) => {
      if (key === 'integration')
        return value.providerIdentifier === row.integration.providerIdentifier;
      if (value && typeof value === 'object' && value.in)
        return value.in.includes(row[key]);
      return row[key] === value;
    });
  const expireTimer = () => {
    row.youtubeThumbnailNextAt = new Date(0);
  };
  const publish = () => service.publish(integration, details, 'post_post');
  const attempt = () => service.attempt('org', 'post', 'video-1');

  beforeEach(() => {
    jest.clearAllMocks();
    row = {
      id: 'post',
      organizationId: 'org',
      deletedAt: null,
      integration,
      organization: { suspendedAt: null },
      youtubeUploadKey: null,
      youtubeUploadState: null,
      youtubeVideoId: null,
      youtubeThumbnailPath: null,
      youtubeThumbnailStatus: null,
      youtubeThumbnailAttempts: 0,
      youtubeThumbnailError: null,
      youtubeThumbnailNextAt: null,
      state: 'QUEUE',
      settings: JSON.stringify(details[0].settings),
    };
    prisma = {
      post: {
        findFirst: jest.fn(async ({ where }) =>
          matches(where) ? { ...row } : null
        ),
        update: jest.fn(async ({ where, data }) => {
          if (!matches(where)) throw new Error('Record changed');
          Object.assign(row, data);
          return { ...row };
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          if (!matches(where)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    };
    insert = jest.fn().mockResolvedValue({ data: { id: 'video-1' } });
    list = jest.fn().mockResolvedValue({
      data: {
        items: [{ processingDetails: { processingStatus: 'succeeded' } }],
      },
    });
    set = jest.fn().mockResolvedValue({ data: { items: [] } });
    (google.youtube as jest.Mock).mockReturnValue({
      videos: { insert, list },
      thumbnails: { set },
    });
    (axios as unknown as jest.Mock).mockImplementation(async (request) => ({
      data:
        request.responseType === 'stream'
          ? 'video-stream'
          : Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    }));
    start = jest.fn().mockResolvedValue({});
    refresh = jest.fn().mockResolvedValue({ accessToken: 'fresh-token' });
    provider = new YoutubeProvider();
    service = new YoutubePublicationService(
      prisma,
      { getSocialIntegration: () => provider } as any,
      { refresh } as any,
      {
        client: {
          getRawClient: () => ({ workflow: { signalWithStart: start } }),
        },
      } as any
    );
  });

  it('checkpoints the video before thumbnail work and applies a processed Short only once', async () => {
    await publish();
    expect(row).toMatchObject({
      youtubeVideoId: 'video-1',
      releaseId: 'video-1',
      youtubeThumbnailStatus: 'pending',
    });
    expect(set).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(
      'youtubeThumbnailWorkflow',
      expect.objectContaining({ taskQueue: 'youtube' })
    );
    expect(await attempt()).toMatchObject({ done: true });
    expect(list).toHaveBeenCalledWith(
      { part: ['processingDetails'], id: ['video-1'] },
      { timeout: 20000, retry: false }
    );
    expect(row.youtubeThumbnailStatus).toBe('applied');
    await attempt();
    await publish();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0]).toMatchObject({
      videoId: 'video-1',
      media: { mimeType: 'image/png' },
    });
    expect(insert.mock.calls[0][0].requestBody.status).toEqual({
      privacyStatus: 'private',
    });
    expect(row.settings).toBe(JSON.stringify(details[0].settings));
  });

  it.each(['processing', undefined])(
    'leaves %s processing pending without setting the thumbnail',
    async (status) => {
      await publish();
      list.mockResolvedValue({
        data: { items: [{ processingDetails: { processingStatus: status } }] },
      });
      expect(await attempt()).toEqual({ done: false, delay: 30000 });
      expect(row.youtubeThumbnailStatus).toBe('pending');
      expect(set).not.toHaveBeenCalled();
      expect(insert).toHaveBeenCalledTimes(1);
    }
  );

  it.each([500, 503, 429])(
    'retries thumbnail HTTP %s without uploading the video again',
    async (status) => {
      await publish();
      set.mockRejectedValueOnce(apiError(status));
      expect(await attempt()).toMatchObject({ done: false });
      expect(row.youtubeThumbnailStatus).toBe('retrying');
      await publish();
      expireTimer();
      await attempt();
      expect(row.youtubeThumbnailStatus).toBe('applied');
      expect(insert).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(2);
    }
  );

  it.each(['quotaExceeded', 'rateLimitExceeded'])(
    'handles retryable 403 %s separately from permission denial',
    async (reason) => {
      await publish();
      set.mockRejectedValueOnce(apiError(403, reason));
      expect(await attempt()).toMatchObject({
        done: reason === 'quotaExceeded',
      });
      expect(row.youtubeThumbnailStatus).toBe(
        reason === 'quotaExceeded' ? 'waiting' : 'retrying'
      );
    }
  );

  it('honors Retry-After without another early API call', async () => {
    await publish();
    set.mockRejectedValueOnce(apiError(429, 'uploadRateLimitExceeded', '3600'));
    expect(await attempt()).toEqual({ done: false, delay: 3600000 });
    await attempt();
    expect(set).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404])(
    'records permanent thumbnail HTTP %s without failing or reuploading the video',
    async (status) => {
      await publish();
      row.state = 'PUBLISHED';
      set.mockRejectedValueOnce(apiError(status, 'forbidden'));
      expect(await attempt()).toMatchObject({ done: true });
      expect(row).toMatchObject({
        state: 'PUBLISHED',
        youtubeThumbnailStatus: 'failed',
        youtubeVideoId: 'video-1',
      });
      expect(row.youtubeThumbnailError).toBeTruthy();
      await attempt();
      expect(set).toHaveBeenCalledTimes(1);
      await service.retry('org', 'post');
      await attempt();
      expect(row.youtubeThumbnailStatus).toBe('applied');
      expect(insert).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['failed', 'terminated'])(
    'reports %s video processing without calling thumbnails.set',
    async (processingStatus) => {
      await publish();
      list.mockResolvedValue({
        data: { items: [{ processingDetails: { processingStatus } }] },
      });
      await attempt();
      expect(row.youtubeThumbnailStatus).toBe('failed');
      expect(set).not.toHaveBeenCalled();
    }
  );

  it('refreshes the authorized account token after a processing 401', async () => {
    await publish();
    list.mockRejectedValueOnce(apiError(401));
    await attempt();
    expect(refresh).toHaveBeenCalledWith(integration);
    expect(row.youtubeThumbnailStatus).toBe('applied');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('refreshes the token after a thumbnail 401 without another videos.insert', async () => {
    await publish();
    set.mockRejectedValueOnce(apiError(401));
    await attempt();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(row.youtubeThumbnailStatus).toBe('applied');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('records an expired authorization when token refresh fails', async () => {
    await publish();
    list.mockRejectedValueOnce(apiError(401));
    refresh.mockResolvedValue(false);
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('failed');
    expect(row.youtubeThumbnailError).toContain('Reconecte');
    expect(set).not.toHaveBeenCalled();
  });

  it('stops polling at the persisted attempt budget and allows an isolated manual retry', async () => {
    await publish();
    row.youtubeThumbnailAttempts = 12;
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('waiting');
    expect(list).not.toHaveBeenCalled();
    await service.retry('org', 'post');
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('applied');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('reuses the checkpoint when scheduling the thumbnail workflow initially fails', async () => {
    start.mockRejectedValueOnce(new Error('Temporal unavailable'));
    expect((await publish())[0]).toMatchObject({
      status: 'success',
      postId: 'video-1',
    });
    expect(row.youtubeThumbnailStatus).toBe('waiting');
    await service.retry('org', 'post');
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('applied');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(row.youtubeVideoId).toBe('video-1');
  });

  it('does not repeat videos.insert after an uncertain response', async () => {
    insert.mockRejectedValueOnce(new Error('socket closed'));
    await expect(publish()).rejects.toThrow('socket closed');
    await expect(publish()).rejects.toMatchObject({
      type: 'youtube_upload_uncertain',
      nonRetryable: true,
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('does not reupload when persisting the returned video ID fails', async () => {
    prisma.post.update.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(publish()).rejects.toThrow('DB unavailable');
    await expect(publish()).rejects.toMatchObject({
      type: 'youtube_upload_uncertain',
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('does not send the thumbnail again after a worker loses the apply result', async () => {
    await publish();
    row.youtubeThumbnailStatus = 'applying';
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('uncertain');
    expect(set).not.toHaveBeenCalled();
  });

  it('preserves normal videos and falls back to the existing media thumbnail', async () => {
    await service.publish(
      integration,
      [
        {
          ...details[0],
          settings: { title: 'Normal video', type: 'unlisted' },
          media: [
            {
              path: 'https://cdn.example/video.mp4',
              thumbnail: 'https://cdn.example/legacy.jpg',
            },
          ],
        },
      ],
      'post_post'
    );
    expect(row.youtubeThumbnailPath).toBe('https://cdn.example/legacy.jpg');
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('applied');
    expect(insert.mock.calls[0][0].requestBody.status).toEqual({
      privacyStatus: 'unlisted',
    });
  });

  it('does no processing or thumbnail calls without a cover', async () => {
    await service.publish(
      integration,
      [{ ...details[0], settings: { title: 'No cover', type: 'public' } }],
      'post_post'
    );
    expect(start).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('allows an intentional repeat with a new generation and ignores old thumbnail jobs', async () => {
    await publish();
    insert.mockResolvedValueOnce({ data: { id: 'video-2' } });
    await service.publish(integration, details, 'post_post_repeat_1');
    expect(row.youtubeVideoId).toBe('video-2');
    await attempt();
    expect(set).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('scopes status and manual retries to the organization and provider', async () => {
    await publish();
    await expect(service.status('other-org', 'post')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.retry('other-org', 'post')).rejects.toMatchObject({
      status: 404,
    });
    row.integration = { ...integration, providerIdentifier: 'facebook' };
    await expect(service.status('org', 'post')).rejects.toMatchObject({
      status: 404,
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('prevents concurrent activities from uploading the same publication twice', async () => {
    const results = await Promise.allSettled([publish(), publish()]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    expect(insert).toHaveBeenCalledTimes(1);
    await publish();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('can safely retry an upload after a definitive 401 rejection', async () => {
    insert.mockRejectedValueOnce(apiError(401));
    await expect(publish()).rejects.toMatchObject({ type: 'refresh_token' });
    expect(row.youtubeUploadState).toBe('ready');
    await publish();
    expect(row.youtubeVideoId).toBe('video-1');
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('validates the image bytes on the server before calling thumbnails.set', async () => {
    await publish();
    (axios as unknown as jest.Mock).mockResolvedValueOnce({
      data: Buffer.from('GIF89a invalid image'),
    });
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('failed');
    expect(set).not.toHaveBeenCalled();
  });

  it('treats an oversized cover as permanent without consuming set quota', async () => {
    await publish();
    (axios as unknown as jest.Mock).mockRejectedValueOnce(
      new Error('maxContentLength size exceeded')
    );
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('failed');
    expect(set).not.toHaveBeenCalled();
  });

  it('respects organization suspension for thumbnail jobs and retries', async () => {
    await publish();
    row.organization.suspendedAt = new Date();
    await attempt();
    expect(row.youtubeThumbnailStatus).toBe('waiting');
    await expect(service.retry('org', 'post')).rejects.toMatchObject({
      status: 400,
    });
    expect(set).not.toHaveBeenCalled();
  });
});
