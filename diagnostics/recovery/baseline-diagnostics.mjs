// Follow-up diagnostics only. No connections, no replacement baseline, no
// semantic normalization of SQL expressions, names or collation versions.
import { sections,literal,locateSelect,detailSelect } from './baseline-metadata.mjs';

export const diagnosticSettings=`SET LOCAL search_path=pg_catalog,public,pg_temp;
SET LOCAL DateStyle='ISO, MDY';
SET LOCAL IntervalStyle='postgres';
SET LOCAL TimeZone='UTC';
SET LOCAL extra_float_digits=1;
SET LOCAL bytea_output='hex';
SET LOCAL standard_conforming_strings=on;`;
export const sessionContextSql=`SELECT jsonb_build_object(
 'server_version_num',current_setting('server_version_num'),
 'server_encoding',current_setting('server_encoding'),'client_encoding',current_setting('client_encoding'),
 'DateStyle',current_setting('DateStyle'),'IntervalStyle',current_setting('IntervalStyle'),
 'TimeZone',current_setting('TimeZone'),'extra_float_digits',current_setting('extra_float_digits'),
 'bytea_output',current_setting('bytea_output'),'standard_conforming_strings',current_setting('standard_conforming_strings'),
 'has_public_usage',has_schema_privilege(current_user,'public','USAGE')) AS settings`;
export const environmentSql=`SELECT jsonb_build_object(
 'provider',d.datlocprovider::text,'collation',d.datcollate,'ctype',d.datctype,
 'provider_locale',d.datlocale,'icu_rules_present',d.daticurules IS NOT NULL,
 'icu_rules_sha256',CASE WHEN d.daticurules IS NOT NULL THEN encode(sha256(convert_to(d.daticurules,'UTF8')),'hex') END,
 'stored_collation_version',d.datcollversion,'actual_collation_version',pg_database_collation_actual_version(d.oid),
 'stored_version_matches_runtime',d.datcollversion IS NOT DISTINCT FROM pg_database_collation_actual_version(d.oid)
) AS settings FROM pg_database d WHERE d.datname=current_database()`;

export const diagnosticReadOnly=sql=>`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='15s';
${diagnosticSettings}
${sql};
ROLLBACK;
`;

// Uses exactly the existing per-object locate hashes. No matching objects or
// raw definitions are returned. Constraints/indexes are located by table first;
// detail queries are generated only once the affected tables are identified.
export function reportedLocateQuery(contract,report) {
  const priority=['tables','columns','constraints','indexes','extras'];
  const selected=priority.filter(s=>report.sections[s]==='MISMATCH');
  if(!selected.length)throw Error('No reported structural mismatches to locate');
  const queries=selected.map((section,i)=>`SELECT ${i+1} AS priority,${literal(section)} AS section,l.object,l.status
 FROM (${locateSelect(section,contract.sections[section].entities)}) l`);
  const reference=contract.sections.database.rows[0].signature;
  const referenceDatabase={provider:reference[0],collation:reference[1],ctype:reference[2],stored_collation_version:reference[3]};
  // Capture the original display settings before pinning them for deparsing.
  // All names/functions are catalog-qualified by search_path; pg_temp is last.
  return `-- FOLLOW-UP ONLY: production-check.sql already ran; do not repeat it.
-- Copy/paste the whole script into a manual session outside an existing transaction.
-- Result 1: safe environment/session context. Result 2: divergent object names only.
-- No application rows, DDL, schema dump, SQL bodies, defaults, secrets, DB/user/host names.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL search_path=pg_catalog,public,pg_temp;
WITH environment AS (${environmentSql}),session AS (${sessionContextSql})
SELECT 'database' AS section,${literal(JSON.stringify(referenceDatabase))}::jsonb AS reference_environment,
 environment.settings AS actual_environment,session.settings AS initial_session FROM environment CROSS JOIN session;
${diagnosticSettings}
WITH differences AS (
${queries.join('\nUNION ALL\n')}
)
SELECT section,object,status FROM differences ORDER BY priority,object COLLATE "C";
ROLLBACK;
`;
}

export function targetedDetailQuery(contract,section,entity,member) {
  if(!Object.hasOwn(sections,section))throw Error('Unknown metadata section');
  return diagnosticReadOnly(detailSelect(section,entity,contract.sections[section].rows,member));
}
