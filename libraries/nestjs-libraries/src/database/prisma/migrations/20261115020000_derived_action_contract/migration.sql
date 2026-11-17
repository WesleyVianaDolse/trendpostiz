BEGIN;
CREATE TABLE "PublicationDerivedAction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "rootOccurrenceId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "sourceIntegrationId" TEXT NOT NULL,
  "targetIntegrationId" TEXT NOT NULL,
  "actionKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "configurationHash" TEXT NOT NULL,
  "configurationSnapshot" JSONB NOT NULL,
  "schedule" JSONB NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationDerivedAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicationDerivedAction_rootOccurrenceId_actionKey_key" ON "PublicationDerivedAction"("rootOccurrenceId", "actionKey");
CREATE INDEX "PublicationDerivedAction_organizationId_rootOccurrenceId_idx" ON "PublicationDerivedAction"("organizationId", "rootOccurrenceId");
ALTER TABLE "AutomationWorkflowBinding" ADD COLUMN "derivedActionId" TEXT;
ALTER TABLE "AutomationWorkflowBinding" ADD COLUMN "derivedCheckIndex" INTEGER;
COMMIT;
