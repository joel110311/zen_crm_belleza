CREATE TABLE IF NOT EXISTS "CashClosure" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "income" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expense" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "movementCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashClosure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CashClosure_dateKey_closedAt_idx" ON "CashClosure"("dateKey", "closedAt");
CREATE INDEX IF NOT EXISTS "CashClosure_closedAt_idx" ON "CashClosure"("closedAt");
CREATE INDEX IF NOT EXISTS "CashClosure_closedById_idx" ON "CashClosure"("closedById");

ALTER TABLE "CashClosure"
    ADD CONSTRAINT "CashClosure_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
