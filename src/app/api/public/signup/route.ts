import { NextResponse } from "next/server";

/** Public provisioning is closed; a verified signup intent is the only entrypoint. */
export async function POST() {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
}
