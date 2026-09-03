-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RECEPCION',
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "company" TEXT,
    "role" TEXT,
    "whatsappAvatarUrl" TEXT,
    "whatsappAvatarPictureId" TEXT,
    "whatsappAvatarCheckedAt" TIMESTAMP(3),
    "whatsappAvatarUpdatedAt" TIMESTAMP(3),
    "bulkCampaignOptOutAt" TIMESTAMP(3),
    "bulkCampaignOptOutReason" TEXT,
    "tags" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'lead',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source_type" TEXT NOT NULL DEFAULT 'wuzapi',
    "source_id" TEXT,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "botActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionExpiresAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "direction" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'wuzapi',
    "source_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "senderType" TEXT,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "mediaFileName" TEXT,
    "providerMessageId" TEXT,
    "reaction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "googleEventId" TEXT,
    "googleCalendarId" TEXT,
    "googleCalendarName" TEXT,
    "googleCalendarColor" TEXT,
    "specialistName" TEXT,
    "googleEventUpdatedAt" TIMESTAMP(3),
    "appointmentType" TEXT DEFAULT 'Consulta',
    "source" TEXT NOT NULL DEFAULT 'internal',
    "isFirstVisit" BOOLEAN NOT NULL DEFAULT false,
    "isOverbook" BOOLEAN NOT NULL DEFAULT false,
    "confirmationStatus" TEXT NOT NULL DEFAULT 'pending',
    "reminderStatus" TEXT NOT NULL DEFAULT 'pending',
    "remindersOptOut" BOOLEAN NOT NULL DEFAULT false,
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "paymentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentCurrency" TEXT NOT NULL DEFAULT 'MXN',
    "paymentMethod" TEXT DEFAULT 'efectivo',
    "paymentLinkUrl" TEXT,
    "publicToken" TEXT,
    "visitMode" TEXT NOT NULL DEFAULT 'presencial',
    "meetStatus" TEXT NOT NULL DEFAULT 'none',
    "meetLink" TEXT,
    "arrivalAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "noShowAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "parentAppointmentId" TEXT,
    "contactId" TEXT,
    "patientId" TEXT,
    "specialistId" TEXT,
    "serviceId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentSlotHold" (
    "id" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "calendarKey" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentSlotHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentReminder" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "provider" TEXT NOT NULL DEFAULT 'wuzapi',
    "messageKind" TEXT NOT NULL DEFAULT 'text',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "providerMessageId" TEXT,
    "lockId" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specialist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "specialty" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "professionalTitle" TEXT,
    "professionalLicense" TEXT,
    "color" TEXT DEFAULT '#2563EB',
    "room" TEXT,
    "bio" TEXT,
    "photoUrl" TEXT,
    "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "googleCalendarSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Specialist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT DEFAULT '#B7923A',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "preparationRequirements" JSONB,
    "imageUrl" TEXT,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialistService" (
    "specialistId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialistService_pkey" PRIMARY KEY ("specialistId","serviceId")
);

