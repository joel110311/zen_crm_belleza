CREATE TABLE "TenantQrChannelConfiguration" (
    "tenantId" TEXT NOT NULL,
    "proxyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "proxyUrlCiphertext" BYTEA,
    "proxyUrlKeyVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantQrChannelConfiguration_pkey" PRIMARY KEY ("tenantId")
);

ALTER TABLE "TenantQrChannelConfiguration"
ADD CONSTRAINT "TenantQrChannelConfiguration_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
