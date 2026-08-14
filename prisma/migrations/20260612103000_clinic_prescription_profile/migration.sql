ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "clinicName" TEXT DEFAULT 'Zen CRM Oftalmo';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "clinicSubtitle" TEXT DEFAULT 'Clinica oftalmologica';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "clinicAddress" TEXT DEFAULT 'Direccion de la clinica';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "clinicLogoUrl" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "clinicLogoScale" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "doctorName" TEXT DEFAULT 'Joel Venegas';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "doctorTitle" TEXT DEFAULT 'Medico Oftalmologo';
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "doctorProfessionalLicense" TEXT;
