-- Copy/paste into an authorized manual SQL session; no file transfer needed.
-- Catalog metadata only. Expected signatures include the operator-confirmed enum order.
-- Abort on any SQL error; do not continue in an already-open transaction.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL search_path=pg_catalog,public;
WITH checks AS (
SELECT 1 AS ordinal,'database' AS section,
 CASE WHEN digest='907dfa0e2dea7c3b52650422461faca860418622bbd9a8a58602be8945b1b832' THEN 'MATCH' ELSE 'MISMATCH' END AS status
 FROM (WITH metadata AS (SELECT '__database__'::text AS entity,'locale'::text AS member,
      jsonb_build_array(d.datlocprovider::text,d.datcollate,d.datctype,d.datcollversion) AS signature
      FROM pg_database d WHERE d.datname=current_database())
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata) actual
UNION ALL
SELECT 2 AS ordinal,'tables' AS section,
 CASE WHEN digest='7e92404fc4e5aa031c3196694a78a76bbe50dfa7fb30ebf58c048ecefc135b37' THEN 'MATCH' ELSE 'MISMATCH' END AS status
 FROM (WITH metadata AS (SELECT c.relname::text AS entity, c.relname::text AS member,
      jsonb_build_array(c.relkind::text,c.relpersistence::text,c.relrowsecurity,c.relforcerowsecurity,
        c.relispartition,pg_get_partkeydef(c.oid),
        (SELECT jsonb_agg(pn.nspname||'.'||pc.relname ORDER BY pn.nspname COLLATE "C",pc.relname COLLATE "C")
         FROM pg_inherits i JOIN pg_class pc ON pc.oid=i.inhparent JOIN pg_namespace pn ON pn.oid=pc.relnamespace WHERE i.inhrelid=c.oid)) AS signature
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata) actual
UNION ALL
SELECT 3 AS ordinal,'columns' AS section,
 CASE WHEN digest='a42ec2a2c829e486685b9b6f42cab7d1a510cb6e6e960eadbcd8c9b3c5d468dc' THEN 'MATCH' ELSE 'MISMATCH' END AS status
 FROM (WITH metadata AS (SELECT c.relname::text AS entity,a.attname::text AS member,
      jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),tn.nspname,t.typname,t.typtype::text,
        a.attnotnull,pg_get_expr(d.adbin,d.adrelid,false),a.attidentity::text,a.attgenerated::text,a.attndims,
        CASE WHEN co.oid IS NOT NULL THEN cn.nspname||'.'||co.collname END) AS signature
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata) actual
UNION ALL
SELECT 4 AS ordinal,'constraints' AS section,
 CASE WHEN digest='aae97536c6debd45bf495eb1e49af262cca8f23db86ed1cb00ba525372b78187' THEN 'MATCH' ELSE 'MISMATCH' END AS status
 FROM (WITH metadata AS (SELECT c.relname::text AS entity,k.conname::text AS member,
      jsonb_build_array(k.contype::text,pg_get_constraintdef(k.oid,false),k.convalidated,k.condeferrable,
        k.condeferred,k.confdeltype::text,k.confupdtype::text,k.confmatchtype::text) AS signature
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata) actual
UNION ALL
SELECT 5 AS ordinal,'indexes' AS section,
 CASE WHEN digest='c911f2cf4208eff03f2ce6745fd3f4d888031093bf5319c970ba14c34402552c' THEN 'MATCH' ELSE 'MISMATCH' END AS status
 FROM (WITH metadata AS (SELECT c.relname::text AS entity,ic.relname::text AS member,
      jsonb_build_array(pg_get_indexdef(i.indexrelid,0,false),i.indisunique,i.indisprimary,i.indisexclusion,
        i.indisvalid,i.indisready,i.indislive,i.indnullsnotdistinct,i.indimmediate,ic.reloptions) AS signature
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class ic ON ic.oid=i.indexrelid
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata) actual
UNION ALL
SELECT 6 AS ordinal,'enums' AS section,
 CASE WHEN digest='f399f55294b0966562cedcde79f303a4b37a17039303d891d5970f833eebef68' THEN 'MATCH' ELSE 'MISMATCH' END AS status
 FROM (WITH metadata AS (SELECT t.typname::text AS entity,e.enumlabel::text AS member,
      jsonb_build_array(e.enumlabel,row_number() OVER(PARTITION BY t.oid ORDER BY e.enumsortorder)) AS signature
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
      WHERE n.nspname='public')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata) actual
UNION ALL
SELECT 7 AS ordinal,'extras' AS section,
 CASE WHEN digest='4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' THEN 'MATCH' ELSE 'MISMATCH' END AS status
 FROM (WITH metadata AS (SELECT c.relname::text AS entity,('trigger:'||t.tgname)::text AS member,
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
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='f')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata) actual
)
SELECT section,status FROM checks ORDER BY ordinal;
ROLLBACK;
