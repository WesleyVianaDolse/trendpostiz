import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { API_VERSION, TARGET, DISCOVERY_FIELDS, REQUIRED_SCOPES, SELECTION_SQL, DiagnosticError,
  investigate, lookupSelectedIntegration, classifyMetaFailure, officialGET, searchKeyword } from './core.mjs';
import { parseArgs, validateExecutionArgs } from './run.mjs';

const selection = { tenantId: 'tenant-authorized', integrationId: 'integration-authorized', igUserId: '17841400123456', pageId: '10101234567890', appId: '30101234567890' };
const token = 'DIAGNOSTIC_USER_TOKEN_ONLY_MEMORY_ABC';
const verifierToken = 'DIAGNOSTIC_VERIFIER_ONLY_MEMORY_DEF';
const now = () => Date.parse('2026-10-26T21:00:00Z');
const row = { providerIdentifier: 'instagram', internalId: selection.igUserId, facebookPageId: selection.pageId, disabled: false, deletedAt: null, inBetweenSteps: false };
function fixture(overrides = {}) {
  const requests = [], lookups = [];
  const responses = {
    token_debug: { data: { is_valid: true, type: 'USER', app_id: selection.appId, user_id: '44444444444444',
      expires_at: Math.floor(now() / 1000) + 3600, data_access_expires_at: Math.floor(now() / 1000) + 7200, scopes: [...REQUIRED_SCOPES] } },
    permissions: { data: REQUIRED_SCOPES.map(permission => ({ permission, status: 'granted' })) },
    page_link: { id: selection.pageId, instagram_business_account: { id: selection.igUserId } },
    source_ig: { id: selection.igUserId, username: 'authorized-origin-not-exported' },
    business_discovery: { id: selection.igUserId, business_discovery: { username: TARGET, media_count: 12, media: { data: [
      { caption: 'Estratégia, ESTRATEGIA e estrate\u0301gia.', media_type: 'IMAGE', timestamp: '2026-09-08T15:00:00+0000', permalink: 'https://www.instagram.com/p/DdBtKrxnQL5/?igsh=omit' }
    ], paging: { cursors: { after: 'PRIVATE_CURSOR' } } } } }
  };
  const stages = Object.keys(responses);
  return { requests, lookups, responses, async run() {
    return investigate({ selection, token, verifierToken, now, authorizationConfirmed: true,
      lookup: async selected => { lookups.push(selected); return overrides.row === undefined ? row : overrides.row; },
      request: async (url, credential) => {
        const stage = stages[requests.length];
        requests.push({ stage, url: new URL(url), credential });
        if (overrides.throwStage === stage) throw new Error(`Unexpected transport error ${token} ${url}`);
        return overrides[stage] || { status: 200, body: responses[stage] };
      }, ...overrides.options });
  } };
}

test('one fixed discovery request follows exact tenant selection and four official validations', async () => {
  const f = fixture(), report = await f.run();
  assert.equal(report.state, 'success');
  assert.equal(report.request_count, 5);
  assert.equal(report.business_discovery_requests, 1);
  assert.deepEqual(f.lookups, [selection]);
  for (const item of f.requests) { assert.equal(item.url.origin, 'https://graph.facebook.com'); assert.ok(item.url.pathname.startsWith(`/${API_VERSION}/`)); }
  assert.equal(f.requests[0].credential, verifierToken);
  assert.equal(f.requests.at(-1).url.searchParams.get('fields'), DISCOVERY_FIELDS);
  assert.equal(report.discovery.returned_media, 1);
  assert.equal(report.discovery.confirmed_captions, 1);
  assert.equal(report.discovery.captions_with_permalink, 1);
  assert.equal(report.discovery.media[0].keyword.accent_insensitive, 3);
  assert.equal(report.discovery.media[0].permalink, 'https://www.instagram.com/p/DdBtKrxnQL5/');
  assert.equal(report.discovery.pagination_available, true);
  const json = JSON.stringify(report);
  for (const secret of [token, verifierToken, selection.tenantId, selection.integrationId, selection.igUserId, selection.pageId, selection.appId, 'PRIVATE_CURSOR', 'authorized-origin-not-exported', '44444444444444']) assert.equal(json.includes(secret), false, 'private material exported');
});

test('no authorization, wrong tenant or wrong provider never causes a Graph request', async () => {
  for (const options of [ { options: { authorizationConfirmed: false } }, { row: null }, { row: { ...row, providerIdentifier: 'instagram-standalone' } }, { row: { ...row, internalId: 'wrong-ig' } }, { row: { ...row, disabled: true } } ]) {
    const f = fixture(options), report = await f.run();
    assert.equal(report.state, 'validation_blocked'); assert.equal(f.requests.length, 0);
  }
});

