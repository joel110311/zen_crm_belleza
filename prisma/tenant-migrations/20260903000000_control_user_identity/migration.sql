-- Authentication remains in the control plane. Tenant users are operational actors only.
ALTER TABLE "User" ADD COLUMN "controlUserId" TEXT;
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

CREATE UNIQUE INDEX "User_controlUserId_key" ON "User"("controlUserId");
