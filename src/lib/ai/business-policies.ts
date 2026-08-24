export const BUSINESS_POLICIES_VERSION = 2 as const;

export const PAYMENT_METHODS = ["cash", "transfer", "card", "mercado_pago"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const HUMAN_ESCALATION_TRIGGERS = [
    "explicit_request",
    "custom_quote",
    "complaint",
    "adverse_reaction",
    "payment_issue",
    "missing_critical_information",
] as const;
export type HumanEscalationTrigger = (typeof HUMAN_ESCALATION_TRIGGERS)[number];

export type BusinessPolicies = {
    version: typeof BUSINESS_POLICIES_VERSION;
    cancellation: {
        manageByChat: boolean;
        minimumNoticeHours: number;
        lateArrivalToleranceMinutes: number | null;
        lateChangeConsequence: "none" | "may_charge" | "deposit_lost" | "human_review";
    };
    deposits: {
        required: boolean;
        appliesTo: "all" | "above_amount" | "new_clients";
        thresholdAmount: number;
        valueType: "fixed" | "percentage";
        value: number;
        refundable: "yes" | "no" | "according_to_notice";
        methods: PaymentMethod[];
    };
    customWork: {
        mode: "fixed_catalog" | "photo_quote" | "in_person_assessment" | "not_offered";
        reviewerName: string;
        allowBookingBeforeQuote: boolean;
    };
    humanEscalation: {
        triggers: HumanEscalationTrigger[];
    };
    legacyNotes: {
        cancellationAndRescheduling: string;
        depositsAndPayments: string;
        preparationInstructions: string;
        customQuotes: string;
        humanEscalation: string;
    };
};

export const EMPTY_BUSINESS_POLICIES: BusinessPolicies = {
    version: BUSINESS_POLICIES_VERSION,
    cancellation: {
        manageByChat: true,
        minimumNoticeHours: 24,
        lateArrivalToleranceMinutes: null,
        lateChangeConsequence: "none",
    },
    deposits: {
        required: false,
        appliesTo: "all",
        thresholdAmount: 1000,
        valueType: "fixed",
        value: 0,
        refundable: "according_to_notice",
        methods: ["cash", "transfer", "card"],
    },
    customWork: {
        mode: "photo_quote",
        reviewerName: "el equipo",
        allowBookingBeforeQuote: true,
    },
    humanEscalation: {
        triggers: ["explicit_request", "custom_quote", "adverse_reaction", "complaint"],
    },
    legacyNotes: {
        cancellationAndRescheduling: "",
        depositsAndPayments: "",
        preparationInstructions: "",
        customQuotes: "",
        humanEscalation: "",
    },
};

function asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function cleanText(value: unknown, maxLength = 80) {
    return typeof value === "string"
        ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
        : "";
}

function cleanLegacyText(value: unknown) {
    return typeof value === "string"
        ? value.replace(/\r\n/g, "\n").trim().slice(0, 2000)
        : "";
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return typeof value === "string" && options.includes(value as T) ? value as T : fallback;
}

function stringList<T extends string>(value: unknown, options: readonly T[], fallback: T[]) {
    if (!Array.isArray(value)) return fallback;
    return [...new Set(value.filter((entry): entry is T => typeof entry === "string" && options.includes(entry as T)))];
}

export function normalizeBusinessPolicies(value?: unknown): BusinessPolicies {
    const source = asRecord(value);
    const cancellation = asRecord(source.cancellation);
    const deposits = asRecord(source.deposits);
    const customWork = asRecord(source.customWork);
    const humanEscalation = asRecord(source.humanEscalation);
    const legacySource = asRecord(source.legacyNotes);
    const sourceVersion = Number(source.version || 1);

    return {
        version: BUSINESS_POLICIES_VERSION,
        cancellation: {
            manageByChat: typeof cancellation.manageByChat === "boolean"
                ? cancellation.manageByChat
                : EMPTY_BUSINESS_POLICIES.cancellation.manageByChat,
            minimumNoticeHours: clampNumber(cancellation.minimumNoticeHours, 24, 0, 168),
            lateArrivalToleranceMinutes: cancellation.lateArrivalToleranceMinutes === null
                || cancellation.lateArrivalToleranceMinutes === undefined
                ? null
                : clampNumber(cancellation.lateArrivalToleranceMinutes, 0, 0, 60),
            lateChangeConsequence: oneOf(cancellation.lateChangeConsequence, ["none", "may_charge", "deposit_lost", "human_review"] as const, "none"),
        },
        deposits: {
            required: typeof deposits.required === "boolean" ? deposits.required : false,
            appliesTo: oneOf(deposits.appliesTo, ["all", "above_amount", "new_clients"] as const, "all"),
            thresholdAmount: clampNumber(deposits.thresholdAmount, 1000, 0, 1_000_000),
            valueType: oneOf(deposits.valueType, ["fixed", "percentage"] as const, "fixed"),
            value: clampNumber(deposits.value, 0, 0, 1_000_000),
            refundable: oneOf(deposits.refundable, ["yes", "no", "according_to_notice"] as const, "according_to_notice"),
            methods: stringList(deposits.methods, PAYMENT_METHODS, [...EMPTY_BUSINESS_POLICIES.deposits.methods]),
        },
        customWork: {
            mode: oneOf(customWork.mode, ["fixed_catalog", "photo_quote", "in_person_assessment", "not_offered"] as const, "photo_quote"),
            reviewerName: cleanText(customWork.reviewerName) || "el equipo",
            allowBookingBeforeQuote: typeof customWork.allowBookingBeforeQuote === "boolean"
                ? customWork.allowBookingBeforeQuote
                : true,
        },
        humanEscalation: {
            triggers: stringList(humanEscalation.triggers, HUMAN_ESCALATION_TRIGGERS, [...EMPTY_BUSINESS_POLICIES.humanEscalation.triggers]),
        },
        legacyNotes: {
            cancellationAndRescheduling: cleanLegacyText(legacySource.cancellationAndRescheduling ?? (sourceVersion < 2 ? source.cancellationAndRescheduling : "")),
            depositsAndPayments: cleanLegacyText(legacySource.depositsAndPayments ?? (sourceVersion < 2 ? source.depositsAndPayments : "")),
            preparationInstructions: cleanLegacyText(legacySource.preparationInstructions ?? (sourceVersion < 2 ? source.preparationInstructions : "")),
            customQuotes: cleanLegacyText(legacySource.customQuotes ?? (sourceVersion < 2 ? source.customQuotes : "")),
            humanEscalation: cleanLegacyText(legacySource.humanEscalation ?? (sourceVersion < 2 ? source.humanEscalation : "")),
        },
    };
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
    cash: "efectivo",
    transfer: "transferencia",
    card: "tarjeta",
    mercado_pago: "Mercado Pago",
};

const ESCALATION_TRIGGER_LABELS: Record<HumanEscalationTrigger, string> = {
    explicit_request: "el cliente solicita hablar con una persona",
    custom_quote: "solicita una cotización personalizada o envía una referencia para valorar",
    complaint: "presenta una queja o solicita una devolución",
    adverse_reaction: "reporta alergia, irritación, embarazo o una reacción adversa",
    payment_issue: "reporta un problema de pago",
    missing_critical_information: "falta información fiable para resolver una decisión importante",
};

export function compileBusinessPolicies(value?: unknown) {
    const policies = normalizeBusinessPolicies(value);
    const lines: string[] = [
        "REGLA DE POLÍTICAS: aplica solamente las reglas compiladas a continuación. No inventes requisitos, cargos, anticipos, penalizaciones ni excepciones.",
    ];

    if (policies.cancellation.manageByChat) {
        lines.push(`- Cancelaciones y cambios: pueden gestionarse por chat con al menos ${policies.cancellation.minimumNoticeHours} hora(s) de anticipación, siempre que el CRM confirme la operación.`);
    } else {
        lines.push("- Cancelaciones y cambios: no los gestiones automáticamente; transfiere la conversación al equipo.");
    }

    const consequence = {
        none: "No menciones penalización ni cargo por aviso tardío.",
        may_charge: "Si avisa tarde, explica que puede aplicarse un cargo y solicita confirmación humana.",
        deposit_lost: "Si avisa tarde, informa que el anticipo no es reembolsable.",
        human_review: "Si avisa tarde, no decidas una consecuencia; solicita revisión humana.",
    }[policies.cancellation.lateChangeConsequence];
    lines.push(`- Avisos tardíos: ${consequence}`);
    if (policies.cancellation.lateArrivalToleranceMinutes !== null) {
        lines.push(`- Tolerancia de llegada: ${policies.cancellation.lateArrivalToleranceMinutes} minuto(s).`);
    }

    if (!policies.deposits.required) {
        lines.push("- Anticipos: no se requiere anticipo para reservar y no debes solicitar pagos previos.");
    } else {
        const appliesTo = {
            all: "todas las reservas",
            above_amount: `servicios con precio mayor o igual a ${policies.deposits.thresholdAmount}`,
            new_clients: "clientes nuevos",
        }[policies.deposits.appliesTo];
        const amount = policies.deposits.valueType === "percentage"
            ? `${policies.deposits.value}% del servicio`
            : `${policies.deposits.value} en la moneda configurada`;
        lines.push(`- Anticipos: solicita ${amount} para ${appliesTo}.`);
        lines.push(`- Reembolso del anticipo: ${{ yes: "sí es reembolsable", no: "no es reembolsable", according_to_notice: "depende de que se respete el plazo de cancelación" }[policies.deposits.refundable]}.`);
    }

    lines.push(
        policies.deposits.methods.length > 0
            ? `- Métodos de pago aceptados: ${policies.deposits.methods.map((method) => PAYMENT_METHOD_LABELS[method]).join(", ")}.`
            : "- Métodos de pago: no están configurados; no inventes uno y solicita confirmación humana si preguntan.",
    );

    const customRule = {
        fixed_catalog: "Los trabajos personalizados tienen precio fijo en el catálogo; usa solamente ese precio.",
        photo_quote: `Los trabajos personalizados se cotizan después de recibir una foto o referencia; ${policies.customWork.reviewerName} confirma el precio.`,
        in_person_assessment: "Los trabajos personalizados requieren una valoración presencial antes de confirmar precio.",
        not_offered: "El negocio no ofrece trabajos personalizados fuera del catálogo.",
    }[policies.customWork.mode];
    lines.push(`- Trabajos personalizados: ${customRule}`);
    lines.push(
        policies.customWork.allowBookingBeforeQuote
            ? "- Puede agendarse el servicio base antes de obtener la cotización, si el cliente no exige conocer antes el precio final."
            : "- No confirmes la reserva de un trabajo personalizado hasta que el equipo haya realizado la cotización o valoración.",
    );

    if (policies.humanEscalation.triggers.length > 0) {
        lines.push(`- Escala a una persona cuando: ${policies.humanEscalation.triggers.map((trigger) => ESCALATION_TRIGGER_LABELS[trigger]).join("; ")}.`);
    } else {
        lines.push("- Escalación humana: no hay detonantes adicionales configurados; escala sólo si no puedes resolver con datos verificados.");
    }

    const legacyLines = Object.values(policies.legacyNotes).filter(Boolean);
    if (legacyLines.length > 0) {
        lines.push("- Notas heredadas conservadas de la configuración anterior:");
        lines.push(...legacyLines.map((note) => `  - ${note}`));
    }

    return lines;
}

export function hasConfiguredBusinessPolicies(value?: unknown) {
    return compileBusinessPolicies(value).length > 1;
}
