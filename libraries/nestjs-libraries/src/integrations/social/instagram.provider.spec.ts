jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

import 'reflect-metadata';
import {
  INSTAGRAM_FACEBOOK_GRAPH_API_VERSION,
  InstagramProvider,
} from './instagram.provider';

const provider = new InstagramProvider();
const versionPrefix = `https://graph.facebook.com/${INSTAGRAM_FACEBOOK_GRAPH_API_VERSION}`;

const ok = (body: object) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

const postDetails = (paths: string[]) =>
  [
    {
      id: 'post-1',
      message: 'Caption',
      settings: { post_type: 'post' },
      media: paths.map((path) => ({ path })),
    },
  ] as any;

describe('InstagramProvider Graph API version', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the supported version in the Facebook OAuth dialog', async () => {
    const auth = await provider.generateAuthUrl();
    expect(auth.url).toContain(
      `https://www.facebook.com/${INSTAGRAM_FACEBOOK_GRAPH_API_VERSION}/dialog/oauth`
    );
    const scope = new URL(auth.url).searchParams.get('scope') || '';
    expect(scope.split(',')).toContain('pages_manage_metadata');
    expect(scope.split(',')).not.toContain('instagram_manage_messages');
  });

  it('uses the supported Facebook Graph version throughout authentication', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => ok({ access_token: 'short-token' }))
      .mockImplementationOnce(() =>
        ok({ access_token: 'user-token', expires_in: 3600 })
      )
      .mockImplementationOnce(() =>
        ok({
          data: provider.scopes.map((permission) => ({
            permission,
            status: 'granted',
          })),
        })
      )
      .mockImplementationOnce(() =>
        ok({ id: 'facebook-user-1', name: 'User', picture: { data: {} } })
      );

    await expect(
      provider.authenticate({ code: 'code', codeVerifier: '', refresh: '' })
    ).resolves.toMatchObject({
      id: 'facebook-user-1',
      accessToken: 'user-token',
    });

    for (const [input] of fetchMock.mock.calls) {
      expect(String(input).startsWith(versionPrefix)).toBe(true);
    }
  });

  it('uses the supported Facebook Graph version while discovering Pages', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation((input) => {
        const url = String(input);
        if (url.includes('/me/accounts')) {
          return ok({
            data: [
              {
                id: 'page-1',
                instagram_business_account: { id: 'ig-1' },
              },
            ],
          });
        }
        if (url.includes('/me/businesses')) return ok({ data: [] });
        if (url.includes('/ig-1')) {
          return ok({ name: 'Instagram', profile_picture_url: 'picture' });
        }
        throw new Error(`Unexpected request: ${url}`);
      });

    await expect(provider.pages('user-token')).resolves.toEqual([
      expect.objectContaining({ id: 'ig-1', pageId: 'page-1' }),
    ]);
    for (const [input] of fetchMock.mock.calls) {
      expect(String(input).startsWith(versionPrefix)).toBe(true);
    }
  });

  it.each([
    ['IMAGE', ['https://cdn.example/image.jpg']],
    ['VIDEO/REELS', ['https://cdn.example/video.mp4']],
    [
      'CAROUSEL',
      ['https://cdn.example/one.jpg', 'https://cdn.example/two.jpg'],
    ],
  ])(
    'publishes %s entirely through the supported Facebook Graph version',
    async (_, paths) => {
      let item = 0;
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockImplementation((input) => {
          const url = String(input);
          if (url.includes('fields=status_code'))
            return ok({ status_code: 'FINISHED' });
          if (url.includes('/media_publish?')) return ok({ id: 'published-1' });
          if (url.includes('fields=permalink'))
            return ok({ permalink: 'https://ig/p/1' });
          if (url.includes('media_type=CAROUSEL'))
            return ok({ id: 'carousel-1' });
          if (url.includes('/media?')) return ok({ id: `item-${++item}` });
          throw new Error(`Unexpected request: ${url}`);
        });

      await expect(
        provider.post(
          'ig-1',
          'page-token',
          postDetails(paths as string[]),
          {} as any
        )
      ).resolves.toEqual([
        expect.objectContaining({ postId: 'published-1', status: 'success' }),
      ]);

      for (const [input] of fetchMock.mock.calls) {
        expect(String(input).startsWith(versionPrefix)).toBe(true);
        expect(String(input)).not.toContain('/v20.0/');
        expect(String(input)).not.toContain('/v21.0/');
      }
    }
  );

  it('publishes the first comment through the supported Facebook Graph version', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => ok({ id: 'comment-1' }))
      .mockImplementationOnce(() => ok({ permalink: 'https://ig/p/1' }));

    await provider.comment(
      'ig-1',
      'media-1',
      undefined,
      'page-token',
      postDetails([]),
      {} as any
    );

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `${versionPrefix}/media-1/comments`
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `${versionPrefix}/media-1?fields=permalink`
    );
  });

  it('loads account analytics through the supported Facebook Graph version', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => ok({ data: [] }))
      .mockImplementationOnce(() => ok({ data: [] }));

    await expect(provider.analytics('ig-1', 'page-token', 7)).resolves.toEqual(
      []
    );
    for (const [input] of fetchMock.mock.calls) {
      expect(String(input).startsWith(`${versionPrefix}/ig-1/insights`)).toBe(
        true
      );
    }
  });

  it('returns the selected Facebook Page ID with the operational page token', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() =>
        ok({ access_token: 'page-token', name: 'Facebook Page' })
      )
      .mockImplementationOnce(() =>
        ok({ id: 'ig-1', name: 'Instagram', username: 'instagram' })
      );

    await expect(
      provider.fetchPageInformation('user-token', {
        id: 'ig-1',
        pageId: 'page-1',
      })
    ).resolves.toMatchObject({
      id: 'ig-1',
      access_token: 'page-token',
      facebookPageId: 'page-1',
    });
  });
});
