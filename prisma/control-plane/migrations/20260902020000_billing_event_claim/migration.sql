-- A webhook delivery may be retried or arrive concurrently; claim it before mutating subscriptions.
ALTER TABLE "BillingEvent" ADD COLUMN "processingStartedAt" TIMESTAMP(3);
