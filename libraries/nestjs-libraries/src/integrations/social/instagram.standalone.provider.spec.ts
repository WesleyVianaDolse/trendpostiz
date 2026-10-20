jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

import 'reflect-metadata';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';
import { RefreshToken } from '../social.abstract';

const provider = new InstagramStandaloneProvider();
const ok = (body: object) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('Instagram Standalone publishing after v20 retirement', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['image', 'post', ['image.jpg']],
    ['reel', 'post', ['video.mp4']],
    ['carousel', 'post', ['one.jpg', 'two.jpg']],
    ['photo stories', 'story', ['one.jpg', 'two.jpg']],
    ['video story', 'story', ['video.mp4']],
  ])('publishes %s through v25 object requests', async (_, postType, paths) => {
    let item = 0;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation((input) => {
        const url = new URL(String(input));
        expect(url.origin).toBe('https://graph.instagram.com');
        expect(url.pathname).toMatch(/^\/v25\.0\/[^/]+/);
        if (url.searchParams.get('fields') === 'status_code')
          return ok({ status_code: 'FINISHED' });
        if (url.pathname.endsWith('/media_publish'))
          return ok({ id: 'published-1' });
        if (url.searchParams.get('fields') === 'permalink')
          return ok({ permalink: 'https://instagram.com/p/1' });
        if (url.pathname.endsWith('/media'))
          return ok({ id: `item-${++item}` });
        throw new Error(`Unexpected request: ${url}`);
      });

    await expect(
      provider.post(
        'ig-1',
        'token',
        [
          {
            id: 'post-1',
            message: 'Caption',
            settings: { post_type: postType },
            media: (paths as string[]).map((path) => ({
              path: `https://cdn.example/${path}`,
            })),
          },
        ] as any,
        {} as any
      )
    ).resolves.toEqual([
      expect.objectContaining({ postId: 'published-1', status: 'success' }),
    ]);
    const publishes = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/media_publish?')
    );
    expect(publishes).toHaveLength(postType === 'story' ? paths.length : 1);
  });

  it('posts comments and loads their parent permalink on v25', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => ok({ id: 'comment-1' }))
      .mockImplementationOnce(() =>
        ok({ permalink: 'https://instagram.com/p/1' })
      );
    await expect(
      provider.comment(
        'ig-1',
        'media-1',
        undefined,
        'token',
        [{ id: 'post-1', message: 'Reply', settings: {}, media: [] }] as any,
        {} as any
      )
    ).resolves.toEqual([expect.objectContaining({ postId: 'comment-1' })]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'https://graph.instagram.com/v25.0/media-1/comments?'
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      'https://graph.instagram.com/v25.0/media-1?fields=permalink'
    );
  });

  it('continues to report expired publication tokens', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 190, message: 'Session has been invalidated' },
        }),
        { status: 401 }
      )
    );
    await expect(
      provider.post(
        'ig-1',
        'token',
        [
          {
            id: 'post-1',
            message: 'Caption',
            settings: { post_type: 'post' },
            media: [{ path: 'https://cdn.example/image.jpg' }],
          },
        ] as any,
        {} as any
      )
    ).rejects.toBeInstanceOf(RefreshToken);
  });
});
