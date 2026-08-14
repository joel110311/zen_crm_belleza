const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Connecting to database...');
        const stages = await prisma.pipelineStage.findMany();
        console.log(`Successfully connected. Found ${stages.length} pipeline stages.`);
        if (stages.length > 0) {
            console.log('Stages:', stages.map(s => s.name));
        } else {
            console.log('WARNING: Pipeline is empty!');
        }
    } catch (e) {
        console.error('Database connection failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
