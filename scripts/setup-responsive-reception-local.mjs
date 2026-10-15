import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
config({ path: ".env.local", quiet: true });
const tenant =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training";
const control =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_retention_control";
if (
  process.env.NODE_ENV === "production" ||
  process.env.DATABASE_URL !== tenant ||
  process.env.CONTROL_DATABASE_URL !== control
)
  throw new Error("Only dedicated localhost UI fixtures are allowed.");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: tenant }),
});
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
try {
  const statuses = ["scheduled", "waiting", "in_progress", "completed"];
  const reminderStatuses = ["failed", "sent", "skipped", "queued"];
  for (let i = 0; i < 4; i++) {
    const contactId = `ui-reception-contact-${i}`;
    await db.contact.upsert({
      where: { id: contactId },
      update: {},
      create: {
        id: contactId,
        name: i === 0 ? "Alejandra del Carmen" : "Cliente de recepción",
        lastName: i === 0 ? "Hernández Martínez y familia" : String(i + 1),
        phone: `550000220${i}`,
        sourceType: "local-ui",
        tags: [],
      },
    });
    const startTime = new Date(
      `${day}T${String(14 + i).padStart(2, "0")}:00:00-06:00`,
    );
    const data = {
      title:
        i === 0
          ? "Coloración, tratamiento de brillo y preparación para evento especial"
          : "Servicio de muestra para recepción",
      contactId,
      specialistId: `ui-local-specialist-${i % 2}`,
      startTime,
      endTime: new Date(startTime.getTime() + 45 * 60000),
      status: statuses[i],
      confirmationStatus: i === 0 ? "pending" : "confirmed",
      remindersOptOut: true,
      source: "local-ui",
      isOverbook: i === 0,
    };
    const appointmentId = `ui-reception-appointment-${i}`;
    await db.appointment.upsert({
      where: { id: appointmentId },
      update: data,
      create: { id: appointmentId, ...data },
    });
    const reminder = {
      appointmentId,
      offsetMinutes: 240,
      label: "4h",
      scheduledFor: new Date(`${day}T10:00:00-06:00`),
      status: reminderStatuses[i],
      attempts: i === 0 ? 2 : 1,
      lastError:
        i === 0
          ? "Error ficticio: proveedor no conectado. Referencia de diagnóstico: " +
            "REFERENCIA_LOCAL_".repeat(8)
          : null,
    };
    await db.appointmentReminder.upsert({
      where: { id: `ui-reception-reminder-${i}` },
      update: reminder,
      create: { id: `ui-reception-reminder-${i}`, ...reminder },
    });
  }
  console.log(
    `Reception UI fixtures ready for ${day}. No migrations or external calls.`,
  );
} finally {
  await db.$disconnect();
}
