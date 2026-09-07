# Instagram comment automation — Phase 2 manual test

The production callback remains:

```text
https://trendpostiz.com.br/api/public/webhooks/instagram
```

The Instagram Standalone account must be reconnected after deploying Phase 2
so that its token includes `instagram_business_manage_messages` and the app is
subscribed to both `comments,messages`.

## Create a test automation

Open `psql` inside the production database container:

```bash
docker compose exec postiz-postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Find the target integration ID. Replace the account username if needed:

```sql
SELECT "id", "name", "internalId", "webhookCommentsSubscribed",
       "webhookMessagesSubscribed", "webhookSubscriptionError"
FROM "Integration"
WHERE "providerIdentifier" = 'instagram-standalone'
  AND "deletedAt" IS NULL;
```

For a post published by TrendPostiz, obtain its Instagram media ID from
`Post.releaseId`:

```sql
SELECT "releaseId", "releaseURL", "publishDate"
FROM "Post"
WHERE "integrationId" = 'INTEGRATION_ID_HERE'
  AND "state" = 'PUBLISHED'
  AND "releaseId" IS NOT NULL
ORDER BY "publishDate" DESC
LIMIT 20;
```

Replace `INTEGRATION_ID_HERE` and `INSTAGRAM_MEDIA_ID_HERE`, then run:

```sql
BEGIN;

WITH automation AS (
  INSERT INTO "InstagramCommentAutomation" (
    "id",
    "integrationId",
    "mediaId",
    "enabled",
    "matchType",
    "publicReplyEnabled",
    "publicReplyText",
    "privateReplyEnabled",
    "privateReplyText",
    "createdAt",
    "updatedAt"
  ) VALUES (
    gen_random_uuid()::text,
    'INTEGRATION_ID_HERE',
    'INSTAGRAM_MEDIA_ID_HERE',
    true,
    'EXACT',
    true,
    'Dá uma olhadinha no seu direct!',
    true,
    'Oi! Aqui está o que você pediu: https://example.com',
    NOW(),
    NOW()
  )
  ON CONFLICT ("integrationId", "mediaId") DO UPDATE SET
    "enabled" = EXCLUDED."enabled",
    "matchType" = EXCLUDED."matchType",
    "publicReplyEnabled" = EXCLUDED."publicReplyEnabled",
    "publicReplyText" = EXCLUDED."publicReplyText",
    "privateReplyEnabled" = EXCLUDED."privateReplyEnabled",
    "privateReplyText" = EXCLUDED."privateReplyText",
    "updatedAt" = NOW()
  RETURNING "id"
)
INSERT INTO "InstagramCommentAutomationTrigger" (
  "id", "automationId", "phrase", "normalizedPhrase", "createdAt"
)
SELECT gen_random_uuid()::text, "id", 'EU QUERO', 'eu quero', NOW()
FROM automation
ON CONFLICT ("automationId", "normalizedPhrase") DO UPDATE SET
  "phrase" = EXCLUDED."phrase";

COMMIT;
```

## Execute and verify

1. Publish or select the post whose numeric media ID was inserted above.
2. From another Instagram account, comment exactly `EU QUERO`.
3. Confirm that the public reply appears under the source comment.
4. Confirm that the same commenter receives the configured Direct message.
5. Comment again from the same account, including on a redelivery attempt. No
   second public reply or Direct should be sent for that automation.
6. Comment from a different account. It should receive both deliveries.
7. Inspect the persisted state:

```sql
SELECT e."id", e."status", e."externalCommentId", e."authorId",
       x."publicReplyStatus", x."privateReplyStatus",
       x."publicReplyId", x."privateReplyId",
       x."publicReplyError", x."privateReplyError", x."processedAt"
FROM "InstagramWebhookEvent" e
LEFT JOIN "InstagramCommentAutomationExecution" x
  ON x."webhookEventId" = e."id"
WHERE e."integrationId" = 'INTEGRATION_ID_HERE'
ORDER BY e."receivedAt" DESC
LIMIT 20;
```

To disable the test without deleting its audit history:

```sql
UPDATE "InstagramCommentAutomation"
SET "enabled" = false, "updatedAt" = NOW()
WHERE "integrationId" = 'INTEGRATION_ID_HERE'
  AND "mediaId" = 'INSTAGRAM_MEDIA_ID_HERE';
```
