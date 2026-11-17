-- Read-only production check. Return only section and MATCH/MISMATCH.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
WITH actual AS (WITH metadata AS (SELECT c.relname::text AS entity,('trigger:'||t.tgname)::text AS member,
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
  SELECT encode(sha256(convert_to(COALESCE((jsonb_agg(jsonb_build_array(entity,member,signature) ORDER BY entity COLLATE "C",member COLLATE "C"))::text,'[]'),'UTF8')),'hex') AS digest FROM metadata)
SELECT 'extras' AS section, CASE WHEN digest='4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' THEN 'MATCH' ELSE 'MISMATCH' END AS status FROM actual;
ROLLBACK;