test('PAGE and other-app tokens are not converted or retried', async () => {
  for (const change of [{ type: 'PAGE' }, { app_id: '99999999999999' }, { user_id: undefined }]) {
    const f = fixture(); Object.assign(f.responses.token_debug.data, change);
    const report = await f.run(); assert.equal(report.state, 'validation_blocked'); assert.equal(f.requests.length, 1);
  }
});

test('expired token and expired data-access stop before permission or discovery reads', async () => {
  for (const [field, expected] of [['expires_at', 'token_expired'], ['data_access_expires_at', 'token_data_access_expired']]) {
    const f = fixture(); f.responses.token_debug.data[field] = now() / 1000 - 1;
    const report = await f.run(); assert.equal(report.state, expected); assert.equal(f.requests.length, 1);
  }
});

test('grants must agree in debug_token and me/permissions; declined scope prevents discovery', async () => {
  const f = fixture(); f.responses.permissions.data[1].status = 'declined';
  const report = await f.run();
  assert.equal(report.state, 'insufficient_permission');
  assert.deepEqual(report.permissions.absent, ['instagram_manage_insights']);
  assert.equal(f.requests.length, 2);
});

test('Page linkage or IG source mismatch blocks before discovery without declaring personal account', async () => {
  const f = fixture(); f.responses.page_link.instagram_business_account = null;
  const report = await f.run();
  assert.equal(report.state, 'validation_blocked'); assert.equal(f.requests.length, 3);
  assert.match(report.reason, /cause_not_proven/);
});

test('incomplete permission inventory has no automatic pagination', async () => {
  const f = fixture(); f.responses.permissions.paging = { next: 'https://evil.example/?token=SECRET' };
  const report = await f.run(); assert.equal(report.state, 'validation_blocked'); assert.equal(f.requests.length, 2);
});

test('generic 190, permission policy, ambiguous 100, rate limit and explicit expiry remain distinct', () => {
  const cases = [
    [{ code: 190 }, 400, 'token_invalid'], [{ code: 190, subcode: 463 }, 400, 'token_expired'],
    [{ code: 10 }, 400, 'permission_or_policy_denied'], [{ code: 100 }, 400, 'unavailable_or_not_accessible'],
    [{ code: 4 }, 400, 'rate_limited'], [null, 429, 'rate_limited'], [null, 503, 'api_error']
  ];
  for (const [meta, status, state] of cases) assert.equal(classifyMetaFailure(meta, status).state, state);
});

test('sanitized official denial is preserved; raw message, trace ID and secrets are not', async () => {
  const f = fixture({ business_discovery: { status: 400, body: { error: { code: 100, type: 'OAuthException',
    message: `Unsupported get request for ${selection.igUserId}; ${token}`, fbtrace_id: 'PRIVATE_TRACE' } } } });
  const report = await f.run();
  assert.equal(report.state, 'unavailable_or_not_accessible');
  assert.equal(report.discovery.http_status, 400);
  assert.equal(report.discovery.returned_media, null);
  assert.equal(report.requests.at(-1).meta_error.code, 100);
  assert.equal(JSON.stringify(report).includes('PRIVATE_TRACE'), false);
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.equal(f.requests.length, 5);
});

test('missing, null, empty captions and missing permalinks do not meet success criterion', async () => {
  const f = fixture(); f.responses.business_discovery.business_discovery.media.data = [
    {}, { caption: null }, { caption: '' }, { caption: 'Legendas sem URL' }
  ];
  const report = await f.run();
  assert.equal(report.state, 'partial'); assert.equal(report.discovery.confirmed_captions, 1);
  assert.deepEqual(report.discovery.media.map(m => m.caption_state), ['absent', 'null', 'empty', 'available']);
  assert.equal(report.discovery.captions_with_permalink, 0);
});

test('zero media_count, empty filtered page and missing collection are different', async () => {
  for (const [count, data, state] of [[0, [], 'no_publications'], [20, [], 'empty_media_page'], [0, undefined, 'api_error']]) {
    const f = fixture(); f.responses.business_discovery.business_discovery.media_count = count;
    f.responses.business_discovery.business_discovery.media.data = data;
    const report = await f.run(); assert.equal(report.state, state); assert.equal(report.discovery.matching_captions, null);
  }
});

test('errors containing request URLs and secrets cannot escape report redaction boundary', async () => {
  const report = await fixture({ throwStage: 'token_debug' }).run();
  assert.equal(report.state, 'network_error'); assert.equal(report.request_count, 1);
  assert.equal(JSON.stringify(report).includes(token), false);
  const f = fixture(); f.responses.business_discovery.business_discovery.media.data[0].caption = `Estratégia ${token} Bearer ${verifierToken}`;
  const redacted = await f.run(); assert.equal(redacted.discovery.media[0].caption_redacted_in_report, true);
  assert.equal(JSON.stringify(redacted).includes(token), false);
});

