-- New signups get the advertised 14-day trial. Existing Trial snapshots are untouched.
BEGIN;
ALTER TABLE "TrialPolicy" ALTER COLUMN "trialDays" SET DEFAULT 14;
ALTER TABLE "Trial" ALTER COLUMN "durationDays" SET DEFAULT 14;

-- Version the policy instead of editing terms already referenced by existing trials.
WITH previous AS (
    SELECT * FROM "TrialPolicy" WHERE "isActive" = true
    ORDER BY "isDefault" DESC, "updatedAt" DESC LIMIT 1
), demoted AS (
    UPDATE "TrialPolicy" SET "isDefault" = false, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "isDefault" = true AND "isActive" = true AND "trialDays" <> 14
    RETURNING "id"
)
INSERT INTO "TrialPolicy" (
    "id", "slug", "name", "version", "trialDays", "warningHours", "finalWarningHours",
    "paymentCollectionMode", "graceDays", "isDefault", "isActive", "updatedAt"
)
SELECT 'trial_landing_14d_20261006', 'landing-14d-20261006', 'Prueba estándar de 14 días',
    COALESCE((SELECT MAX("version") FROM "TrialPolicy"), 0) + 1, 14,
    COALESCE((SELECT "warningHours" FROM previous), 48),
    COALESCE((SELECT "finalWarningHours" FROM previous), 24),
    'OPTIONAL_AFTER_ONBOARDING', COALESCE((SELECT "graceDays" FROM previous), 3), true, true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM previous WHERE "isDefault" = true AND "trialDays" = 14)
    AND (SELECT COUNT(*) FROM demoted) >= 0
ON CONFLICT ("slug") DO NOTHING;
COMMIT;
