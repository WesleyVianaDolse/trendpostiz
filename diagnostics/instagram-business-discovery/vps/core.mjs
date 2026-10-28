import https from 'node:https';

export const API_VERSION = 'v25.0';
export const TARGET = 'wesleydolse';
export const REQUIRED_SCOPES = Object.freeze(['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement']);
export const DISCOVERY_FIELDS = 'business_discovery.username(wesleydolse){username,media_count,media.limit(5){caption,media_type,timestamp,permalink}}';
export const SELECTION_SQL = `SELECT "providerIdentifier", "internalId", "facebookPageId", "disabled", "deletedAt", "inBetweenSteps"
FROM "Integration" WHERE "organizationId" = $1 AND "id" = $2 LIMIT 1`;

export class DiagnosticError extends Error {
  constructor(code, state = 'validation_blocked') { super(code); this.code = code; this.state = state; }
}

export function validateSelection(selection) {
  for (const key of ['tenantId', 'integrationId']) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(selection[key] || '')) throw new DiagnosticError('invalid_explicit_selection');
  }
  for (const key of ['igUserId', 'pageId', 'appId']) {
    if (!/^[0-9]{5,30}$/.test(selection[key] || '')) throw new DiagnosticError('invalid_expected_meta_identifiers');
  }
  if (selection.igUserId === selection.pageId) throw new DiagnosticError('page_and_ig_identifiers_must_be_distinct');
}

export function makeSanitizer(secrets = []) {
  const values = [...new Set(secrets.filter(v => typeof v === 'string' && v.length >= 5))].sort((a, b) => b.length - a.length);
  return input => {
    let text = String(input);
    for (const value of values) for (const variant of [value, encodeURIComponent(value)]) text = text.split(variant).join('[redigido]');
    return text.replace(/\b(?:EAA|IGAA)[A-Za-z0-9_-]{20,}/g, '[token omitido]')
      .replace(/\b(?:access_token|input_token|appsecret_proof|client_secret|password|sessionid|csrftoken)\s*[:=]\s*[^\s,;]+/gi, '[segredo omitido]')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email omitido]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [redigido]');
  };
}

