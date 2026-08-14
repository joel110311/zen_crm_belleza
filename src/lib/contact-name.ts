type ContactNameLike = {
    name?: string | null;
    lastName?: string | null;
    phone?: string | null;
};

function normalizeNamePart(value?: string | null) {
    const normalized = value?.trim().replace(/\s+/g, " ") || "";
    return normalized || null;
}

export function getContactFullName(
    contact: ContactNameLike | null | undefined,
    fallback = "Sin nombre",
) {
    const firstName = normalizeNamePart(contact?.name);
    const lastName = normalizeNamePart(contact?.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    if (fullName) return fullName;
    if (contact?.phone) return `+${contact.phone}`;
    return fallback;
}

export function getContactInitial(contact: ContactNameLike | null | undefined) {
    return getContactFullName(contact, "C").charAt(0).toUpperCase();
}
