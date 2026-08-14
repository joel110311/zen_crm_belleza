ALTER TABLE "SystemSettings"
    ADD COLUMN IF NOT EXISTS "posTaxEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "posTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 16,
    ADD COLUMN IF NOT EXISTS "posTicketEnabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "posTicketShowUnitPrice" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "posTicketFullDescription" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "posTicketHeader" TEXT DEFAULT 'Zen CRM Oftalmo
Clinica oftalmologica
Direccion de la clinica',
    ADD COLUMN IF NOT EXISTS "posTicketFooter" TEXT DEFAULT 'Gracias por su compra
Regrese pronto';
