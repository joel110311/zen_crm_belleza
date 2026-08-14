ALTER TABLE "Specialist" ADD COLUMN IF NOT EXISTS "professionalTitle" TEXT;
ALTER TABLE "Specialist" ADD COLUMN IF NOT EXISTS "professionalLicense" TEXT;

ALTER TABLE "PatientConsultation" ADD COLUMN IF NOT EXISTS "specialistId" TEXT;
ALTER TABLE "PatientConsultation" ADD COLUMN IF NOT EXISTS "professionalTitle" TEXT;
ALTER TABLE "PatientConsultation" ADD COLUMN IF NOT EXISTS "professionalLicense" TEXT;

DO $$
BEGIN
    ALTER TABLE "PatientConsultation"
        ADD CONSTRAINT "PatientConsultation_specialistId_fkey"
        FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "PatientConsultation_specialistId_idx" ON "PatientConsultation"("specialistId");
