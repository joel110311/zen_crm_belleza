import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

config({ path: ".env.local", quiet: true });
const expected =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training";
const expectedControl =
  "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_retention_control";
if (
  process.env.NODE_ENV === "production" ||
  process.env.DATABASE_URL !== expected ||
  process.env.CONTROL_DATABASE_URL !== expectedControl
) {
  throw new Error(
    "Only the dedicated localhost UI fixture database is allowed.",
  );
}
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: expected }),
});
const control = new Pool({ connectionString: expectedControl });
try {
  await control.query(
    'INSERT INTO "User" (id,email,name,"passwordHash","emailVerifiedAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT (id) DO UPDATE SET "updatedAt"=NOW()',
    [
      "ui-control-staff",
      "staff-ui@crm.local",
      "Personal de prueba UI",
      await bcrypt.hash("CRM-Local-Staff-UI-2026!", 12),
    ],
  );
  await control.query(
    'INSERT INTO "TenantMembership" (id,"tenantId","userId",role,"isActive","updatedAt") VALUES ($1,$2,$3,$4,true,NOW()) ON CONFLICT (id) DO UPDATE SET role=$4,"isActive"=true,"updatedAt"=NOW()',
    [
      "ui-staff-membership",
      "localexpirytest",
      "ui-control-staff",
      "PROFESSIONAL",
    ],
  );
  await db.user.upsert({
    where: { controlUserId: "ui-control-staff" },
    create: {
      id: "ui-responsive-staff",
      controlUserId: "ui-control-staff",
      email: "staff-ui@crm.local",
      name: "Personal de prueba UI",
      role: "PROFESIONAL",
      permissions: [],
    },
    update: { role: "PROFESIONAL", permissions: [] },
  });
  const fixtures = [
    [
      "Bienvenida y primera visita",
      "Hola {{nombre}}, gracias por escribirnos. ¿Qué servicio te gustaría reservar?",
      "Atención",
      "ui-bienvenida",
    ],
    [
      "Confirmación de cita",
      "Hola {{nombre}}, tu cita está confirmada. Si necesitas cambiarla, avísanos con anticipación.",
      "Agenda",
      "ui-confirmacion",
    ],
    [
      "Políticas de cambios para citas de eventos y grupos — información completa",
      "Para cambiar tu cita, contáctanos con 24 horas de anticipación. Te ayudaremos a encontrar otro horario.",
      "Políticas",
      "ui-cambios",
    ],
    [
      "Servicios disponibles",
      "Ofrecemos corte, peinado, manicure y coloración. Cuéntanos qué buscas y revisamos disponibilidad.",
      "Servicios",
      "ui-servicios",
    ],
  ];
  for (const [
    index,
    [name, content, category, shortcut],
  ] of fixtures.entries()) {
    const data = {
      name,
      content,
      category,
      shortcut,
      type: "text",
      isFavorite: index === 0,
      isActive: true,
      sortOrder: index,
    };
    await db.template.upsert({
      where: { id: `ui-template-${index}` },
      create: { id: `ui-template-${index}`, ...data },
      update: data,
    });
  }
  await db.knowledgeSource.upsert({
    where: { id: "ui-knowledge-text" },
    create: {
      id: "ui-knowledge-text",
      title: "Políticas del negocio — copia local de prueba",
      type: "text",
      rawContent:
        "Nota ficticia para revisar la interfaz. No es información de producción.",
      status: "pending",
    },
    update: {},
  });
  await db.knowledgeSource.upsert({
    where: { id: "ui-knowledge-failed" },
    create: {
      id: "ui-knowledge-failed",
      title: "Fuente con error de ejemplo",
      type: "website",
      sourceUri: "https://example.invalid/informacion-del-negocio/politicas",
      status: "failed",
      error:
        "No se pudo consultar esta fuente de prueba. Revisa la dirección antes de reintentar.",
    },
    update: {},
  });
  console.log(
    "Local UI fixtures ready: four templates and two knowledge sources. No indexing or external messages triggered.",
  );
} finally {
  await db.$disconnect();
  await control.end();
}
