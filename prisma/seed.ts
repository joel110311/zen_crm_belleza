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

    // Create a test contact (Joel Venegas)
    const contact = await prisma.contact.upsert({
        where: { phone_sourceType: { phone: "524772683928", sourceType: "wuzapi" } },
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
