ALTER TABLE "Contact" ADD COLUMN "providerContactUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "providerContactRemovedAt" TIMESTAMP(3);
ALTER TABLE "SystemSettings" ADD COLUMN "whatsappIsCoexistence" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "SystemSettings" ADD COLUMN "whatsappCoexistenceSync" JSONB;
ALTER TABLE "Message" ADD COLUMN "providerChangedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "providerRevokedAt" TIMESTAMP(3);
