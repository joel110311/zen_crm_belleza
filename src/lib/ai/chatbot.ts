import type OpenAI from "openai";
import { prisma } from "@/lib/db";
import { generateCompletion } from "@/lib/ai/openai";
import { buildKnowledgeContext } from "@/lib/brain/knowledge";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { formatBusinessScheduleLines, normalizeBusinessHours } from "@/lib/calendar/business-hours";
import { getContactFullName } from "@/lib/contact-name";
import { resolvePhoneLadaContext } from "@/lib/phone";

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
    history: Array<{
        content: string;
        direction: string;
        senderType: string | null;
    }>,
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

function normalizeAmbiguousNumericToken(token: string) {
    return token.replace(/[oO]/g, "0");
}

function extractRecentQuantityFact(messages: string[]) {
    for (const message of [...messages].reverse()) {
        const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const candidates = normalized.match(/\b[0-9o]{2,5}\b/g) || [];

        for (const candidate of candidates) {
            if (!/\d/.test(candidate)) continue;

            const parsed = Number.parseInt(normalizeAmbiguousNumericToken(candidate), 10);
            if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) continue;

            const hasQuantityContext =
                /\b(piezas?|pulseras?|invitados?|personas?|pax|cantidad|aprox|aproximadamente)\b/.test(normalized) ||
                normalized.trim() === candidate ||
                /\b(el|las|los)\s+[0-9o]{2,5}\b/.test(normalized);

            if (hasQuantityContext) {
                return {
                    value: parsed,
                    raw: message.trim(),
                };
            }
        }
    }

    return null;
}

function extractRecentEventDateFact(messages: string[]) {
    for (const message of [...messages].reverse()) {
        const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const monthMatch = normalized.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
        if (!monthMatch) continue;

        return {
            value: monthMatch[1],
            isTentative: /\b(no\s+esta\s+fija|no\s+es\s+fija|tentativa|aprox|aproximada|por\s+definir)\b/.test(normalized),
            raw: message.trim(),
        };
    }

    return null;
}

