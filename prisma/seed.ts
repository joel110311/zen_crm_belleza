// Seed script to create initial data
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log("Seeding database...");

    // Las credenciales de integraciones se configuran por entorno o desde el CRM; nunca se incluyen en seeds.
    const settings = await prisma.systemSettings.findFirst()
        || await prisma.systemSettings.create({ data: { id: "default" } });
    console.log("Created settings:", settings.id);

    // Create Pipeline Stages (Kommo-style)
    const stages = [
        { name: "Leads Entrantes", color: "#2563EB", order: 0, isIncoming: true, isClosedWon: false, isClosedLost: false },
        { name: "Nuevo Lead", color: "#3B82F6", order: 1, isIncoming: false, isClosedWon: false, isClosedLost: false },
        { name: "Calificado", color: "#EAB308", order: 2, isIncoming: false, isClosedWon: false, isClosedLost: false },
        { name: "Propuesta", color: "#8B5CF6", order: 3, isIncoming: false, isClosedWon: false, isClosedLost: false },
        { name: "Negociación", color: "#F97316", order: 4, isIncoming: false, isClosedWon: false, isClosedLost: false },
        { name: "Cerrado Ganado", color: "#22C55E", order: 5, isIncoming: false, isClosedWon: true, isClosedLost: false },
        { name: "Cerrado Perdido", color: "#EF4444", order: 6, isIncoming: false, isClosedWon: false, isClosedLost: true },
    ];

    for (const stage of stages) {
        // Check if stage already exists by name
        const existing = await prisma.pipelineStage.findFirst({ where: { name: stage.name } });
        if (!existing) {
            const created = await prisma.pipelineStage.create({ data: stage });
            console.log(`Created stage: ${created.name} (order: ${created.order})`);
        } else {
            // Update order and flags
            await prisma.pipelineStage.update({
                where: { id: existing.id },
                data: { order: stage.order, color: stage.color, isIncoming: stage.isIncoming, isClosedWon: stage.isClosedWon, isClosedLost: stage.isClosedLost },
            });
            console.log(`Updated stage: ${existing.name}`);
        }
    }

    // Create a test contact (Joel Venegas)
    const contact = await prisma.contact.upsert({
        where: { phone: "524772683928" },
        update: {},
        create: {
            phone: "524772683928",
            name: "Joel Venegas",
            status: "active",
        },
    });
    console.log("Created contact:", contact.name);

    // Create a conversation
    const conversation = await prisma.conversation.upsert({
        where: { id: "conv-joel-1" },
        update: {},
        create: {
            id: "conv-joel-1",
            contactId: contact.id,
            status: "active",
        },
    });
    console.log("Created conversation:", conversation.id);

    // Create a test message
    await prisma.message.create({
        data: {
            conversationId: conversation.id,
            content: "¡Hola! Este es un mensaje de prueba.",
            direction: "inbound",
            sourceType: "wuzapi",
            sourceId: "seed",
            type: "text",
            status: "delivered",
        },
    });
    console.log("Created test message");

    console.log("Seeding complete!");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
