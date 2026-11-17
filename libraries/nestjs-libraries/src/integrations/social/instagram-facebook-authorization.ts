import {
  getInstagramIntegrationCapabilities,
  InstagramCapabilityIntegration,
  InstagramPrivateReplyAuthorization,
  INSTAGRAM_FACEBOOK_MESSAGING_SCOPES,
} from './instagram-capabilities';
import { INSTAGRAM_FACEBOOK_GRAPH_API_VERSION } from './instagram.provider';

/** Read-only, no persistence/cache: verify the actual operational Page token.
 * Never return/log the debugger payload, request URL, token or fetch error.
 */
async function privateReplyAuthorization(
  integration: InstagramCapabilityIntegration
): Promise<InstagramPrivateReplyAuthorization> {
  const appId = process.env.FACEBOOK_APP_ID;
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !secret) return 'VERIFICATION_UNAVAILABLE';
  try {
    const url = new URL(
      `https://graph.facebook.com/${INSTAGRAM_FACEBOOK_GRAPH_API_VERSION}/debug_token`
    );
    url.searchParams.set('input_token', integration.token);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${appId}|${secret}` },
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    if (!response.ok) return 'VERIFICATION_UNAVAILABLE';
    const payload = await response.json();
    const data = payload?.data;
    if (payload?.error || !data) return 'VERIFICATION_UNAVAILABLE';
    const now = Date.now() / 1000;
    if (
      data.error || data.is_valid !== true || String(data.app_id) !== appId ||
      (data.type && data.type !== 'PAGE') ||
      String(data.profile_id) !== integration.facebookPageId ||
      [data.expires_at, data.data_access_expires_at].some(
        (expiry) => expiry !== undefined &&
          (typeof expiry !== 'number' || !Number.isFinite(expiry) ||
            (expiry !== 0 && expiry <= now))
      )
    ) return 'RECONNECT_REQUIRED';

    const required = [
      'instagram_basic', 'instagram_manage_comments',
      ...INSTAGRAM_FACEBOOK_MESSAGING_SCOPES,
    ];
    if (!Array.isArray(data.scopes) ||
      !required.every((scope) => data.scopes.includes(scope))) {
      return 'RECONNECT_REQUIRED';
    }
    if (data.granular_scopes !== undefined) {
      if (!Array.isArray(data.granular_scopes)) return 'VERIFICATION_UNAVAILABLE';
      for (const scope of required) {
        const grants = data.granular_scopes.filter((g: any) => g?.scope === scope);
        const targets = [integration.facebookPageId, integration.internalId].filter(Boolean);
        if (grants.length && !grants.some((grant: any) =>
          grant.target_ids === undefined ||
          (Array.isArray(grant.target_ids) &&
            grant.target_ids.some((id: unknown) => targets.includes(String(id))))
        )) return 'RECONNECT_REQUIRED';
      }
    }
    return 'GRANTED';
  } catch {
    return 'VERIFICATION_UNAVAILABLE';
  }
}

export async function getInstagramCapabilitiesWithAuthorization(
  integration: InstagramCapabilityIntegration
) {
  const capabilities = getInstagramIntegrationCapabilities(integration);
  if (integration.providerIdentifier !== 'instagram' || !capabilities.commentsWebhook) {
    return capabilities;
  }
  return getInstagramIntegrationCapabilities(
    integration, await privateReplyAuthorization(integration)
  );
}
