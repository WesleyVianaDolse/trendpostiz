-- Track message subscriptions independently from comment subscriptions.
ALTER TABLE "Integration"
ADD COLUMN "webhookMessagesSubscribed" BOOLEAN NOT NULL DEFAULT false;

-- Extend inbound event lifecycle states for asynchronous automation processing.
ALTER TYPE "InstagramWebhookEventStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "InstagramWebhookEventStatus" ADD VALUE IF NOT EXISTS 'PROCESSED';
ALTER TYPE "InstagramWebhookEventStatus" ADD VALUE IF NOT EXISTS 'REPLIED';
ALTER TYPE "InstagramWebhookEventStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
ALTER TYPE "InstagramWebhookEventStatus" ADD VALUE IF NOT EXISTS 'FAILED';

CREATE TYPE "InstagramCommentMatchType" AS ENUM ('CONTAINS', 'EXACT');
CREATE TYPE "InstagramCommentDeliveryStatus" AS ENUM (
  'PENDING',
  'SUCCESS',
  'SKIPPED',
  'FAILED'
);

CREATE TABLE "InstagramCommentAutomation" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "matchType" "InstagramCommentMatchType" NOT NULL,
  "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "publicReplyText" TEXT,
  "privateReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "privateReplyText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InstagramCommentAutomation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramCommentAutomationTrigger" (
  "id" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "phrase" TEXT NOT NULL,
  "normalizedPhrase" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InstagramCommentAutomationTrigger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramCommentAutomationExecution" (
  "id" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "webhookEventId" TEXT,
  "authorId" TEXT NOT NULL,
  "externalCommentId" TEXT NOT NULL,
  "publicReplyId" TEXT,
  "privateReplyId" TEXT,
  "publicReplyStatus" "InstagramCommentDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "privateReplyStatus" "InstagramCommentDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "publicReplyError" TEXT,
  "privateReplyError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "InstagramCommentAutomationExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstagramCommentAutomation_integrationId_mediaId_key"
ON "InstagramCommentAutomation"("integrationId", "mediaId");
CREATE INDEX "InstagramCommentAutomation_integrationId_idx"
ON "InstagramCommentAutomation"("integrationId");
CREATE INDEX "InstagramCommentAutomation_mediaId_idx"
ON "InstagramCommentAutomation"("mediaId");
CREATE INDEX "InstagramCommentAutomation_enabled_idx"
ON "InstagramCommentAutomation"("enabled");

CREATE UNIQUE INDEX "InstagramCommentAutomationTrigger_automationId_normalizedPhrase_key"
ON "InstagramCommentAutomationTrigger"("automationId", "normalizedPhrase");
CREATE INDEX "InstagramCommentAutomationTrigger_automationId_idx"
ON "InstagramCommentAutomationTrigger"("automationId");

CREATE UNIQUE INDEX "InstagramCommentAutomationExecution_webhookEventId_key"
ON "InstagramCommentAutomationExecution"("webhookEventId");
CREATE UNIQUE INDEX "InstagramCommentAutomationExecution_publicReplyId_key"
ON "InstagramCommentAutomationExecution"("publicReplyId");
CREATE UNIQUE INDEX "InstagramCommentAutomationExecution_automationId_authorId_key"
ON "InstagramCommentAutomationExecution"("automationId", "authorId");
CREATE UNIQUE INDEX "InstagramCommentAutomationExecution_automationId_externalCommentId_key"
ON "InstagramCommentAutomationExecution"("automationId", "externalCommentId");
CREATE INDEX "InstagramCommentAutomationExecution_automationId_idx"
ON "InstagramCommentAutomationExecution"("automationId");
CREATE INDEX "InstagramCommentAutomationExecution_authorId_idx"
ON "InstagramCommentAutomationExecution"("authorId");
CREATE INDEX "InstagramCommentAutomationExecution_externalCommentId_idx"
ON "InstagramCommentAutomationExecution"("externalCommentId");
CREATE INDEX "InstagramCommentAutomationExecution_createdAt_idx"
ON "InstagramCommentAutomationExecution"("createdAt");

ALTER TABLE "InstagramCommentAutomation"
ADD CONSTRAINT "InstagramCommentAutomation_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "Integration"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentAutomationTrigger"
ADD CONSTRAINT "InstagramCommentAutomationTrigger_automationId_fkey"
FOREIGN KEY ("automationId") REFERENCES "InstagramCommentAutomation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentAutomationExecution"
ADD CONSTRAINT "InstagramCommentAutomationExecution_automationId_fkey"
FOREIGN KEY ("automationId") REFERENCES "InstagramCommentAutomation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstagramCommentAutomationExecution"
ADD CONSTRAINT "InstagramCommentAutomationExecution_webhookEventId_fkey"
FOREIGN KEY ("webhookEventId") REFERENCES "InstagramWebhookEvent"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
