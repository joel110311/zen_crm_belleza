"use server";

import { prisma } from "@/lib/db";
import { requireAuthenticated } from "@/lib/authz";

export type SearchResult = {
    contacts: Array<{
        id: string;
        name: string | null;
        lastName: string | null;
        email: string | null;
        company: string | null;
        avatar?: string;
    }>;
    deals: Array<{
        id: string;
        title: string;
        value: number;
        stageName: string;
    }>;
};

export async function searchGlobal(term: string): Promise<SearchResult> {
    await requireAuthenticated();
    if (!term || term.length < 2) {
        return { contacts: [], deals: [] };
    }

    const normalizedTerm = term.trim();

    try {
        const contacts = await
            prisma.contact.findMany({
                where: {
                    OR: [
                        { name: { contains: normalizedTerm, mode: "insensitive" } },
                        { lastName: { contains: normalizedTerm, mode: "insensitive" } },
                        { email: { contains: normalizedTerm, mode: "insensitive" } },
                        { company: { contains: normalizedTerm, mode: "insensitive" } },
                        { phone: { contains: normalizedTerm, mode: "insensitive" } },
                    ],
                },
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    email: true,
                    company: true,
                    whatsappAvatarUrl: true,
                },
                take: 5,
            });


        return {
            contacts: contacts.map((contact) => ({
                ...contact,
                avatar: contact.whatsappAvatarUrl || undefined,
            })),
            deals: [],
        };
    } catch (error) {
        console.error("Search error:", error);
        return { contacts: [], deals: [] };
    }
}
