-- Additive, Prisma-owned only. Does not open recovery or worker consumption.
BEGIN;
ALTER TABLE "AutomationWorkflowBinding" ADD COLUMN "expectedRequestHash" TEXT;
CREATE TABLE "AutomationEffectAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "actionKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "occurrenceId" TEXT,
  "postId" TEXT,
  "claimId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'CLAIMED',
  "remoteId" TEXT,
  "receipt" JSONB,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationEffectAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationEffectAttempt_organizationId_subjectKey_actionKey_key"
 ON "AutomationEffectAttempt"("organizationId","subjectKey","actionKey");
CREATE INDEX "AutomationEffectAttempt_organizationId_occurrenceId_idx"
 ON "AutomationEffectAttempt"("organizationId","occurrenceId");
COMMIT;
