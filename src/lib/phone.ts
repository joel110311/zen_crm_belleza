export const PHONE_MIN_DIGITS = 8;
export const PHONE_MAX_DIGITS = 15;

const MONTERREY_METRO_PREFIXES = new Set(["811", "812"]);

export function normalizePhoneDigits(value: string | null | undefined) {
    return (value || "").replace(/\D/g, "");
}

export function isPlausiblePhoneDigits(value: string) {
    return value.length >= PHONE_MIN_DIGITS && value.length <= PHONE_MAX_DIGITS;
}

export function getPhoneSuffix(value: string) {
    const normalized = normalizePhoneDigits(value);
    if (!normalized) return "";
    return normalized.length > 10 ? normalized.slice(-10) : normalized;
}

export type PhoneLadaContext = {
    normalizedPhone: string;
    suffix10: string;
    lada2: string | null;
    lada3: string | null;
    zoneKey: "monterrey_metro" | "fuera_monterrey_metro" | "indefinida";
    zoneLabel: string;
    ruleApplied: string;
};

export function resolvePhoneLadaContext(value: string | null | undefined): PhoneLadaContext {
    const normalizedPhone = normalizePhoneDigits(value);
    const suffix10 = getPhoneSuffix(normalizedPhone);
    const lada2 = suffix10.length >= 2 ? suffix10.slice(0, 2) : null;
    const lada3 = suffix10.length >= 3 ? suffix10.slice(0, 3) : null;

    if (!suffix10 || suffix10.length < 10 || !lada3) {
        return {
            normalizedPhone,
            suffix10,
            lada2,
            lada3,
            zoneKey: "indefinida",
            zoneLabel: "No se pudo clasificar por lada",
            ruleApplied: "Telefono insuficiente o no normalizable a 10 digitos.",
        };
    }

    if (MONTERREY_METRO_PREFIXES.has(lada3)) {
        return {
            normalizedPhone,
            suffix10,
            lada2,
            lada3,
            zoneKey: "monterrey_metro",
            zoneLabel: "Monterrey y zona metropolitana",
            ruleApplied: `Prefijo ${lada3} pertenece al conjunto metropolitano configurado (${Array.from(MONTERREY_METRO_PREFIXES).join(", ")}).`,
        };
    }

    return {
        normalizedPhone,
        suffix10,
        lada2,
        lada3,
        zoneKey: "fuera_monterrey_metro",
        zoneLabel: "Fuera de Monterrey y zona metropolitana",
        ruleApplied: `Prefijo ${lada3} no coincide con los prefijos metropolitanos configurados (${Array.from(MONTERREY_METRO_PREFIXES).join(", ")}).`,
    };
}

export function normalizeWuzapiRecipient(phone: string | null | undefined): string {
    const trimmed = (phone || "").trim();
    if (!trimmed) return "";

    if (trimmed.startsWith("me:") || trimmed.includes("@")) {
        return trimmed.replace(/\s+/g, "");
    }

    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return "";

    // WhatsApp linked-device JIDs for Mexico commonly require the legacy mobile
    // marker `1` after country code 52.
    if (digits.length === 10) {
        return `521${digits}`;
    }

    if (digits.length === 12 && digits.startsWith("52") && !digits.startsWith("521")) {
        return `521${digits.slice(2)}`;
    }

    return digits;
}

export function normalizeMetaRecipient(phone: string | null | undefined): string {
    const digits = (phone || "").replace(/\D/g, "");
    if (!digits) return "";

    // Meta WhatsApp Cloud API for Mexico requires E.164 WITHOUT the legacy mobile `1`:
    // 52 + 10 digits (12 digits total).
    if (digits.length === 13 && digits.startsWith("521")) {
        return `52${digits.slice(3)}`;
    }

    if (digits.length === 10) {
        return `52${digits}`;
    }

    return digits;
}

export function extractNational10(value: string | null | undefined): string {
    const digits = normalizePhoneDigits(value);
    if (!digits) return "";
    if (digits.length === 13 && digits.startsWith("521")) return digits.slice(3);
    if (digits.length === 12 && digits.startsWith("52")) return digits.slice(2);
    if (digits.length === 10) return digits;
    return digits.length > 10 ? digits.slice(-10) : digits;
}

export function uniquePhoneCandidates(values: Array<string | null | undefined>) {
    const seen = new Set<string>();

    return values
        .map((value) => normalizePhoneDigits(value))
        .filter((value) => isPlausiblePhoneDigits(value))
        .filter((value) => {
            if (seen.has(value)) return false;
            seen.add(value);
            return true;
        });
}

export function buildPhoneMatchClauses(values: Array<string | null | undefined>) {
    const candidates = uniquePhoneCandidates(values);
    const clauses: Array<{ phone: string } | { phone: { endsWith: string } } | { phone: { contains: string } }> = [];
    const seen = new Set<string>();

    const addClause = (clause: { phone: string } | { phone: { endsWith: string } } | { phone: { contains: string } }, key: string) => {
        if (!seen.has(key)) {
            clauses.push(clause);
            seen.add(key);
        }
    };

    for (const rawCandidate of candidates) {
        const candidate = normalizePhoneDigits(rawCandidate);
        if (!candidate) continue;

        addClause({ phone: candidate }, `eq:${candidate}`);
        addClause({ phone: `+${candidate}` }, `eq:+${candidate}`);

        const national10 = extractNational10(candidate);
        if (national10 && national10.length === 10) {
            // Equivalent digit representations
            const eqCandidates = [
                national10,
                `52${national10}`,
                `521${national10}`,
                `+${national10}`,
                `+52${national10}`,
                `+521${national10}`,
                // Formatted representations often stored from UI inputs or contacts forms
                `+52 ${national10.slice(0, 3)} ${national10.slice(3, 6)} ${national10.slice(6)}`,
                `+52 1${national10.slice(0, 2)} ${national10.slice(2, 5)} ${national10.slice(5)}`,
                `+52 1 ${national10.slice(0, 3)} ${national10.slice(3, 6)} ${national10.slice(6)}`,
                `${national10.slice(0, 3)} ${national10.slice(3, 6)} ${national10.slice(6)}`,
                `${national10.slice(0, 3)}-${national10.slice(3, 6)}-${national10.slice(6)}`,
                `(${national10.slice(0, 3)}) ${national10.slice(3, 6)}-${national10.slice(6)}`,
                `+52 (${national10.slice(0, 3)}) ${national10.slice(3, 6)}-${national10.slice(6)}`,
            ];

            for (const eq of eqCandidates) {
                addClause({ phone: eq }, `eq:${eq}`);
            }

            // Suffix and contains clauses
            addClause({ phone: { endsWith: national10 } }, `endsWith:${national10}`);
            addClause({ phone: { contains: national10 } }, `contains:${national10}`);

            // Formatted suffixes e.g. " 268 3928" or "268 3928"
            const last7Formatted = `${national10.slice(3, 6)} ${national10.slice(6)}`;
            addClause({ phone: { endsWith: last7Formatted } }, `endsWith:${last7Formatted}`);
            const last7Hyphen = `${national10.slice(3, 6)}-${national10.slice(6)}`;
            addClause({ phone: { endsWith: last7Hyphen } }, `endsWith:${last7Hyphen}`);
        } else {
            const suffix = getPhoneSuffix(candidate);
            if (suffix && suffix !== candidate) {
                addClause({ phone: { endsWith: suffix } }, `endsWith:${suffix}`);
            }
        }
    }

    return clauses;
}
