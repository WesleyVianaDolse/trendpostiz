import { BadRequestException } from '@nestjs/common';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository',
  () => ({ IntegrationRepository: class {} })
);

import { InstagramWebhookSubscriptionService } from './instagram-webhook-subscription.service';

describe('InstagramWebhookSubscriptionService', () => {
  const integrationRepository = {
    updateInstagramWebhookSubscriptions: jest.fn().mockResolvedValue({}),
  };
  const service = new InstagramWebhookSubscriptionService(
    integrationRepository as any
  );
  const integration = {
    id: 'integration-1',
    internalId: 'account-1',
    providerIdentifier: 'instagram-standalone',
    token: 'sensitive-token',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the expected subscribed_apps request and stores success', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(service.subscribeComments(integration)).resolves.toEqual({
      success: true,
      error: undefined,
    });
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${requestedUrl.origin}${requestedUrl.pathname}`).toBe(
      'https://graph.instagram.com/v25.0/account-1/subscribed_apps'
    );
    expect(requestedUrl.searchParams.get('subscribed_fields')).toBe(
      'comments,messages'
    );
    expect(requestedUrl.searchParams.get('access_token')).toBeNull();
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'POST',
      headers: { Authorization: 'Bearer sensitive-token' },
    });
    expect(
      integrationRepository.updateInstagramWebhookSubscriptions
    ).toHaveBeenCalledWith('integration-1', true, true, undefined);
  });

  it('stores a sanitized Meta error without exposing the token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            type: 'OAuthException',
            message: 'Invalid sensitive-token access_token=sensitive-token',
          },
        }),
        { status: 400 }
      )
    );

    const result = await service.subscribeComments(integration);
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('sensitive-token');
    expect(
      integrationRepository.updateInstagramWebhookSubscriptions
    ).toHaveBeenCalledWith(
      'integration-1',
      false,
      false,
      expect.not.stringContaining('sensitive-token')
    );
  });

  it('preserves a known comments subscription when messages expansion fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 10, message: 'Denied' } }), {
        status: 400,
      })
    );

    await service.subscribeComments({
      ...integration,
      webhookCommentsSubscribed: true,
    });
    expect(
      integrationRepository.updateInstagramWebhookSubscriptions
    ).toHaveBeenCalledWith('integration-1', true, false, expect.any(String));
  });

  describe('Facebook Login: app Instagram comments plus linked Page enablement', () => {
    const originalEnv = { ...process.env };
    const traditional = {
      ...integration,
      providerIdentifier: 'instagram',
      facebookPageId: 'page-1',
    } as any;
    const responses = () => ({
      identity: {
        id: 'page-1',
        instagram_business_account: { id: 'account-1' },
      },
      app: {
        data: [
          {
            object: 'instagram',
            active: true,
            callback_url: 'https://example.com/webhooks',
            fields: [{ name: 'comments' }],
          },
        ],
      },
      pages: { data: [{ id: 'app-1', subscribed_fields: ['messages'] }] },
      post: { success: true },
    });
    const mockGraph = (values = responses()) =>
      jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        const body = url.pathname.endsWith('/me')
          ? values.identity
          : url.pathname.endsWith('/subscriptions')
          ? values.app
          : init?.method === 'POST'
          ? values.post
          : values.pages;
        return new Response(JSON.stringify(body), {
          status: (body as any)?.error ? 400 : 200,
        });
      });
    beforeEach(() => {
      process.env.FACEBOOK_APP_ID = 'app-1';
      process.env.FACEBOOK_APP_SECRET = 'app-secret';
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = 'verify-token';
    });
    afterEach(() => {
      for (const key of [
        'FACEBOOK_APP_ID',
        'FACEBOOK_APP_SECRET',
        'INSTAGRAM_WEBHOOK_VERIFY_TOKEN',
      ]) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      }
      integrationRepository.updateInstagramWebhookSubscriptions.mockResolvedValue(
        {}
      );
    });

    it('requires real app comments configuration and Page POST confirmation, preserving existing Page fields', async () => {
      const fetchMock = mockGraph();
      await expect(
        service.subscribeComments(traditional)
      ).resolves.toMatchObject({ success: true });
      const post = fetchMock.mock.calls.find(
        ([, init]) => init?.method === 'POST'
      )!;
      const url = new URL(String(post[0]));
      expect(`${url.origin}${url.pathname}`).toBe(
        'https://graph.facebook.com/v25.0/page-1/subscribed_apps'
      );
      expect(url.searchParams.get('subscribed_fields')).toBe('messages');
      expect(post[1]?.headers).toEqual({
        Authorization: 'Bearer sensitive-token',
      });
      const appRequest = fetchMock.mock.calls.find(([input]) =>
        String(input).includes('/app-1/subscriptions')
      )!;
      expect(appRequest[1]?.headers).toEqual({
        Authorization: 'Bearer app-1|app-secret',
      });
      for (const [input] of fetchMock.mock.calls) {
        expect(String(input)).not.toMatch(
          /sensitive-token|app-secret|access_token=/
        );
      }
      expect(
        integrationRepository.updateInstagramWebhookSubscriptions
      ).toHaveBeenCalledWith('integration-1', true, false, undefined);
    });

    it.each([
      { data: [] },
      {
        data: [
          {
            object: 'page',
            active: true,
            callback_url: 'https://example.com',
            fields: [{ name: 'feed' }],
          },
        ],
      },
    ])(
      'does not enable capabilities when Instagram comments are not configured: %j',
      async ({ data }) => {
        const values = responses();
        values.app = { data } as any;
        const fetchMock = mockGraph(values);
        await expect(
          service.subscribeComments(traditional)
        ).resolves.toMatchObject({
          success: false,
          reason: 'WEBHOOK_CONFIGURATION_INCOMPLETE',
        });
        expect(
          fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
        ).toBe(false);
        expect(
          integrationRepository.updateInstagramWebhookSubscriptions
        ).toHaveBeenCalledWith(
          'integration-1',
          false,
          false,
          expect.any(String)
        );
      }
    );

    it.each([
      [190, 'Invalid token', 'RECONNECT_REQUIRED'],
      [102, 'Invalid session', 'RECONNECT_REQUIRED'],
      [10, 'Denied', 'INSUFFICIENT_PERMISSIONS'],
      [200, 'Denied', 'INSUFFICIENT_PERMISSIONS'],
      [
        100,
        'Param subscribed_fields[0] must be one of {feed, mention}',
        'WEBHOOK_CONFIGURATION_INCOMPLETE',
      ],
      [100, 'Invalid parameter', 'SUBSCRIPTION_FAILED'],
    ])(
      'classifies Meta %s without inventing a successful subscription',
      async (code, message, reason) => {
        const values = responses();
        values.post = { error: { code, message } } as any;
        mockGraph(values);
        await expect(
          service.subscribeComments(traditional)
        ).resolves.toMatchObject({ success: false, reason });
        expect(
          integrationRepository.updateInstagramWebhookSubscriptions
        ).toHaveBeenCalledWith(
          'integration-1',
          false,
          false,
          expect.stringContaining(String(reason))
        );
      }
    );

    it('classifies invalid app credentials as server configuration, not user reconnection', async () => {
      const values = responses();
      values.app = {
        error: { code: 190, message: 'Invalid app-1|app-secret' },
      } as any;
      mockGraph(values);
      const result = await service.subscribeComments(traditional);
      expect(result).toMatchObject({
        success: false,
        reason: 'WEBHOOK_CONFIGURATION_INCOMPLETE',
      });
      expect(result.error).not.toContain('app-secret');
      expect(result.error).not.toContain('sensitive-token');
    });

    it('does not claim success after a persistence failure', async () => {
      mockGraph();
      integrationRepository.updateInstagramWebhookSubscriptions.mockRejectedValueOnce(
        new Error('offline')
      );
      await expect(
        service.subscribeComments(traditional)
      ).resolves.toMatchObject({
        success: false,
        reason: 'SUBSCRIPTION_FAILED',
      });
    });

    it.each([{}, { success: 'true' }])(
      'requires a strict Meta success response: %j',
      async (post) => {
        const values = responses();
        values.post = post as any;
        mockGraph(values);
        await expect(
          service.subscribeComments(traditional)
        ).resolves.toMatchObject({
          success: false,
          reason: 'SUBSCRIPTION_FAILED',
        });
      }
    );

    it('records missing configuration before calling Meta', async () => {
      delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
      const fetchMock = mockGraph();
      await expect(
        service.subscribeComments(traditional)
      ).resolves.toMatchObject({
        success: false,
        reason: 'WEBHOOK_CONFIGURATION_INCOMPLETE',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires reconnection to recover a missing Page ID', async () => {
      const fetchMock = mockGraph();
      await expect(
        service.subscribeComments({ ...traditional, facebookPageId: null })
      ).resolves.toMatchObject({
        success: false,
        reason: 'RECONNECT_REQUIRED',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a token or linked Instagram account belonging to another Page', async () => {
      const values = responses();
      values.identity.instagram_business_account.id = 'different-account';
      const fetchMock = mockGraph(values);
      await expect(
        service.subscribeComments(traditional)
      ).resolves.toMatchObject({
        success: false,
        reason: 'RECONNECT_REQUIRED',
      });
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
      ).toBe(false);
    });

    it('classifies network failures without exposing request URLs or credentials', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValueOnce(
          new Error(
            'Failed sensitive-token app-secret https://example.com?access_token=secret'
          )
        );
      const result = await service.subscribeComments(traditional);
      expect(result).toMatchObject({
        success: false,
        reason: 'SUBSCRIPTION_FAILED',
      });
      expect(result.error).not.toMatch(
        /sensitive-token|app-secret|access_token|https:/
      );
    });

    it('reads all Page subscriptions before preserving the current app fields', async () => {
      const base = mockGraph();
      const defaultImplementation = base.getMockImplementation()!;
      base.mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        if (
          url.pathname.endsWith('/subscribed_apps') &&
          init?.method === 'GET' &&
          !url.searchParams.has('after')
        ) {
          return new Response(
            JSON.stringify({
              data: [{ id: 'another-app', subscribed_fields: ['leadgen'] }],
              paging: {
                next: 'https://untrusted.example/?access_token=never-follow',
                cursors: { after: 'cursor' },
              },
            })
          );
        }
        return defaultImplementation(input, init);
      });
      await expect(
        service.subscribeComments(traditional)
      ).resolves.toMatchObject({ success: true });
      const post = base.mock.calls.find(([, init]) => init?.method === 'POST')!;
      expect(
        new URL(String(post[0])).searchParams.get('subscribed_fields')
      ).toBe('messages');
      expect(
        base.mock.calls.some(
          ([input]) =>
            new URL(String(input)).searchParams.get('after') === 'cursor'
        )
      ).toBe(true);
      expect(
        base.mock.calls.every(
          ([input]) => new URL(String(input)).hostname === 'graph.facebook.com'
        )
      ).toBe(true);
    });

    it('fails closed when a subscription collection cannot be read completely', async () => {
      const values = responses();
      values.pages = {
        data: [],
        paging: { next: 'https://graph.facebook.com/next' },
      } as any;
      const fetchMock = mockGraph(values);
      await expect(
        service.subscribeComments(traditional)
      ).resolves.toMatchObject({
        success: false,
        reason: 'SUBSCRIPTION_FAILED',
      });
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
      ).toBe(false);
    });

    it('does not retain a traditional success flag after a failed revalidation', async () => {
      const values = responses();
      values.post = { error: { code: 200, message: 'Denied' } } as any;
      mockGraph(values);
      await service.subscribeComments({
        ...traditional,
        webhookCommentsSubscribed: true,
      });
      expect(
        integrationRepository.updateInstagramWebhookSubscriptions
      ).toHaveBeenCalledWith('integration-1', false, false, expect.any(String));
    });

    it('uses the documented Page field only when enabling a new Page association', async () => {
      const values = responses();
      values.pages = { data: [] };
      const fetchMock = mockGraph(values);
      await expect(
        service.subscribeComments(traditional)
      ).resolves.toMatchObject({ success: true });
      const post = fetchMock.mock.calls.find(
        ([, init]) => init?.method === 'POST'
      )!;
      expect(
        new URL(String(post[0])).searchParams.get('subscribed_fields')
      ).toBe('feed');
    });

    it('does not overwrite existing Page subscriptions if their fields are unknown', async () => {
      const values = responses();
      values.pages = { data: [{ id: 'app-1' }] } as any;
      const fetchMock = mockGraph(values);
      await expect(
        service.subscribeComments(traditional)
      ).resolves.toMatchObject({
        success: false,
        reason: 'SUBSCRIPTION_FAILED',
      });
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')
      ).toBe(false);
    });
  });

  it('does not call Meta for another provider', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      service.subscribeComments({
        ...integration,
        providerIdentifier: 'facebook',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
