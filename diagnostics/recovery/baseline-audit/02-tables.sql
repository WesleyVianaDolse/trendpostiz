-- Read-only production check. Return only section and MATCH/MISMATCH.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
WITH actual AS (WITH metadata AS (SELECT c.relname::text AS entity, c.relname::text AS member,
      jsonb_build_array(c.relkind::text,c.relpersistence::text,c.relrowsecurity,c.relforcerowsecurity,
        c.relispartition,pg_get_partkeydef(c.oid),
        (SELECT jsonb_agg(pn.nspname||'.'||pc.relname ORDER BY pn.nspname COLLATE "C",pc.relname COLLATE "C")
         FROM pg_inherits i JOIN pg_class pc ON pc.oid=i.inhparent JOIN pg_namespace pn ON pn.oid=pc.relnamespace WHERE i.inhrelid=c.oid)) AS signature
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata)
SELECT 'tables' AS section, CASE WHEN digest='7e92404fc4e5aa031c3196694a78a76bbe50dfa7fb30ebf58c048ecefc135b37' THEN 'MATCH' ELSE 'MISMATCH' END AS status FROM actual;
ROLLBACK;
