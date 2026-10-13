import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
config({ path: ".env.local", quiet: true });
const expectedTenant =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training";
const expectedControl =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_retention_control";
if (
  process.env.NODE_ENV === "production" ||
  process.env.DATABASE_URL !== expectedTenant ||
  process.env.CONTROL_DATABASE_URL !== expectedControl
)
  throw new Error("Only dedicated localhost UI fixtures are allowed.");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: expectedTenant }),
});
const control = new Pool({ connectionString: expectedControl });
try {
  const expired = process.argv.includes("--expired");
  const deadline = new Date(Date.now() + (expired ? -2 : 14) * 86400000);
  await control.query(
    'UPDATE "Trial" SET status=$1,"endsAt"=$2,"expiredAt"=$3,"updatedAt"=NOW() WHERE id=$4',
    [
      expired ? "EXPIRED" : "ACTIVE",
      deadline,
      expired ? deadline : null,
      "local-expiry-trial",
    ],
  );
  await control.query(
    'UPDATE "Tenant" SET "accessMode"=$1,"billingStatus"=$2,"updatedAt"=NOW() WHERE id=$3',
    [
      expired ? "BILLING_ONLY" : "FULL",
      expired ? "CANCELED" : "TRIALING",
      "localexpirytest",
    ],
  );
  const category = await db.serviceCategory.upsert({
    where: { name: "Servicios de muestra local" },
    update: {},
    create: { id: "ui-local-category", name: "Servicios de muestra local" },
  });
  for (const [i, name, serviceName, duration, price] of [
    [0, "Ana Torres", "Corte y peinado", 45, 280],
    [1, "María López", "Manicure semipermanente", 60, 350],
    [2, "Lucía Ramos", "Coloración", 90, 900],
  ]) {
    const contact = await db.contact.upsert({
      where: { id: `ui-local-contact-${i}` },
      update: { name },
      create: {
        id: `ui-local-contact-${i}`,
        name,
        phone: `550000100${i}`,
        sourceType: "local-ui",
        tags: [],
      },
    });
    const specialist = await db.specialist.upsert({
      where: { id: `ui-local-specialist-${i % 2}` },
      update: {},
      create: {
        id: `ui-local-specialist-${i % 2}`,
        name: i % 2 ? "Valeria" : "Sofía",
        defaultDurationMinutes: duration,
      },
    });
    const service = await db.service.upsert({
      where: { name: serviceName },
      update: {},
      create: {
        id: `ui-local-service-${i}`,
        name: serviceName,
        categoryId: category.id,
        price,
        durationMinutes: duration,
      },
    });
    await db.specialistService.upsert({
      where: {
        specialistId_serviceId: {
          specialistId: specialist.id,
          serviceId: service.id,
        },
      },
      update: {},
      create: { specialistId: specialist.id, serviceId: service.id },
    });
    const start = new Date(Date.now() + (i + 1) * 90 * 60000);
    const data = {
      title: serviceName,
      appointmentType: serviceName,
      startTime: start,
      endTime: new Date(start.getTime() + duration * 60000),
      contactId: contact.id,
      specialistId: specialist.id,
      serviceId: service.id,
      confirmationStatus: i === 0 ? "confirmed" : "pending",
      remindersOptOut: true,
    };
    await db.appointment.upsert({
      where: { id: `ui-local-appointment-${i}` },
      update: data,
      create: { id: `ui-local-appointment-${i}`, ...data },
    });
  }
  console.log(
    `Dedicated UI fixtures ready: ${expired ? "read only" : "active trial"}. No migrations or external calls.`,
  );
} finally {
  await db.$disconnect();
  await control.end();
}
