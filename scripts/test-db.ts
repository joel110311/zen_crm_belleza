import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
    adapter,
    log: ["query", "info", "warn", "error"],
});

async function main() {
    console.log("Testing database connection...");
    try {
        await prisma.$connect();
        console.log("Successfully connected to the database.");

        const userCount = await prisma.user.count();
        console.log(`Connection verified. Found ${userCount} users.`);

        const contacts = await prisma.contact.findMany({ take: 1 });
        console.log("Successfully queried contacts table.");

    } catch (e) {
        console.error("Connection failed:");
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
