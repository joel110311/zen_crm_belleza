function normalizeReplyText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildConsonantSkeleton(value: string) {
    return value.replace(/[aeiou]/g, "");
}

function levenshteinDistance(left: string, right: string) {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;

    const distances = Array.from({ length: right.length + 1 }, (_, index) => index);

    for (let row = 1; row <= left.length; row += 1) {
        let previous = row - 1;
        distances[0] = row;

        for (let column = 1; column <= right.length; column += 1) {
            const current = distances[column];
            const cost = left[row - 1] === right[column - 1] ? 0 : 1;
            distances[column] = Math.min(
                distances[column] + 1,
                distances[column - 1] + 1,
                previous + cost,
            );
            previous = current;
        }
    }

    return distances[right.length];
}

function tokenLooksLikeKeyword(token: string, keyword: string) {
    if (!token || !keyword) return false;
    if (token === keyword) return true;
    if (token.length < 4 || keyword.length < 4) return false;

    if (buildConsonantSkeleton(token) === buildConsonantSkeleton(keyword)) {
        return true;
    }

    const distance = levenshteinDistance(token, keyword);
    const maxDistance = keyword.length >= 8 ? 3 : keyword.length >= 6 ? 2 : 1;
    return distance <= maxDistance;
}

function tokenLooksLikeStopKeyword(token: string, keyword: string) {
    if (!token || !keyword) return false;
    if (token === keyword) return true;
    if (token.length < 5 || keyword.length < 5) return false;
    if (Math.abs(token.length - keyword.length) > 1) return false;

    // STOP commands are high-impact (opt-out + closed lost), so keep matching strict.
    const distance = levenshteinDistance(token, keyword);
    return distance <= 1;
}

const STOP_PHRASES = [
    "no me interesa",
    "ya no me interesa",
    "deja de mandar",
    "deja de enviar",
    "para de mandar",
    "para de enviar",
    "para de escribirme",
    "no mandes",
    "no enviar",
    "no envies",
    "no escribas",
    "no me escribas",
    "dame de baja",
    "quiero dejar de recibir",
    "no quiero recibir",
];

const STOP_KEYWORDS = [
    "detener",
    "deten",
    "stop",
    "basta",
    "quitame",
    "removeme",
    "desuscribir",
    "bajame",
];

const INTEREST_PHRASES = [
    "me interesa",
    "quiero informacion",
    "quiero info",
    "mandame informacion",
    "manda informacion",
    "quiero cotizar",
    "quiero una cotizacion",
    "quiero comprar",
    "quiero agendar",
    "quiero verlo",
    "quiero ver",
    "sigue disponible",
    "esta disponible",
];

const INTEREST_KEYWORDS = [
    "interesa",
    "precio",
    "precios",
    "costo",
    "costos",
    "cotizacion",
    "cotizar",
    "informacion",
    "info",
    "disponible",
    "quiero",
    "agendar",
    "agenda",
    "visita",
    "visitar",
    "comprar",
    "apartar",
    "detalle",
    "detalles",
];

export type BulkCampaignReplyIntent = "stop" | "interest" | "neutral";

export function isExplicitBulkStopCommand(rawText: string) {
    const normalized = normalizeReplyText(rawText);
    if (!normalized) return false;

    if (STOP_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return true;
    }

    const tokens = normalized.split(" ").filter(Boolean);
    return tokens.some((token) => STOP_KEYWORDS.includes(token));
}

export function classifyBulkCampaignReplyIntent(rawText: string): BulkCampaignReplyIntent {
    const normalized = normalizeReplyText(rawText);
    if (!normalized) return "neutral";

    if (STOP_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return "stop";
    }

    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.some((token) => STOP_KEYWORDS.some((keyword) => tokenLooksLikeStopKeyword(token, keyword)))) {
        return "stop";
    }

    if (INTEREST_PHRASES.some((phrase) => normalized.includes(phrase))) {
        return "interest";
    }

    const interestScore = tokens.reduce((score, token) => (
        score + (INTEREST_KEYWORDS.some((keyword) => tokenLooksLikeKeyword(token, keyword)) ? 1 : 0)
    ), 0);

    if (interestScore >= 1) {
        return "interest";
    }

    return "neutral";
}
