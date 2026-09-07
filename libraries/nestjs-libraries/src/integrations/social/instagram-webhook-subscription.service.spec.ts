import { BadRequestException } from '@nestjs/common';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);

import { InstagramWebhookSubscriptionService } from './instagram-webhook-subscription.service';

describe('InstagramWebhookSubscriptionService', () => {
  const integrationService = {
    updateInstagramWebhookSubscriptions: jest.fn().mockResolvedValue({}),
  };
  const service = new InstagramWebhookSubscriptionService(
    integrationService as any
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
    expect(requestedUrl.searchParams.get('access_token')).toBe(
      'sensitive-token'
    );
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'POST' });
    expect(
      integrationService.updateInstagramWebhookSubscriptions
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
      integrationService.updateInstagramWebhookSubscriptions
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
      integrationService.updateInstagramWebhookSubscriptions
    ).toHaveBeenCalledWith('integration-1', true, false, expect.any(String));
  });

  it('does not call Meta for another provider', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      service.subscribeComments({
        ...integration,
        providerIdentifier: 'instagram',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
