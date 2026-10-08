ALTER TABLE "ChannelConnection" ADD COLUMN "isCoexistence" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "ChannelConnection" ADD COLUMN "coexistenceSync" JSONB;
