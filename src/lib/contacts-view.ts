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
  listMetrics?: ClientMetrics;
};

export type ClientMetrics = {
  attendedCount: number;
  favoriteService: string;
  actionAppointment: ClientAppointment | null;
  nextAppointment: ClientAppointment | null;
  lastVisit: ClientAppointment | null;
  tags: string[];
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

export function getClientMetrics(contact: ContactTableItem, now = new Date()): ClientMetrics {
  if (contact.listMetrics) return contact.listMetrics;
  const appointments = uniqueAppointments(contact);
  let attendedCount = 0;
  const serviceFrequency = new Map<string, number>();
  let nextAppointment: ClientAppointment | null = null;
  let latestAction: ClientAppointment | null = null;
  let lastVisit: ClientAppointment | null = null;
  for (const appointment of appointments) {
    const time = new Date(appointment.startTime).getTime();
    if (appointment.status === "completed") {
      attendedCount++;
      const label = serviceLabel(appointment);
      serviceFrequency.set(label, (serviceFrequency.get(label) || 0) + 1);
      if (!lastVisit || time > new Date(lastVisit.startTime).getTime()) lastVisit = appointment;
    }
    if (time >= now.getTime() && !CLOSED_APPOINTMENT_STATUSES.has(appointment.status) &&
        (!nextAppointment || time < new Date(nextAppointment.startTime).getTime())) nextAppointment = appointment;
    if (!["cancelled", "no_show"].includes(appointment.status) &&
        (!latestAction || time > new Date(latestAction.startTime).getTime())) latestAction = appointment;
  }
  let favoriteService = "Sin servicios todavía", favoriteCount = 0;
  for (const [label, count] of serviceFrequency) {
    if (count > favoriteCount) { favoriteService = label; favoriteCount = count; }
  }
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

  const actionAppointment = nextAppointment || latestAction;
  return {
    attendedCount,
    favoriteService,
    actionAppointment,
    nextAppointment,
    lastVisit,
    tags,
  };
}

/** The list needs metrics and its action appointments, not the whole visit history. */
export function contactListSnapshot(contact: ContactTableItem, now = new Date()): ContactTableItem {
  const listMetrics = getClientMetrics(contact, now);
  return {
    id: contact.id, name: contact.name, lastName: contact.lastName, phone: contact.phone,
    sourceType: contact.sourceType, tags: contact.tags, createdAt: contact.createdAt,
    whatsappAvatarUrl: contact.whatsappAvatarUrl,
    appointments: [], patients: contact.patients.map((patient) => ({ id: patient.id, appointments: [] })),
    listMetrics,
  };
}
