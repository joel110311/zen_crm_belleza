ALTER TABLE "ChannelConnection" ADD COLUMN "wabaId" TEXT;
CREATE INDEX "ChannelConnection_wabaId_idx" ON "ChannelConnection"("wabaId");
