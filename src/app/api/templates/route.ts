import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureAuthenticatedResponse, ensurePermissionResponse } from "@/lib/authz";
import { listTemplateVariableKeys, normalizeTemplateShortcut } from "@/lib/templates";

const ALLOWED_TEMPLATE_TYPES = new Set(["text", "image", "document"]);

export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticatedResponse(session);
        if (unauthorized) return unauthorized;
        const templateRepo = prisma.template as any;

        const { searchParams } = new URL(request.url);
        const activeOnly = searchParams.get("activeOnly") === "true";
        const query = searchParams.get("q")?.trim();

        const templates = await templateRepo.findMany({
            where: {
                ...(activeOnly ? { isActive: true } : {}),
                ...(query
                    ? {
                          OR: [
                              { name: { contains: query, mode: "insensitive" } },
                              { category: { contains: query, mode: "insensitive" } },
                              { content: { contains: query, mode: "insensitive" } },
                              { shortcut: { contains: query, mode: "insensitive" } },
                          ],
                      }
                    : {}),
            },
            orderBy: [
                { isFavorite: "desc" },
                { sortOrder: "asc" },
                { lastUsedAt: "desc" },
                { usageCount: "desc" },
                { updatedAt: "desc" },
            ],
        });

        return NextResponse.json({ templates });
    } catch (error) {
        console.error("[Templates] GET failed:", error);
        return NextResponse.json({ error: "No se pudieron cargar las plantillas" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "templates.manage", "No tienes permiso para administrar plantillas.");
        if (forbidden) return forbidden;

        const body = await request.json();
        const templateRepo = prisma.template as any;
        const name = String(body.name || "").trim();
        const content = String(body.content || "").trim();
        const type = String(body.type || "text").trim();
        const category = String(body.category || "").trim() || null;
        const shortcut = normalizeTemplateShortcut(body.shortcut);
        const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : null;
        const mediaType = typeof body.mediaType === "string" ? body.mediaType : null;
        const mediaFileName = typeof body.mediaFileName === "string" ? body.mediaFileName : null;
        const isFavorite = Boolean(body.isFavorite);
        const isActive = body.isActive !== false;
        const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;

        if (!name) {
            return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
        }

        if (!ALLOWED_TEMPLATE_TYPES.has(type)) {
            return NextResponse.json({ error: "Tipo de plantilla no soportado" }, { status: 400 });
        }

        if (type === "text" && !content) {
            return NextResponse.json({ error: "El contenido es obligatorio para plantillas de texto" }, { status: 400 });
        }

        if ((type === "image" || type === "document") && !mediaUrl) {
            return NextResponse.json({ error: "La plantilla requiere un archivo adjunto" }, { status: 400 });
        }

        const template = await templateRepo.create({
            data: {
                name,
                content,
                category,
                type,
                shortcut,
                mediaUrl,
                mediaType,
                mediaFileName,
                variables: listTemplateVariableKeys(content),
                isFavorite,
                isActive,
                sortOrder,
            },
        });

        return NextResponse.json({ success: true, template });
    } catch (error) {
        console.error("[Templates] POST failed:", error);
        const message =
            error instanceof Error && error.message.toLowerCase().includes("unique")
                ? "El atajo ya esta en uso por otra plantilla"
                : "No se pudo crear la plantilla";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
