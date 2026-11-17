-- Read-only production check. Return only section and MATCH/MISMATCH.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
WITH actual AS (WITH metadata AS (SELECT c.relname::text AS entity,a.attname::text AS member,
      jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),tn.nspname,t.typname,t.typtype::text,
        a.attnotnull,pg_get_expr(d.adbin,d.adrelid,false),a.attidentity::text,a.attgenerated::text,a.attndims,
        CASE WHEN co.oid IS NOT NULL THEN cn.nspname||'.'||co.collname END) AS signature
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations')
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata)
SELECT 'columns' AS section, CASE WHEN digest='a42ec2a2c829e486685b9b6f42cab7d1a510cb6e6e960eadbcd8c9b3c5d468dc' THEN 'MATCH' ELSE 'MISMATCH' END AS status FROM actual;
ROLLBACK;
