import 'reflect-metadata';
import { getInstagramCapabilitiesWithAuthorization } from './instagram-facebook-authorization';
import { getInstagramIntegrationCapabilities } from './instagram-capabilities';

const integration = {
  providerIdentifier: 'instagram', internalId: 'ig-1', facebookPageId: 'page-1',
  token: 'synthetic-page-token', tokenExpiration: null, disabled: false,
  deletedAt: null, refreshNeeded: false,
  webhookCommentsSubscribed: true, webhookMessagesSubscribed: false,
};
const scopes = [
  'instagram_basic', 'instagram_manage_comments',
  'instagram_manage_messages',
];
const debug = (overrides: any = {}) => ({ data: {
  app_id: 'app-1', type: 'PAGE', profile_id: 'page-1', is_valid: true,
  scopes, expires_at: 0, data_access_expires_at: 0, ...overrides,
} });

describe('Facebook Instagram operational token authorization', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env, FACEBOOK_APP_ID: 'app-1', FACEBOOK_APP_SECRET: 'synthetic-app-secret',
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const response = (payload: any, status = 200) =>
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status })
    );

  it('checks the actual Page token and returns only sanitized capabilities', async () => {
    const fetchMock = response(debug());
    const result = await getInstagramCapabilitiesWithAuthorization(integration);
    expect(result).toMatchObject({ privateReply: true, privateReplyAuthorization: 'GRANTED' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe('/v25.0/debug_token');
    expect(new URL(String(url)).searchParams.get('input_token')).toBe(integration.token);
    expect(options).toMatchObject({
      headers: { Authorization: 'Bearer app-1|synthetic-app-secret' }, redirect: 'error',
    });
    expect(JSON.stringify(result)).not.toMatch(/synthetic|app-1|page-1/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(scopes)('blocks only Direct when %s is absent', async (missing) => {
    response(debug({ scopes: scopes.filter(s => s !== missing) }));
    await expect(getInstagramCapabilitiesWithAuthorization(integration)).resolves.toMatchObject({
      commentsWebhook: true, publicReply: true, privateReply: false,
      reconnectRequired: false, privateReplyAuthorization: 'RECONNECT_REQUIRED',
    });
  });

  it.each([
    { is_valid: false }, { app_id: 'another-app' }, { type: 'USER' },
    { profile_id: 'another-page' }, { expires_at: 1 }, { data_access_expires_at: 1 },
    { scopes: undefined },
    { granular_scopes: [{ scope: 'instagram_manage_messages', target_ids: ['another-ig'] }] },
    { granular_scopes: [{ scope: 'instagram_manage_messages', target_ids: [] }] },
  ])('does not accept invalid token metadata: %j', async (overrides) => {
    response(debug(overrides));
    await expect(getInstagramCapabilitiesWithAuthorization(integration)).resolves.toMatchObject({
      publicReply: true, privateReply: false, reconnectRequired: false,
      privateReplyAuthorization: 'RECONNECT_REQUIRED',
    });
  });

  it.each([
    [{ scope: 'instagram_manage_messages', target_ids: ['ig-1'] }],
    [{ scope: 'instagram_manage_messages' }],
  ])('accepts valid granular or unrestricted grants', async (...grants) => {
    response(debug({ granular_scopes: grants }));
    await expect(getInstagramCapabilitiesWithAuthorization(integration)).resolves.toMatchObject({ privateReply: true });
  });

  it('enables Direct without pages_messaging and ignores its unrelated granular grants', async () => {
    expect(scopes).not.toContain('pages_messaging');
    response(debug({ granular_scopes: [
      { scope: 'instagram_manage_messages', target_ids: ['ig-1'] },
      { scope: 'pages_messaging', target_ids: ['another-page'] },
    ] }));
    await expect(getInstagramCapabilitiesWithAuthorization(integration)).resolves.toMatchObject({
      publicReply: true, privateReply: true, reconnectRequired: false,
      privateReplyAuthorization: 'GRANTED',
    });
  });

  it('does not accept pages_messaging as a substitute for instagram_manage_messages', async () => {
    response(debug({ scopes: ['instagram_basic', 'instagram_manage_comments', 'pages_messaging'] }));
    await expect(getInstagramCapabilitiesWithAuthorization(integration)).resolves.toMatchObject({
      publicReply: true, privateReply: false, reconnectRequired: false,
      privateReplyAuthorization: 'RECONNECT_REQUIRED',
    });
  });

  it.each([403, 429, 503])('does not demand reconnection after debugger HTTP %s', async (status) => {
    response({ error: { message: 'synthetic private metadata' } }, status);
    await expect(getInstagramCapabilitiesWithAuthorization(integration)).resolves.toMatchObject({
      publicReply: true, privateReply: false, reconnectRequired: false,
      privateReplyAuthorization: 'VERIFICATION_UNAVAILABLE',
    });
  });

  it('contains transport errors and does not cache grants across checks', async () => {
    const fetchMock = response(debug());
    expect((await getInstagramCapabilitiesWithAuthorization(integration)).privateReply).toBe(true);
    fetchMock.mockRejectedValueOnce(new Error('synthetic-token-bearing-url'));
    const failed = await getInstagramCapabilitiesWithAuthorization(integration);
    expect(failed.privateReplyAuthorization).toBe('VERIFICATION_UNAVAILABLE');
    expect(JSON.stringify(failed)).not.toContain('synthetic');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(debug({ scopes: [] }))));
    expect((await getInstagramCapabilitiesWithAuthorization(integration)).privateReply).toBe(false);
  });

  it('leaves Direct disabled without app credentials; does not change Standalone', async () => {
    delete process.env.FACEBOOK_APP_SECRET;
    const fetchMock = jest.spyOn(global, 'fetch');
    expect((await getInstagramCapabilitiesWithAuthorization(integration)).privateReplyAuthorization)
      .toBe('VERIFICATION_UNAVAILABLE');
    const standalone = { ...integration, providerIdentifier: 'instagram-standalone', webhookMessagesSubscribed: true };
    await expect(getInstagramCapabilitiesWithAuthorization(standalone))
      .resolves.toEqual(getInstagramIntegrationCapabilities(standalone));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
