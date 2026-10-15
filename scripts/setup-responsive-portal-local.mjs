import { config } from "dotenv";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
config({ path: ".env.local", quiet: true });
const tenantUrl = "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_training";
const controlUrl = "postgresql://crm_local:local_training_only@127.0.0.1:5446/crm_retention_control";
if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL !== tenantUrl || process.env.CONTROL_DATABASE_URL !== controlUrl) throw new Error("Only dedicated localhost UI fixtures are allowed.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: tenantUrl }) });
try {
    const settings = await db.systemSettings.findFirst();
    if (!settings) throw new Error("Run the existing local UI setup first.");
    await db.systemSettings.update({ where: { id: settings.id }, data: { portalEnabled: true, portalClinicName: "Glow UP · estudio de cuidado personal", portalIntro: "Elige tu servicio y encuentra un momento para ti.", portalVisibleServiceIds: ["ui-local-service-0", "ui-local-service-1", "ui-local-service-2"] } });
    await db.tenantOnboardingState.upsert({ where: { id: "default" }, update: { publishedAt: new Date() }, create: { id: "default", publishedAt: new Date() } });
    const salt = process.env.SECURITY_HASH_SALT || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "zen-crm-local-development-salt";
    const start = new Date(Date.now() + 5 * 86400000); start.setUTCHours(18, 0, 0, 0);
    for (const [suffix, status, confirmationStatus, digit] of [["pending", "scheduled", "pending", "a"], ["confirmed", "scheduled", "confirmed", "b"], ["cancelled", "cancelled", "declined", "c"]]) {
        const token = digit.repeat(64);
        const data = { title: "Corte y peinado — muestra local", startTime: start, endTime: new Date(start.getTime() + 45 * 60000), status, confirmationStatus, serviceId: "ui-local-service-0", specialistId: "ui-local-specialist-0", remindersOptOut: true, publicToken: `ui-portal-classic-${suffix}`, publicBookingTokenHash: createHmac("sha256", salt).update(`portal-booking-token-hash:${token}`).digest("hex"), publicBookingTokenExpiresAt: new Date(Date.now() + 30 * 86400000), cancellationReason: status === "cancelled" ? "Cancelación de ejemplo local." : null };
        await db.appointment.upsert({ where: { id: `ui-portal-status-${suffix}` }, update: data, create: { id: `ui-portal-status-${suffix}`, ...data } });
    }
    console.log("Local portal fixtures ready: /portal/negocio-local; status tokens a, b and c repeated 64 times. No external calls.");
} finally { await db.$disconnect(); }
