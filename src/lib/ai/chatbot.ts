import type OpenAI from "openai";
import { prisma } from "@/lib/db";
import { generateCompletion } from "@/lib/ai/openai";
import { buildKnowledgeContext } from "@/lib/brain/knowledge";
import { getSystemSettingsOrDefaults, type AppSystemSettings } from "@/lib/system-settings";
import { formatBusinessScheduleLines, normalizeBusinessHours } from "@/lib/calendar/business-hours";
import { getContactFullName } from "@/lib/contact-name";
import { buildBeautyBusinessContext } from "@/lib/ai/beauty-business-context";

type AssistantHistoryEntry = {
    content: string;
    direction: string;
    senderType: string | null;
};

type AssistantIdentityContext = {
    contactName: string;
    contactPhone: string;
    contactCompany: string;
    contactStatus: string;
    advisorName: string;
    advisorEmail: string;
};

export type AssistantPreviewMessage = {
    role: "user" | "assistant";
    content: string;
};

export type AssistantPreviewResult = {
    reply: string;
    trace: {
        model: string;
        structuredSources: string[];
        knowledgeSources: Array<{
            title: string;
            uri: string | null;
        }>;
        operationalActionsExecuted: false;
    };
};

function mapHistoryToMessages(
    history: Array<{
        content: string;
        direction: string;
        senderType: string | null;
    }>,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return history
        .filter((message) => message.content?.trim())
        .map((message) => ({
            role:
                message.direction === "outbound" || message.senderType === "bot"
                    ? "assistant"
                    : "user",
            content: message.content,
        }));
}

function normalizeWhatsAppReply(text: string) {
    const normalized = text
        .replace(/\r\n?/g, "\n")
        .replace(/\*\*([^*]+)\*\*/g, "*$1*")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!normalized || normalized.includes("\n") || normalized.length < 220) {
        return normalized;
    }

    const sentences =
        normalized.match(/[^.!?]+[.!?]*/g)?.map((sentence) => sentence.trim()).filter(Boolean) ||
        [normalized];

    if (sentences.length <= 1) {
        return normalized;
    }

    const paragraphs: string[] = [];
    let currentParagraph = "";

    for (const sentence of sentences) {
        if (!currentParagraph) {
            currentParagraph = sentence;
            continue;
        }

        if (`${currentParagraph} ${sentence}`.length <= 180) {
            currentParagraph = `${currentParagraph} ${sentence}`;
            continue;
        }

        paragraphs.push(currentParagraph);
        currentParagraph = sentence;
    }

    if (currentParagraph) {
        paragraphs.push(currentParagraph);
    }

    return paragraphs.join("\n\n");
}

