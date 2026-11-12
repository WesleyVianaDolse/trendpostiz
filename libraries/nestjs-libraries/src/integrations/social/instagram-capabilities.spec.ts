import { getInstagramIntegrationCapabilities } from './instagram-capabilities';

const integration = {
  providerIdentifier: 'instagram-standalone',
  token: 'token',
  tokenExpiration: null,
  facebookPageId: null,
  disabled: false,
  deletedAt: null,
  refreshNeeded: false,
  webhookCommentsSubscribed: true,
  webhookMessagesSubscribed: true,
};

describe('Instagram integration capabilities', () => {
  it('reports the capabilities already implemented for Standalone', () => {
    expect(getInstagramIntegrationCapabilities(integration)).toEqual({
      commentsWebhook: true,
      publicReply: true,
      privateReply: true,
      reconnectRequired: false,
    });
  });

  it('does not equate private replies with only a messages subscription', () => {
    expect(
      getInstagramIntegrationCapabilities({
        ...integration,
        webhookCommentsSubscribed: false,
      })
    ).toEqual({
      commentsWebhook: false,
      publicReply: false,
      privateReply: false,
      reconnectRequired: false,
    });
  });

  it('enables Facebook/Business Manager without requiring messages subscription', () => {
    expect(
      getInstagramIntegrationCapabilities({
        ...integration,
        providerIdentifier: 'instagram',
        facebookPageId: 'page-1',
        webhookMessagesSubscribed: false,
      })
    ).toEqual({
      commentsWebhook: true,
      publicReply: true,
      privateReply: true,
      reconnectRequired: false,
    });
  });

  it('requires traditional accounts without a Facebook Page ID to reconnect', () => {
    expect(
      getInstagramIntegrationCapabilities({
        ...integration,
        providerIdentifier: 'instagram',
      })
    ).toEqual({
      commentsWebhook: false,
      publicReply: false,
      privateReply: false,
      reconnectRequired: true,
    });
  });

  it('blocks an unconfirmed subscription without incorrectly requiring reconnection', () => {
    expect(
      getInstagramIntegrationCapabilities({
        ...integration,
        providerIdentifier: 'instagram',
        facebookPageId: 'page-1',
        webhookCommentsSubscribed: false,
      })
    ).toMatchObject({
      commentsWebhook: false,
      reconnectRequired: false,
      unavailableReason: 'SUBSCRIPTION_FAILED',
    });
  });

  it.each([
    [
      { code: 100, message: 'Param subscribed_fields must be one of {feed}' },
      'WEBHOOK_CONFIGURATION_INCOMPLETE',
      false,
    ],
    [{ code: 200 }, 'INSUFFICIENT_PERMISSIONS', false],
    [{ code: 190 }, 'RECONNECT_REQUIRED', true],
    [
      { reason: 'SUBSCRIPTION_FAILED', message: 'network failure' },
      'SUBSCRIPTION_FAILED',
      false,
    ],
  ])(
    'classifies an unsuccessful Facebook subscription: %j',
    (failure, unavailableReason, reconnectRequired) => {
      expect(
        getInstagramIntegrationCapabilities({
          ...integration,
          providerIdentifier: 'instagram',
          facebookPageId: 'page-1',
          webhookCommentsSubscribed: false,
          webhookSubscriptionError: JSON.stringify(failure),
        })
      ).toMatchObject({
        commentsWebhook: false,
        publicReply: false,
        privateReply: false,
        reconnectRequired,
        unavailableReason,
      });
    }
  );

  it('disables capabilities for an unavailable integration', () => {
    expect(
      getInstagramIntegrationCapabilities({ ...integration, disabled: true })
    ).toEqual({
      commentsWebhook: false,
      publicReply: false,
      privateReply: false,
      reconnectRequired: false,
    });
  });

  it('disables capabilities for a deleted integration', () => {
    expect(
      getInstagramIntegrationCapabilities({
        ...integration,
        deletedAt: new Date(),
      })
    ).toMatchObject({
      commentsWebhook: false,
      publicReply: false,
      privateReply: false,
    });
  });

  it('requires reconnection for an expired token', () => {
    expect(
      getInstagramIntegrationCapabilities({
        ...integration,
        tokenExpiration: new Date(0),
      })
    ).toMatchObject({
      commentsWebhook: false,
      reconnectRequired: true,
    });
  });
});
