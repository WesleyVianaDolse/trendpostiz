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

  it('requires a traditional account with no confirmed subscription to reconnect', () => {
    expect(
      getInstagramIntegrationCapabilities({
        ...integration,
        providerIdentifier: 'instagram',
        facebookPageId: 'page-1',
        webhookCommentsSubscribed: false,
      })
    ).toMatchObject({
      commentsWebhook: false,
      reconnectRequired: true,
    });
  });

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
