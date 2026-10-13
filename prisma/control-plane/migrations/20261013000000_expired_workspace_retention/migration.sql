CREATE TABLE "TenantDataRetention" (
    "tenantId" TEXT PRIMARY KEY,
    "expiredAt" TIMESTAMP(3) NOT NULL,
    "warningAt" TIMESTAMP(3) NOT NULL,
    "deletionAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RETAINED',
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantDataRetention_status_check" CHECK ("status" IN ('RETAINED','REACTIVATED','REVIEW_REQUIRED','PURGING','RETRY','COMPLETED'))
);
CREATE INDEX "TenantDataRetention_status_deletionAt_nextRunAt_idx" ON "TenantDataRetention" ("status", "deletionAt", "nextRunAt");
