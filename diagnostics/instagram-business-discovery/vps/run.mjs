#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DISCOVERY_FIELDS, DiagnosticError, investigate, lookupSelectedIntegration, validateSelection } from './core.mjs';

const HELP = `Diagnóstico 005: somente leitura, destino fixo wesleydolse, Graph v25.0.
Sem --execute: plano offline; não abre banco, descritores ou rede.

node run.mjs --dry-run

Após aprovação, parâmetros obrigatórios:
  --execute --authorization-ref CHG-123 --requirements-reviewed
  --app-root /caminho/trendpostiz
  --tenant-id TENANT --integration-id INTEGRATION
  --expected-ig-user-id IG_ID --expected-page-id PAGE_ID --expected-app-id APP_ID
  --token-fd 3 --database-fd 5 [--verifier-fd 4]
  --report /diretorio-fora-do-app/relatorio-005.json

Descritores devem conter credenciais existentes em memória. Não há parâmetro
de token literal, arquivo de token, App Secret, novo OAuth ou refresh.
--verifier-fd é opcional: por padrão a credencial de diagnóstico é usada também
na leitura oficial debug_token; se isso não for aceito pela Meta, o teste para.
Veja RUNBOOK.md antes de executar. --requirements-reviewed é a declaração do
operador de que revisou os requisitos oficiais atuais e as condições do app.
`;

export function parseArgs(args) {
  const valueKeys = new Set(['app-root', 'tenant-id', 'integration-id', 'expected-ig-user-id', 'expected-page-id', 'expected-app-id', 'authorization-ref', 'token-fd', 'database-fd', 'verifier-fd', 'report']);
  const flags = new Set(['execute', 'dry-run', 'requirements-reviewed', 'help']);
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) throw new DiagnosticError('unexpected_cli_argument');
    const key = arg.slice(2);
    if (Object.hasOwn(result, key)) throw new DiagnosticError('duplicate_cli_argument');
    if (flags.has(key)) result[key] = true;
    else if (valueKeys.has(key)) {
      const value = args[++index];
      if (!value || value.startsWith('--') || /[\r\n\x00]/.test(value)) throw new DiagnosticError('missing_or_invalid_cli_value');
      result[key] = value;
    } else throw new DiagnosticError('unknown_cli_option');
  }
  if (result.execute && result['dry-run']) throw new DiagnosticError('conflicting_execution_modes');
  return result;
}

