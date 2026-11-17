jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: async () => {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { fixedDecryption: (s: string) => s },
}));
const mockX = {
  tweetLikedBy: jest.fn(),
  retweet: jest.fn(),
  tweet: jest.fn(),
  me: jest.fn(),
};
jest.mock('twitter-api-v2', () => ({
  TwitterApi: class {
    v2 = mockX;
  },
}));
const mockBsky = {
  login: jest.fn(),
  getPostThread: jest.fn(),
  repost: jest.fn(),
  post: jest.fn(),
};
jest.mock('@atproto/api', () => ({
  BskyAgent: class {
    constructor() {
      Object.assign(this, mockBsky);
    }
  },
  RichText: class {
    text: string;
    facets = [];
    constructor(v: any) {
      this.text = v.text;
    }
  },
}));

import {
  captureDerivedEffect,
  derivedMutation,
  derivedConditionNotMet,
  derivedConfirmed,
} from './derived-effect-result';
import { ThreadsProvider } from '../integrations/social/threads.provider';
import { LinkedinPageProvider } from '../integrations/social/linkedin.page.provider';
import { LinkedinProvider } from '../integrations/social/linkedin.provider';
import { BlueskyProvider } from '../integrations/social/bluesky.provider';
import { XProvider } from '../integrations/social/x.provider';
import { SocialAbstract } from '../integrations/social.abstract';

