-- Track the Instagram comments webhook subscription on each integration.
ALTER TABLE "Integration"
ADD COLUMN "webhookCommentsSubscribed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "webhookSubscriptionLastAttemptAt" TIMESTAMP(3),
ADD COLUMN "webhookSubscriptionError" TEXT;

-- Persist inbound comment events for auditability and delivery idempotency.
CREATE TYPE "InstagramWebhookEventStatus" AS ENUM (
  'RECEIVED',
  'UNMATCHED',
  'AMBIGUOUS',
  'INVALID'
);

CREATE TABLE "InstagramWebhookEvent" (
  "id" TEXT NOT NULL,
  "externalCommentId" TEXT,
  "integrationId" TEXT,
  "instagramAccountId" TEXT NOT NULL,
  "mediaId" TEXT,
  "authorId" TEXT,
  "authorUsername" TEXT,
  "commentText" TEXT,
  "payload" JSONB NOT NULL,
  "status" "InstagramWebhookEventStatus" NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InstagramWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstagramWebhookEvent_externalCommentId_key"
ON "InstagramWebhookEvent"("externalCommentId");

CREATE INDEX "InstagramWebhookEvent_integrationId_idx"
ON "InstagramWebhookEvent"("integrationId");

CREATE INDEX "InstagramWebhookEvent_instagramAccountId_idx"
ON "InstagramWebhookEvent"("instagramAccountId");

CREATE INDEX "InstagramWebhookEvent_status_idx"
ON "InstagramWebhookEvent"("status");

CREATE INDEX "InstagramWebhookEvent_receivedAt_idx"
ON "InstagramWebhookEvent"("receivedAt");

ALTER TABLE "InstagramWebhookEvent"
ADD CONSTRAINT "InstagramWebhookEvent_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "Integration"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