-- CreateTable
CREATE TABLE "SpecialistAvailabilityBlock" (
    "id" TEXT NOT NULL,
    "specialistId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'block',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialistAvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "patientNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "dob" TIMESTAMP(3),
    "sex" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "allergies" TEXT,
    "pathologicalHistory" TEXT,
    "nonPathologicalHistory" TEXT,
    "familyHistory" TEXT,
    "surgicalHistory" TEXT,
    "currentMedications" TEXT,
    "notes" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastVisitAt" TIMESTAMP(3),
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientConsultation" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "specialistId" TEXT,
    "parentId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'consultation',
    "chiefComplaint" TEXT NOT NULL,
    "notes" TEXT,
    "diagnosis" TEXT,
    "treatmentPlan" TEXT,
    "vitalSigns" JSONB,
    "medications" JSONB,
    "studies" JSONB,
    "studyRequests" JSONB,
    "bmi" DOUBLE PRECISION,
    "doctorName" TEXT,
    "professionalTitle" TEXT,
    "professionalLicense" TEXT,
    "clinicName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientConsultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientEvolutionNote" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT,
    "note" TEXT NOT NULL,
    "doctorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientEvolutionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientBudget" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payments" JSONB,
    "plan" JSONB,
    "notes" TEXT,
    "validUntil" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientClinicalAnalysis" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'result',
    "title" TEXT NOT NULL,
    "category" TEXT,
    "results" TEXT,
    "studies" JSONB,
    "resultDate" TIMESTAMP(3),
    "notes" TEXT,
    "files" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientClinicalAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'income',
    "concept" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "paymentMethod" TEXT DEFAULT 'efectivo',
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "appointmentId" TEXT,
    "patientId" TEXT,
    "contactId" TEXT,
    "specialistId" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashClosure" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "income" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expense" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "movementCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "url" TEXT,
    "externalId" TEXT,
    "appointmentId" TEXT,
    "patientId" TEXT,
    "contactId" TEXT,
    "specialistId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientEducationArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "category" TEXT DEFAULT 'General',
    "audience" TEXT DEFAULT 'pacientes',
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientEducationArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceUri" TEXT,
    "rawContent" TEXT,
    "mimeType" TEXT,
    "error" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "metadata" JSONB,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "development" TEXT NOT NULL,
    "location" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "searchableText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogAsset" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogConversationState" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "pendingImages" BOOLEAN NOT NULL DEFAULT false,
    "pendingPdf" BOOLEAN NOT NULL DEFAULT false,
    "pendingLink" BOOLEAN NOT NULL DEFAULT false,
    "offeredAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "language" TEXT NOT NULL DEFAULT 'es',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "type" TEXT NOT NULL DEFAULT 'text',
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "mediaFileName" TEXT,
    "shortcut" TEXT,
    "variables" JSONB,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audienceFilters" JSONB,
    "source_type" TEXT NOT NULL DEFAULT 'wuzapi',
    "source_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "mediaFileName" TEXT,
    "ycloudTemplateName" TEXT,
    "ycloudTemplateLanguage" TEXT,
    "ycloudTemplateComponents" JSONB,
    "ycloudTemplateVariableValues" JSONB,
    "batchSize" INTEGER NOT NULL DEFAULT 3,
    "batchDelayMinutes" INTEGER NOT NULL DEFAULT 5,
    "randomDelayMinSeconds" INTEGER NOT NULL DEFAULT 25,
    "randomDelayMaxSeconds" INTEGER NOT NULL DEFAULT 75,
    "respectBusinessHours" BOOLEAN NOT NULL DEFAULT true,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "followUpDelayDays" INTEGER NOT NULL DEFAULT 1,
    "senderStrategy" TEXT NOT NULL DEFAULT 'primary',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "repliedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastProcessedAt" TIMESTAMP(3),
    "scheduledStartAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "workerLockId" TEXT,
    "workerLockExpiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkCampaignVariant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "variables" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkCampaignVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "variantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sequenceIndex" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 0,
    "plannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastError" TEXT,
    "renderedContent" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748B',
    "order" INTEGER NOT NULL,
    "isIncoming" BOOLEAN NOT NULL DEFAULT false,
    "isClosedWon" BOOLEAN NOT NULL DEFAULT false,
    "isClosedLost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stageId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "notes" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "contactId" TEXT,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadIntelligence" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "interestStatus" TEXT NOT NULL DEFAULT 'nuevo',
    "currentStep" TEXT NOT NULL DEFAULT 'inicio',
    "stepProgress" INTEGER NOT NULL DEFAULT 0,
    "pendingCaptureField" TEXT,
    "nameCaptured" BOOLEAN NOT NULL DEFAULT false,
    "emailCaptured" BOOLEAN NOT NULL DEFAULT false,
    "nameDeclined" BOOLEAN NOT NULL DEFAULT false,
    "emailDeclined" BOOLEAN NOT NULL DEFAULT false,
    "capturedName" TEXT,
    "capturedEmail" TEXT,
    "askedForNameAt" TIMESTAMP(3),
    "askedForEmailAt" TIMESTAMP(3),
    "capturedNameAt" TIMESTAMP(3),
    "capturedEmailAt" TIMESTAMP(3),
    "interestDetectedAt" TIMESTAMP(3),
    "lastScoredAt" TIMESTAMP(3),
    "sameDayInboundCount" INTEGER NOT NULL DEFAULT 0,
    "lastSummary" TEXT,
    "signals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748B',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageAutomation" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'on_enter',
    "action" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "applyAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealTag" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "DealTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL,
    "openaiApiKey" TEXT,
    "openaiModel" TEXT DEFAULT 'gpt-4o-mini',
    "geminiApiKey" TEXT,
    "whatsappWabaId" TEXT,
    "whatsappPhoneNumberId" TEXT,
    "whatsappDisplayPhoneNumber" TEXT,
    "whatsappAccessToken" TEXT,
    "whatsappBusinessId" TEXT,
    "whatsappConnectedAt" TIMESTAMP(3),
    "whatsappMetaAppId" TEXT,
    "whatsappMetaAppSecret" TEXT,
    "whatsappEmbeddedSignupConfigId" TEXT,
    "whatsappTechProviderSolutionId" TEXT,
    "whatsappGraphApiVersion" TEXT DEFAULT 'v26.0',
    "whatsappRegistrationPin" TEXT,
    "whatsappWebhookVerifyToken" TEXT,
    "whatsappWebhookBaseUrl" TEXT,
    "whatsappBaseUrl" TEXT,
    "whatsappAdminToken" TEXT,
    "whatsappUserToken" TEXT,
    "whatsappInstanceName" TEXT DEFAULT 'zen-crm',
    "whatsappProxyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappProxyUrl" TEXT,
    "isBotEnabled" BOOLEAN NOT NULL DEFAULT false,
    "n8nWebhookUrl" TEXT,
    "agentName" TEXT DEFAULT 'Asistente Zen',
    "agentPrompt" TEXT,
    "welcomeMessage" TEXT,
    "welcomeRepeatHours" INTEGER NOT NULL DEFAULT 24,
    "agentTemperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "knowledgeTopK" INTEGER NOT NULL DEFAULT 6,
    "autoReplyDelayMs" INTEGER NOT NULL DEFAULT 4000,
    "botReplyDelayMinMs" INTEGER NOT NULL DEFAULT 4000,
    "botReplyDelayMaxMs" INTEGER NOT NULL DEFAULT 8000,
    "operationCountry" TEXT NOT NULL DEFAULT 'MX',
    "phoneDefaultCountry" TEXT NOT NULL DEFAULT 'MX',
    "businessHoursStart" TEXT NOT NULL DEFAULT '09:00',
    "businessHoursEnd" TEXT NOT NULL DEFAULT '18:00',
    "businessTimeZone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "businessWeeklySchedule" JSONB,
    "businessPolicies" JSONB,
    "brandName" TEXT DEFAULT 'Zen CRM Belleza',
    "brandLogoUrl" TEXT,
    "brandFaviconUrl" TEXT,
    "clinicName" TEXT DEFAULT 'Zen CRM Belleza',
    "clinicSubtitle" TEXT DEFAULT 'Servicios de belleza',
    "clinicAddress" TEXT DEFAULT 'Direccion del negocio',
    "clinicLogoUrl" TEXT,
    "clinicLogoScale" INTEGER NOT NULL DEFAULT 100,
    "doctorName" TEXT DEFAULT 'Joel Venegas',
    "doctorTitle" TEXT DEFAULT 'Profesional de belleza',
    "doctorProfessionalLicense" TEXT,
    "googleClientId" TEXT,
    "googleClientSecret" TEXT,
    "googleCalendarId" TEXT DEFAULT 'primary',
    "googleAccessToken" TEXT,
    "googleRefreshToken" TEXT,
    "googleTokenExpiresAt" TIMESTAMP(3),
    "googleConnectedEmail" TEXT,
    "googleSyncToken" TEXT,
    "googleLastSyncedAt" TIMESTAMP(3),
    "portalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "portalSlug" TEXT DEFAULT 'belleza',
    "portalClinicName" TEXT DEFAULT 'Zen CRM Belleza',
    "portalIntro" TEXT DEFAULT 'Aparta el horario para tu proximo servicio.',
    "portalPrimaryColor" TEXT DEFAULT '#4B5F25',
    "portalPaymentInstructions" TEXT,
    "paymentDefaultCurrency" TEXT DEFAULT 'MXN',
    "paymentEnabledCurrencies" JSONB NOT NULL DEFAULT '["MXN"]',
    "posTaxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "posTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 16,
    "posTicketEnabled" BOOLEAN NOT NULL DEFAULT true,
    "posTicketShowUnitPrice" BOOLEAN NOT NULL DEFAULT true,
    "posTicketFullDescription" BOOLEAN NOT NULL DEFAULT false,
    "posTicketHeader" TEXT DEFAULT 'Zen CRM Belleza
Servicios de belleza
Direccion del negocio',
    "posTicketFooter" TEXT DEFAULT 'Gracias por su compra
Regrese pronto',
    "mercadoPagoAccessToken" TEXT,
    "googleMeetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "googleMeetDefaultVirtual" BOOLEAN NOT NULL DEFAULT false,
    "reminderWhatsAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reminderEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
    "appointmentRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "appointmentReminderOffsets" JSONB NOT NULL DEFAULT '[1440,240]',
    "appointmentReminderProvider" TEXT NOT NULL DEFAULT 'wuzapi',
    "appointmentReminderSendOnlyConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "appointmentReminderWuzapiTemplate" TEXT,
    "appointmentReminderMetaTemplate24h" TEXT,
    "appointmentReminderMetaTemplate4h" TEXT,
    "appointmentReminderMetaLanguage" TEXT DEFAULT 'es',
    "confirmationLinkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "waitingRoomEnabled" BOOLEAN NOT NULL DEFAULT true,
    "leadScoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "captureLeadName" BOOLEAN NOT NULL DEFAULT false,
    "captureLeadEmail" BOOLEAN NOT NULL DEFAULT false,
    "leadInterestThreshold" INTEGER NOT NULL DEFAULT 45,
    "escalationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "escalationPhone" TEXT,
    "catalogOfferImages" BOOLEAN NOT NULL DEFAULT true,
    "catalogOfferPdf" BOOLEAN NOT NULL DEFAULT true,
    "catalogAskBeforeSending" BOOLEAN NOT NULL DEFAULT true,
    "catalogMaxImagesToSend" INTEGER NOT NULL DEFAULT 10,
    "catalogIncludeLink" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarSource" (
    "id" TEXT NOT NULL,
    "systemSettingsId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "backgroundColor" TEXT,
    "foregroundColor" TEXT,
    "accessRole" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "blocksAvailability" BOOLEAN NOT NULL DEFAULT false,
    "importToCrm" BOOLEAN NOT NULL DEFAULT false,
    "isWriteTarget" BOOLEAN NOT NULL DEFAULT false,
    "isSpecialist" BOOLEAN NOT NULL DEFAULT false,
    "specialistName" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "syncToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_phone_key" ON "Contact"("phone");

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");

-- CreateIndex
CREATE INDEX "Conversation_contactId_source_type_source_id_status_idx" ON "Conversation"("contactId", "source_type", "source_id", "status");

-- CreateIndex
CREATE INDEX "Conversation_source_type_source_id_idx" ON "Conversation"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "Conversation_assignedUserId_idx" ON "Conversation"("assignedUserId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_providerMessageId_idx" ON "Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "Message_source_type_source_id_idx" ON "Message"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "Message_source_type_providerMessageId_idx" ON "Message"("source_type", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_publicToken_key" ON "Appointment"("publicToken");

-- CreateIndex
CREATE INDEX "Appointment_startTime_idx" ON "Appointment"("startTime");

-- CreateIndex
CREATE INDEX "Appointment_contactId_idx" ON "Appointment"("contactId");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_googleCalendarId_idx" ON "Appointment"("googleCalendarId");

-- CreateIndex
CREATE INDEX "Appointment_specialistId_startTime_idx" ON "Appointment"("specialistId", "startTime");

-- CreateIndex
CREATE INDEX "Appointment_serviceId_idx" ON "Appointment"("serviceId");

-- CreateIndex
CREATE INDEX "Appointment_status_startTime_idx" ON "Appointment"("status", "startTime");

-- CreateIndex
CREATE INDEX "Appointment_source_idx" ON "Appointment"("source");

-- CreateIndex
CREATE INDEX "Appointment_paymentStatus_startTime_idx" ON "Appointment"("paymentStatus", "startTime");

-- CreateIndex
CREATE INDEX "Appointment_visitMode_startTime_idx" ON "Appointment"("visitMode", "startTime");

-- CreateIndex
CREATE INDEX "Appointment_parentAppointmentId_idx" ON "Appointment"("parentAppointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_googleCalendarId_googleEventId_key" ON "Appointment"("googleCalendarId", "googleEventId");

-- CreateIndex
CREATE INDEX "AppointmentSlotHold_ownerKey_idx" ON "AppointmentSlotHold"("ownerKey");

-- CreateIndex
CREATE INDEX "AppointmentSlotHold_expiresAt_idx" ON "AppointmentSlotHold"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentSlotHold_calendarKey_slotStart_key" ON "AppointmentSlotHold"("calendarKey", "slotStart");

-- CreateIndex
CREATE INDEX "AppointmentReminder_status_scheduledFor_idx" ON "AppointmentReminder"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AppointmentReminder_appointmentId_idx" ON "AppointmentReminder"("appointmentId");

-- CreateIndex
CREATE INDEX "AppointmentReminder_provider_idx" ON "AppointmentReminder"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentReminder_appointmentId_offsetMinutes_channel_key" ON "AppointmentReminder"("appointmentId", "offsetMinutes", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Specialist_googleCalendarSourceId_key" ON "Specialist"("googleCalendarSourceId");

-- CreateIndex
CREATE INDEX "Specialist_isActive_sortOrder_idx" ON "Specialist"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Specialist_userId_idx" ON "Specialist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_name_key" ON "ServiceCategory"("name");

-- CreateIndex
CREATE INDEX "ServiceCategory_isActive_sortOrder_idx" ON "ServiceCategory"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Service_name_key" ON "Service"("name");

-- CreateIndex
CREATE INDEX "Service_categoryId_isActive_sortOrder_idx" ON "Service"("categoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "SpecialistService_serviceId_idx" ON "SpecialistService"("serviceId");

-- CreateIndex
CREATE INDEX "SpecialistAvailabilityBlock_specialistId_startTime_idx" ON "SpecialistAvailabilityBlock"("specialistId", "startTime");

-- CreateIndex
CREATE INDEX "SpecialistAvailabilityBlock_startTime_endTime_idx" ON "SpecialistAvailabilityBlock"("startTime", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_patientNumber_key" ON "Patient"("patientNumber");

-- CreateIndex
CREATE INDEX "Patient_firstName_lastName_idx" ON "Patient"("firstName", "lastName");

-- CreateIndex
CREATE INDEX "Patient_phone_idx" ON "Patient"("phone");

-- CreateIndex
CREATE INDEX "Patient_lastVisitAt_idx" ON "Patient"("lastVisitAt");

-- CreateIndex
CREATE INDEX "Patient_contactId_idx" ON "Patient"("contactId");

-- CreateIndex
CREATE INDEX "PatientConsultation_patientId_createdAt_idx" ON "PatientConsultation"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientConsultation_appointmentId_idx" ON "PatientConsultation"("appointmentId");

-- CreateIndex
CREATE INDEX "PatientConsultation_specialistId_idx" ON "PatientConsultation"("specialistId");

-- CreateIndex
CREATE INDEX "PatientConsultation_parentId_idx" ON "PatientConsultation"("parentId");

-- CreateIndex
CREATE INDEX "PatientEvolutionNote_patientId_createdAt_idx" ON "PatientEvolutionNote"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientEvolutionNote_consultationId_idx" ON "PatientEvolutionNote"("consultationId");

-- CreateIndex
CREATE INDEX "PatientBudget_patientId_createdAt_idx" ON "PatientBudget"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientBudget_status_idx" ON "PatientBudget"("status");

-- CreateIndex
CREATE INDEX "PatientClinicalAnalysis_patientId_createdAt_idx" ON "PatientClinicalAnalysis"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "CashMovement_occurredAt_idx" ON "CashMovement"("occurredAt");

-- CreateIndex
CREATE INDEX "CashMovement_type_status_occurredAt_idx" ON "CashMovement"("type", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "CashMovement_appointmentId_idx" ON "CashMovement"("appointmentId");

-- CreateIndex
CREATE INDEX "CashMovement_patientId_idx" ON "CashMovement"("patientId");

-- CreateIndex
CREATE INDEX "CashMovement_specialistId_idx" ON "CashMovement"("specialistId");

-- CreateIndex
CREATE INDEX "CashMovement_recordedById_idx" ON "CashMovement"("recordedById");

-- CreateIndex
CREATE INDEX "CashClosure_dateKey_closedAt_idx" ON "CashClosure"("dateKey", "closedAt");

-- CreateIndex
CREATE INDEX "CashClosure_closedAt_idx" ON "CashClosure"("closedAt");

-- CreateIndex
CREATE INDEX "CashClosure_closedById_idx" ON "CashClosure"("closedById");

-- CreateIndex
CREATE INDEX "PaymentLink_status_createdAt_idx" ON "PaymentLink"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentLink_appointmentId_idx" ON "PaymentLink"("appointmentId");

-- CreateIndex
CREATE INDEX "PaymentLink_patientId_idx" ON "PaymentLink"("patientId");

-- CreateIndex
CREATE INDEX "PaymentLink_specialistId_idx" ON "PaymentLink"("specialistId");

-- CreateIndex
CREATE INDEX "PaymentLink_provider_externalId_idx" ON "PaymentLink"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientEducationArticle_slug_key" ON "PatientEducationArticle"("slug");

-- CreateIndex
CREATE INDEX "PatientEducationArticle_isPublished_sortOrder_idx" ON "PatientEducationArticle"("isPublished", "sortOrder");

-- CreateIndex
CREATE INDEX "PatientEducationArticle_category_idx" ON "PatientEducationArticle"("category");

-- CreateIndex
CREATE INDEX "KnowledgeSource_type_status_idx" ON "KnowledgeSource"("type", "status");

-- CreateIndex
CREATE INDEX "KnowledgeSource_updatedAt_idx" ON "KnowledgeSource"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_sourceId_chunkIndex_idx" ON "KnowledgeChunk"("sourceId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_externalId_key" ON "CatalogItem"("externalId");

-- CreateIndex
CREATE INDEX "CatalogItem_development_idx" ON "CatalogItem"("development");

-- CreateIndex
CREATE INDEX "CatalogItem_isActive_idx" ON "CatalogItem"("isActive");

-- CreateIndex
CREATE INDEX "CatalogAsset_itemId_type_sortOrder_idx" ON "CatalogAsset"("itemId", "type", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogConversationState_conversationId_key" ON "CatalogConversationState"("conversationId");

-- CreateIndex
CREATE INDEX "CatalogConversationState_catalogItemId_idx" ON "CatalogConversationState"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_shortcut_key" ON "Template"("shortcut");

-- CreateIndex
CREATE INDEX "Template_isActive_category_idx" ON "Template"("isActive", "category");

-- CreateIndex
CREATE INDEX "Template_isFavorite_updatedAt_idx" ON "Template"("isFavorite", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "BulkCampaign_status_nextRunAt_idx" ON "BulkCampaign"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "BulkCampaign_source_type_source_id_idx" ON "BulkCampaign"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "BulkCampaign_createdAt_idx" ON "BulkCampaign"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "BulkCampaignVariant_campaignId_sortOrder_idx" ON "BulkCampaignVariant"("campaignId", "sortOrder");

-- CreateIndex
CREATE INDEX "BulkCampaignRecipient_campaignId_status_sequenceIndex_idx" ON "BulkCampaignRecipient"("campaignId", "status", "sequenceIndex");

-- CreateIndex
CREATE INDEX "BulkCampaignRecipient_campaignId_status_plannedAt_sequenceI_idx" ON "BulkCampaignRecipient"("campaignId", "status", "plannedAt", "sequenceIndex");

-- CreateIndex
CREATE INDEX "BulkCampaignRecipient_contactId_status_idx" ON "BulkCampaignRecipient"("contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BulkCampaignRecipient_campaignId_contactId_attemptNumber_key" ON "BulkCampaignRecipient"("campaignId", "contactId", "attemptNumber");

-- CreateIndex
CREATE INDEX "Deal_stageId_idx" ON "Deal"("stageId");

-- CreateIndex
CREATE INDEX "Deal_contactId_idx" ON "Deal"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadIntelligence_dealId_key" ON "LeadIntelligence"("dealId");

-- CreateIndex
CREATE INDEX "LeadIntelligence_interestStatus_idx" ON "LeadIntelligence"("interestStatus");

-- CreateIndex
CREATE INDEX "LeadIntelligence_score_idx" ON "LeadIntelligence"("score");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DealTag_dealId_tagId_key" ON "DealTag"("dealId", "tagId");

-- CreateIndex
CREATE INDEX "GoogleCalendarSource_systemSettingsId_sortOrder_idx" ON "GoogleCalendarSource"("systemSettingsId", "sortOrder");

-- CreateIndex
CREATE INDEX "GoogleCalendarSource_systemSettingsId_isSpecialist_idx" ON "GoogleCalendarSource"("systemSettingsId", "isSpecialist");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarSource_systemSettingsId_calendarId_key" ON "GoogleCalendarSource"("systemSettingsId", "calendarId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_parentAppointmentId_fkey" FOREIGN KEY ("parentAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentReminder" ADD CONSTRAINT "AppointmentReminder_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specialist" ADD CONSTRAINT "Specialist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specialist" ADD CONSTRAINT "Specialist_googleCalendarSourceId_fkey" FOREIGN KEY ("googleCalendarSourceId") REFERENCES "GoogleCalendarSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialistService" ADD CONSTRAINT "SpecialistService_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialistService" ADD CONSTRAINT "SpecialistService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialistAvailabilityBlock" ADD CONSTRAINT "SpecialistAvailabilityBlock_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsultation" ADD CONSTRAINT "PatientConsultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsultation" ADD CONSTRAINT "PatientConsultation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsultation" ADD CONSTRAINT "PatientConsultation_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsultation" ADD CONSTRAINT "PatientConsultation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PatientConsultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientEvolutionNote" ADD CONSTRAINT "PatientEvolutionNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientEvolutionNote" ADD CONSTRAINT "PatientEvolutionNote_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "PatientConsultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientBudget" ADD CONSTRAINT "PatientBudget_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientClinicalAnalysis" ADD CONSTRAINT "PatientClinicalAnalysis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashClosure" ADD CONSTRAINT "CashClosure_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogAsset" ADD CONSTRAINT "CatalogAsset_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogConversationState" ADD CONSTRAINT "CatalogConversationState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogConversationState" ADD CONSTRAINT "CatalogConversationState_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkCampaign" ADD CONSTRAINT "BulkCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkCampaignVariant" ADD CONSTRAINT "BulkCampaignVariant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BulkCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkCampaignRecipient" ADD CONSTRAINT "BulkCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BulkCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkCampaignRecipient" ADD CONSTRAINT "BulkCampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkCampaignRecipient" ADD CONSTRAINT "BulkCampaignRecipient_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkCampaignRecipient" ADD CONSTRAINT "BulkCampaignRecipient_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "BulkCampaignVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadIntelligence" ADD CONSTRAINT "LeadIntelligence_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageAutomation" ADD CONSTRAINT "StageAutomation_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageAutomation" ADD CONSTRAINT "StageAutomation_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealTag" ADD CONSTRAINT "DealTag_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealTag" ADD CONSTRAINT "DealTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarSource" ADD CONSTRAINT "GoogleCalendarSource_systemSettingsId_fkey" FOREIGN KEY ("systemSettingsId") REFERENCES "SystemSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
