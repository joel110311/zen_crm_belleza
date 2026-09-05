ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "controlUserId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_controlUserId_key"
ON "User"("controlUserId");
