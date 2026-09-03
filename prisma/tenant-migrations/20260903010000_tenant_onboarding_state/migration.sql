-- One resumable onboarding state is stored in each isolated tenant database.
CREATE TABLE "TenantOnboardingState" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "initialServiceId" TEXT,
    "initialSpecialistId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantOnboardingState_pkey" PRIMARY KEY ("id")
);
