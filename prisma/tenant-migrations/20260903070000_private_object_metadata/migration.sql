-- Objects are stored in a private S3-compatible bucket. This table contains only metadata and
-- a tenant-prefixed key; never an object URL or storage credential.
CREATE TYPE "PrivateFileStatus" AS ENUM ('PENDING_UPLOAD', 'READY', 'QUARANTINED', 'DELETED', 'FAILED');
CREATE TYPE "PrivateFileAntivirusStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'CLEAN', 'INFECTED', 'FAILED');

CREATE TABLE "PrivateFile" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "requestKeyHash" TEXT NOT NULL,
    "status" "PrivateFileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "antivirusStatus" "PrivateFileAntivirusStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "antivirusDetail" TEXT,
    "uploadedByUserId" TEXT,
    "uploadExpiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "publicAccessTokenHash" TEXT,
    "publicAccessExpiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivateFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivateFile_storageKey_key" ON "PrivateFile"("storageKey");
CREATE UNIQUE INDEX "PrivateFile_requestKeyHash_key" ON "PrivateFile"("requestKeyHash");
CREATE UNIQUE INDEX "PrivateFile_publicAccessTokenHash_key" ON "PrivateFile"("publicAccessTokenHash");
CREATE INDEX "PrivateFile_resourceType_resourceId_status_idx" ON "PrivateFile"("resourceType", "resourceId", "status");
CREATE INDEX "PrivateFile_uploadExpiresAt_status_idx" ON "PrivateFile"("uploadExpiresAt", "status");
CREATE INDEX "PrivateFile_publicAccessExpiresAt_idx" ON "PrivateFile"("publicAccessExpiresAt");
