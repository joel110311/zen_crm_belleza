ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "permissions" JSONB;
ALTER TABLE "User" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb;
UPDATE "User" SET "permissions" = '[]'::jsonb WHERE "permissions" IS NULL;

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
UPDATE "User"
SET "role" = CASE
    WHEN "role" = 'SUPERADMIN' THEN 'ADMINISTRADOR'
    WHEN "role" = 'ADMIN' THEN 'RECEPCION'
    WHEN "role" IN ('ADMINISTRADOR', 'PROFESIONAL', 'RECEPCION') THEN "role"
    ELSE 'RECEPCION'
END;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'RECEPCION';

WITH first_user AS (
    SELECT id
    FROM "User"
    ORDER BY "createdAt" ASC
    LIMIT 1
)
UPDATE "User"
SET "role" = 'ADMINISTRADOR'
WHERE id IN (SELECT id FROM first_user)
  AND NOT EXISTS (
      SELECT 1
      FROM "User"
      WHERE "role" = 'ADMINISTRADOR'
         OR "permissions" @> '["system.fullAccess"]'::jsonb
  );

DROP TYPE IF EXISTS "Role";
