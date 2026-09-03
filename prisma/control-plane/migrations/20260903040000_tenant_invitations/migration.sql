CREATE TYPE "TenantInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "ProfessionalProfileProjectionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "TenantInvitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "TenantInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "professionalProfile" JSONB,
    "professionalProfileStatus" "ProfessionalProfileProjectionStatus",
    "professionalProfileError" TEXT,
    "professionalProfileSpecialistId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantInvitation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmailDelivery" ADD COLUMN "tenantInvitationId" TEXT;

CREATE UNIQUE INDEX "TenantInvitation_tokenHash_key" ON "TenantInvitation"("tokenHash");
CREATE UNIQUE INDEX "TenantInvitation_idempotencyKey_key" ON "TenantInvitation"("idempotencyKey");
CREATE INDEX "TenantInvitation_tenantId_email_status_idx" ON "TenantInvitation"("tenantId", "email", "status");
CREATE INDEX "TenantInvitation_tenantId_status_expiresAt_idx" ON "TenantInvitation"("tenantId", "status", "expiresAt");
CREATE INDEX "TenantInvitation_acceptedByUserId_status_idx" ON "TenantInvitation"("acceptedByUserId", "status");
CREATE INDEX "TenantInvitation_expiresAt_idx" ON "TenantInvitation"("expiresAt");
CREATE INDEX "EmailDelivery_tenantInvitationId_createdAt_idx" ON "EmailDelivery"("tenantInvitationId", "createdAt");

ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_tenantInvitationId_fkey" FOREIGN KEY ("tenantInvitationId") REFERENCES "TenantInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
