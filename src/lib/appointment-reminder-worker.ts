import { processDueAppointmentReminders } from "@/lib/appointment-reminders";

const DEFAULT_WORKER_INTERVAL_MS = 30_000;

const globalForAppointmentReminderWorker = globalThis as typeof globalThis & {
    __appointmentReminderWorkerStarted?: boolean;
    __appointmentReminderWorkerTimer?: ReturnType<typeof setTimeout> | null;
};

function getWorkerIntervalMs() {
    const raw = Number.parseInt(process.env.APPOINTMENT_REMINDER_WORKER_INTERVAL_MS || "", 10);
    if (!Number.isFinite(raw) || raw < 15_000) {
        return DEFAULT_WORKER_INTERVAL_MS;
    }
    return raw;
}

export function startAppointmentReminderWorker() {
    if (globalForAppointmentReminderWorker.__appointmentReminderWorkerStarted) {
        return;
    }

    globalForAppointmentReminderWorker.__appointmentReminderWorkerStarted = true;

    const tick = async () => {
        try {
            await processDueAppointmentReminders();
        } catch (error) {
            console.error("[AppointmentReminderWorker] Tick failed", error);
        } finally {
            globalForAppointmentReminderWorker.__appointmentReminderWorkerTimer = setTimeout(() => {
                void tick();
            }, getWorkerIntervalMs());
            globalForAppointmentReminderWorker.__appointmentReminderWorkerTimer.unref?.();
        }
    };

    console.log("[AppointmentReminderWorker] Started");
    void tick();
}
