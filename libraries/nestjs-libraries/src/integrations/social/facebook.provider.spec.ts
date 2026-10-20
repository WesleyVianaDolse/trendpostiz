jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

import 'reflect-metadata';
import { FacebookProvider } from './facebook.provider';
import { RefreshToken } from '../social.abstract';

const provider = new FacebookProvider();
const prefix = 'https://graph.facebook.com/v25.0';
const ok = (body: object) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const details = (postType: string, paths: string[]) =>
  [
    {
      id: 'post-1',
      message: 'Caption',
      settings: { post_type: postType },
      media: paths.map((path) => ({ path: `https://cdn.example/${path}` })),
    },
  ] as any;

describe('Facebook requests after v20 retirement', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses v25 for OAuth, token exchange, permissions and profile', async () => {
    expect((await provider.generateAuthUrl()).url).toContain(
      'https://www.facebook.com/v25.0/dialog/oauth?'
    );
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => ok({ access_token: 'short-token' }))
      .mockImplementationOnce(() => ok({ access_token: 'user-token' }))
      .mockImplementationOnce(() =>
        ok({
          data: provider.scopes.map((permission) => ({
            permission,
            status: 'granted',
          })),
        })
      )
      .mockImplementationOnce(() => ok({ id: 'user-1', name: 'User' }));
    await expect(
      provider.authenticate({ code: 'code', codeVerifier: '' })
    ).resolves.toMatchObject({ id: 'user-1', accessToken: 'user-token' });
    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
    ).toEqual([
      '/v25.0/oauth/access_token',
      '/v25.0/oauth/access_token',
      '/v25.0/me/permissions',
      '/v25.0/me',
    ]);
  });

  it('preserves discovery pagination, deduplication and Business Manager fallback', async () => {
    const page = { id: 'page-1', name: 'Page', access_token: 'page-token' };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation((input) => {
        const url = new URL(String(input));
        expect(url.origin).toBe('https://graph.facebook.com');
        expect(url.pathname).toMatch(/^\/v25\.0\//);
        if (url.pathname.endsWith('/me/accounts')) {
          expect(url.searchParams.get('limit')).toBe('100');
          return ok(
            url.searchParams.has('after')
              ? { data: [page] }
              : {
                  data: [page],
                  paging: { next: `${url}&after=cursor` },
                }
          );
        }
        if (url.pathname.endsWith('/me/businesses'))
          return ok({ data: [{ id: 'business-1' }] });
        if (url.pathname.endsWith('/owned_pages')) return ok({ data: [page] });
        if (url.pathname.endsWith('/client_pages'))
          return ok({ data: [{ id: 'page-2' }] });
        throw new Error(`Unexpected request: ${url}`);
      });
    await expect(provider.pages('token')).resolves.toEqual([
      page,
      { id: 'page-2' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('reconnects using the selected page token from paginated client_pages', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = new URL(String(input));
      expect(url.pathname).toMatch(/^\/v25\.0\//);
      if (url.pathname.endsWith('/me/accounts')) return ok({ data: [] });
      if (url.pathname.endsWith('/me/businesses'))
        return ok({ data: [{ id: 'business-1' }] });
      if (url.pathname.endsWith('/owned_pages')) return ok({ data: [] });
      if (url.pathname.endsWith('/client_pages'))
        return ok(
          url.searchParams.has('after')
            ? {
                data: [
                  { id: 'page-2', name: 'Page', access_token: 'page-token' },
                ],
              }
            : { data: [], paging: { next: `${url}&after=cursor` } }
        );
      throw new Error(`Unexpected request: ${url}`);
    });
    await expect(
      provider.reConnect('user-1', 'page-2', 'token')
    ).resolves.toMatchObject({
      id: 'page-2',
      accessToken: 'page-token',
    });
  });

  it.each([
    ['text', 'post', []],
    ['photos', 'post', ['one.jpg', 'two.jpg']],
    ['video', 'post', ['video.mp4']],
    ['photo stories', 'story', ['one.jpg', 'two.jpg']],
    ['video story', 'story', ['video.mp4']],
  ])(
    'publishes %s through v25 preserving payloads',
    async (_, postType, paths) => {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockImplementation((input, options) => {
          const url = new URL(String(input));
          if (url.origin === 'https://upload.example') {
            expect(options?.headers).toEqual({
              Authorization: 'OAuth token',
              file_url: 'https://cdn.example/video.mp4',
            });
            return ok({ success: true });
          }
          expect(String(url).startsWith(`${prefix}/`)).toBe(true);
          if (url.pathname.endsWith('/photos')) {
            expect(JSON.parse(String(options?.body))).toMatchObject({
              published: false,
            });
            return ok({ id: 'photo-1' });
          }
          if (url.pathname.endsWith('/feed')) {
            expect(JSON.parse(String(options?.body))).toMatchObject({
              message: 'Caption',
              published: true,
            });
            return ok({
              id: 'published-1',
              permalink_url: 'https://facebook.com/post/1',
            });
          }
          if (url.pathname.endsWith('/videos'))
            return ok({ id: 'published-1' });
          if (url.pathname.endsWith('/photo_stories'))
            return ok({ post_id: 'published-1' });
          if (url.pathname.endsWith('/video_stories'))
            return ok(
              url.searchParams.get('upload_phase') === 'start'
                ? {
                    video_id: 'video-1',
                    upload_url: 'https://upload.example/video',
                  }
                : { post_id: 'published-1' }
            );
          if (url.searchParams.get('fields') === 'status')
            return ok({ status: { video_status: 'ready' } });
          if (url.pathname.endsWith('/stories')) return ok({ data: [] });
          throw new Error(`Unexpected request: ${url}`);
        });
      await expect(
        provider.post('page-1', 'token', details(postType, paths as string[]))
      ).resolves.toEqual([
        expect.objectContaining({ postId: 'published-1', status: 'success' }),
      ]);
      expect(fetchMock).toHaveBeenCalled();
    }
  );

  it('keeps comment threading and attachments', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => ok({ id: 'comment-2' }));
    await provider.comment(
      'page-1',
      'post-1',
      'comment-1',
      'token',
      details('post', ['image.jpg']),
      {} as any
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `${prefix}/comment-1/comments?`
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      message: 'Caption',
      attachment_url: 'https://cdn.example/image.jpg',
    });
  });

  it('loads account and post insights on v25', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => ok({ data: [] }));
    await expect(provider.analytics('page-1', 'token', 7)).resolves.toEqual([]);
    await expect(
      provider.postAnalytics('integration-1', 'token', 'post-1', 7)
    ).resolves.toEqual([]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `${prefix}/page-1/insights?`
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `${prefix}/post-1/insights?`
    );
  });

  it('continues to report expired publication tokens', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            message: 'Error validating access token: Session has expired',
          },
        }),
        { status: 401 }
      )
    );
    await expect(
      provider.post('page-1', 'token', details('post', []))
    ).rejects.toBeInstanceOf(RefreshToken);
  });
});