export function searchKeyword(text) {
  if (typeof text !== 'string' || !text.trim()) return { evaluated: false, accented: null, unaccented: null, accent_insensitive: null };
  const normalized = text.normalize('NFC').toLocaleLowerCase('pt-BR');
  const count = (value, term) => [...value.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${term}(?![\\p{L}\\p{N}_])`, 'gu'))].length;
  return { evaluated: true, accented: count(normalized, 'estratégia'), unaccented: count(normalized, 'estrategia'),
    accent_insensitive: count(normalized.normalize('NFD').replace(/\p{M}/gu, ''), 'estrategia') };
}

export function sanitizeMetaError(body, status) {
  const raw = body?.error;
  if (!raw || typeof raw !== 'object') return null;
  const allowedTypes = ['OAuthException', 'GraphMethodException', 'OAuthAccessTokenException', 'Exception'];
  const message = typeof raw.message === 'string' ? raw.message : '';
  const evidence = /(?:not a|not an|isn't a|must be a|not.*valid).*?(?:business|professional|creator)/i.test(message) ? 'explicit_professional_account_requirement'
    : /nonexisting field|unknown field/i.test(message) ? 'explicit_unsupported_field'
      : /unsupported get request|does not exist|cannot be loaded|not found/i.test(message) ? 'object_unavailable_or_not_accessible'
        : null;
  return { code: Number.isSafeInteger(raw.code) ? raw.code : null,
    subcode: Number.isSafeInteger(raw.error_subcode) ? raw.error_subcode : null,
    type: allowedTypes.includes(raw.type) ? raw.type : 'other_or_omitted',
    is_transient: typeof raw.is_transient === 'boolean' ? raw.is_transient : null,
    message_evidence: evidence, raw_message_omitted: true, http_status: status };
}

export function classifyMetaFailure(meta, status) {
  if (status === 429 || [4, 17, 32, 613].includes(meta?.code)) return { state: 'rate_limited', reason: 'official_rate_limit_response_no_retry' };
  if (meta?.code === 190 && meta.subcode === 463) return { state: 'token_expired', reason: 'explicit_meta_expiry_subcode' };
  if ([190, 102].includes(meta?.code)) return { state: 'token_invalid', reason: 'invalid_revoked_or_expired_token_cause_not_further_proven' };
  if ([10, 200].includes(meta?.code)) return { state: 'permission_or_policy_denied', reason: 'meta_denied_request_does_not_alone_prove_a_missing_scope' };
  if (meta?.message_evidence === 'explicit_professional_account_requirement') return { state: 'account_not_eligible', reason: 'meta_explicit_professional_account_requirement_not_proof_of_personal_account' };
  if (meta?.message_evidence === 'explicit_unsupported_field') return { state: 'unsupported_field', reason: 'meta_explicit_field_error' };
  if (meta?.code === 100 || meta?.code === 803 || status === 404) return { state: 'unavailable_or_not_accessible', reason: 'object_or_parameter_error_cause_ambiguous_not_evidence_of_personal_account' };
  return { state: 'api_error', reason: status >= 500 ? 'meta_server_failure_no_retry' : 'unclassified_official_api_failure' };
}

// Direct TLS request. No cookie jar, proxy, SDK, redirects, retries, URL logging,
// automatic token exchange or application services are involved.
export async function officialGET(url, token) {
  if (url.origin !== 'https://graph.facebook.com' || !url.pathname.startsWith('/v25.0/') || url.username || url.password) throw new DiagnosticError('request_outside_graph_allowlist');
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'GET', agent: false, rejectUnauthorized: true,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, response => {
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) request.destroy(new DiagnosticError('response_too_large', 'api_error'));
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new DiagnosticError('response_stream_error', 'network_error')));
      response.on('end', () => {
        const status = response.statusCode;
        try { resolve({ status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { reject(Object.assign(new DiagnosticError('non_json_response', 'api_error'), { httpStatus: status })); }
      });
    });
    const timer = setTimeout(() => request.destroy(new DiagnosticError('request_timeout', 'network_error')), 12000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', err => reject(err instanceof DiagnosticError ? err : new DiagnosticError('tls_or_network_error', 'network_error')));
    request.end();
  });
}

export async function lookupSelectedIntegration({ Client, databaseURL, selection }) {
  validateSelection(selection);
  const client = new Client({ connectionString: databaseURL, connectionTimeoutMillis: 5000, query_timeout: 5000,
    application_name: 'trend-business-discovery-005-readonly', options: '-c default_transaction_read_only=on -c statement_timeout=5000' });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query('SHOW transaction_read_only');
    if (result.rows[0]?.transaction_read_only !== 'on') throw new DiagnosticError('readonly_transaction_not_verified');
    const selected = await client.query(SELECTION_SQL, [selection.tenantId, selection.integrationId]);
    if (selected.rows.length !== 1) throw new DiagnosticError('explicit_tenant_integration_not_found');
    return selected.rows[0];
  } catch (err) {
    if (err instanceof DiagnosticError) throw err;
    throw new DiagnosticError('selected_database_read_failed', 'environment_blocked');
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* No writes issued; connection closure also rolls back. */ }
    await client.end().catch(() => {});
  }
}

function safePermalink(value) {
  try {
    const u = new URL(value);
    const m = u.pathname.match(/^\/(?:wesleydolse\/)?(p|reel)\/([A-Za-z0-9_-]+)\/?$/);
    return u.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(u.hostname) && m ? `https://www.instagram.com/${m[1]}/${m[2]}/` : null;
  } catch { return null; }
}

