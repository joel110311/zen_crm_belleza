-- Tenant-scoped channels use a short-lived connection capability and a durable, independently
-- claimable work queue. These tables deliberately do not contain tenant database URLs.
CREATE TYPE "TenantWorkKind" AS ENUM ('WEBHOOK_EVENT', 'OUTBOUND_MESSAGE', 'APPOINTMENT_REMINDER', 'CAMPAIGN_DISPATCH', 'AI_TASK', 'MAINTENANCE');
CREATE TYPE "TenantWorkStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'DEAD_LETTER', 'CANCELLED');

ALTER TABLE "ChannelConnection"
    ADD COLUMN "lastWebhookAt" TIMESTAMP(3),
    ADD COLUMN "lastError" TEXT;

CREATE TABLE "ChannelConnectionState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "provider" "ChannelProvider" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelConnectionState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenantWorkItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "TenantWorkKind" NOT NULL,
    "recordId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "TenantWorkStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantWorkItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelConnectionState_stateHash_key" ON "ChannelConnectionState"("stateHash");
CREATE INDEX "ChannelConnectionState_tenantId_provider_expiresAt_idx" ON "ChannelConnectionState"("tenantId", "provider", "expiresAt");
CREATE INDEX "ChannelConnectionState_requestedByUserId_expiresAt_idx" ON "ChannelConnectionState"("requestedByUserId", "expiresAt");
CREATE UNIQUE INDEX "TenantWorkItem_idempotencyKey_key" ON "TenantWorkItem"("idempotencyKey");
CREATE INDEX "TenantWorkItem_status_availableAt_idx" ON "TenantWorkItem"("status", "availableAt");
CREATE INDEX "TenantWorkItem_tenantId_kind_status_idx" ON "TenantWorkItem"("tenantId", "kind", "status");
CREATE INDEX "TenantWorkItem_lockedAt_idx" ON "TenantWorkItem"("lockedAt");

ALTER TABLE "ChannelConnectionState" ADD CONSTRAINT "ChannelConnectionState_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelConnectionState" ADD CONSTRAINT "ChannelConnectionState_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantWorkItem" ADD CONSTRAINT "TenantWorkItem_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
