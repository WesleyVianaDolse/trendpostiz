BEGIN;
CREATE TABLE "RecoveryManifest" (
  "id" TEXT NOT NULL,
  "recoveryId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "cutoffAt" TIMESTAMP(3) NOT NULL,
  "protocolVersion" INTEGER NOT NULL DEFAULT 1,
  "scope" JSONB NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL,
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "phase" TEXT NOT NULL DEFAULT 'COLLECTING',
  "manifestHash" TEXT,
  "createdById" TEXT NOT NULL,
  "invalidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkedAt" TIMESTAMP(3),
  "checkedById" TEXT,
  CONSTRAINT "RecoveryManifest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecoveryManifest_recoveryId_version_key" ON "RecoveryManifest"("recoveryId", "version");
CREATE TABLE "RecoveryManifestItem" (
  "manifestId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "organizationId" TEXT,
  "subjectKey" TEXT NOT NULL,
  "postId" TEXT,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  CONSTRAINT "RecoveryManifestItem_pkey" PRIMARY KEY ("manifestId", "ordinal")
);
CREATE UNIQUE INDEX "RecoveryManifestItem_manifestId_subjectKey_key" ON "RecoveryManifestItem"("manifestId", "subjectKey");
CREATE INDEX "RecoveryManifestItem_organizationId_postId_idx" ON "RecoveryManifestItem"("organizationId", "postId");
ALTER TABLE "RecoveryManifestItem" ADD CONSTRAINT "RecoveryManifestItem_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "RecoveryManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
