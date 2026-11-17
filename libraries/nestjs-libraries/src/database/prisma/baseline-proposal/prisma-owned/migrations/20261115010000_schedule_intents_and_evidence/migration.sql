BEGIN;
CREATE TABLE "PublicationScheduleIntent" (
  "occurrenceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "seriesAnchor" TIMESTAMP(3),
  "intervalDays" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationScheduleIntent_pkey" PRIMARY KEY ("occurrenceId")
);
CREATE UNIQUE INDEX "PublicationScheduleIntent_workflowId_key" ON "PublicationScheduleIntent"("workflowId");
CREATE INDEX "PublicationScheduleIntent_organizationId_idx" ON "PublicationScheduleIntent"("organizationId");
CREATE TABLE "PublicationRecordEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "groupSnapshot" TEXT NOT NULL,
  "dateSnapshot" TIMESTAMP(3) NOT NULL,
  "stateSnapshot" TEXT NOT NULL,
  "remoteId" TEXT,
  "remoteUrl" TEXT,
  "youtubeVideoId" TEXT,
  "uploadKey" TEXT,
  "origin" TEXT NOT NULL DEFAULT 'unknown',
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationRecordEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PublicationRecordEvidence_organizationId_postId_idx" ON "PublicationRecordEvidence"("organizationId", "postId");
COMMIT;