export function validateExecutionArgs(options) {
  const selection = { tenantId: options['tenant-id'], integrationId: options['integration-id'], igUserId: options['expected-ig-user-id'], pageId: options['expected-page-id'], appId: options['expected-app-id'] };
  validateSelection(selection);
  if (!/^CHG-[A-Za-z0-9-]{1,40}$/.test(options['authorization-ref'] || '') || !options['requirements-reviewed']) throw new DiagnosticError('operator_approval_and_requirements_review_required');
  if (!path.isAbsolute(options['app-root'] || '') || !path.isAbsolute(options.report || '')) throw new DiagnosticError('absolute_app_and_report_paths_required');
  const relative = path.relative(path.resolve(options['app-root']), path.resolve(options.report));
  if (!relative || !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new DiagnosticError('report_must_be_outside_production_app');
  const descriptors = ['token-fd', 'database-fd', ...(options['verifier-fd'] ? ['verifier-fd'] : [])].map(key => {
    if (!/^(?:[3-9]|[1-5][0-9]|6[0-4])$/.test(options[key] || '')) throw new DiagnosticError('distinct_secret_descriptors_3_to_64_required');
    return Number(options[key]);
  });
  if (new Set(descriptors).size !== descriptors.length) throw new DiagnosticError('secret_descriptors_must_be_distinct');
  return selection;
}

async function readSecretDescriptor(fd) {
  // Only the explicitly selected descriptors are read. No environment/.env scan.
  // Bounded reads avoid reading an unbounded input stream into memory.
  const handle = await fs.open(`/dev/fd/${fd}`, 'r');
  const bytes = Buffer.alloc(65537);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > 65536) throw new DiagnosticError('secret_descriptor_too_large');
    const result = bytes.subarray(0, offset).toString('utf8').replace(/[\r\n]+$/, '');
    bytes.fill(0);
    if (!result || /[\x00\r\n]/.test(result)) throw new DiagnosticError('invalid_secret_descriptor');
    return result;
  } finally { bytes.fill(0); await handle.close(); }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) { console.log(HELP); return; }
  if (!options.execute) {
    console.log(JSON.stringify({ mode: 'dry_run', execution_performed: false, network_requests: 0, database_queries: 0,
      secrets_read: false, requires_approval_before_vps_execution: true,
      plan: ['Read exactly one integration using tenant AND integration ID; never select a token column.',
        'Validate explicit in-memory USER token through debug_token and me/permissions.',
        'Confirm selected app, Page-to-professional-IG link and source IG access.',
        'One Business Discovery request only; no retry, pagination or other profile.'], fields: DISCOVERY_FIELDS }, null, 2));
    return;
  }
  const selection = validateExecutionArgs(options);
  // No insecure TLS or debug/preload instrumentation is allowed in this process.
  if (process.env.NODE_DEBUG || process.env.NODE_OPTIONS || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
    || process.execArgv.length) throw new DiagnosticError('debug_instrumentation_or_insecure_tls_not_allowed');
  if (process.platform !== 'linux') throw new DiagnosticError('live_descriptor_mode_requires_linux_vps');
  const appRoot = await fs.realpath(options['app-root']);
  const parent = await fs.realpath(path.dirname(options.report));
  const relativeParent = path.relative(appRoot, parent);
  if (!relativeParent || !relativeParent.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeParent)) throw new DiagnosticError('resolved_report_directory_inside_app');
  // Reserve a new, owner-only report before any credential, DB or API access.
  // O_EXCL prevents accidental overwrites or following an existing symlink.
  const handle = await fs.open(path.join(parent, path.basename(options.report)), 'wx', 0o600);
  let token, verifierToken, databaseURL;
  try {
    const require = createRequire(path.join(appRoot, 'package.json'));
    const { Client } = require('pg'); // Resolve the already installed dependency; never install/start services.
    token = await readSecretDescriptor(Number(options['token-fd']));
    verifierToken = options['verifier-fd'] ? await readSecretDescriptor(Number(options['verifier-fd'])) : token;
    databaseURL = await readSecretDescriptor(Number(options['database-fd']));
    const report = await investigate({ selection, token, verifierToken, authorizationConfirmed: true,
      lookup: selected => lookupSelectedIntegration({ Client, databaseURL, selection: selected }) });
    report.operator_approval_reference_provided = true;
    report.current_official_requirements_reviewed_by_operator = true;
    report.runtime = { production_application_started: false, read_only_database_selection: true };
    const json = JSON.stringify(report, null, 2);
    if ([token, verifierToken, databaseURL].some(secret => secret && json.includes(secret))) throw new DiagnosticError('report_rejected_by_secret_leak_check');
    await handle.writeFile(json, 'utf8');
    console.log(JSON.stringify({ state: report.state, reason: report.reason, request_count: report.request_count,
      business_discovery_requests: report.business_discovery_requests, returned_media: report.discovery.returned_media,
      confirmed_captions: report.discovery.confirmed_captions, report_written: true }));
    if (report.state !== 'success') process.exitCode = 2;
  } catch (err) {
    const code = err instanceof DiagnosticError ? err.code : 'local_execution_failed_raw_error_omitted';
    await handle.truncate(0);
    await handle.writeFile(JSON.stringify({ diagnostic: '005', state: 'environment_blocked', reason: code,
      criteria_met: false, secrets_omitted: true }, null, 2), 'utf8');
    throw new DiagnosticError(code, 'environment_blocked');
  } finally {
    token = verifierToken = databaseURL = undefined;
    await handle.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(); }
  catch (err) { console.error(JSON.stringify({ state: 'not_completed', reason: err instanceof DiagnosticError ? err.code : 'local_error_raw_message_omitted' })); process.exitCode = 1; }
}