function buildRecentSalesFactsInstruction(
    history: Array<{
        content: string;
        direction: string;
        senderType: string | null;
    }>,
    latestUserMessage: string,
) {
    const recentInboundMessages = [
        ...history
            .filter((message) => message.direction === "inbound" && message.content?.trim())
            .slice(-6)
            .map((message) => message.content.trim()),
        latestUserMessage.trim(),
    ].filter(Boolean);

    const quantityFact = extractRecentQuantityFact(recentInboundMessages);
    const eventDateFact = extractRecentEventDateFact(recentInboundMessages);
    const lines: string[] = [];

    if (quantityFact) {
        lines.push(`- Cantidad detectada: ${quantityFact.value} piezas. Mensaje origen: "${quantityFact.raw}".`);
    }

    if (eventDateFact) {
        lines.push(`- Fecha/mes de evento detectado: ${eventDateFact.value}${eventDateFact.isTentative ? " (tentativa/no fija)" : ""}. Mensaje origen: "${eventDateFact.raw}".`);
    }

    if (lines.length === 0) {
        return null;
    }

    return [
        "DATOS COMERCIALES RECIENTES DETECTADOS",
        ...lines,
        "Reglas:",
        "- Si ya hay cantidad detectada, no vuelvas a preguntar cuantas piezas/invitados necesita; usala para cotizar o avanzar.",
        "- Si la fecha del evento es tentativa o no fija, no bloquees la cotizacion; aclara que puede ajustarse cuando confirme fecha.",
        "- Si el usuario escribe una cantidad con letras parecidas a numeros, por ejemplo 1oo, interpretala como 100 cuando el contexto sea piezas, invitados o cotizacion.",
    ].join("\n");
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
    const businessHours = normalizeBusinessHours(settings);
    const ladaContext = resolvePhoneLadaContext(conversation.contact?.phone || null);

    const dedupedHistory =
        baseHistory.length > 0 &&
        baseHistory[baseHistory.length - 1].direction === "inbound" &&
        baseHistory[baseHistory.length - 1].content === latestUserMessage
            ? baseHistory.slice(0, -1)
            : baseHistory;

    const history = mapHistoryToMessages(
        dedupedHistory.map((message) => ({
            content: message.content,
            direction: message.direction,
            senderType: message.senderType,
        })),
    );
    const knowledgeLookupQuery = buildKnowledgeLookupQuery(dedupedHistory, latestUserMessage);
    const recentSalesFactsInstruction = buildRecentSalesFactsInstruction(dedupedHistory, latestUserMessage);
    const { context, chunks } = await buildKnowledgeContext(
        knowledgeLookupQuery || latestUserMessage,
        settings.knowledgeTopK,
    );

    const systemPrompt = `
${settings.agentPrompt}

IDENTIDAD DEL AGENTE
- Nombre del agente o marca: ${settings.agentName || "Asistente Zen"}

DATOS DEL CONTACTO
- Nombre: ${getContactFullName(conversation.contact, "Sin nombre")}
- Telefono: ${conversation.contact?.phone || "Sin telefono"}
- Empresa: ${conversation.contact?.company || "No registrada"}
- Estado: ${conversation.contact?.status || "lead"}

CONTEXTO TERRITORIAL DETECTADO POR LADA
- Telefono normalizado: ${ladaContext.normalizedPhone || "No disponible"}
- Sufijo 10 digitos: ${ladaContext.suffix10 || "No disponible"}
- Lada 2 digitos: ${ladaContext.lada2 || "No disponible"}
- Lada 3 digitos: ${ladaContext.lada3 || "No disponible"}
- Zona inferida: ${ladaContext.zoneLabel}
- Regla aplicada: ${ladaContext.ruleApplied}

RESPONSABLE HUMANO VERIFICADO EN CRM
- Nombre: ${conversation.assignedUser?.name || "No asignado"}
- Email: ${conversation.assignedUser?.email || "No disponible"}

REGLAS DE RESPUESTA
- Responde siempre en espanol.
- Se breve y util. Evita respuestas largas salvo que el usuario las pida.
- Si el usuario pide algo que no esta en el contexto, dilo con honestidad.
- Si el mensaje es ambiguo, haz una sola pregunta aclaratoria.
- Si la conversacion apunta a venta o seguimiento, intenta cerrar con un siguiente paso concreto.
- Aplica la zona inferida por lada en el tono comercial y en recomendaciones de cobertura.
- Si la zona inferida es "Monterrey y zona metropolitana", trata al contacto como local de esa zona.
- Si la zona inferida es "Fuera de Monterrey y zona metropolitana", tratalo como contacto foraneo.
- No inventes ciudad cuando la zona por lada sea "No se pudo clasificar por lada".
- Si el usuario hace una pregunta de seguimiento como "si", "esas", "las casas", "ahi" o "de eso", usa el contexto inmediato de la conversacion para entender a que se refiere.
- Si recibes una instruccion operativa adicional, siguela sin romper el hilo de la conversacion.
- No cambies abruptamente a preguntas genericas si el usuario ya esta hablando de un tema concreto.
- No repitas muletillas o frases de arranque como "Si, claro que si", salvo que realmente aporten algo.
- No respondas mas de lo que el cliente pregunto si no hace falta.
- Si no tienes informacion fiable o suficiente para responder, dilo con honestidad y avisa brevemente que vas a canalizar la conversacion con un asesor humano.
- Si el usuario quiere una cita, ayuda a concretarla dentro del horario comercial del negocio.
- Nunca inventes nombres, telefonos ni correos de asesores, ejecutivos o responsables.
- Solo puedes mencionar un responsable humano si aparece en los DATOS VERIFICADOS DEL CRM.
- Nunca inventes telefonos de personas del equipo. Si no existe un dato verificado, omitelo.
- Nunca menciones al cliente acciones internas del negocio como alertas internas, correos internos, notificaciones al equipo o asuntos de correo.
- Si el cliente pregunta con quien habla o quien le atiende, puedes usar el nombre del agente o marca indicado en IDENTIDAD DEL AGENTE.
- Horario comercial por dia:
${formatBusinessScheduleLines(businessHours)}
- Zona horaria del negocio: ${businessHours.timeZone}
- Formatea para WhatsApp: usa saltos de linea entre ideas, pasos, precios y cierre.
- No amontones la informacion: usa parrafos cortos de 1 o 2 frases maximo.
- Si enumeras beneficios, opciones o pasos, usa una lista simple con cada punto en su propia linea.
- Para resaltar algo usa *negritas* con un solo asterisco. No uses **doble asterisco**, encabezados Markdown ni tablas.
- Mantena un tono amable, profesional y claro. Usa pocos emojis y solo si aportan.

CONTEXTO RAG
${context || "No se recuperaron fuentes relevantes para esta consulta."}

FUENTES ENCONTRADAS
${chunks.length > 0 ? chunks.map((chunk) => `- ${chunk.sourceTitle}${chunk.sourceUri ? ` -> ${chunk.sourceUri}` : ""}`).join("\n") : "- Ninguna"}

INSTRUCCION OPERATIVA ACTUAL
${[automationInstruction, recentSalesFactsInstruction].filter(Boolean).join("\n\n") || "Ninguna. Responde de forma normal."}
    `.trim();

    const response = await generateCompletion(
        [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: latestUserMessage },
        ],
        settings.agentTemperature,
    );

    const normalized = normalizeWhatsAppReply(response || "");
    return stripUnverifiedAdvisorLines(normalized, conversation.assignedUser);
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
