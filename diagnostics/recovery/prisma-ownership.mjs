// Explicit DDL boundary; never applied to the runtime Prisma Client schema.
import assert from 'node:assert/strict';
import { sections,literal } from './baseline-metadata.mjs';
import { diagnosticReadOnly } from './baseline-diagnostics.mjs';

export function migrationSchema(source,externalModels) {
  const removed=[];
  let schema=source.replace(/^model (\w+) \{[\s\S]*?^\}/gm,(block,name)=>{
    if(!externalModels.includes(name))return block;
    removed.push(name);return '';
  });
  assert.deepEqual(removed.sort(),[...externalModels].sort(),'External model set changed; review ownership');
  schema=schema.replace(/^generator client \{[\s\S]*?^\}\s*/m,'');
  assert(!/^model mastra_/m.test(schema),'Unclassified external model');
  return '// MIGRATIONS ONLY. Generate the runtime client from schema.prisma, never this file.\n'+schema;
}

const sqlList=names=>names.map(literal).join(',');
export function ownedMetadataSql(section,policy) {
  const external=`entity IN (${sqlList(policy.externalTables)})`;
  const excluded=section==='extras'
    ? `((${external}) AND (member LIKE 'trigger:%' OR member LIKE 'policy:%' OR member LIKE 'rule:%'))
       OR (entity='trigger_set_timestamps' AND member='routine:')`
    : ['tables','columns','constraints','indexes'].includes(section)?external:'false';
  // Do not restrict to a positive application allowlist: unknown tables/routines
  // remain visible. In particular, a new mastra_* name is NOT auto-exempted.
  return `SELECT * FROM (${sections[section].sql}) all_metadata WHERE NOT (${excluded})`;
}
export function ownedHashQuery(section,policy) {
  return `WITH metadata AS (${ownedMetadataSql(section,policy)})
 SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature)
 ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata`;
}

export function boundarySelect(policy,functionDigest) {
  return `WITH external_names AS (SELECT unnest(ARRAY[${sqlList(policy.externalTables)}]::text[]) AS name),
 external_relations AS (SELECT c.oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN external_names e ON e.name=c.relname WHERE n.nspname='public'),
 timestamp_routines AS (SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='trigger_set_timestamps'),
 violations AS (
  SELECT 'unclassified_mastra_name'::text AS category,c.relname::text AS object FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
   AND left(c.relname,7)='mastra_' AND NOT EXISTS(SELECT 1 FROM external_names e WHERE e.name=c.relname)
  UNION ALL
  SELECT 'external_relation_kind',relname FROM external_relations WHERE relkind NOT IN ('r','p')
  UNION ALL
  SELECT 'cross_boundary_fk',k.conname::text FROM pg_constraint k
   WHERE k.contype='f' AND ((k.conrelid IN (SELECT oid FROM external_relations)) <> (k.confrelid IN (SELECT oid FROM external_relations)))
  UNION ALL
  SELECT 'cross_boundary_inheritance',c.relname::text FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
   WHERE ((i.inhrelid IN (SELECT oid FROM external_relations)) <> (i.inhparent IN (SELECT oid FROM external_relations)))
  UNION ALL
  SELECT 'timestamps_on_non_external_relation',c.relname::text FROM pg_trigger t
   JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgfoid IN (SELECT oid FROM timestamp_routines)
   AND NOT t.tgisinternal AND t.tgrelid NOT IN (SELECT oid FROM external_relations)
  UNION ALL
  SELECT 'routine_recorded_non_external_dependency',c.relname::text FROM pg_depend d
   JOIN pg_class c ON c.oid=d.refobjid WHERE d.classid='pg_proc'::regclass
   AND d.refclassid='pg_class'::regclass AND d.objid IN (SELECT oid FROM timestamp_routines)
   AND d.refobjid NOT IN (SELECT oid FROM external_relations)
 ), results AS (
 SELECT v.category AS section,CASE WHEN EXISTS(SELECT 1 FROM violations x WHERE x.category=v.category) THEN 'MISMATCH' ELSE 'MATCH' END AS status
  FROM (VALUES ('unclassified_mastra_name'),('external_relation_kind'),('cross_boundary_fk'),('cross_boundary_inheritance'),
   ('timestamps_on_non_external_relation'),('routine_recorded_non_external_dependency')) v(category)
 UNION ALL
 SELECT 'timestamps_function_contract',CASE WHEN NOT EXISTS(SELECT 1 FROM timestamp_routines) THEN 'ABSENT_OPTIONAL'
  WHEN (SELECT count(*) FROM timestamp_routines)=1 AND EXISTS(SELECT 1 FROM timestamp_routines p
   WHERE p.pronargs=0 AND p.prokind='f' AND p.prorettype='trigger'::regtype
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=${literal(functionDigest)}) THEN 'MATCH' ELSE 'REVIEW_REQUIRED' END
 ) SELECT section,status FROM results ORDER BY section`;
}
export const boundaryQuery=(policy,functionDigest)=>`-- Only the ownership questions not answered by the previous locate.
-- Manual read-only execution; no application rows or function definitions returned.
${diagnosticReadOnly(boundarySelect(policy,functionDigest))}`;
