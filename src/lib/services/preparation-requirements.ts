export const SERVICE_PREPARATION_VERSION = 1 as const;
export const SERVICE_PREPARATION_OPTIONS = [
    "no_polish_or_acrylic",
    "clean_dry_hair",
    "no_eye_makeup",
    "no_contact_lenses",
    "clean_skin",
    "no_companions",
] as const;

export type ServicePreparationOption = (typeof SERVICE_PREPARATION_OPTIONS)[number];

export type ServicePreparationRequirements = {
    version: typeof SERVICE_PREPARATION_VERSION;
    options: ServicePreparationOption[];
    additionalInstruction: string;
};

export const EMPTY_SERVICE_PREPARATION: ServicePreparationRequirements = {
    version: SERVICE_PREPARATION_VERSION,
    options: [],
    additionalInstruction: "",
};

export const SERVICE_PREPARATION_LABELS: Record<ServicePreparationOption, string> = {
    no_polish_or_acrylic: "Acudir sin esmalte ni acrílico previo",
    clean_dry_hair: "Acudir con el cabello limpio y seco",
    no_eye_makeup: "Acudir sin maquillaje ni cremas en los ojos",
    no_contact_lenses: "Retirar los lentes de contacto antes del servicio",
    clean_skin: "Acudir con la piel limpia y sin maquillaje",
    no_companions: "Acudir sin acompañantes ni niños",
};

export function normalizeServicePreparation(value?: unknown): ServicePreparationRequirements {
    const source = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    const options = Array.isArray(source.options)
        ? [...new Set(source.options.filter((entry): entry is ServicePreparationOption =>
            typeof entry === "string" && SERVICE_PREPARATION_OPTIONS.includes(entry as ServicePreparationOption),
        ))]
        : [];

    return {
        version: SERVICE_PREPARATION_VERSION,
        options,
        additionalInstruction: typeof source.additionalInstruction === "string"
            ? source.additionalInstruction.replace(/\s+/g, " ").trim().slice(0, 160)
            : "",
    };
}

export function formatServicePreparation(value?: unknown) {
    const requirements = normalizeServicePreparation(value);
    return [
        ...requirements.options.map((option) => SERVICE_PREPARATION_LABELS[option]),
        requirements.additionalInstruction,
    ].filter(Boolean);
}
