import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import { listTemplateVariableKeys, normalizeTemplateShortcut } from "@/lib/templates";

const ALLOWED_TEMPLATE_TYPES = new Set(["text", "image", "document"]);

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "templates.manage", "No tienes permiso para administrar plantillas.");
        if (forbidden) return forbidden;
        const templateRepo = prisma.template as any;

        const { id } = await params;
        const body = await request.json();

        const existing = await templateRepo.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
        }

        const name = body.name !== undefined ? String(body.name || "").trim() : existing.name;
        const content = body.content !== undefined ? String(body.content || "").trim() : existing.content;
        const type = body.type !== undefined ? String(body.type || "").trim() : existing.type;
        const category = body.category !== undefined ? String(body.category || "").trim() || null : existing.category;
        const shortcut = body.shortcut !== undefined ? normalizeTemplateShortcut(body.shortcut) : existing.shortcut;
        const mediaUrl = body.mediaUrl !== undefined ? (typeof body.mediaUrl === "string" ? body.mediaUrl : null) : existing.mediaUrl;
        const mediaType = body.mediaType !== undefined ? (typeof body.mediaType === "string" ? body.mediaType : null) : existing.mediaType;
        const mediaFileName = body.mediaFileName !== undefined ? (typeof body.mediaFileName === "string" ? body.mediaFileName : null) : existing.mediaFileName;
        const isFavorite = body.isFavorite !== undefined ? Boolean(body.isFavorite) : existing.isFavorite;
        const isActive = body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive;
        const sortOrder =
            body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
                ? Number(body.sortOrder)
                : existing.sortOrder;

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

        const template = await templateRepo.update({
            where: { id },
            data: {
                name,
                content,
                type,
                category,
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
        console.error("[Templates] PATCH failed:", error);
        const message =
            error instanceof Error && error.message.toLowerCase().includes("unique")
                ? "El atajo ya esta en uso por otra plantilla"
                : "No se pudo actualizar la plantilla";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "templates.manage", "No tienes permiso para administrar plantillas.");
        if (forbidden) return forbidden;
        const templateRepo = prisma.template as any;

        const { id } = await params;
        await templateRepo.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[Templates] DELETE failed:", error);
        return NextResponse.json({ error: "No se pudo eliminar la plantilla" }, { status: 500 });
    }
}
