import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
config({ path: ".env.local", quiet: true });
const expected =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training";
if (
  process.env.NODE_ENV === "production" ||
  process.env.DATABASE_URL !== expected
)
  throw new Error(
    "Only the dedicated localhost UI fixture database is allowed.",
  );
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: expected }),
});
try {
  for (let i = 0; i < 24; i++) {
    const name =
      i === 0
        ? "Ana Torres"
        : i === 1
          ? "María López"
          : i === 2
            ? "Lucía Ramos"
            : i === 3
              ? "Alejandra del Carmen Hernández Martínez — atención de bodas y eventos"
              : `Cliente de ejemplo ${i + 1}`;
    const contact = await db.contact.upsert({
      where: { id: `ui-inbox-contact-${i}` },
      create: {
        id: `ui-inbox-contact-${i}`,
        phone: `525500002${String(i).padStart(3, "0")}`,
        name,
        tags: ["Prueba de interfaz"],
        sourceType: "local-ui",
        status: "customer",
      },
      update: { name },
    });
    const sourceType = i === 1 ? "meta" : "wuzapi";
    const createdAt = new Date(Date.now() - i * 1800000 - 86400000);
    const updatedAt = new Date(Date.now() - i * 1800000);
    await db.conversation.upsert({
      where: { id: `ui-inbox-conversation-${i}` },
      create: {
        id: `ui-inbox-conversation-${i}`,
        contactId: contact.id,
        sourceType,
        sourceId: "local-ui-disconnected",
        createdAt,
        updatedAt,
        botActive: true,
        sessionExpiresAt:
          sourceType === "meta" ? new Date(Date.now() - 86400000) : null,
      },
      update: { updatedAt },
    });
    for (let j = 0; j < 8; j++) {
      const outbound = j % 2 === 1;
      const content = outbound
        ? j === 7
          ? "Claro, Ana. Nuestro horario es de lunes a viernes de 9:00 a 18:00 y sábados de 9:00 a 14:00.\n\n¿Quieres que revisemos una cita para ti?"
          : "Con gusto te ayudamos a elegir el servicio. Puedes consultar los horarios disponibles."
        : j === 6
          ? "¿Qué horarios manejan?"
          : "Hola, quisiera consultar una cita para manicure. ¿Tienen espacio esta semana?";
      const data = {
        conversationId: `ui-inbox-conversation-${i}`,
        content,
        direction: outbound ? "outbound" : "inbound",
        senderType: outbound ? (j === 3 ? "human" : "bot") : "contact",
        sourceType,
        sourceId: "local-ui-disconnected",
        type: "text",
        status: "delivered",
        createdAt: new Date(updatedAt.getTime() - (7 - j) * 60000),
      };
      await db.message.upsert({
        where: { id: `ui-inbox-message-${i}-${j}` },
        create: { id: `ui-inbox-message-${i}-${j}`, ...data },
        update: data,
      });
    }
  }
  console.log(
    "24 fictitious local conversations ready. No migrations, messages sent or external calls.",
  );
} finally {
  await db.$disconnect();
}