describe('audited derived evidence, preserving provider public results', () => {
  const integration: any = {
    internalId: '100',
    token: 'synthetic',
    customInstanceDetails: '{}',
  };
  const hooks = () => ({
    beforeMutation: jest.fn().mockResolvedValue(undefined),
    checkpoint: jest.fn().mockResolvedValue(undefined),
  });
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => {
    mockX.tweetLikedBy.mockResolvedValue({ meta: { result_count: 10 } });
    mockX.retweet.mockResolvedValue({ data: { retweeted: true } });
    mockX.tweet.mockResolvedValue({ data: { id: '701' } });
    mockX.me.mockResolvedValue({ data: { id: '100' } });
    mockBsky.login.mockResolvedValue({});
    mockBsky.getPostThread.mockResolvedValue({
      data: {
        thread: {
          post: {
            likeCount: 10,
            uri: 'at://did:plc:synthetic/app.bsky.feed.post/parent',
            cid: 'syntheticcid',
          },
        },
      },
    });
    mockBsky.post.mockResolvedValue({
      uri: 'at://did:plc:synthetic/app.bsky.feed.post/created',
      cid: 'syntheticcid',
    });
    mockBsky.repost.mockResolvedValue({
      uri: 'at://did:plc:synthetic/app.bsky.feed.repost/created',
      cid: 'syntheticcid',
    });
  });
  it.each([true, false, undefined])(
    'does not infer an outcome from %s',
    async (value) => {
      expect(
        await captureDerivedEffect(async () => value, hooks())
      ).toMatchObject({ kind: 'UNCERTAIN' });
    }
  );
  it('rejects no-effect evidence after a mutation and isolates concurrent captures', async () => {
    const [a, b] = await Promise.all([
      captureDerivedEffect(async () => {
        derivedConditionNotMet(1, 2);
      }, hooks()),
      captureDerivedEffect(async () => {
        await derivedMutation(async () => {});
        derivedConditionNotMet(1, 2);
      }, hooks()),
    ]);
    expect(a.kind).toBe('NOT_EXECUTED');
    expect(b.kind).toBe('UNCERTAIN');
  });
  it('retains uncertainty when checkpoint fails after a positive response', async () => {
    const h = hooks();
    h.checkpoint.mockRejectedValue(new Error('synthetic checkpoint failure'));
    expect(
      await captureDerivedEffect(async () => {
        await derivedMutation(async () => {});
        await derivedConfirmed({ proof: 'X_POST_ID', remoteId: '701' });
      }, h)
    ).toMatchObject({ kind: 'UNCERTAIN' });
  });
  it('uses the published Threads id rather than the container id; keeps public true', async () => {
    const provider = new ThreadsProvider();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ name: 'likes', values: [{ value: 10 }] }] })
        )
      );
    jest
      .spyOn(provider, 'fetch')
      .mockResolvedValueOnce(new Response('{"id":"500"}'))
      .mockResolvedValueOnce(new Response('{"id":"501"}'));
    let legacy: unknown;
    const result = await captureDerivedEffect(async () => {
      legacy = await provider.autoPlugPost(integration, '100', {
        likesAmount: '2',
        post: 'Synthetic',
      });
    }, hooks());
    expect(legacy).toBe(true);
    expect(result).toMatchObject({
      kind: 'CONFIRMED',
      receipt: { remoteId: '501' },
    });
  });
  it.each(['autoRepostPost', 'autoPlugPost'] as const)(
    'LinkedIn page %s needs an actual id',
    async (method) => {
      const provider = new LinkedinPageProvider();
      jest
        .spyOn(provider, 'fetch')
        .mockResolvedValueOnce(
          new Response('{"likesSummary":{"totalLikes":10}}')
        )
        .mockResolvedValueOnce(
          new Response('{"object":"parent-only"}', { status: 201 })
        );
      expect(
        await captureDerivedEffect(
          () =>
            provider[method](integration, '100', {
              likesAmount: '2',
              post: 'Synthetic',
            }),
          hooks()
        )
      ).toMatchObject({ kind: 'UNCERTAIN' });
    }
  );
  it('captures the real LinkedIn comment id without changing the old object return', async () => {
    const provider = new LinkedinProvider();
    jest
      .spyOn(provider, 'fetch')
      .mockResolvedValue(
        new Response('{"id":"601","object":"100"}', { status: 201 })
      );
    let legacy: any;
    const result = await captureDerivedEffect(async () => {
      legacy = await provider.addComment(integration, integration, '100', {
        comment: 'Synthetic',
      });
    }, hooks());
    expect(legacy[0].postId).toBe('100');
    expect(result).toMatchObject({
      kind: 'CONFIRMED',
      receipt: { remoteId: '601', proof: 'LINKEDIN_COMMENT_ID' },
    });
  });
  it.each(['autoRepostPost', 'autoPlugPost'] as const)(
    'Bluesky %s can retain public true and prove no effect',
    async (method) => {
      mockBsky.getPostThread.mockResolvedValue({
        data: { thread: { post: { likeCount: 0 } } },
      });
      const provider = new BlueskyProvider();
      let legacy: unknown;
      const outcome = await captureDerivedEffect(async () => {
        legacy = await provider[method](integration, '100', {
          likesAmount: '2',
          post: 'Synthetic',
        });
      }, hooks());
      expect(legacy).toBe(true);
      expect(outcome).toMatchObject({
        kind: 'NOT_EXECUTED',
        evidence: { observed: 0, threshold: 2 },
      });
    }
  );
  it.each(['autoRepostPost', 'autoPlugPost'] as const)(
    'Bluesky %s records URI and CID from the SDK acknowledgement',
    async (method) => {
      const result = await captureDerivedEffect(
        () =>
          new BlueskyProvider()[method](integration, '100', {
            likesAmount: '2',
            post: 'Synthetic',
          }),
        hooks()
      );
      expect(result).toMatchObject({
        kind: 'CONFIRMED',
        receipt: { proof: 'ATPROTO_RECORD', cid: 'syntheticcid' },
      });
    }
  );
  it.each(['autoRepostPost', 'autoPlugPost'] as const)(
    'X %s records only an explicit SDK acknowledgement',
    async (method) => {
      expect(
        await captureDerivedEffect(
          () =>
            new XProvider()[method](integration, '100', {
              likesAmount: '2',
              post: 'Synthetic',
            }),
          hooks()
        )
      ).toMatchObject({ kind: 'CONFIRMED' });
    }
  );
  it('X caught transport failure and void remain uncertain', async () => {
    mockX.retweet.mockRejectedValueOnce(new Error('synthetic connection loss'));
    let legacy: unknown;
    const outcome = await captureDerivedEffect(async () => {
      legacy = await new XProvider().repostPostUsers(
        integration,
        integration,
        '100',
        {}
      );
    }, hooks());
    expect(legacy).toBeUndefined();
    expect(outcome.kind).toBe('UNCERTAIN');
  });
  it('does not send an internal X repost with a different authenticated actor', async () => {
    mockX.retweet.mockClear(); mockX.me.mockResolvedValue({ data: { id: 'other-actor' } });
    const outcome = await captureDerivedEffect(() => new XProvider().repostPostUsers(integration, integration, '100', {}), hooks());
    expect(outcome.kind).toBe('UNCERTAIN'); expect(mockX.retweet).not.toHaveBeenCalled();
  });
  it('does not retry a derived mutating 500 inside SocialAbstract.fetch', async () => {
    const network = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 500 }));
    const outcome = await captureDerivedEffect(
      () =>
        derivedMutation(() =>
          new SocialAbstract().fetch('https://example.test/fake', {
            method: 'POST',
          })
        ),
      hooks()
    );
    expect(outcome.kind).toBe('UNCERTAIN');
    expect(network).toHaveBeenCalledTimes(1);
  });
});
