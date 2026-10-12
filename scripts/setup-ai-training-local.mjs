import fs from "node:fs";
import crypto from "node:crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

// Dedicated, disposable local database. Never seed customer data or connect WhatsApp.
const url = "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training";
if (!fs.existsSync(".env.local")) {
    fs.writeFileSync(".env.local", [
        `DATABASE_URL=${url}`, `AUTH_SECRET=${crypto.randomBytes(32).toString("hex")}`,
        "AUTH_URL=http://localhost:3106", "MULTITENANT_AUTH_ENABLED=false",
        "MULTITENANT_RUNTIME_ENABLED=false", "ALLOW_ENV_AI_FALLBACK=true", "",
    ].join("\n"));
}
config({ path: ".env.local", quiet: true });
if (process.env.DATABASE_URL !== url || process.env.NODE_ENV === "production") {
    throw new Error("Este script sólo admite la base desechable crm_training en 127.0.0.1:5446.");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
    const user = await db.user.upsert({
        where: { email: "admin@crm.local" }, update: {},
        create: { id: "training-local-admin", email: "admin@crm.local", name: "Administrador local", role: "ADMINISTRADOR", password: await bcrypt.hash("EntrenarIA-Local-2026!", 12) },
    });
    const contact = await db.contact.upsert({
        where: { phone_sourceType: { phone: "525500000000", sourceType: "wuzapi" } }, update: {},
        create: { id: "training-local-contact", phone: "525500000000", name: "Cliente de prueba", tags: ["Prueba local"] },
    });
    await db.conversation.upsert({
        where: { id: "training-local-conversation" }, update: {},
        create: { id: "training-local-conversation", contactId: contact.id, assignedUserId: user.id, botActive: false },
    });
    const now = Date.now();
    for (const [id, direction, senderType, content, offset] of [
        ["training-local-question", "inbound", null, "¿Cuánto cuesta el corte y qué incluye?", -180000],
        ["training-local-bot", "outbound", "bot", "El corte cuesta $200. Podemos darte más información al reservar.", -120000],
        ["training-local-human", "outbound", "human", "Esta conversación es de prueba. Puedes corregir la respuesta marcada como IA.", -60000],
    ]) {
        await db.message.upsert({ where: { id }, update: {}, create: { id, conversationId: "training-local-conversation", direction, senderType, content, createdAt: new Date(now + offset) } });
    }
    if (!await db.systemSettings.findFirst()) await db.systemSettings.create({ data: { isBotEnabled: false } });
    console.log("Prueba local preparada. Usuario: admin@crm.local · contraseña: EntrenarIA-Local-2026!");
    console.log("No se configuraron claves de IA ni conexiones de WhatsApp. El mensaje IA de ejemplo es un fixture.");
} finally { await db.$disconnect(); }
