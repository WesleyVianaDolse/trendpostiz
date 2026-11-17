// Metadata only. Signatures are hashed in PostgreSQL before leaving the server.
// No row values, sequence counters, default literals or function bodies returned
// by the generated production checks. C ordering avoids locale-dependent name
// sorting and the signatures do not contain instance OIDs. These are STRICT
// catalog/deparser fingerprints, not proofs of semantic SQL equivalence.
export const sections = {
  database: {
    fields:['locale_provider','collation','ctype','collation_version'],
    sql:`SELECT '__database__'::text AS entity,'locale'::text AS member,
      jsonb_build_array(d.datlocprovider::text,d.datcollate,d.datctype,d.datcollversion) AS signature
      FROM pg_database d WHERE d.datname=current_database()`,
  },
  tables: {
    fields:['kind','persistence','row_security','force_row_security','partition','partition_key','parents'],
    sql:`SELECT c.relname::text AS entity, c.relname::text AS member,
      jsonb_build_array(c.relkind::text,c.relpersistence::text,c.relrowsecurity,c.relforcerowsecurity,
        c.relispartition,pg_get_partkeydef(c.oid),
        (SELECT jsonb_agg(pn.nspname||'.'||pc.relname ORDER BY pn.nspname COLLATE "C",pc.relname COLLATE "C")
         FROM pg_inherits i JOIN pg_class pc ON pc.oid=i.inhparent JOIN pg_namespace pn ON pn.oid=pc.relnamespace WHERE i.inhrelid=c.oid)) AS signature
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'`,
  },
  columns: {
    fields:['name','type','type_schema','type_name','type_kind','not_null','default','identity','generated','dimensions','collation'],
    sql:`SELECT c.relname::text AS entity,a.attname::text AS member,
      jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),tn.nspname,t.typname,t.typtype::text,
        a.attnotnull,pg_get_expr(d.adbin,d.adrelid,false),a.attidentity::text,a.attgenerated::text,a.attndims,
        CASE WHEN co.oid IS NOT NULL THEN cn.nspname||'.'||co.collname END) AS signature
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'`,
  },
  constraints: {
    fields:['kind','definition','validated','deferrable','deferred','delete_action','update_action','match_type'],
    sql:`SELECT c.relname::text AS entity,k.conname::text AS member,
      jsonb_build_array(k.contype::text,pg_get_constraintdef(k.oid,false),k.convalidated,k.condeferrable,
        k.condeferred,k.confdeltype::text,k.confupdtype::text,k.confmatchtype::text) AS signature
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'`,
  },
  indexes: {
    fields:['definition','unique','primary','exclusion','valid','ready','live','nulls_not_distinct','immediate','options'],
    sql:`SELECT c.relname::text AS entity,ic.relname::text AS member,
      jsonb_build_array(pg_get_indexdef(i.indexrelid,0,false),i.indisunique,i.indisprimary,i.indisexclusion,
        i.indisvalid,i.indisready,i.indislive,i.indnullsnotdistinct,i.indimmediate,ic.reloptions) AS signature
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class ic ON ic.oid=i.indexrelid
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations'`,
  },
  enums: {
    fields:['label','position'],
    sql:`SELECT t.typname::text AS entity,e.enumlabel::text AS member,
      jsonb_build_array(e.enumlabel,row_number() OVER(PARTITION BY t.oid ORDER BY e.enumsortorder)) AS signature
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
      WHERE n.nspname='public'`,
  },
  extras: {
    fields:['definition','state_or_mode','attributes','check','roles'],
    sql:`SELECT c.relname::text AS entity,('trigger:'||t.tgname)::text AS member,
        jsonb_build_array(pg_get_triggerdef(t.oid,false),t.tgenabled::text) AS signature
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal
      UNION ALL
      SELECT c.relname,('policy:'||p.polname),jsonb_build_array(p.polcmd::text,p.polpermissive,
        pg_get_expr(p.polqual,p.polrelid,false),pg_get_expr(p.polwithcheck,p.polrelid,false),
        (SELECT jsonb_agg(r.rolname ORDER BY r.rolname COLLATE "C") FROM pg_roles r WHERE r.oid=ANY(p.polroles)))
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT c.relname,('view:'||c.relkind::text),jsonb_build_array(pg_get_viewdef(c.oid,false),c.reloptions)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')
      UNION ALL
      SELECT p.proname,('routine:'||pg_get_function_identity_arguments(p.oid)),jsonb_build_array(pg_get_functiondef(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p','w')
      UNION ALL
      SELECT c.relname,'sequence',jsonb_build_array(format_type(s.seqtypid,NULL),s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle)
      FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT c.relname,('rule:'||r.rulename),jsonb_build_array(pg_get_ruledef(r.oid,false))
      FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND r.rulename<>'_RETURN'
      UNION ALL
      SELECT t.typname,'custom-type',jsonb_build_array(t.typtype::text,format_type(t.typbasetype,t.typtypmod),t.typnotnull,t.typdefault)
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace LEFT JOIN pg_class c ON c.oid=t.typrelid
      WHERE n.nspname='public' AND (t.typtype IN ('d','r','m') OR (t.typtype='c' AND c.relkind='c') OR (t.typtype='b' AND t.typelem=0))
      UNION ALL
      SELECT c.relname,'foreign-table',jsonb_build_array(c.relkind::text)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='f'`,
  },
};

