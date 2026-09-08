-- Preserve the Facebook Page that owns an Instagram professional account.
-- Existing integrations remain NULL until they are reconnected or repaired.
ALTER TABLE "Integration" ADD COLUMN "facebookPageId" TEXT;

CREATE INDEX "Integration_facebookPageId_idx" ON "Integration"("facebookPageId");
