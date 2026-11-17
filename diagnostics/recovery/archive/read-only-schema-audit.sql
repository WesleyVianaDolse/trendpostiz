-- NOT EXECUTED in production. Metadata only; no tokens or customer payloads.
-- Run the first transaction only after separate authorization for read access.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT current_schema() AS connection_schema, current_setting('search_path') AS search_path;
SELECT n.nspname AS migration_schema
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relname='_prisma_migrations' AND c.relkind='r';
-- The statements below assume the application's schema is public. If metadata
-- identifies another application schema, review/adjust these identifiers first;
-- absence in public alone does not prove absence of migration history.
SELECT to_regclass('public._prisma_migrations') AS migration_history;
SELECT table_name, column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('Integration','Organization','User','Post','PlatformSettings',
    'InstagramWebhookEvent','InstagramCommentAutomation','InstagramCommentAutomationExecution')
ORDER BY table_name, ordinal_position;
SELECT t.typname AS enum_name, e.enumlabel AS value
FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
WHERE t.typname IN ('State','InstagramWebhookEventStatus','InstagramCommentDeliveryStatus')
ORDER BY t.typname,e.enumsortorder;
ROLLBACK;

-- Only if the previous query confirmed that public._prisma_migrations exists:
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
FROM public._prisma_migrations ORDER BY started_at;
ROLLBACK;