test('Unicode variants are counted separately and folded without matching other words', () => {
  assert.deepEqual(searchKeyword('ESTRATÉGIA estrategia estrate\u0301gia estratégias estrategicamente'), { evaluated: true, accented: 2, unaccented: 1, accent_insensitive: 3 });
  assert.equal(searchKeyword(null).accent_insensitive, null);
});

test('DB lookup is exact, parameterized, read-only and never selects token columns', async () => {
  const calls = [];
  class Client {
    constructor(options) { assert.match(options.options, /default_transaction_read_only=on/); }
    async connect() { calls.push('connect'); }
    async query(sql, values) {
      calls.push({ sql, values });
      return sql === 'SHOW transaction_read_only' ? { rows: [{ transaction_read_only: 'on' }] } : { rows: [row] };
    }
    async end() { calls.push('end'); }
  }
  await lookupSelectedIntegration({ Client, databaseURL: 'test-only-secret', selection });
  assert.ok(calls.some(c => c.sql === 'BEGIN READ ONLY'));
  assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
  const query = calls.find(c => c.sql === SELECTION_SQL);
  assert.deepEqual(query.values, [selection.tenantId, selection.integrationId]);
  assert.match(query.sql, /"organizationId" = \$1 AND "id" = \$2/);
  assert.doesNotMatch(query.sql, /\btoken\b|refreshToken|SELECT\s+\*/i);
});

test('SQL read-only failure never selects the integration', async () => {
  const queries = [];
  class Client { async connect() {} async end() {} async query(sql) { queries.push(sql); return { rows: [{ transaction_read_only: 'off' }] }; } }
  await assert.rejects(lookupSelectedIntegration({ Client, databaseURL: 'unused', selection }), /readonly_transaction_not_verified/);
  assert.equal(queries.includes(SELECTION_SQL), false);
});

test('TLS transport rejects any other host before contacting network', async () => {
  await assert.rejects(officialGET(new URL('https://evil.example/v25.0/debug_token'), token), /request_outside_graph_allowlist/);
  await assert.rejects(officialGET(new URL('http://graph.facebook.com/v25.0/debug_token'), token), /request_outside_graph_allowlist/);
});

test('CLI rejects literal tokens, duplicate flags, unsafe selectors and reports inside app', () => {
  assert.throws(() => parseArgs(['--token', 'SECRET']), /unknown_cli_option/);
  assert.throws(() => parseArgs(['--execute', '--execute']), /duplicate/);
  assert.throws(() => parseArgs(['--execute', '--dry-run']), /conflicting/);
  const valid = { 'tenant-id': selection.tenantId, 'integration-id': selection.integrationId,
    'expected-ig-user-id': selection.igUserId, 'expected-page-id': selection.pageId, 'expected-app-id': selection.appId,
    'authorization-ref': 'CHG-approved-example', 'requirements-reviewed': true,
    'app-root': process.platform === 'win32' ? 'C:\\app' : '/app',
    report: process.platform === 'win32' ? 'C:\\outside\\report.json' : '/outside/report.json', 'token-fd': '3', 'database-fd': '5' };
  assert.deepEqual(validateExecutionArgs(valid), selection);
  assert.throws(() => validateExecutionArgs({ ...valid, report: `${valid['app-root']}/report.json` }), /outside_production_app/);
  assert.throws(() => validateExecutionArgs({ ...valid, 'database-fd': '3' }), /distinct/);
  assert.throws(() => validateExecutionArgs({ ...valid, 'requirements-reviewed': false }), /approval/);
});

test('default CLI and dry-run do not read descriptors, credentials, DB or network', () => {
  const child = spawnSync(process.execPath, ['run.mjs', '--dry-run', '--token-fd', '63', '--database-fd', '64'], { cwd: import.meta.dirname, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0);
  const result = JSON.parse(child.stdout);
  assert.equal(result.mode, 'dry_run'); assert.equal(result.network_requests, 0); assert.equal(result.database_queries, 0); assert.equal(result.secrets_read, false);
});

test('debugger verifier failure does not mark the diagnostic credential expired or invalid', async () => {
  const f = fixture({ token_debug: { status: 400, body: { error: { code: 190, error_subcode: 463, type: 'OAuthException', message: 'Verifier expired' } } } });
  const report = await f.run();
  assert.equal(report.state, 'token_inspection_failed');
  assert.equal(report.token_validation.valid, null);
  assert.equal(report.token_validation.expired, null);
  assert.equal(report.requests[0].meta_error.code, 190);
  assert.equal(f.requests.length, 1);
});

test('reported granular scope for a different asset blocks before discovery without enumerating assets', async () => {
  const f = fixture();
  f.responses.token_debug.data.granular_scopes = [{ scope: 'instagram_manage_insights', target_ids: ['another-customer-private-asset'] }];
  const report = await f.run();
  assert.equal(report.state, 'insufficient_permission');
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.stringify(report).includes('another-customer-private-asset'), false);
});
