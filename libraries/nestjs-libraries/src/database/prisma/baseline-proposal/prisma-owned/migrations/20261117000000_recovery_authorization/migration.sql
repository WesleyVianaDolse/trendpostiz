BEGIN;
CREATE TABLE "RecoveryAuthorization" (
  "id" TEXT NOT NULL, "manifestId" TEXT NOT NULL, "generation" INTEGER NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'APPROVED', "approval" JSONB NOT NULL,
  "approvalSignature" TEXT NOT NULL, "authorityHash" TEXT NOT NULL,
  "plan" JSONB NOT NULL, "source" JSONB NOT NULL, "expectedDbHash" TEXT NOT NULL,
  "cursor" INTEGER NOT NULL DEFAULT 0, "resultHash" TEXT NOT NULL,
  "admitted" JSONB, "admittedSignature" TEXT, "approvedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecoveryAuthorization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecoveryAuthorization_manifestId_key" ON "RecoveryAuthorization"("manifestId");
CREATE TABLE "RecoveryApplicationItem" (
  "authorizationId" TEXT NOT NULL, "ordinal" INTEGER NOT NULL, "fingerprint" TEXT NOT NULL,
  "result" JSONB NOT NULL, "previousHash" TEXT NOT NULL, "resultHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecoveryApplicationItem_pkey" PRIMARY KEY ("authorizationId", "ordinal")
);
COMMIT;
