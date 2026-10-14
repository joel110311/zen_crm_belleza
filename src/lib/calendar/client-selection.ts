type ClientLookup = {
  patient: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; contactId: true };
    }): PromiseLike<{ id: string; contactId: string | null } | null>;
  };
  contact: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; patients: { take: 1; select: { id: true } } };
    }): PromiseLike<{ id: string; patients: { id: string }[] } | null>;
  };
};

/** Resolves only records from the caller's authorized, routed tenant database. Never creates a profile as a read side effect. */
export async function resolveCalendarClient(
  input: { patientId?: string | null; contactId?: string | null },
  db: ClientLookup,
) {
  const patientId =
    typeof input.patientId === "string" ? input.patientId.trim() : "";
  const contactId =
    typeof input.contactId === "string" ? input.contactId.trim() : "";
  if (patientId) {
    const patient = await db.patient.findUnique({
      where: { id: patientId },
      select: { id: true, contactId: true },
    });
    if (!patient || (contactId && contactId !== patient.contactId))
      return {
        success: false as const,
        error:
          "El cliente seleccionado ya no está disponible. Vuelve a seleccionarlo.",
      };
    return {
      success: true as const,
      patientId: patient.id,
      contactId: patient.contactId,
    };
  }
  if (contactId) {
    const contact = await db.contact.findUnique({
      where: { id: contactId },
      select: { id: true, patients: { take: 1, select: { id: true } } },
    });
    if (!contact)
      return {
        success: false as const,
        error:
          "El cliente seleccionado ya no está disponible. Vuelve a seleccionarlo.",
      };
    return {
      success: true as const,
      contactId: contact.id,
      patientId: contact.patients[0]?.id || null,
    };
  }
  return {
    success: false as const,
    error: "Selecciona o registra un cliente antes de agendar.",
  };
}
