export type ClientAppointment = {
  id: string;
  title: string;
  appointmentType: string | null;
  serviceId: string | null;
  patientId: string | null;
  specialistId: string | null;
  notes: string | null;
  source: string;
  isOverbook: boolean;
  visitMode: string;
  meetStatus: string;
  meetLink: string | null;
  remindersOptOut: boolean;
  googleCalendarId: string | null;
  startTime: string | Date;
  endTime: string | Date;
  status: string;
  confirmationStatus: string;
};

export type ContactTableItem = {
  id: string;
  sourceType?: string;
  name: string | null;
  lastName: string | null;
  phone: string | null;
  tags: string[];
  createdAt: string | Date;
  whatsappAvatarUrl: string | null;
  appointments: ClientAppointment[];
  patients: Array<{
    id: string;
    appointments: ClientAppointment[];
  }>;
};

const CLOSED_APPOINTMENT_STATUSES = new Set([
  "completed",
  "cancelled",
  "no_show",
]);

export function uniqueAppointments(contact: ContactTableItem) {
  const appointments = new Map<string, ClientAppointment>();
  for (const appointment of contact.appointments)
    appointments.set(appointment.id, appointment);
  for (const patient of contact.patients) {
    for (const appointment of patient.appointments)
      appointments.set(appointment.id, appointment);
  }
  return Array.from(appointments.values());
}

export function serviceLabel(appointment: ClientAppointment) {
  const type = appointment.appointmentType?.trim();
  if (type && type.toLocaleLowerCase("es-MX") !== "consulta") return type;
  return appointment.title?.trim() || "Servicio";
}

export function getClientMetrics(contact: ContactTableItem, now = new Date()) {
  const appointments = uniqueAppointments(contact);
  const attendedCount = appointments.filter(
    (appointment) => appointment.status === "completed",
  ).length;
  const serviceFrequency = new Map<string, number>();

  for (const appointment of appointments.filter(
    (entry) => entry.status === "completed",
  )) {
    const label = serviceLabel(appointment);
    serviceFrequency.set(label, (serviceFrequency.get(label) || 0) + 1);
  }

  const favoriteService =
    Array.from(serviceFrequency.entries()).sort(
      (left, right) => right[1] - left[1],
    )[0]?.[0] || "Sin servicios todavía";
  const nextAppointment =
    appointments
      .filter(
        (appointment) =>
          new Date(appointment.startTime) >= now &&
          !CLOSED_APPOINTMENT_STATUSES.has(appointment.status),
      )
      .sort(
        (left, right) =>
          new Date(left.startTime).getTime() -
          new Date(right.startTime).getTime(),
      )[0] || null;
  const tags = contact.tags.filter((tag) => {
    const normalized = tag.toLocaleLowerCase("es-MX");
    return (
      !normalized.startsWith("entry_global_") &&
      !normalized.startsWith("entryapp_")
    );
  });
  if (
    attendedCount >= 2 &&
    !tags.some((tag) => tag.toLocaleLowerCase("es-MX") === "recurrente")
  )
    tags.push("recurrente");
  if (
    attendedCount >= 5 &&
    !tags.some((tag) => tag.toLocaleLowerCase("es-MX") === "vip")
  )
    tags.push("vip");

  const actionAppointment =
    nextAppointment ||
    appointments
      .filter(
        (appointment) => !["cancelled", "no_show"].includes(appointment.status),
      )
      .sort(
        (left, right) =>
          new Date(right.startTime).getTime() -
          new Date(left.startTime).getTime(),
      )[0] ||
    null;

  const lastVisit =
    appointments
      .filter((entry) => entry.status === "completed")
      .sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      )[0] || null;
  return {
    attendedCount,
    favoriteService,
    actionAppointment,
    nextAppointment,
    lastVisit,
    tags,
  };
}
