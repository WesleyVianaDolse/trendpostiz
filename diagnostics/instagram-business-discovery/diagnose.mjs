import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intentionally isolated from Nest, providers, jobs, Redis and OAuth. This
// reproduces the current prerequisite blocker; it is not an OAuth/API client.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const { parse } = require('dotenv');
const { Client } = require('pg');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const output = path.join(root, 'reports', 'instagram-business-discovery');
const run = path.join(output, new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(run, { recursive: true });

const sourceFiles = [
  'libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts',
  'libraries/nestjs-libraries/src/integrations/social/instagram.standalone.provider.ts',
  'libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts',
  'libraries/nestjs-libraries/src/database/prisma/schema.prisma',
  'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts',
  'apps/backend/src/services/instagram-comment-automations/instagram-media.service.ts'
];
const report = {
  diagnostic: 'instagram_business_discovery_v25', started_at: new Date().toISOString(),
  target_username: 'wesleydolse', api_version: 'v25.0', keyword: 'Estratégia',
  scope: { environment: 'local_checkout_configuration_only', production_configuration_inspected: false,
    database_read_only: true, token_values_read: false, oauth_executed: false,
    token_refresh_executed: false, scraping: false, playwright: false, deployment: false,
    publication: false, records_modified: false, providers_modified: false },
  code_evidence: [], providers: [], configuration: [], database: {}, integrations: null,
  eligibility: { state: 'unknown', authenticated_source: 'unknown', target_professional_account: 'unknown',
    target_public_account: 'not_verified_by_api', target_eligibility_not_inferred_from_public_web_visibility: true },
  token: { existence_in_database: 'unknown', valid: null, expired: null, type: null,
    reason: 'stored_tokens_not_accessible_no_live_validation' },
  permissions: { present: null, absent: null, live_verified: false,
    baseline_to_verify: ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement'],
    discovery_of_linked_pages_to_verify: ['pages_show_list'],
    conditional_business_manager_permissions: ['ads_management', 'ads_read'],
    note: 'Permission requirements need endpoint-specific official confirmation. Requested scopes in source code are not evidence of grants.' },
  api: { attempted: false, http_status: null, meta_error: null, requests_sent: 0,
    requested_fields_template: 'business_discovery.username(wesleydolse){username,media_count,media.limit(30){id,caption,media_type,timestamp,permalink}}',
    source_path_template: '/v25.0/{IG_USER_ID_OF_AUTHENTICATED_PROFESSIONAL_ACCOUNT}',
    request_limit: 30, pagination_attempted: false,
    pagination_plan: 'Keep Business Discovery field expansion on the authenticated source IG user; use the returned media cursor; do not fetch third-party media IDs as owned media; stop at 30 unique posts or error.',
    token_transport_if_later_validated: 'Authorization header; never report token, proof, cursor or request URL containing secrets.' },
  result: { state: 'not_executed', posts_returned: null, captions_available: null, captions_missing: null,
    matching_posts: null, matches: [], posts: [], mention_assessment: 'inconclusive_no_api_collection',
    empty_fields_reason: 'No authorized eligible source has been verified; null means not observed, not zero.' },
  keyword_search: { term: 'Estratégia', normalized_term: 'Estratégia'.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR'),
    unicode_normalization: 'NFD_then_remove_combining_marks', case_sensitive: false, accent_sensitive: false,
    evaluated: false, matches: null, reason: 'no_api_captions_collected' },
  error_taxonomy: {
    no_publications: 'Only a successful eligible response with media_count=0 can support this conclusion; an empty filtered page alone cannot.',
    no_caption: 'Only a returned media object without a nonempty caption; separate field absent, null and empty.',
    insufficient_permission: 'Verified missing required grants or a relevant Meta permission error; not inferred from missing credentials.',
    ineligible_account: 'Verified unsupported auth flow/account type, missing Page link, or explicit eligibility response; ambiguous object errors remain inconclusive.',
    expired_token: 'Meta debug_token expiration/validity evidence or explicit expiry subcode (e.g. 190/463); code 190 alone is invalid/revoked/expired ambiguity.',
    api_error: 'Other Meta failures, unsupported fields/version, rate limiting or malformed response; retain only numeric code/subcode, safe type and HTTP status.',
    environment_blocked: 'Prerequisite unavailable before Graph API request; no fabricated HTTP or Meta code.'
  },
  documentation: {
    checked_at: '2026-10-26', full_business_discovery_requirements_verified: false,
    version_v25_live_support_verified: false,
    sources: [
      { url: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery/',
        status: 'fetch_failed_http_429', supports: [], limitation: 'Endpoint-specific permissions, fields and pagination could not be reread.' },
      { url: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery/',
        status: 'fetch_failed_http_429', supports: [] },
      { url: 'https://developers.facebook.com/docs/instagram-platform/overview/', status: 'fetch_failed_http_429', supports: [] },
      { url: 'https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login',
        status: 'official_meta_collection_indexed_content_read', supports: ['Facebook Login requires a Facebook Page linked to a professional Instagram account.', 'General Facebook Login API can read basic metadata about other professional accounts.', 'Personal consumer accounts are unsupported.'],
        limitation: 'General collection permissions include unrelated publish/comment use cases; they are not the minimal Business Discovery requirements.' },
      { url: 'https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-3fe78620-2258-44b6-893f-42d76c7200d7',
        status: 'official_meta_collection_indexed_content_read', supports: ['Facebook and Instagram Login have different permission families.', 'Page access tokens and IG account identifiers have different purposes.'],
        limitation: 'Does not establish Business Discovery support through Instagram Standalone or v25.0 endpoint eligibility.' }
    ]
  },
  blockers: [], recommendations: [], errors: []
};

function configState(value) {
  if (!value?.trim()) return 'missing';
  return /^(?:your[-_ ]|change[-_ ]|replace[-_ ]|<|xxxxx|xxx$)/i.test(value) ? 'placeholder' : 'configured_not_validated';
}
let env = {};
let originalEnvHash = null;
try {
  const bytes = await fs.readFile(path.join(root, '.env'));
  originalEnvHash = sha(bytes);
  env = parse(bytes);
} catch (error) {
  report.errors.push({ stage: 'environment_read', code: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'ENV_READ_FAILED', raw_message_omitted: true });
}
env = { ...env, ...process.env };
try {
  report.repository_commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  for (const filename of sourceFiles) {
    const bytes = await fs.readFile(path.join(root, filename));
    report.code_evidence.push({ file: filename, sha256_before: sha(bytes) });
    if (filename.endsWith('.provider.ts')) {
      const text = bytes.toString('utf8');
      const scopes = [...(text.match(/scopes\s*=\s*\[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
      const identifier = text.match(/identifier\s*=\s*'([a-z-]+)'/)?.[1];
      report.providers.push({ identifier, file: filename,
        authentication: identifier === 'instagram-standalone' ? 'instagram_login' : 'facebook_login',
        graph_host: identifier === 'instagram-standalone' ? 'graph.instagram.com' : 'graph.facebook.com',
        requested_scopes_in_code: scopes, granted_scopes_live: null,
        business_discovery_route: identifier === 'instagram' ? 'candidate_for_readonly_validation_not_yet_eligible' : identifier === 'facebook' ? 'facebook_page_provider_not_an_ig_user_source' : 'not_validated_do_not_reuse_for_facebook_graph_discovery' });
    }
  }
  for (const key of ['DATABASE_URL', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET',
    'FACEBOOK_ACCESS_TOKEN', 'FACEBOOK_USER_ACCESS_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'IG_USER_ID']) {
    report.configuration.push({ key, state: configState(env[key]) });
  }
  report.configuration_evidence_note = 'Only names and presence states are recorded. Missing app credentials in this local environment do not prove absence in production or absence of tokens in the database.';
  report.database = { configured: !!env.DATABASE_URL, connected: false, read_only_verified: false, query_executed: false };
  if (!env.DATABASE_URL) report.blockers.push({ code: 'database_configuration_missing' });
  else {
    const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000,
      application_name: 'trend-business-discovery-readonly-audit' });
    try {
      await client.connect();
      report.database.connected = true;
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const flag = await client.query('SHOW transaction_read_only');
      report.database.read_only_verified = flag.rows[0]?.transaction_read_only === 'on';
      if (!report.database.read_only_verified) throw Object.assign(new Error('readonly_not_verified'), { code: 'READ_ONLY_NOT_VERIFIED' });
      // Boolean inventory only. Neither token values nor account/tenant IDs leave the DB.
      const rows = await client.query(`SELECT "providerIdentifier" AS provider,
        ("token" <> '') AS token_present, ("internalId" <> '') AS internal_id_present,
        ("facebookPageId" IS NOT NULL AND "facebookPageId" <> '') AS facebook_page_link_recorded,
        "disabled", ("deletedAt" IS NOT NULL) AS deleted, "refreshNeeded" AS refresh_needed,
        ("tokenExpiration" IS NOT NULL AND "tokenExpiration" <= CURRENT_TIMESTAMP) AS stored_expired
        FROM "Integration" WHERE "providerIdentifier" IN ('instagram','instagram-standalone','facebook')
        ORDER BY "providerIdentifier" LIMIT 100`);
      report.database.query_executed = true;
      report.integrations = rows.rows.map((row, index) => ({ reference: `local-candidate-${index + 1}`, ...row, live_token_validity: 'unknown' }));
      report.database.inventory_limit = 100;
      report.database.inventory_possibly_truncated = rows.rows.length === 100;
      report.token.existence_in_database = rows.rows.some(row => row.token_present) ? 'recorded_token_exists_not_live_validated' : rows.rows.length === 100 ? 'unknown_truncated_inventory' : 'none_in_inspected_meta_integrations';
      await client.query('ROLLBACK');
      report.blockers.push({ code: 'live_token_permission_and_account_validation_not_performed',
        reason: 'This inventory never reads secret values; boolean presence cannot establish eligibility.' });
    } catch (error) {
      const safeCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '28P01', '3D000', '42P01', 'READ_ONLY_NOT_VERIFIED'];
      const code = safeCodes.includes(error.code) ? error.code : 'DATABASE_PREFLIGHT_FAILED';
      report.database.error = { code, raw_message_omitted: true };
      report.blockers.push({ code: code === 'ECONNREFUSED' ? 'database_connection_refused' : 'database_preflight_failed', error_code: code });
    } finally { await client.end().catch(() => {}); }
  }
  report.blockers.push({ code: 'business_discovery_official_reference_not_revalidated', http_status: 429,
    scope: 'documentation_fetch_not_graph_api', reason: 'Do not claim current v25.0 endpoint requirements fully verified from an inaccessible reference.' });
  report.eligibility.state = 'not_established';
  report.result.state = 'environment_blocked';
  report.api.not_attempted_reason = 'no_live_validated_token_permissions_and_linked_professional_source';
  report.recommendations = [
    { topic: 'viability', decision: 'conditional_not_demonstrated', text: 'The Facebook Login provider is the candidate route for this experiment. No evidence from this environment proves that Business Discovery works for wesleydolse on v25.0.' },
    { topic: 'production', text: 'No production connection, OAuth, refresh, deployment, configuration or record change was performed. Do not infer production eligibility from this local checkout.' },
    { topic: 'next_readonly_run', text: 'Use an already authorized read-only access path to the intended environment. Select one explicit existing integration and tenant; verify actual token type/validity, granted scopes and the Page-to-professional-IG link before calling the target. Do not request tokens through chat or create new OAuth grants.' },
    { topic: 'token_type', text: 'saveProviderPage stores a Page token in Integration.token and the IG user ID in internalId. Page ID, IG user ID and Facebook user ID must not be interchanged. Verify the original Facebook user-token context rather than assuming the publication token is eligible.' },
    { topic: 'multiclient', text: 'Keep tenant-specific authorization and token isolation. Require the appropriate reviewed access level/app mode for external clients; validate that status in Meta before rollout. A provider scope array is not proof of Advanced Access or granted permissions.' },
    { topic: 'coverage', text: 'Treat professional-account coverage and returned captions as explicit limits. For each client, track cursor progress, deduplication, API rate-limit headers, token validity and missing captions. Do not promise monitoring of arbitrary personal accounts or complete keyword coverage.' },
    { topic: 'release_gate', text: 'Keep this as an isolated diagnostic until at least one real caption and permalink are obtained through the approved Graph route, followed by a multiclient permission/quota review. Do not change the existing login or publishing flows to run this test.' }
  ];
} catch (error) {
  report.result.state = 'diagnostic_error';
  report.errors.push({ stage: 'audit', code: 'AUDIT_FAILED', raw_message_omitted: true });
}
finally {
  for (const item of report.code_evidence) {
    try { item.preserved = sha(await fs.readFile(path.join(root, item.file))) === item.sha256_before; }
    catch { item.preserved = false; }
  }
  report.environment_file_preserved = originalEnvHash ? sha(await fs.readFile(path.join(root, '.env'))) === originalEnvHash : null;
  report.finished_at = new Date().toISOString();
  const json = JSON.stringify(report, null, 2);
  // Exact-value leak check stays in memory. Never print the offending value.
  const sensitiveValues = Object.entries(env).filter(([key, value]) => value && /(?:TOKEN|SECRET|PASSWORD|DATABASE_URL)/.test(key)).map(([, value]) => value);
  if (sensitiveValues.some(value => value.length >= 8 && json.includes(value))) throw new Error('Report rejected by secret leak check; no report was written.');
  const filename = 'relatorio-business-discovery-v25.json';
  await fs.writeFile(path.join(run, filename), json, 'utf8');
  await fs.writeFile(path.join(output, filename), json, 'utf8');
  if (report.result.state === 'diagnostic_error' || report.code_evidence.some(item => !item.preserved) || report.environment_file_preserved === false) process.exitCode = 1;
  console.log(JSON.stringify({ state: report.result.state, api_attempted: report.api.attempted,
    database_connected: report.database.connected, report: path.join(output, filename),
    snapshots: run, sources_preserved: report.code_evidence.every(item => item.preserved) }, null, 2));
}