function stripUnverifiedAdvisorLines(
    text: string,
    verifiedAdvisor?: {
        name?: string | null;
        email?: string | null;
    } | null,
) {
    const advisorName = verifiedAdvisor?.name?.trim().toLowerCase() || "";
    const advisorEmail = verifiedAdvisor?.email?.trim().toLowerCase() || "";
    const lines = text
        .split("\n")
        .map((line) => line.trimEnd());

    const filtered = lines.filter((line) => {
        const normalized = line.trim().toLowerCase();
        if (!normalized) return true;

        const mentionsAdvisorRole = /\b(asesor|asesora|ejecutivo|ejecutiva|responsable|agente asignado|agente asignada)\b/i.test(line);
        const mentionsAdvisorContact = /\b(contactarl[oa]|contactar(?:lo|la)|escribirle|llamarle|puedes contactarl[oa]|puedes escribirle)\b/i.test(line);
        const hasPhoneOrEmail = /(?:\+?\d[\d\s()-]{7,}\d|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(line);
        const mentionsHumanContactContext = /\b(contacto|informes|correo|telefono|teléfono|whatsapp|llama|escribe)\b/i.test(line);

        if (!mentionsAdvisorRole && !mentionsAdvisorContact && !(hasPhoneOrEmail && mentionsHumanContactContext)) {
            return true;
        }

        const matchesVerifiedName = advisorName ? normalized.includes(advisorName) : false;
        const matchesVerifiedEmail = advisorEmail ? normalized.includes(advisorEmail) : false;

        return matchesVerifiedName || matchesVerifiedEmail;
    });

    return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildKnowledgeLookupQuery(
    history: AssistantHistoryEntry[],
    latestUserMessage: string,
) {
    const recentInboundMessages = history
        .filter((message) => message.direction === "inbound" && message.content?.trim())
        .slice(-3)
        .map((message) => message.content.trim());

    return [...recentInboundMessages, latestUserMessage]
        .map((message) => message.trim())
        .filter(Boolean)
        .join("\n");
}

function buildAssistantSystemPrompt(params: {
    settings: AppSystemSettings;
    businessContext: string;
    businessScheduleLines: string;
    businessTimeZone: string;
    identity: AssistantIdentityContext;
    knowledgeContext: string;
    knowledgeSourceLines: string;
    automationInstruction?: string | null;
}) {
    const {
        settings,
        businessContext,
        businessScheduleLines,
        businessTimeZone,
        identity,
        knowledgeContext,
        knowledgeSourceLines,
        automationInstruction,
    } = params;

    return `
${settings.agentPrompt}

${businessContext}

IDENTIDAD DEL AGENTE
- Nombre del agente o marca: ${settings.agentName || "Asistente Zen"}

DATOS DEL CONTACTO
- Nombre: ${identity.contactName}
- Telefono: ${identity.contactPhone}
- Empresa: ${identity.contactCompany}
- Estado: ${identity.contactStatus}

RESPONSABLE HUMANO VERIFICADO EN CRM
- Nombre: ${identity.advisorName}
- Email: ${identity.advisorEmail}

REGLAS DE RESPUESTA
- Responde siempre en espanol.
- Se breve y util. Evita respuestas largas salvo que el usuario las pida.
- Si el usuario pide algo que no esta en el contexto, dilo con honestidad.
- Si el mensaje es ambiguo, haz una sola pregunta aclaratoria.
- Si la conversacion apunta a venta o seguimiento, intenta cerrar con un siguiente paso concreto.
- Si el usuario hace una pregunta de seguimiento como "si", "esas", "las casas", "ahi" o "de eso", usa el contexto inmediato de la conversacion para entender a que se refiere.
- Si recibes una instruccion operativa adicional, siguela sin romper el hilo de la conversacion.
- No cambies abruptamente a preguntas genericas si el usuario ya esta hablando de un tema concreto.
- No repitas muletillas o frases de arranque como "Si, claro que si", salvo que realmente aporten algo.
- No respondas mas de lo que el cliente pregunto si no hace falta.
- Si no tienes informacion fiable o suficiente para responder, dilo con honestidad y avisa brevemente que vas a canalizar la conversacion con un asesor humano.
- Si el usuario quiere una cita, ayuda a concretarla dentro del horario comercial del negocio.
- Nunca afirmes que una cita fue registrada, agendada, confirmada, actualizada, reprogramada o cancelada. Esas confirmaciones solo las envia el modulo operativo despues de escribir el cambio en el calendario.
- Al hablar de una cita usa siempre la fecha completa con dia, mes y año; no confirmes usando solamente expresiones relativas como "el proximo martes".
- Nunca inventes ni calcules horarios libres a partir del horario comercial. Solo el modulo operativo puede ofrecer horas despues de consultar citas, bloqueos y retenciones vigentes en el calendario de la profesional elegida.
- El horario de apertura y cierre no demuestra que una hora concreta esté libre. Si la INSTRUCCION OPERATIVA ACTUAL no contiene horas verificadas, no menciones ninguna hora como disponible: pide primero el servicio y, cuando corresponda, la profesional y el día.
- Si hay varias profesionales, pregunta con cual desea la cita y consulta unicamente la agenda de esa profesional.
- Si solo existe una profesional activa, seleccionala automaticamente y no preguntes con quien desea atenderse.
- Nunca inventes nombres, telefonos ni correos de asesores, ejecutivos o responsables.
- Solo puedes mencionar un responsable humano si aparece en los DATOS VERIFICADOS DEL CRM.
- Nunca inventes telefonos de personas del equipo. Si no existe un dato verificado, omitelo.
- Nunca menciones al cliente acciones internas del negocio como alertas internas, correos internos, notificaciones al equipo o asuntos de correo.
- Si el cliente pregunta con quien habla o quien le atiende, puedes usar el nombre del agente o marca indicado en IDENTIDAD DEL AGENTE.
- Horario comercial por dia:
${businessScheduleLines}
- Zona horaria del negocio: ${businessTimeZone}
- Formatea para WhatsApp: usa saltos de linea entre ideas, pasos, precios y cierre.
- No amontones la informacion: usa parrafos cortos de 1 o 2 frases maximo.
- Si enumeras beneficios, opciones o pasos, usa una lista simple con cada punto en su propia linea.
- Para resaltar algo usa *negritas* con un solo asterisco. No uses **doble asterisco**, encabezados Markdown ni tablas.
- Mantena un tono amable, profesional y claro. Usa pocos emojis y solo si aportan.

CONTEXTO RAG
${knowledgeContext || "No se recuperaron fuentes relevantes para esta consulta."}

FUENTES ENCONTRADAS
${knowledgeSourceLines || "- Ninguna"}

INSTRUCCION OPERATIVA ACTUAL
${automationInstruction || "Ninguna. Responde de forma normal."}
    `.trim();
}

async function generateConfiguredAssistantReply(params: {
    settings: AppSystemSettings;
    latestUserMessage: string;
    history: AssistantHistoryEntry[];
    identity: AssistantIdentityContext;
    automationInstruction?: string | null;
}) {
    const businessHours = normalizeBusinessHours(params.settings);
    const businessContext = await buildBeautyBusinessContext(params.settings);
    const history = mapHistoryToMessages(params.history);
    const knowledgeLookupQuery = buildKnowledgeLookupQuery(params.history, params.latestUserMessage);
    const { context, chunks } = await buildKnowledgeContext(
        knowledgeLookupQuery || params.latestUserMessage,
        params.settings.knowledgeTopK,
    );
    const knowledgeSourceLines = chunks
        .map((chunk) => `- ${chunk.sourceTitle}${chunk.sourceUri ? ` -> ${chunk.sourceUri}` : ""}`)
        .join("\n");
    const systemPrompt = buildAssistantSystemPrompt({
        settings: params.settings,
        businessContext,
        businessScheduleLines: formatBusinessScheduleLines(businessHours),
        businessTimeZone: businessHours.timeZone,
        identity: params.identity,
        knowledgeContext: context,
        knowledgeSourceLines,
        automationInstruction: params.automationInstruction,
    });
    const response = await generateCompletion(
        [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: params.latestUserMessage },
        ],
        params.settings.agentTemperature,
    );
    const normalized = normalizeWhatsAppReply(response || "");

    return {
        reply: stripUnverifiedAdvisorLines(normalized, {
            name: params.identity.advisorName,
            email: params.identity.advisorEmail,
        }),
        knowledgeSources: Array.from(
            new Map(
                chunks.map((chunk) => [
                    `${chunk.sourceTitle}:${chunk.sourceUri || ""}`,
                    { title: chunk.sourceTitle, uri: chunk.sourceUri },
                ]),
            ).values(),
        ),
    };
}

export async function generateConversationReply(
    conversationId: string,
    latestUserMessage: string,
    automationInstruction?: string | null,
) {
    const [settings, conversation] = await Promise.all([
        getSystemSettingsOrDefaults(),
        prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
                contact: true,
                assignedUser: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
                messages: {
                    where: {
                        type: {
                            not: "system",
                        },
                    },
                    orderBy: { createdAt: "desc" },
                    take: 16,
                },
            },
        }),
    ]);

    if (!conversation) {
        throw new Error("Conversacion no encontrada.");
    }

    const baseHistory = [...conversation.messages].reverse().map((message) => ({
        content: message.content,
        direction: message.direction,
        senderType: message.senderType,
    }));
    const dedupedHistory =
        baseHistory.length > 0 &&
        baseHistory[baseHistory.length - 1].direction === "inbound" &&
        baseHistory[baseHistory.length - 1].content === latestUserMessage
            ? baseHistory.slice(0, -1)
            : baseHistory;

    const result = await generateConfiguredAssistantReply({
        settings,
        latestUserMessage,
        history: dedupedHistory,
        identity: {
            contactName: getContactFullName(conversation.contact, "Sin nombre"),
            contactPhone: conversation.contact?.phone || "Sin telefono",
            contactCompany: conversation.contact?.company || "No registrada",
            contactStatus: conversation.contact?.status || "lead",
            advisorName: conversation.assignedUser?.name || "No asignado",
            advisorEmail: conversation.assignedUser?.email || "No disponible",
        },
        automationInstruction,
    });

    return result.reply;
}

