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
    const clauses: Array<{ phone: string } | { phone: { endsWith: string } }> = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
        const exactKey = `eq:${candidate}`;
        if (!seen.has(exactKey)) {
            clauses.push({ phone: candidate });
            seen.add(exactKey);
        }

        const suffix = getPhoneSuffix(candidate);
        if (suffix && suffix !== candidate) {
            const suffixKey = `suffix:${suffix}`;
            if (!seen.has(suffixKey)) {
                clauses.push({ phone: { endsWith: suffix } });
                seen.add(suffixKey);
            }
        }
    }

    return clauses;
}
