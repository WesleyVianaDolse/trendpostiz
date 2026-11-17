-- Only the ownership questions not answered by the previous locate.
-- Manual read-only execution; no application rows or function definitions returned.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL search_path=pg_catalog,public,pg_temp;
SET LOCAL DateStyle='ISO, MDY';
SET LOCAL IntervalStyle='postgres';
SET LOCAL TimeZone='UTC';
SET LOCAL extra_float_digits=1;
SET LOCAL bytea_output='hex';
SET LOCAL standard_conforming_strings=on;
WITH external_names AS (SELECT unnest(ARRAY['mastra_agent_versions','mastra_agents','mastra_agents_legacy','mastra_ai_spans','mastra_dataset_items','mastra_dataset_versions','mastra_datasets','mastra_evals','mastra_experiment_results','mastra_experiments','mastra_mcp_client_versions','mastra_mcp_clients','mastra_mcp_server_versions','mastra_mcp_servers','mastra_messages','mastra_observational_memory','mastra_prompt_block_versions','mastra_prompt_blocks','mastra_resources','mastra_scorer_definition_versions','mastra_scorer_definitions','mastra_scorers','mastra_skill_blobs','mastra_skill_versions','mastra_skills','mastra_threads','mastra_traces','mastra_workflow_snapshot','mastra_workspace_versions','mastra_workspaces']::text[]) AS name),
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
    AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='625a5b31d458d2f047f1fd864250d760ad2569958a569ce8d56b28298f7bfae6') THEN 'MATCH' ELSE 'REVIEW_REQUIRED' END
 ) SELECT section,status FROM results ORDER BY section;
ROLLBACK;
