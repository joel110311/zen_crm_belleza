ALTER TABLE "Conversation"
ADD COLUMN "assignedUserId" TEXT;

CREATE INDEX "Conversation_assignedUserId_idx"
ON "Conversation"("assignedUserId");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_assignedUserId_fkey"
FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