export const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const digest = expression => `encode(sha256(convert_to(COALESCE((${expression})::text,'[]'),'UTF8')),'hex')`;
export const hashQuery = section => `WITH metadata AS (${sections[section].sql})
  SELECT ${digest('jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C")')} AS digest FROM metadata`;
export const entityHashQuery = section => `WITH metadata AS (${sections[section].sql})
  SELECT entity, ${digest('jsonb_agg(jsonb_build_array(member,signature) ORDER BY member COLLATE "C")')} AS digest FROM metadata GROUP BY entity ORDER BY entity COLLATE "C"`;
export const readOnly = sql => `BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
${sql};
ROLLBACK;
`;
export const checkQuery = (section, expected) => readOnly(`WITH actual AS (${hashQuery(section)})
SELECT ${literal(section)} AS section, CASE WHEN digest=${literal(expected)} THEN 'MATCH' ELSE 'MISMATCH' END AS status FROM actual`);

// One snapshot, one result set, seven pairs. Same signatures as the individual
// checks; no ignored enum ordering or whitelisted production mismatches.
export function consolidatedQuery(expected) {
  const checks=Object.keys(sections).map((section,i)=>`SELECT ${i+1} AS ordinal,${literal(section)} AS section,
 CASE WHEN digest=${literal(expected[section].digest)} THEN 'MATCH' ELSE 'MISMATCH' END AS status
 FROM (${hashQuery(section)}) actual`);
  return `-- Copy/paste into an authorized manual SQL session; no file transfer needed.
-- Catalog metadata only. Expected signatures include the operator-confirmed enum order.
-- Abort on any SQL error; do not continue in an already-open transaction.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL search_path=pg_catalog,public;
WITH checks AS (
${checks.join('\nUNION ALL\n')}
)
SELECT section,status FROM checks ORDER BY ordinal;
ROLLBACK;
`;
}

// Optional second step, only for a category that returned MISMATCH. Expected
// data comes exclusively from the versioned baseline; output is object names.
export function locateQuery(section, entities) {
  return readOnly(locateSelect(section,entities));
}

