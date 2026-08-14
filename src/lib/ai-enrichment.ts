"use server";

import { prisma } from "@/lib/db";
import { resolveAiProviderKey } from "@/lib/ai/provider-keys";
import { callGeminiGenerateContent } from "@/lib/ai/openai";

/**
 * AI Contact Enrichment Service
 * Analyzes incoming messages for contact data (full name, company, email)
 * and updates the Contact and Deal records accordingly.
 * Uses Gemini API if available, otherwise silently skips.
 */

interface EnrichmentData {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    company?: string;
    email?: string;
}

async function getGeminiApiKey(): Promise<string | null> {
    try {
        return await resolveAiProviderKey("gemini");
    } catch {
        return null;
    }
}

/**
 * Call Gemini API to extract contact info from a message
 */
async function extractContactData(
    messageText: string,
    existingName?: string | null,
    existingLastName?: string | null,
    existingCompany?: string | null,
    existingEmail?: string | null
): Promise<EnrichmentData | null> {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
        return null;
    }

    const prompt = `Analiza el siguiente mensaje de WhatsApp y extrae SOLO datos personales del remitente si los menciona explícitamente.

Datos actuales del contacto:
- Nombre: ${existingName || "desconocido"}
- Apellido: ${existingLastName || "desconocido"}
- Empresa: ${existingCompany || "desconocida"}
- Email: ${existingEmail || "desconocido"}

Mensaje:
"${messageText}"

Responde ÚNICAMENTE con un JSON válido (sin markdown, sin explicación) con los campos que hayas encontrado NUEVOS o MÁS COMPLETOS que los datos actuales. Si el nombre actual es "Joel" y el mensaje menciona "Joel Venegas Vargas", devuelve el nombre completo.

Formato de respuesta:
{"firstName": "string o null", "lastName": "string o null", "company": "string o null", "email": "string o null"}

Si no encuentras ningún dato nuevo, responde: {}`;

    try {
        const text = await callGeminiGenerateContent({
            apiKey,
            preferredModel: "gemini-2.5-flash",
            payload: {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 200,
                },
            },
        });

        if (!text) return null;

        // Parse JSON response, handle potential markdown wrapping
        const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(jsonStr);

        // Only return if there's actual new data
        const hasNewData = parsed.firstName || parsed.lastName || parsed.company || parsed.email;
        return hasNewData ? parsed : null;
    } catch (error) {
        console.error("[AI Enrichment] Error calling Gemini:", error);
        return null;
    }
}

/**
 * Enrich contact data from a new inbound message.
 * This is called fire-and-forget from processInboundMessage.
 */
export async function enrichContactFromMessage(
    contactId: string,
    messageText: string
) {
    try {
        // Get current contact data
        const contact = await prisma.contact.findUnique({
            where: { id: contactId },
        });

        if (!contact) return;

        // Only analyze text messages that are long enough to possibly contain data
        if (!messageText || messageText.length < 3) return;
        // Skip media placeholders
        if (messageText.startsWith("[") && messageText.endsWith("]")) return;

        const enrichment = await extractContactData(
            messageText,
            contact.name,
            contact.lastName,
            contact.company,
            contact.email
        );

        if (!enrichment) return;

        // Build update payload
        const contactUpdate: Record<string, string> = {};
        const dealUpdate: Record<string, string> = {};

        if (enrichment.firstName && (!contact.name || enrichment.firstName.length > (contact.name?.length || 0))) {
            contactUpdate.name = enrichment.firstName;
        }

        if (enrichment.fullName && enrichment.fullName.includes(" ")) {
            const parts = enrichment.fullName.split(" ");
            const firstName = parts[0];
            const lastName = parts.slice(1).join(" ");
            if (!contact.name || firstName.length >= (contact.name?.length || 0)) {
                contactUpdate.name = firstName;
            }
            if (!contact.lastName || lastName.length > (contact.lastName?.length || 0)) {
                contactUpdate.lastName = lastName;
            }
        }

        if (enrichment.lastName && (!contact.lastName || enrichment.lastName.length > (contact.lastName?.length || 0))) {
            contactUpdate.lastName = enrichment.lastName;
        }

        if (enrichment.company && !contact.company) {
            contactUpdate.company = enrichment.company;
        }

        if (enrichment.email && !contact.email) {
            contactUpdate.email = enrichment.email;
        }

        // Update contact if there's new data
        if (Object.keys(contactUpdate).length > 0) {
            await prisma.contact.update({
                where: { id: contactId },
                data: contactUpdate,
            });
            console.log(`[AI Enrichment] Updated contact ${contactId}:`, contactUpdate);

            // Also update any associated deals' titles if we got a better name
            if (contactUpdate.name || contactUpdate.lastName) {
                const fullName = [
                    contactUpdate.name || contact.name,
                    contactUpdate.lastName || contact.lastName,
                ].filter(Boolean).join(" ");

                // Update deal titles that were auto-generated from WhatsApp
                const deals = await prisma.deal.findMany({
                    where: { contactId: contactId, source: "whatsapp" },
                });

                for (const deal of deals) {
                    // Only update if the title looks like it was auto-generated
                    if (deal.title.startsWith("Lead WhatsApp") || deal.title.includes(contact.phone)) {
                        await prisma.deal.update({
                            where: { id: deal.id },
                            data: { title: `Lead - ${fullName}` },
                        });
                        console.log(`[AI Enrichment] Updated deal ${deal.id} title to: Lead - ${fullName}`);
                    }
                }
            }
        }
    } catch (error) {
        console.error("[AI Enrichment] Error enriching contact:", error);
        // Silently fail - enrichment is best-effort
    }
}
