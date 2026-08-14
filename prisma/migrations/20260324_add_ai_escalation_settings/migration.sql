ALTER TABLE "SystemSettings"
ADD COLUMN "escalationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "escalationPhone" TEXT;
