-- Read-only production check. Return only section and MATCH/MISMATCH.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
WITH actual AS (WITH metadata AS (SELECT c.relname::text AS entity,ic.relname::text AS member,
      jsonb_build_array(pg_get_indexdef(i.indexrelid,0,false),i.indisunique,i.indisprimary,i.indisexclusion,
        i.indisvalid,i.indisready,i.indislive,i.indnullsnotdistinct,i.indimmediate,ic.reloptions) AS signature
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class ic ON ic.oid=i.indexrelid
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata)
SELECT 'indexes' AS section, CASE WHEN digest='c911f2cf4208eff03f2ce6745fd3f4d888031093bf5319c970ba14c34402552c' THEN 'MATCH' ELSE 'MISMATCH' END AS status FROM actual;
ROLLBACK;
