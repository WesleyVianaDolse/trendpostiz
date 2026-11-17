-- Read-only production check. Return only section and MATCH/MISMATCH.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
WITH actual AS (WITH metadata AS (SELECT c.relname::text AS entity,k.conname::text AS member,
      jsonb_build_array(k.contype::text,pg_get_constraintdef(k.oid,false),k.convalidated,k.condeferrable,
        k.condeferred,k.confdeltype::text,k.confupdtype::text,k.confmatchtype::text) AS signature
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata)
SELECT 'constraints' AS section, CASE WHEN digest='aae97536c6debd45bf495eb1e49af262cca8f23db86ed1cb00ba525372b78187' THEN 'MATCH' ELSE 'MISMATCH' END AS status FROM actual;
ROLLBACK;
