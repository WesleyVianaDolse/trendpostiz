-- Read-only production check. Return only section and MATCH/MISMATCH.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
WITH actual AS (WITH metadata AS (SELECT t.typname::text AS entity,e.enumlabel::text AS member,
      jsonb_build_array(e.enumlabel,row_number() OVER(PARTITION BY t.oid ORDER BY e.enumsortorder)) AS signature
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
      WHERE n.nspname='public')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata)
SELECT 'enums' AS section, CASE WHEN digest='f399f55294b0966562cedcde79f303a4b37a17039303d891d5970f833eebef68' THEN 'MATCH' ELSE 'MISMATCH' END AS status FROM actual;
ROLLBACK;
