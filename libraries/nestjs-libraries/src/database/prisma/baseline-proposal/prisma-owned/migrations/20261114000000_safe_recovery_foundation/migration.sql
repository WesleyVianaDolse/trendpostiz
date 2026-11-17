-- Additive recovery foundation only; does not authorize worker consumption.
BEGIN;
-- AlterTable
ALTER TABLE "InstagramWebhookEvent" ADD COLUMN     "occurredAt" TIMESTAMP(3),
ADD COLUMN     "occurredAtSource" TEXT,
ADD COLUMN     "recoverySkipReason" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "scheduleRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AutomationRecoveryRun" (
    "id" TEXT NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "phase" TEXT NOT NULL DEFAULT 'BLOCKED',
    "authorizedById" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "manifestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRecoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRecoveryControl" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'BLOCKED',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRecoveryControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationOccurrence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "scheduleRevision" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "groupSnapshot" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptState" TEXT NOT NULL DEFAULT 'UNATTEMPTED',
    "claimId" TEXT,
    "claimGeneration" INTEGER,
    "remoteId" TEXT,
    "remoteUrl" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicationOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRecoveryDecision" (
    "id" TEXT NOT NULL,
    "recoveryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRecoveryDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationWorkflowBinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL DEFAULT 'publication',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationWorkflowBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "remoteId" TEXT,
    "remoteUrl" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicationOccurrence_organizationId_scheduledAt_idx" ON "PublicationOccurrence"("organizationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublicationOccurrence_postId_idx" ON "PublicationOccurrence"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationOccurrence_organizationId_postId_scheduleRevisio_key" ON "PublicationOccurrence"("organizationId", "postId", "scheduleRevision", "scheduledAt");

-- CreateIndex
CREATE INDEX "AutomationRecoveryDecision_organizationId_recoveryId_idx" ON "AutomationRecoveryDecision"("organizationId", "recoveryId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRecoveryDecision_subjectKey_action_key" ON "AutomationRecoveryDecision"("subjectKey", "action");

-- CreateIndex
CREATE INDEX "AutomationWorkflowBinding_occurrenceId_idx" ON "AutomationWorkflowBinding"("occurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationWorkflowBinding_workflowId_runId_actionKey_key" ON "AutomationWorkflowBinding"("workflowId", "runId", "actionKey");

-- CreateIndex
CREATE INDEX "PublicationEvidence_organizationId_occurrenceId_idx" ON "PublicationEvidence"("organizationId", "occurrenceId");


INSERT INTO "AutomationRecoveryControl" ("id", "phase", "generation", "protocolVersion", "updatedAt") VALUES ('global', 'BLOCKED', 0, 1, CURRENT_TIMESTAMP);
COMMIT;
