CREATE TABLE "ApiMutationReceipt" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "response" JSONB,
    "statusCode" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiMutationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiMutationReceipt_scope_key_key"
ON "ApiMutationReceipt"("scope", "key");

CREATE INDEX "ApiMutationReceipt_expiresAt_idx"
ON "ApiMutationReceipt"("expiresAt");