// Shared by the individual locate and the reported-mismatch consolidation.
export function locateSelect(section, entities) {
  return `WITH actual AS (${entityHashQuery(section)}),
expected AS (SELECT key AS entity,value AS digest FROM jsonb_each_text(${literal(JSON.stringify(entities))}::jsonb))
SELECT COALESCE(e.entity,a.entity) AS object,
 CASE WHEN a.entity IS NULL THEN 'MISSING' WHEN e.entity IS NULL THEN 'EXTRA' ELSE 'DIFFERENT' END AS status
 FROM expected e FULL JOIN actual a USING(entity) WHERE e.digest IS DISTINCT FROM a.digest ORDER BY COALESCE(e.entity,a.entity) COLLATE "C"`;
}

// Final drilldown for one object, emits changed property names, never raw
// defaults, constraints, predicates, routines, trigger arguments or row values.
export function detailQuery(section, entity, expectedRows, member) {
  return readOnly(detailSelect(section,entity,expectedRows,member));
}

export function detailSelect(section, entity, expectedRows, member) {
  const expected=expectedRows.filter(r=>r.entity===entity&&(!member||r.member===member)).map(r=>[r.member,r.signature]);
  const fields=sections[section].fields;
  const safeDetails=section==='database'
    ? `,e.signature->>0 AS expected_provider,a.signature->>0 AS actual_provider,e.signature->>1 AS expected_collation,a.signature->>1 AS actual_collation,e.signature->>2 AS expected_ctype,a.signature->>2 AS actual_ctype,e.signature->>3 AS expected_version,a.signature->>3 AS actual_version`
    : section==='tables'
    ? `,e.signature->>0 AS expected_kind,a.signature->>0 AS actual_kind,e.signature->>1 AS expected_persistence,a.signature->>1 AS actual_persistence,
       e.signature->>2 AS expected_rls,a.signature->>2 AS actual_rls,e.signature->>3 AS expected_force_rls,a.signature->>3 AS actual_force_rls,
       e.signature->>4 AS expected_partition,a.signature->>4 AS actual_partition`
    : section==='columns'
    ? `,e.signature->>1 AS expected_type,a.signature->>1 AS actual_type,e.signature->>5 AS expected_not_null,a.signature->>5 AS actual_not_null,
       e.signature->>7 AS expected_identity,a.signature->>7 AS actual_identity,e.signature->>8 AS expected_generated,a.signature->>8 AS actual_generated,
       e.signature->>10 AS expected_collation,a.signature->>10 AS actual_collation`
    : section==='constraints'
    ? `,e.signature->>0 AS expected_kind,a.signature->>0 AS actual_kind,a.signature->>2 AS actual_validated,a.signature->>5 AS actual_delete_action,a.signature->>6 AS actual_update_action`
    : section==='indexes'
    ? `,e.signature->>1 AS expected_unique,a.signature->>1 AS actual_unique,a.signature->>4 AS actual_valid,a.signature->>5 AS actual_ready`
    : section==='enums'
    ? `,e.signature->>1 AS expected_position,a.signature->>1 AS actual_position` : '';
  return `WITH metadata AS (${sections[section].sql}),
actual AS (SELECT * FROM metadata WHERE entity=${literal(entity)}${member?' AND member='+literal(member):''}),
expected AS (SELECT v->>0 AS member,v->1 AS signature FROM jsonb_array_elements(${literal(JSON.stringify(expected))}::jsonb) v)
SELECT ${literal(entity)} AS object,COALESCE(e.member,a.member) AS member,
 CASE WHEN a.member IS NULL THEN 'MISSING' WHEN e.member IS NULL THEN 'EXTRA' ELSE 'DIFFERENT' END AS status,
 (SELECT string_agg(f.name,', ' ORDER BY f.position) FROM jsonb_array_elements_text(${literal(JSON.stringify(fields))}::jsonb) WITH ORDINALITY f(name,position)
  WHERE e.signature->(f.position::int-1) IS DISTINCT FROM a.signature->(f.position::int-1)) AS properties${safeDetails}
FROM expected e FULL JOIN actual a USING(member) WHERE e.signature IS DISTINCT FROM a.signature ORDER BY COALESCE(e.member,a.member) COLLATE "C"`;
}
