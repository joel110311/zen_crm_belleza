-- Add WhatsApp profile avatar cache fields to contacts
ALTER TABLE "Contact"
ADD COLUMN "whatsappAvatarUrl" TEXT,
ADD COLUMN "whatsappAvatarPictureId" TEXT,
ADD COLUMN "whatsappAvatarCheckedAt" TIMESTAMP(3),
ADD COLUMN "whatsappAvatarUpdatedAt" TIMESTAMP(3);
