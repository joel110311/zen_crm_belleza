CREATE TABLE "AccountDeletion" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT, "tokenHash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "targets" JSONB NOT NULL,
 "attempts" INTEGER NOT NULL DEFAULT 0, "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "AccountDeletion_userId_key" ON "AccountDeletion"("userId");
CREATE UNIQUE INDEX "AccountDeletion_tokenHash_key" ON "AccountDeletion"("tokenHash");
CREATE INDEX "AccountDeletion_status_nextRunAt_idx" ON "AccountDeletion"("status", "nextRunAt");
