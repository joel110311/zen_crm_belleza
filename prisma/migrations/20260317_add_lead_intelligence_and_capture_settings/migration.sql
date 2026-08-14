CREATE TABLE "LeadIntelligence" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "interestStatus" TEXT NOT NULL DEFAULT 'nuevo',
    "currentStep" TEXT NOT NULL DEFAULT 'inicio',
    "stepProgress" INTEGER NOT NULL DEFAULT 0,
    "pendingCaptureField" TEXT,
    "nameCaptured" BOOLEAN NOT NULL DEFAULT false,
    "emailCaptured" BOOLEAN NOT NULL DEFAULT false,
    "nameDeclined" BOOLEAN NOT NULL DEFAULT false,
    "emailDeclined" BOOLEAN NOT NULL DEFAULT false,
    "capturedName" TEXT,
    "capturedEmail" TEXT,
    "askedForNameAt" TIMESTAMP(3),
    "askedForEmailAt" TIMESTAMP(3),
    "capturedNameAt" TIMESTAMP(3),
    "capturedEmailAt" TIMESTAMP(3),
    "interestDetectedAt" TIMESTAMP(3),
    "lastScoredAt" TIMESTAMP(3),
    "sameDayInboundCount" INTEGER NOT NULL DEFAULT 0,
    "lastSummary" TEXT,
    "signals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadIntelligence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadIntelligence_dealId_key" ON "LeadIntelligence"("dealId");
CREATE INDEX "LeadIntelligence_interestStatus_idx" ON "LeadIntelligence"("interestStatus");
CREATE INDEX "LeadIntelligence_score_idx" ON "LeadIntelligence"("score");

ALTER TABLE "LeadIntelligence"
ADD CONSTRAINT "LeadIntelligence_dealId_fkey"
FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "SystemSettings"
ADD COLUMN "leadScoringEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "captureLeadName" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "captureLeadEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "leadInterestThreshold" INTEGER NOT NULL DEFAULT 45;
