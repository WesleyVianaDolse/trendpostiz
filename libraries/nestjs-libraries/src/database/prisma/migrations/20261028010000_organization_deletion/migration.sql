ALTER TABLE "Organization"
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "deletionRequestedById" TEXT,
  ADD COLUMN "deletionProcessingAt" TIMESTAMP(3),
  ADD COLUMN "deletionError" TEXT;
CREATE INDEX "Organization_deletionRequestedAt_idx" ON "Organization"("deletionRequestedAt");
