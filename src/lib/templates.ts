export type TemplateVariableKey = "nombre" | "empresa" | "telefono" | "agente";

export type TemplateVariableDefinition = {
    key: TemplateVariableKey;
    label: string;
    placeholder: string;
};

export const TEMPLATE_VARIABLES: TemplateVariableDefinition[] = [
    { key: "nombre", label: "Nombre del contacto", placeholder: "{{nombre}}" },
    { key: "empresa", label: "Empresa", placeholder: "{{empresa}}" },
    { key: "telefono", label: "Telefono", placeholder: "{{telefono}}" },
    { key: "agente", label: "Nombre del agente", placeholder: "{{agente}}" },
];

export type TemplateRenderContext = {
    contact?: {
        name?: string | null;
        company?: string | null;
        phone?: string | null;
    } | null;
    agentName?: string | null;
};

export type TemplateRecord = {
    id: string;
    name: string;
    content: string;
    category: string | null;
    language: string;
    status: string;
    type: string;
    mediaUrl: string | null;
    mediaType: string | null;
    mediaFileName: string | null;
    shortcut: string | null;
    variables: unknown;
    isFavorite: boolean;
    isActive: boolean;
    sortOrder: number;
    usageCount: number;
    lastUsedAt: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
};

function normalizeWhitespace(value?: string | null) {
    return value?.trim().replace(/\s+/g, " ") || "";
}

export function normalizeTemplateShortcut(value?: string | null) {
    const normalized = normalizeWhitespace(value)
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9_-]/g, "");

    return normalized || null;
}

export function listTemplateVariableKeys(content: string) {
    const matches = content.match(/{{\s*([a-zA-Z0-9_]+)\s*}}/g) || [];
    const keys = matches
        .map((match) => match.replace(/[{}]/g, "").trim().toLowerCase())
        .filter((value, index, array) => array.indexOf(value) === index);

    return keys;
}

export function renderTemplateContent(content: string, context: TemplateRenderContext) {
    const values: Record<TemplateVariableKey, string> = {
        nombre: normalizeWhitespace(context.contact?.name),
        empresa: normalizeWhitespace(context.contact?.company),
        telefono: normalizeWhitespace(context.contact?.phone),
        agente: normalizeWhitespace(context.agentName),
    };

    return content.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, rawKey: string) => {
        const key = rawKey.trim().toLowerCase() as TemplateVariableKey;
        return values[key] ?? "";
    });
}

export function extractTemplateSlashQuery(input: string) {
    const match = input.match(/(?:^|\s)\/([a-z0-9_-]*)$/i);
    return match ? match[1].toLowerCase() : null;
}

export function humanizeTemplateType(type: string) {
    if (type === "image") return "Imagen";
    if (type === "document") return "Documento";
    return "Texto";
}
