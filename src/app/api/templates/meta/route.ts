import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import { createMetaTemplate, deleteMetaTemplate, listMetaTemplates } from "@/lib/meta-whatsapp";

export async function GET(request: NextRequest) {
    const session = await auth();
    const forbidden = ensurePermissionResponse(session, "templates.manage", "No tienes permiso para administrar plantillas de WhatsApp.");
    if (forbidden) return forbidden;
    try {
        const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "100", 10);
        return NextResponse.json(await listMetaTemplates({ limit: Number.isFinite(limit) ? limit : 100 }));
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar las plantillas de Meta." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const session = await auth();
    const forbidden = ensurePermissionResponse(session, "templates.manage", "No tienes permiso para administrar plantillas de WhatsApp.");
    if (forbidden) return forbidden;
    try {
        const body = await request.json();
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const category = typeof body.category === "string" ? body.category.trim().toUpperCase() : "";
        const language = typeof body.language === "string" ? body.language.trim() : "es";
        if (!name || !category || !Array.isArray(body.components) || body.components.length === 0) {
            return NextResponse.json({ error: "name, category y components son obligatorios." }, { status: 400 });
        }
        const template = await createMetaTemplate({ name, category, language, components: body.components, allowCategoryChange: body.allowCategoryChange === true });
        return NextResponse.json({ success: true, template }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo solicitar la plantilla." }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    const session = await auth();
    const forbidden = ensurePermissionResponse(session, "templates.manage", "No tienes permiso para administrar plantillas de WhatsApp.");
    if (forbidden) return forbidden;
    const name = (request.nextUrl.searchParams.get("name") || "").trim();
    if (!name) return NextResponse.json({ error: "name es obligatorio." }, { status: 400 });
    try {
        return NextResponse.json({ success: true, result: await deleteMetaTemplate(name) });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la plantilla." }, { status: 500 });
    }
}
