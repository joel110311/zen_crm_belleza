import { prisma } from "@/lib/db";
import { generateCompletion } from "@/lib/ai/openai";
import type { AppSystemSettings } from "@/lib/system-settings";
import {
    getBusinessDateKey,
    shiftDateKey,
    zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";

type PendingCaptureField = "name" | "email";

type LeadAutomationResult = {
    instruction: string | null;
    pendingCaptureField: PendingCaptureField | null;
};

type ExtractionResult = {
    value: string | null;
    declined: boolean;
};

const STRONG_INTENT_KEYWORDS = [
    "precio",
    "precios",
    "cotizacion",
    "cotizar",
    "costo",
    "costos",
    "informe",
    "informes",
    "informacion",
    "me interesa",
    "interesa",
    "quiero",
    "quisiera",
    "necesito",
    "agendar",
    "cita",
    "demo",
    "llamada",
    "reunion",
    "automatizar",
    "automatizacion",
    "crm",
    "plan",
    "planes",
    "paquete",
    "paquetes",
    "servicio",
    "servicios",
    "como funciona",
    "cómo funciona",
];

const DECISION_KEYWORDS = [
    "contratar",
    "comprar",
    "pagar",
    "pago",
    "transferencia",
    "comprobante",
    "factura",
    "facturacion",
];

const BUSINESS_CONTEXT_KEYWORDS = [
    "negocio",
    "empresa",
    "clientes",
    "ventas",
    "whatsapp",
    "soporte",
    "agenda",
    "calendario",
    "automatizar",
];

const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
const NAME_PREFIX_REGEX = /(?:mi nombre es|me llamo|soy|habla|hablo como|nombre completo(?: es)?|puedes poner(?:me)? como)\s+(.+)/i;
const NAME_REQUEST_CAPTURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeWhitespace(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

function normalizeForIntent(value: string) {
    return normalizeWhitespace(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function cleanCustomerName(value: string) {
    const withoutEmail = value.replace(EMAIL_REGEX, " ");
    const normalized = normalizeWhitespace(
        withoutEmail
            .replace(/[|/\\]+/g, " ")
            .replace(/^[^A-Za-zÁÉÍÓÚáéíóúÑñÜü]+/u, "")
            .replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü.' -]+$/u, ""),
    );

    return normalized.replace(/\s{2,}/g, " ").trim();
}

function splitFullName(fullName: string) {
    const parts = cleanCustomerName(fullName)
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length === 0) {
        return { name: null, lastName: null };
    }

    if (parts.length === 1) {
        return { name: parts[0], lastName: null };
    }

    return {
        name: parts[0],
        lastName: parts.slice(1).join(" "),
    };
}

function extractEmail(text: string) {
    return text.match(EMAIL_REGEX)?.[1]?.trim().toLowerCase() || null;
}

function detectFieldDecline(text: string, field: PendingCaptureField) {
    const normalized = text.toLowerCase();

    if (field === "email") {
        return (
            /\b(no tengo correo|sin correo|prefiero no compartir(?:lo)?|prefiero no dar(?:lo)?|mejor luego|despues te lo paso|después te lo paso)\b/i.test(normalized) ||
            /\bno\b/i.test(normalized)
        );
    }

    return (
        /\b(prefiero no decir(?:lo)?|mejor luego|despues te lo paso|después te lo paso)\b/i.test(normalized) ||
        normalized === "no"
    );
}

function looksLikeStandaloneName(text: string) {
    const normalizedSource = normalizeWhitespace(text);
    const loweredSource = normalizedSource.toLowerCase();

    if (!normalizedSource) return false;
    if (/[?!]/.test(normalizedSource)) return false;
    if (collectMatchedKeywords(loweredSource, STRONG_INTENT_KEYWORDS).length > 0) return false;
    if (collectMatchedKeywords(loweredSource, DECISION_KEYWORDS).length > 0) return false;
    if (collectMatchedKeywords(loweredSource, BUSINESS_CONTEXT_KEYWORDS).length > 0) return false;

    const withoutGreeting = normalizedSource.replace(
        /^(hola|buenas|buenos dias|buen dia|buen dia|buenas tardes|buenas noches)\s+/i,
        "",
    );
    const candidate = cleanCustomerName(withoutGreeting);
    if (!candidate) return false;
    if (candidate.length < 3 || candidate.length > 60) return false;
    if (/[0-9@]/.test(candidate)) return false;

    const parts = candidate.split(" ").filter(Boolean);
    if (parts.length === 0 || parts.length > 5) return false;

    return parts.every((part) => /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü.'-]+$/u.test(part));
}

function extractNameHeuristically(text: string) {
    const normalized = normalizeWhitespace(text);
    const prefixed = normalized.match(NAME_PREFIX_REGEX)?.[1];
    if (prefixed) {
        const candidate = cleanCustomerName(prefixed);
        return looksLikeStandaloneName(candidate) ? candidate : null;
    }

    if (looksLikeStandaloneName(normalized)) {
        return cleanCustomerName(normalized);
    }

    return null;
}

function safeJsonParse(text: string) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
        return null;
    }

    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

async function extractNameWithAi(text: string): Promise<ExtractionResult> {
    try {
        const response = await generateCompletion(
            [
                {
                    role: "system",
                    content:
                        "Extrae un nombre de persona en espanol desde el mensaje del usuario. Devuelve solo JSON valido con este formato exacto: {\"name\": string | null, \"declined\": boolean}. Si el usuario no comparte su nombre o lo evita, usa declined=true. No inventes nombres.",
                },
                {
                    role: "user",
                    content: text,
                },
            ],
            0,
        );

        const parsed = safeJsonParse(response || "");
        const candidate = cleanCustomerName(typeof parsed?.name === "string" ? parsed.name : "");

        return {
            value: looksLikeStandaloneName(candidate) ? candidate : null,
            declined: Boolean(parsed?.declined),
        };
    } catch {
        return { value: null, declined: false };
    }
}

async function extractNameValue(text: string, forceAi = false): Promise<ExtractionResult> {
    const heuristic = extractNameHeuristically(text);
    if (heuristic && !forceAi) {
        return { value: heuristic, declined: false };
    }

    const aiResult = await extractNameWithAi(text);
    if (aiResult.value || aiResult.declined) {
        return aiResult;
    }

    return {
        value: heuristic,
        declined: false,
    };
}

function collectMatchedKeywords(text: string, dictionary: string[]) {
    const haystack = text.toLowerCase();
    return dictionary.filter((keyword) => haystack.includes(keyword));
}

function calculateLeadScore(messageCount: number, combinedInboundText: string) {
    const strongMatches = collectMatchedKeywords(combinedInboundText, STRONG_INTENT_KEYWORDS);
    const decisionMatches = collectMatchedKeywords(combinedInboundText, DECISION_KEYWORDS);
    const businessMatches = collectMatchedKeywords(combinedInboundText, BUSINESS_CONTEXT_KEYWORDS);

    let score = messageCount * 15;
    score += Math.min(strongMatches.length, 3) * 10;
    score += Math.min(decisionMatches.length, 2) * 12;
    score += Math.min(businessMatches.length, 2) * 5;

    if (combinedInboundText.length >= 180) {
        score += 8;
    }

    if (messageCount >= 4) {
        score += 5;
    }

    return {
        score: Math.min(100, score),
        signals: [...new Set([...strongMatches, ...decisionMatches, ...businessMatches])],
    };
}

function containsAppointmentIntent(text: string) {
    return /\b(cita|agendar|agenda|demo|llamada|reunion|reunión|calendar|calendario)\b/i.test(text);
}

function assistantAskedForCustomerName(text?: string | null) {
    const normalized = normalizeForIntent(text || "");
    if (!normalized) return false;

    const mentionsName =
        /\bnombre completo\b/.test(normalized) ||
        /\bnombre real\b/.test(normalized) ||
        /\btu nombre\b/.test(normalized) ||
        /\bcomo te llamas\b/.test(normalized) ||
        /\bcomo puedo llamarte\b/.test(normalized);
    const asksForName =
        /\b(me compartes|comparteme|compartir|compartas|podrias|puedes|dime|cual es|registrarte|agendarte)\b/.test(normalized) ||
        normalized.includes("como te llamas") ||
        normalized.includes("como puedo llamarte");

    return mentionsName && asksForName;
}

function buildSavedDataNote(name: string | null, email: string | null) {
    const parts = [
        name ? `nombre: ${name}` : null,
        email ? `email: ${email}` : null,
    ].filter(Boolean);

    if (parts.length === 0) return null;

    return `Datos guardados: ${parts.join(", ")}`;
}

function getNextPendingCaptureField(
    settings: AppSystemSettings,
    state: {
        nameCaptured: boolean;
        emailCaptured: boolean;
        nameDeclined: boolean;
        emailDeclined: boolean;
        nameAsked: boolean;
        emailAsked: boolean;
    },
): PendingCaptureField | null {
    if (
        settings.captureLeadName &&
        !state.nameCaptured &&
        !state.nameDeclined &&
        !state.nameAsked
    ) {
        return "name";
    }

    if (
        settings.captureLeadEmail &&
        !state.emailCaptured &&
        !state.emailDeclined &&
        !state.emailAsked
    ) {
        return "email";
    }

    return null;
}

function resolveIntelligenceState(params: {
    thresholdReached: boolean;
    score: number;
    threshold: number;
    nextPendingField: PendingCaptureField | null;
}) {
    const { thresholdReached, score, threshold, nextPendingField } = params;

    if (!thresholdReached) {
        return {
            interestStatus: score >= Math.max(25, Math.round(threshold * 0.65)) ? "interesado" : "nuevo",
            currentStep: "inicio",
            stepProgress: Math.min(40, score),
        };
    }

    if (nextPendingField === "name") {
        return {
            interestStatus: "interesado",
            currentStep: "captura_nombre",
            stepProgress: 60,
        };
    }

    if (nextPendingField === "email") {
        return {
            interestStatus: "interesado",
            currentStep: "captura_email",
            stepProgress: 82,
        };
    }

    return {
        interestStatus: "calificado",
        currentStep: "calificado",
        stepProgress: 100,
    };
}

function buildAskForNameReply() {
    return "Veo buen interes y quiero dejar bien tus datos.\n\n¿Me compartes tu *nombre completo*?";
}

function buildAskForEmailReply(nameWasCaptured: boolean) {
    return nameWasCaptured
        ? "Perfecto, ya guardé tu nombre.\n\nAhora, ¿me compartes tu *correo electrónico*?"
        : "Perfecto.\n\nPara enviarte la información y dar seguimiento, ¿me compartes tu *correo electrónico*?";
}

function buildPostCaptureReply(params: {
    savedName: string | null;
    savedEmail: string | null;
    appointmentIntent: boolean;
    declinedField: PendingCaptureField | null;
}) {
    const savedParts = [
        params.savedName ? "tu nombre" : null,
        params.savedEmail ? "tu correo" : null,
    ].filter(Boolean);

    const opening =
        params.declinedField && savedParts.length === 0
            ? "No hay problema."
            : savedParts.length > 0
                ? `Perfecto, ya guardé ${savedParts.join(" y ")}.`
                : "Perfecto.";

    if (params.appointmentIntent) {
        return `${opening}\n\nSi quieres agendar, dime por favor *qué día y a qué hora* te funciona mejor.`;
    }

    return `${opening}\n\n¿Qué tipo de negocio tienes y qué te gustaría automatizar?`;
}

function buildLeadAutomationInstruction(params: {
    nextPendingField: PendingCaptureField | null;
    savedName: string | null;
    savedEmail: string | null;
    appointmentIntent: boolean;
    declinedField: PendingCaptureField | null;
    thresholdReached: boolean;
}) {
    if (params.thresholdReached && params.nextPendingField === "name") {
        return [
            "Acabas de detectar interes real del cliente.",
            "Responde siguiendo la identidad del agente, el contexto reciente y el conocimiento cargado.",
            "Pide ahora el nombre real o nombre completo del cliente con una sola pregunta breve y natural.",
            "No afirmes que ya guardaste su nombre y no cambies de tema.",
        ].join(" ");
    }

    if (params.thresholdReached && params.nextPendingField === "email") {
        return [
            params.savedName
                ? `Acabas de guardar el nombre del cliente (${params.savedName}).`
                : "Ya se cubrio la captura del nombre.",
            "Responde siguiendo la identidad del agente, el contexto reciente y el conocimiento cargado.",
            "Pide ahora su correo electronico con una sola pregunta breve y natural, sin sonar robotico.",
            "Manten el hilo del tema actual y no cambies a preguntas genericas.",
        ].join(" ");
    }

    if (params.savedName || params.savedEmail || params.declinedField) {
        const facts = [
            params.savedName ? `Se guardo el nombre: ${params.savedName}.` : null,
            params.savedEmail ? `Se guardo el correo: ${params.savedEmail}.` : null,
            params.declinedField ? `El cliente prefirio no compartir su ${params.declinedField === "name" ? "nombre" : "correo"}.` : null,
        ].filter(Boolean);

        return [
            ...facts,
            "Responde siguiendo la identidad del agente, el contexto reciente y el conocimiento cargado.",
            params.appointmentIntent
                ? "Continua la conversacion enfocandote en concretar la cita o el siguiente dato necesario para agendar."
                : "Continua exactamente en el tema actual de la conversacion, sin reiniciar el discovery ni hacer preguntas genericas fuera de contexto.",
            "Si confirmas el guardado, hazlo de forma breve y natural.",
        ].join(" ");
    }

    return null;
}

async function ensureLeadIntelligence(
    dealId: string,
    contact: {
        email: string | null;
    } | null,
) {
    const existing = await prisma.leadIntelligence.findUnique({
        where: { dealId },
    });

    if (existing) {
        if (!existing.emailCaptured && contact?.email) {
            return prisma.leadIntelligence.update({
                where: { id: existing.id },
                data: {
                    emailCaptured: true,
                    capturedEmail: contact.email,
                    capturedEmailAt: existing.capturedEmailAt || new Date(),
                },
            });
        }

        return existing;
    }

    return prisma.leadIntelligence.create({
        data: {
            dealId,
            emailCaptured: Boolean(contact?.email),
            capturedEmail: contact?.email || null,
            capturedEmailAt: contact?.email ? new Date() : null,
        },
    });
}

export async function processLeadAutomationTurn(params: {
    conversationId: string;
    latestUserMessage: string;
    settings: AppSystemSettings;
}): Promise<LeadAutomationResult> {
    const { conversationId, latestUserMessage, settings } = params;

    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
            contact: true,
        },
    });

    if (!conversation?.contactId) {
        return { instruction: null, pendingCaptureField: null };
    }

    const deal = await prisma.deal.findFirst({
        where: { contactId: conversation.contactId },
        include: {
            stage: true,
            intelligence: true,
        },
        orderBy: { updatedAt: "desc" },
    });

    if (!deal) {
        return { instruction: null, pendingCaptureField: null };
    }

    const intelligence = await ensureLeadIntelligence(deal.id, conversation.contact);
    const latestInboundMessage = await prisma.message.findFirst({
        where: {
            conversationId,
            direction: "inbound",
        },
        orderBy: { createdAt: "desc" },
        select: {
            content: true,
            createdAt: true,
            type: true,
        },
    });
    const latestOutboundBeforeInbound = latestInboundMessage
        ? await prisma.message.findFirst({
            where: {
                conversationId,
                direction: "outbound",
                type: { not: "system" },
                createdAt: { lt: latestInboundMessage.createdAt },
            },
            orderBy: { createdAt: "desc" },
            select: {
                content: true,
                createdAt: true,
            },
        })
        : null;

    const timeZone = settings.businessTimeZone || "America/Mexico_City";
    const threshold = Math.max(15, settings.leadInterestThreshold || 45);

    let sameDayInboundCount = intelligence.sameDayInboundCount;
    let score = intelligence.score;
    let signals: string[] = Array.isArray(intelligence.signals) ? intelligence.signals.filter((item): item is string => typeof item === "string") : [];
    let businessDateKey: string | null = null;

    if (latestInboundMessage && settings.leadScoringEnabled) {
        businessDateKey = getBusinessDateKey(latestInboundMessage.createdAt, timeZone);
        const startOfDay = zonedDateTimeToUtc(businessDateKey, "00:00", timeZone);
        const nextDay = zonedDateTimeToUtc(shiftDateKey(businessDateKey, 1), "00:00", timeZone);
        const sameDayMessages = await prisma.message.findMany({
            where: {
                conversationId,
                direction: "inbound",
                createdAt: {
                    gte: startOfDay,
                    lt: nextDay,
                },
                type: {
                    not: "system",
                },
            },
            orderBy: { createdAt: "asc" },
            select: { content: true },
        });

        sameDayInboundCount = sameDayMessages.length;
        const scoreResult = calculateLeadScore(
            sameDayInboundCount,
            sameDayMessages.map((message) => message.content || "").join("\n"),
        );
        score = scoreResult.score;
        signals = scoreResult.signals;
    }

    const alreadyInterested = Boolean(
        intelligence.interestDetectedAt ||
        intelligence.interestStatus === "interesado" ||
        intelligence.interestStatus === "calificado",
    );

    if (alreadyInterested) {
        score = Math.max(score, threshold);
    }

    const thresholdReached = settings.leadScoringEnabled && (score >= threshold || alreadyInterested);
    const appointmentIntent = containsAppointmentIntent(latestUserMessage);
    const pendingCaptureField = intelligence.pendingCaptureField as PendingCaptureField | null;

    let nameCaptured = intelligence.nameCaptured;
    let emailCaptured = intelligence.emailCaptured;
    let nameDeclined = intelligence.nameDeclined;
    let emailDeclined = intelligence.emailDeclined;
    let capturedName = intelligence.capturedName;
    let capturedEmail = intelligence.capturedEmail || conversation.contact?.email || null;
    const nameAskedBefore = Boolean(intelligence.askedForNameAt);
    const emailAskedBefore = Boolean(intelligence.askedForEmailAt);

    let savedNameThisTurn = false;
    let savedEmailThisTurn = false;
    let declinedFieldThisTurn: PendingCaptureField | null = null;
    const latestTextMessageForCapture =
        latestInboundMessage?.type === "text"
            ? latestInboundMessage.content || latestUserMessage
            : "";

    const directEmail =
        thresholdReached && settings.captureLeadEmail && !emailCaptured && latestTextMessageForCapture
            ? extractEmail(latestTextMessageForCapture)
            : null;
    const latestOutboundAskedForName = Boolean(
        latestInboundMessage &&
        latestOutboundBeforeInbound &&
        latestInboundMessage.createdAt.getTime() - latestOutboundBeforeInbound.createdAt.getTime() <= NAME_REQUEST_CAPTURE_WINDOW_MS &&
        assistantAskedForCustomerName(latestOutboundBeforeInbound.content),
    );
    const shouldTryNameCapture =
        thresholdReached &&
        settings.captureLeadName &&
        !nameCaptured &&
        Boolean(latestTextMessageForCapture) &&
        (
            pendingCaptureField === "name" ||
            NAME_PREFIX_REGEX.test(latestTextMessageForCapture) ||
            (latestOutboundAskedForName && looksLikeStandaloneName(latestTextMessageForCapture))
        );
    const nameExtraction = shouldTryNameCapture
        ? await extractNameValue(latestTextMessageForCapture, pendingCaptureField === "name" || latestOutboundAskedForName)
        : { value: null, declined: false };

    if (pendingCaptureField === "name" && latestTextMessageForCapture && detectFieldDecline(latestTextMessageForCapture, "name")) {
        nameDeclined = true;
        declinedFieldThisTurn = "name";
    } else if (shouldTryNameCapture && nameExtraction.declined) {
        nameDeclined = true;
        declinedFieldThisTurn = "name";
    } else if (shouldTryNameCapture && nameExtraction.value) {
        capturedName = nameExtraction.value;
        nameCaptured = true;
        nameDeclined = false;
        savedNameThisTurn = true;
    }

    if (pendingCaptureField === "email" && latestTextMessageForCapture && detectFieldDecline(latestTextMessageForCapture, "email")) {
        emailDeclined = true;
        declinedFieldThisTurn = "email";
    } else if (directEmail) {
        capturedEmail = directEmail;
        emailCaptured = true;
        emailDeclined = false;
        savedEmailThisTurn = true;
    }

    const nextPendingField = getNextPendingCaptureField(settings, {
        nameCaptured,
        emailCaptured,
        nameDeclined,
        emailDeclined,
        nameAsked: nameAskedBefore,
        emailAsked: emailAskedBefore,
    });

    const intelligenceState = resolveIntelligenceState({
        thresholdReached,
        score,
        threshold,
        nextPendingField: thresholdReached ? nextPendingField : null,
    });

    const stageToMove = thresholdReached
        ? await (async () => {
            const orderedActiveStages = await prisma.pipelineStage.findMany({
                where: {
                    isClosedWon: false,
                    isClosedLost: false,
                },
                orderBy: { order: "asc" },
                select: { id: true, isIncoming: true },
            });

            if (orderedActiveStages.length === 0) return null;

            const secondStageByPosition = orderedActiveStages.length > 1 ? orderedActiveStages[1] : null;
            const fallbackFirstNonIncoming = orderedActiveStages.find((stage) => !stage.isIncoming) || null;
            const targetQualifiedStage = secondStageByPosition || fallbackFirstNonIncoming;

            if (!targetQualifiedStage) return null;
            if (deal.stageId === targetQualifiedStage.id) return null;

            const isIncomingDeal = Boolean(deal.stage?.isIncoming);
            return isIncomingDeal ? targetQualifiedStage : null;
        })()
        : null;

    const nameParts = capturedName ? splitFullName(capturedName) : { name: null, lastName: null };
    const noteText = savedNameThisTurn || savedEmailThisTurn ? buildSavedDataNote(capturedName, capturedEmail) : null;
    const shouldAskForNextField = Boolean(
        thresholdReached &&
        nextPendingField &&
        !(
            (nextPendingField === "name" && nameAskedBefore) ||
            (nextPendingField === "email" && emailAskedBefore)
        ) &&
        (
            pendingCaptureField !== nextPendingField ||
            savedNameThisTurn ||
            savedEmailThisTurn ||
            declinedFieldThisTurn
        ),
    );

    await prisma.$transaction(async (tx) => {
        if (savedNameThisTurn || savedEmailThisTurn || thresholdReached || settings.leadScoringEnabled) {
            await tx.leadIntelligence.update({
                where: { id: intelligence.id },
                data: {
                    score,
                    interestStatus: intelligenceState.interestStatus,
                    currentStep: intelligenceState.currentStep,
                    stepProgress: intelligenceState.stepProgress,
                    pendingCaptureField: thresholdReached ? nextPendingField : null,
                    nameCaptured,
                    emailCaptured,
                    nameDeclined,
                    emailDeclined,
                    capturedName,
                    capturedEmail,
                    askedForNameAt:
                        shouldAskForNextField && nextPendingField === "name"
                            ? new Date()
                            : intelligence.askedForNameAt,
                    askedForEmailAt:
                        shouldAskForNextField && nextPendingField === "email"
                            ? new Date()
                            : intelligence.askedForEmailAt,
                    capturedNameAt:
                        savedNameThisTurn
                            ? new Date()
                            : intelligence.capturedNameAt,
                    capturedEmailAt:
                        savedEmailThisTurn
                            ? new Date()
                            : intelligence.capturedEmailAt,
                    interestDetectedAt:
                        thresholdReached
                            ? intelligence.interestDetectedAt || new Date()
                            : intelligence.interestDetectedAt,
                    ...(settings.leadScoringEnabled
                        ? {
                            lastScoredAt: new Date(),
                            sameDayInboundCount,
                            lastSummary: businessDateKey
                                ? `${sameDayInboundCount} mensajes del ${businessDateKey}${signals.length ? `. Senales: ${signals.join(", ")}` : ""}`
                                : intelligence.lastSummary,
                            signals: {
                                sameDayInboundCount,
                                threshold,
                                thresholdReached,
                                matchedSignals: signals,
                                businessDateKey,
                            },
                        }
                        : {}),
                },
            });
        }

        if (savedNameThisTurn || savedEmailThisTurn || thresholdReached) {
            await tx.contact.update({
                where: { id: conversation.contactId },
                data: {
                    ...(savedNameThisTurn
                        ? {
                            name: nameParts.name,
                            lastName: nameParts.lastName,
                        }
                        : {}),
                    ...(savedEmailThisTurn ? { email: capturedEmail } : {}),
                    ...(thresholdReached && conversation.contact?.status !== "customer" ? { status: "qualified" } : {}),
                },
            });
        }

        if (stageToMove?.id) {
            await tx.deal.update({
                where: { id: deal.id },
                data: { stageId: stageToMove.id },
            });
        }

        if (noteText) {
            await tx.message.create({
                data: {
                    conversationId,
                    content: noteText,
                    direction: "outbound",
                    status: "sent",
                    type: "system",
                    senderType: "system",
                },
            });
        }
    });

    if (shouldAskForNextField || savedNameThisTurn || savedEmailThisTurn || declinedFieldThisTurn) {
        return {
            instruction: buildLeadAutomationInstruction({
                nextPendingField: shouldAskForNextField ? nextPendingField : null,
                savedName: savedNameThisTurn ? capturedName : null,
                savedEmail: savedEmailThisTurn ? capturedEmail : null,
                appointmentIntent,
                declinedField: declinedFieldThisTurn,
                thresholdReached,
            }),
            pendingCaptureField: thresholdReached ? nextPendingField : null,
        };
    }

    return {
        instruction: null,
        pendingCaptureField: thresholdReached ? nextPendingField : null,
    };
}
