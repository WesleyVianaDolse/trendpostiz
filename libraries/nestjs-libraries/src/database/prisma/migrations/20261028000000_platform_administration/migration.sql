ALTER TABLE "Organization" ADD COLUMN "suspendedAt" TIMESTAMP(3), ADD COLUMN "suspensionReason" TEXT;
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "disabledAt" TIMESTAMP(3), ADD COLUMN "disabledReason" TEXT;
ALTER TABLE "Post" ADD COLUMN "adminPausedAt" TIMESTAMP(3);

CREATE TABLE "PlatformSettings" (
  "id" TEXT NOT NULL DEFAULT 'platform',
  "ownerUserId" TEXT NOT NULL,
  "registrationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "organizationCreationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformSettings_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlatformSettings_ownerUserId_key" ON "PlatformSettings"("ownerUserId");

CREATE TABLE "AdminAuditLog" (
  "id" TEXT NOT NULL, "actorId" TEXT NOT NULL, "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL, "reason" TEXT,
  "details" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");
CREATE INDEX "Organization_suspendedAt_idx" ON "Organization"("suspendedAt");
CREATE INDEX "User_disabledAt_idx" ON "User"("disabledAt");
CREATE INDEX "Post_organizationId_adminPausedAt_idx" ON "Post"("organizationId", "adminPausedAt");
