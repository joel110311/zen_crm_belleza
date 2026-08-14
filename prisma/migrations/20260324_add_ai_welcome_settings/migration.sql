ALTER TABLE "SystemSettings"
ADD COLUMN "welcomeMessage" TEXT,
ADD COLUMN "welcomeRepeatHours" INTEGER NOT NULL DEFAULT 24;
