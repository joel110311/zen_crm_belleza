"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/authz";

type EducationArticleInput = {
    id?: string;
    title: string;
    slug?: string;
    summary?: string;
    content: string;
    category?: string;
    audience?: string;
    isPublished?: boolean;
    featured?: boolean;
    sortOrder?: number;
};

const DEFAULT_ARTICLES = [
    {
        title: "Antes de tu consulta oftalmologica",
        slug: "antes-de-tu-consulta-oftalmologica",
        summary: "Recomendaciones basicas para llegar preparado a tu valoracion.",
        content: "Trae tus lentes actuales, estudios previos, lista de medicamentos y el nombre de gotas que estes usando. Si es posible, acude con acompanante cuando se planee dilatacion pupilar.",
        category: "Consulta",
        featured: true,
        sortOrder: 10,
    },
    {
        title: "Despues de dilatacion pupilar",
        slug: "despues-de-dilatacion-pupilar",
        summary: "Cuidados frecuentes despues de usar gotas para dilatar la pupila.",
        content: "La vision borrosa y sensibilidad a la luz pueden durar varias horas. Evita manejar si no te sientes seguro, usa lentes oscuros y consulta si presentas dolor intenso o perdida visual.",
        category: "Indicaciones",
        featured: true,
        sortOrder: 20,
    },
    {
        title: "Control y seguimiento de glaucoma",
        slug: "control-y-seguimiento-de-glaucoma",
        summary: "Que datos ayudan a vigilar la presion ocular y el nervio optico.",
        content: "El seguimiento suele incluir PIO, fondo de ojo, excavacion papilar, campimetria y OCT. Lleva registro de tus gotas y no suspendas tratamiento sin indicacion medica.",
        category: "Glaucoma",
        featured: false,
        sortOrder: 30,
    },
];

function slugify(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "articulo";
}

function cleanText(value?: string | null) {
    return value?.trim() || "";
}

async function uniqueSlug(base: string, currentId?: string) {
    const slug = slugify(base);
    const existing = await prisma.patientEducationArticle.findUnique({
        where: { slug },
        select: { id: true },
    });
    if (!existing || existing.id === currentId) return slug;
    return `${slug}-${Date.now().toString(36)}`;
}

export async function ensureDefaultEducationArticles() {
    const count = await prisma.patientEducationArticle.count();
    if (count > 0) return;

    for (const article of DEFAULT_ARTICLES) {
        await prisma.patientEducationArticle.upsert({
            where: { slug: article.slug },
            create: {
                ...article,
                audience: "pacientes",
                isPublished: true,
            },
            update: {},
        });
    }
}

export async function getEducationArticles(includeDrafts = false) {
    if (includeDrafts) {
        await requirePermission("portal.manage");
    }

    await ensureDefaultEducationArticles();
    return prisma.patientEducationArticle.findMany({
        where: includeDrafts ? undefined : { isPublished: true },
        orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { title: "asc" }],
    });
}

export async function saveEducationArticle(input: EducationArticleInput) {
    await requirePermission("portal.manage");

    const title = cleanText(input.title);
    const content = cleanText(input.content);
    if (!title || !content) {
        return { success: false, error: "Captura titulo y contenido." };
    }

    try {
        const slug = await uniqueSlug(input.slug || title, input.id);
        const data = {
            title,
            slug,
            summary: cleanText(input.summary) || null,
            content,
            category: cleanText(input.category) || "General",
            audience: cleanText(input.audience) || "pacientes",
            isPublished: input.isPublished ?? true,
            featured: Boolean(input.featured),
            sortOrder: Number(input.sortOrder || 0),
        };

        const article = input.id
            ? await prisma.patientEducationArticle.update({ where: { id: input.id }, data })
            : await prisma.patientEducationArticle.create({ data });

        revalidatePath("/dashboard/settings");
        revalidatePath("/portal/oftalmo");
        return { success: true, article };
    } catch (error) {
        console.error("Failed to save education article:", error);
        return { success: false, error: "No se pudo guardar el articulo." };
    }
}

export async function toggleEducationArticle(id: string, isPublished: boolean) {
    await requirePermission("portal.manage");

    try {
        await prisma.patientEducationArticle.update({
            where: { id },
            data: { isPublished },
        });
        revalidatePath("/dashboard/settings");
        revalidatePath("/portal/oftalmo");
        return { success: true };
    } catch (error) {
        console.error("Failed to toggle education article:", error);
        return { success: false, error: "No se pudo actualizar el articulo." };
    }
}

export async function deleteEducationArticle(id: string) {
    await requirePermission("portal.manage");

    try {
        await prisma.patientEducationArticle.delete({ where: { id } });
        revalidatePath("/dashboard/settings");
        revalidatePath("/portal/oftalmo");
        return { success: true };
    } catch (error) {
        console.error("Failed to delete education article:", error);
        return { success: false, error: "No se pudo eliminar el articulo." };
    }
}