export async function investigate({ selection, token, verifierToken = token, lookup, request = officialGET, now = () => Date.now(), authorizationConfirmed = false }) {
  const report = { diagnostic: '005', api_version: API_VERSION, target_username: TARGET, started_at: new Date(now()).toISOString(),
    state: 'not_executed', reason: null, execution_authorized_by_operator: authorizationConfirmed,
    scope: { one_explicit_tenant_and_integration: true, selected_provider: 'instagram', token_source: 'explicit_memory_descriptor',
      stored_tokens_read: false, app_secret_read: false, refresh: false, oauth: false, mutation: false, retries: 0, pagination: false },
    selection: { matched: false, source_ids_redacted: true },
    token_validation: { valid: null, type: null, app_matches: null, expired: null, data_access_expired: null },
    permissions: { required: [...REQUIRED_SCOPES], present: null, absent: null, verified_by_debug_and_permissions: false,
      granular_selected_asset_check: 'not_reported_direct_page_and_ig_reads_still_required' },
    source_validation: { page_matches: null, professional_link_matches: null, ig_user_access_verified: null },
    requests: [], request_count: 0, business_discovery_requests: 0,
    discovery: { attempted: false, http_status: null, requested_fields: DISCOVERY_FIELDS, media_count: null, returned_media: null,
      confirmed_captions: null, captions_with_permalink: null, matching_captions: null, media: [],
      caption_coverage: null, pagination_available: null, all_recent_posts_covered: false },
    keyword: { accented: 'estratégia', unaccented: 'estrategia', case_sensitive: false, unicode_normalization: 'NFC_for_variants_NFD_without_combining_marks_for_combined_count', word_matching: 'unicode_whole_word' },
    errors: [], notes: ['No returned media or caption count is inferred from a failed or unexecuted API request.',
      'An empty media page does not establish absence of posts or mentions.', 'Only caption returned by Business Discovery is used; no alt, metadata, bio or comments.',
      'Target personal-account status is not inferred from generic object errors.'] };
  const sanitize = makeSanitizer([token, verifierToken, ...Object.values(selection || {})]);
  async function read(stage, pathname, params, credential = token) {
    if (report.requests.length >= 5) throw new DiagnosticError('request_budget_exceeded');
    const allowed = { token_debug: '/debug_token', permissions: '/me/permissions', page_link: `/${selection.pageId}`, source_ig: `/${selection.igUserId}`, business_discovery: `/${selection.igUserId}` };
    if (allowed[stage] !== pathname) throw new DiagnosticError('request_outside_stage_allowlist');
    if (stage === 'business_discovery') {
      if (report.business_discovery_requests) throw new DiagnosticError('business_discovery_already_attempted');
      if (params.fields !== DISCOVERY_FIELDS) throw new DiagnosticError('unexpected_discovery_fields');
      report.business_discovery_requests++; report.discovery.attempted = true;
    }
    const url = new URL(`https://graph.facebook.com/${API_VERSION}${pathname}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const item = { stage, method: 'GET', host: 'graph.facebook.com', api_version: API_VERSION, http_status: null, meta_error: null };
    report.requests.push(item); report.request_count++;
    let response;
    try { response = await request(url, credential); }
    catch (error) {
      item.http_status = Number.isInteger(error.httpStatus) ? error.httpStatus : null;
      if (stage === 'business_discovery') report.discovery.http_status = item.http_status;
      throw error instanceof DiagnosticError ? error : new DiagnosticError('transport_failed', 'network_error');
    }
    item.http_status = response.status;
    if (stage === 'business_discovery') report.discovery.http_status = response.status;
    item.meta_error = sanitizeMetaError(response.body, response.status);
    if (item.meta_error || response.status < 200 || response.status >= 300) {
      const classification = classifyMetaFailure(item.meta_error, response.status);
      if (stage === 'token_debug' && classification.state !== 'rate_limited') {
        throw new DiagnosticError('debugger_credential_or_inspection_failed_diagnostic_token_validity_unknown', 'token_inspection_failed');
      }
      throw new DiagnosticError(classification.reason, classification.state);
    }
    if (!response.body || typeof response.body !== 'object') throw new DiagnosticError('invalid_json_payload', 'api_error');
    return response.body;
  }
  try {
    validateSelection(selection);
    if (!authorizationConfirmed) throw new DiagnosticError('explicit_execution_authorization_required');
    if (typeof token !== 'string' || token.length < 16 || /[|\s\x00-\x1f\x7f]/.test(token) || typeof verifierToken !== 'string' || verifierToken.length < 16 || /[|\s\x00-\x1f\x7f]/.test(verifierToken)) throw new DiagnosticError('invalid_in_memory_credential_no_app_secret_composite_allowed');
    const row = await lookup(selection);
    if (!row) throw new DiagnosticError('explicit_tenant_integration_not_found');
    if (row.providerIdentifier !== 'instagram') throw new DiagnosticError('selected_provider_is_not_facebook_login_instagram');
    if (row.disabled || row.deletedAt || row.inBetweenSteps) throw new DiagnosticError('selected_integration_not_active_and_complete');
    if (row.internalId !== selection.igUserId || row.facebookPageId !== selection.pageId) throw new DiagnosticError('selected_source_identifiers_do_not_match');
    report.selection.matched = true;
    const debug = (await read('token_debug', '/debug_token', { input_token: token }, verifierToken)).data;
    if (!debug || typeof debug !== 'object') throw new DiagnosticError('token_debug_data_missing');
    report.token_validation.type = ['USER', 'PAGE', 'APP', 'SYSTEM_USER'].includes(debug.type) ? debug.type : 'unknown';
    report.token_validation.app_matches = debug.app_id === selection.appId;
    report.token_validation.valid = debug.is_valid === true;
    report.token_validation.expired = Number(debug.expires_at) > 0 ? Number(debug.expires_at) * 1000 <= now() : null;
    report.token_validation.data_access_expired = Number(debug.data_access_expires_at) > 0 ? Number(debug.data_access_expires_at) * 1000 <= now() : null;
    if (report.token_validation.expired) throw new DiagnosticError('debug_token_expiration_in_past', 'token_expired');
    if (report.token_validation.data_access_expired) throw new DiagnosticError('debug_token_data_access_expiration_in_past', 'token_data_access_expired');
    if (!debug.is_valid) throw new DiagnosticError('debug_token_invalid_cause_not_proven', 'token_invalid');
    if (debug.type !== 'USER') throw new DiagnosticError('only_verified_facebook_user_token_supported_no_conversion');
    if (!report.token_validation.app_matches) throw new DiagnosticError('diagnostic_token_belongs_to_other_app');
    if (typeof debug.user_id !== 'string' || !/^[0-9]+$/.test(debug.user_id)) throw new DiagnosticError('facebook_user_identity_not_verified');
    if (!Array.isArray(debug.scopes)) throw new DiagnosticError('debug_token_scopes_unavailable');
    const granular = Array.isArray(debug.granular_scopes) ? debug.granular_scopes.filter(g => REQUIRED_SCOPES.includes(g.scope) && Array.isArray(g.target_ids) && g.target_ids.length) : [];
    if (granular.length) {
      const selectedAssetIncluded = granular.every(g => g.target_ids.includes(selection.pageId) || g.target_ids.includes(selection.igUserId));
      report.permissions.granular_selected_asset_check = selectedAssetIncluded ? 'selected_asset_present_in_reported_scope_targets' : 'selected_asset_absent_in_reported_scope_targets';
      if (!selectedAssetIncluded) throw new DiagnosticError('reported_scope_targets_exclude_selected_asset', 'insufficient_permission');
    }
    const permissions = await read('permissions', '/me/permissions', { limit: '100' });
    if (!Array.isArray(permissions.data) || permissions.paging?.next) throw new DiagnosticError('permission_inventory_incomplete_no_pagination');
    const granted = new Set(permissions.data.filter(p => p.status === 'granted').map(p => p.permission));
    report.permissions.present = REQUIRED_SCOPES.filter(p => debug.scopes.includes(p) && granted.has(p));
    report.permissions.absent = REQUIRED_SCOPES.filter(p => !debug.scopes.includes(p) || !granted.has(p));
    report.permissions.verified_by_debug_and_permissions = true;
    if (report.permissions.absent.length) throw new DiagnosticError('required_permissions_not_granted', 'insufficient_permission');
    // Do not infer asset IDs from permission names. The direct selected-Page read
    // below proves access/linkage without listing other Pages or fetching tokens.
    const page = await read('page_link', `/${selection.pageId}`, { fields: 'id,instagram_business_account{id}' });
    report.source_validation.page_matches = page.id === selection.pageId;
    report.source_validation.professional_link_matches = page.instagram_business_account?.id === selection.igUserId;
    if (!report.source_validation.page_matches) throw new DiagnosticError('selected_page_identity_not_verified');
    if (!report.source_validation.professional_link_matches) throw new DiagnosticError('professional_link_absent_not_shared_or_mismatched_cause_not_proven');
    const source = await read('source_ig', `/${selection.igUserId}`, { fields: 'id,username' });
    report.source_validation.ig_user_access_verified = source.id === selection.igUserId && typeof source.username === 'string' && !!source.username;
    if (!report.source_validation.ig_user_access_verified) throw new DiagnosticError('source_ig_identity_not_verified');
    const payload = await read('business_discovery', `/${selection.igUserId}`, { fields: DISCOVERY_FIELDS });
    const data = payload.business_discovery;
    if (!data || typeof data !== 'object') throw new DiagnosticError('business_discovery_not_returned_target_cause_unknown', 'unavailable_or_not_accessible');
    if (data.username !== TARGET) throw new DiagnosticError('discovery_target_identity_mismatch', 'api_error');
    if (!Array.isArray(data.media?.data)) throw new DiagnosticError('media_collection_missing_not_zero_posts', 'api_error');
    report.discovery.media_count = Number.isSafeInteger(data.media_count) && data.media_count >= 0 ? data.media_count : null;
    if (data.media.data.length > 5) throw new DiagnosticError('response_exceeds_five_media_limit', 'api_error');
    const seen = new Set();
    report.discovery.media = data.media.data.map(item => {
      const captionState = !Object.hasOwn(item, 'caption') ? 'absent' : item.caption === null ? 'null' : typeof item.caption !== 'string' ? 'invalid_type' : item.caption.trim() ? 'available' : 'empty';
      const caption = captionState === 'available' ? item.caption : null;
      const url = safePermalink(item.permalink);
      const duplicate = url ? seen.has(url) : false;
      if (url) seen.add(url);
      return { caption_state: captionState, caption_confirmed: caption !== null, caption: caption === null ? null : sanitize(caption).slice(0, 10000),
        caption_redacted_in_report: caption !== null && sanitize(caption) !== caption,
        caption_truncated_in_report: caption !== null && sanitize(caption).length > 10000,
        media_type: ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'].includes(item.media_type) ? item.media_type : null,
        timestamp: typeof item.timestamp === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:?\d\d)$/.test(item.timestamp) ? item.timestamp : null,
        permalink: url, duplicate_permalink: duplicate, source: 'official_business_discovery_media_caption',
        keyword: searchKeyword(caption), field_reasons: { caption: caption === null ? `api_caption_${captionState}` : null,
          permalink: url ? null : 'api_permalink_missing_or_not_a_public_instagram_post_url' } };
    });
    const media = report.discovery.media;
    report.discovery.returned_media = media.length;
    report.discovery.confirmed_captions = media.filter(m => m.caption_confirmed).length;
    report.discovery.captions_with_permalink = media.filter(m => m.caption_confirmed && m.permalink).length;
    report.discovery.matching_captions = report.discovery.confirmed_captions ? media.filter(m => m.keyword.accent_insensitive > 0).length : null;
    report.discovery.caption_coverage = media.length ? report.discovery.confirmed_captions / media.length : null;
    report.discovery.pagination_available = Boolean(data.media.paging?.next || data.media.paging?.cursors?.after);
    report.state = report.discovery.captions_with_permalink ? 'success' : !media.length && report.discovery.media_count === 0 ? 'no_publications' : !media.length ? 'empty_media_page' : 'partial';
    report.reason = report.state === 'success' ? 'real_api_caption_and_public_permalink_obtained' : report.state === 'no_publications' ? 'successful_api_response_with_zero_media_count' : 'caption_and_permalink_success_criterion_not_met';
  } catch (error) {
    report.state = error instanceof DiagnosticError ? error.state : 'diagnostic_error';
    report.reason = error instanceof DiagnosticError ? error.code : 'unexpected_error_raw_message_omitted';
    report.errors.push({ stage: report.requests.at(-1)?.stage || 'selection', code: report.reason, raw_error_omitted: true });
  }
  report.finished_at = new Date(now()).toISOString();
  // Redact string values recursively, never serialized JSON syntax.
  const clean = value => typeof value === 'string' ? sanitize(value) : Array.isArray(value) ? value.map(clean)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)])) : value;
  return clean(report);
}
