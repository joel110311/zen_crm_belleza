export const SERVICE_PREPARATION_VERSION = 2 as const;
export const SERVICE_PREPARATION_OPTIONS = ["no_polish_or_acrylic", "clean_dry_hair", "no_eye_makeup", "no_contact_lenses", "clean_skin", "no_companions"] as const;
export const SERVICE_BOOKING_QUESTIONS = ["custom_design", "existing_product_removal", "allergies_or_sensitivities", "preferred_style_or_length", "hair_history", "first_time_service"] as const;
export const SERVICE_AFTERCARE_OPTIONS = ["avoid_water_24h", "avoid_oils", "brush_lashes_daily", "hydrate_cuticles", "avoid_heat_48h", "use_sulfate_free", "follow_specialist_instructions"] as const;

export type ServicePreparationOption = (typeof SERVICE_PREPARATION_OPTIONS)[number];
export type ServiceBookingQuestion = (typeof SERVICE_BOOKING_QUESTIONS)[number];
export type ServiceAftercareOption = (typeof SERVICE_AFTERCARE_OPTIONS)[number];

export type ServicePreparationRequirements = {
    version: typeof SERVICE_PREPARATION_VERSION;
    options: ServicePreparationOption[];
    additionalInstruction: string;
    bookingQuestions: ServiceBookingQuestion[];
    customBookingQuestion: string;
    aftercareOptions: ServiceAftercareOption[];
    additionalAftercareInstruction: string;
};

export const EMPTY_SERVICE_PREPARATION: ServicePreparationRequirements = {
    version: SERVICE_PREPARATION_VERSION,
    options: [],
    additionalInstruction: "",
    bookingQuestions: [],
    customBookingQuestion: "",
    aftercareOptions: [],
    additionalAftercareInstruction: "",
};

export const SERVICE_PREPARATION_LABELS: Record<ServicePreparationOption, string> = {
    no_polish_or_acrylic: "Acudir sin esmalte ni acrílico previo",
    clean_dry_hair: "Acudir con el cabello limpio y seco",
    no_eye_makeup: "Acudir sin maquillaje ni cremas en los ojos",
    no_contact_lenses: "Retirar los lentes de contacto antes del servicio",
    clean_skin: "Acudir con la piel limpia y sin maquillaje",
    no_companions: "Acudir sin acompañantes ni niños",
};
export const SERVICE_BOOKING_QUESTION_LABELS: Record<ServiceBookingQuestion, string> = {
    custom_design: "¿Lleva diseño personalizado o tiene foto de referencia?",
    existing_product_removal: "¿Necesita retiro de producto o trabajo anterior?",
    allergies_or_sensitivities: "¿Tiene alergias, sensibilidad o alguna reacción previa?",
    preferred_style_or_length: "¿Qué estilo, largo o resultado prefiere?",
    hair_history: "¿Su cabello es virgen o tiene procesos químicos previos?",
    first_time_service: "¿Es la primera vez que se realiza este servicio?",
};
export const SERVICE_AFTERCARE_LABELS: Record<ServiceAftercareOption, string> = {
    avoid_water_24h: "Evitar agua, vapor o humedad durante 24 horas",
    avoid_oils: "Evitar productos con aceite en la zona tratada",
    brush_lashes_daily: "Cepillar suavemente las pestañas a diario",
    hydrate_cuticles: "Hidratar cutículas y manos diariamente",
    avoid_heat_48h: "Evitar calor intenso durante 48 horas",
    use_sulfate_free: "Usar productos sin sulfatos para prolongar el resultado",
    follow_specialist_instructions: "Seguir las indicaciones personalizadas del especialista",
};

function selectKnown<T extends string>(value: unknown, options: readonly T[]) {
    return Array.isArray(value) ? [...new Set(value.filter((entry): entry is T => typeof entry === "string" && options.includes(entry as T)))] : [];
}
function clean(value: unknown, max: number) { return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : ""; }

export function normalizeServicePreparation(value?: unknown): ServicePreparationRequirements {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
        version: SERVICE_PREPARATION_VERSION,
        options: selectKnown(source.options, SERVICE_PREPARATION_OPTIONS),
        additionalInstruction: clean(source.additionalInstruction, 160),
        bookingQuestions: selectKnown(source.bookingQuestions, SERVICE_BOOKING_QUESTIONS),
        customBookingQuestion: clean(source.customBookingQuestion, 140),
        aftercareOptions: selectKnown(source.aftercareOptions, SERVICE_AFTERCARE_OPTIONS),
        additionalAftercareInstruction: clean(source.additionalAftercareInstruction, 180),
    };
}

export function formatServicePreparation(value?: unknown) {
    const requirements = normalizeServicePreparation(value);
    return [...requirements.options.map((option) => SERVICE_PREPARATION_LABELS[option]), requirements.additionalInstruction].filter(Boolean);
}
export function formatServiceBookingQuestions(value?: unknown) {
    const requirements = normalizeServicePreparation(value);
    return [...requirements.bookingQuestions.map((option) => SERVICE_BOOKING_QUESTION_LABELS[option]), requirements.customBookingQuestion].filter(Boolean);
}
export function formatServiceAftercare(value?: unknown) {
    const requirements = normalizeServicePreparation(value);
    return [...requirements.aftercareOptions.map((option) => SERVICE_AFTERCARE_LABELS[option]), requirements.additionalAftercareInstruction].filter(Boolean);
}