export async function generateAssistantPreview(input: {
    message: string;
    history?: AssistantPreviewMessage[];
}): Promise<AssistantPreviewResult> {
    const settings = await getSystemSettingsOrDefaults();
    const safeHistory = (input.history || []).slice(-12).map((message) => ({
        content: message.content.trim().slice(0, 2000),
        direction: message.role === "assistant" ? "outbound" : "inbound",
        senderType: message.role === "assistant" ? "bot" : null,
    }));
    const result = await generateConfiguredAssistantReply({
        settings,
        latestUserMessage: input.message.trim().slice(0, 2000),
        history: safeHistory,
        identity: {
            contactName: "Cliente de prueba",
            contactPhone: "No disponible en el simulador",
            contactCompany: "No registrada",
            contactStatus: "lead",
            advisorName: "No asignado",
            advisorEmail: "No disponible",
        },
        automationInstruction: [
            "MODO DE PRUEBA AISLADO.",
            "Evalua solamente la respuesta conversacional.",
            "No se ejecutan acciones, no se envia WhatsApp y no se consulta ni modifica una cita real.",
            "Si la solicitud requiere disponibilidad o una operacion de agenda, explica el siguiente dato que pedirias sin afirmar que realizaste la accion.",
        ].join(" "),
    });

    return {
        reply: result.reply,
        trace: {
            model: settings.openaiModel,
            structuredSources: [
                "Personalidad del agente",
                "Mi Negocio y políticas",
                "Servicios y duraciones",
                "Profesionales y horarios",
            ],
            knowledgeSources: result.knowledgeSources,
            operationalActionsExecuted: false,
        },
    };
}

export async function processBotResponse(contactId: string, userMessage: string) {
    const conversation = await prisma.conversation.findFirst({
        where: {
            contactId,
            status: "active",
        },
        orderBy: { updatedAt: "desc" },
    });

    if (!conversation) {
        throw new Error("No encontre una conversacion activa para este contacto.");
    }

    return generateConversationReply(conversation.id, userMessage);
}
