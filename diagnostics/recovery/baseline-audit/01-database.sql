-- Read-only production check. Return only section and MATCH/MISMATCH.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
WITH actual AS (WITH metadata AS (SELECT '__database__'::text AS entity,'locale'::text AS member,
      jsonb_build_array(d.datlocprovider::text,d.datcollate,d.datctype,d.datcollversion) AS signature
      FROM pg_database d WHERE d.datname=current_database())
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata)
SELECT 'database' AS section, CASE WHEN digest='907dfa0e2dea7c3b52650422461faca860418622bbd9a8a58602be8945b1b832' THEN 'MATCH' ELSE 'MISMATCH' END AS status FROM actual;
ROLLBACK;
