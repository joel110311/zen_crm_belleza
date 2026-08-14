import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { ensurePermissionResponse } from "@/lib/authz";
import { importBulkCampaignContactsFromCsv } from "@/lib/bulk-campaign-csv";

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const forbidden = ensurePermissionResponse(session, "campaigns.manage", "No tienes permiso para importar contactos.");
        if (forbidden) return forbidden;

        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Adjunta un archivo CSV valido" }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await importBulkCampaignContactsFromCsv(buffer, {
            defaultStatus: typeof formData.get("defaultStatus") === "string"
                ? String(formData.get("defaultStatus"))
                : "lead",
            importTag: typeof formData.get("importTag") === "string"
                ? String(formData.get("importTag"))
                : "",
        });

        revalidatePath("/dashboard/contacts");
        revalidatePath("/dashboard/templates");

        return NextResponse.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error("[BulkCampaigns][ImportCsv] POST failed:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "No se pudo importar el CSV" },
            { status: 400 },
        );
    }
}
