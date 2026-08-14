export type OperationCountryCode =
    | "MX"
    | "AR"
    | "US"
    | "CL"
    | "CO"
    | "PE"
    | "ES"
    | "BR"
    | "UY"
    | "PY"
    | "BO"
    | "EC"
    | "VE"
    | "CR"
    | "PA"
    | "GT";

export type OperationCountry = {
    code: OperationCountryCode;
    name: string;
    callingCode: string;
    locale: string;
    timeZone: string;
    currencies: string[];
    defaultCurrency: string;
};

export const OPERATION_COUNTRIES: OperationCountry[] = [
    { code: "MX", name: "Mexico", callingCode: "+52", locale: "es-MX", timeZone: "America/Mexico_City", currencies: ["MXN"], defaultCurrency: "MXN" },
    { code: "AR", name: "Argentina", callingCode: "+54", locale: "es-AR", timeZone: "America/Argentina/Buenos_Aires", currencies: ["ARS", "USD"], defaultCurrency: "ARS" },
    { code: "US", name: "Estados Unidos", callingCode: "+1", locale: "en-US", timeZone: "America/New_York", currencies: ["USD"], defaultCurrency: "USD" },
    { code: "CL", name: "Chile", callingCode: "+56", locale: "es-CL", timeZone: "America/Santiago", currencies: ["CLP", "USD"], defaultCurrency: "CLP" },
    { code: "CO", name: "Colombia", callingCode: "+57", locale: "es-CO", timeZone: "America/Bogota", currencies: ["COP"], defaultCurrency: "COP" },
    { code: "PE", name: "Peru", callingCode: "+51", locale: "es-PE", timeZone: "America/Lima", currencies: ["PEN", "USD"], defaultCurrency: "PEN" },
    { code: "ES", name: "Espana", callingCode: "+34", locale: "es-ES", timeZone: "Europe/Madrid", currencies: ["EUR"], defaultCurrency: "EUR" },
    { code: "BR", name: "Brasil", callingCode: "+55", locale: "pt-BR", timeZone: "America/Sao_Paulo", currencies: ["BRL"], defaultCurrency: "BRL" },
    { code: "UY", name: "Uruguay", callingCode: "+598", locale: "es-UY", timeZone: "America/Montevideo", currencies: ["UYU", "USD"], defaultCurrency: "UYU" },
    { code: "PY", name: "Paraguay", callingCode: "+595", locale: "es-PY", timeZone: "America/Asuncion", currencies: ["PYG", "USD"], defaultCurrency: "PYG" },
    { code: "BO", name: "Bolivia", callingCode: "+591", locale: "es-BO", timeZone: "America/La_Paz", currencies: ["BOB"], defaultCurrency: "BOB" },
    { code: "EC", name: "Ecuador", callingCode: "+593", locale: "es-EC", timeZone: "America/Guayaquil", currencies: ["USD"], defaultCurrency: "USD" },
    { code: "VE", name: "Venezuela", callingCode: "+58", locale: "es-VE", timeZone: "America/Caracas", currencies: ["VES", "USD"], defaultCurrency: "VES" },
    { code: "CR", name: "Costa Rica", callingCode: "+506", locale: "es-CR", timeZone: "America/Costa_Rica", currencies: ["CRC", "USD"], defaultCurrency: "CRC" },
    { code: "PA", name: "Panama", callingCode: "+507", locale: "es-PA", timeZone: "America/Panama", currencies: ["USD"], defaultCurrency: "USD" },
    { code: "GT", name: "Guatemala", callingCode: "+502", locale: "es-GT", timeZone: "America/Guatemala", currencies: ["GTQ", "USD"], defaultCurrency: "GTQ" },
];

const COUNTRY_BY_CODE = new Map(OPERATION_COUNTRIES.map((country) => [country.code, country]));
const COUNTRY_BY_CALLING_CODE = [...OPERATION_COUNTRIES]
    .sort((left, right) => right.callingCode.length - left.callingCode.length);

export const DEFAULT_OPERATION_COUNTRY = "MX" satisfies OperationCountryCode;

export function normalizeOperationCountryCode(value?: string | null): OperationCountryCode {
    const code = String(value || "").trim().toUpperCase();
    return COUNTRY_BY_CODE.has(code as OperationCountryCode) ? code as OperationCountryCode : DEFAULT_OPERATION_COUNTRY;
}

export function getOperationCountry(value?: string | null): OperationCountry {
    return COUNTRY_BY_CODE.get(normalizeOperationCountryCode(value)) || COUNTRY_BY_CODE.get(DEFAULT_OPERATION_COUNTRY)!;
}

export function getOrderedPhoneCountries(defaultCountry?: string | null) {
    const selected = getOperationCountry(defaultCountry);
    return [
        selected,
        ...OPERATION_COUNTRIES.filter((country) => country.code !== selected.code),
    ];
}

export function normalizeCurrencyList(value: unknown, countryCode?: string | null) {
    const country = getOperationCountry(countryCode);
    const raw = Array.isArray(value) ? value : country.currencies;
    const currencies = Array.from(
        new Set(
            raw
                .map((currency) => String(currency || "").trim().toUpperCase())
                .filter((currency) => /^[A-Z]{3}$/.test(currency)),
        ),
    );

    return currencies.length > 0 ? currencies : country.currencies;
}

export function buildOperationContext(settings?: {
    operationCountry?: string | null;
    phoneDefaultCountry?: string | null;
    paymentDefaultCurrency?: string | null;
    paymentEnabledCurrencies?: unknown;
    businessTimeZone?: string | null;
    clinicName?: string | null;
    clinicSubtitle?: string | null;
    clinicAddress?: string | null;
    clinicLogoUrl?: string | null;
    clinicLogoScale?: number | null;
    doctorName?: string | null;
    doctorTitle?: string | null;
    doctorProfessionalLicense?: string | null;
    posTaxEnabled?: boolean | null;
    posTaxRate?: number | null;
    posTicketEnabled?: boolean | null;
    posTicketShowUnitPrice?: boolean | null;
    posTicketFullDescription?: boolean | null;
    posTicketHeader?: string | null;
    posTicketFooter?: string | null;
} | null) {
    const country = getOperationCountry(settings?.operationCountry);
    const phoneCountry = getOperationCountry(settings?.phoneDefaultCountry || country.code);
    const currencies = normalizeCurrencyList(settings?.paymentEnabledCurrencies, country.code);
    const defaultCurrency = currencies.includes(String(settings?.paymentDefaultCurrency || "").toUpperCase())
        ? String(settings?.paymentDefaultCurrency).toUpperCase()
        : country.defaultCurrency;

    return {
        countryCode: country.code,
        countryName: country.name,
        locale: country.locale,
        timeZone: settings?.businessTimeZone || country.timeZone,
        phoneDefaultCountry: phoneCountry.code,
        callingCode: phoneCountry.callingCode,
        currencies,
        defaultCurrency: currencies.includes(defaultCurrency) ? defaultCurrency : currencies[0],
        clinicName: settings?.clinicName || "Zen CRM Oftalmo",
        clinicSubtitle: settings?.clinicSubtitle || "Clinica oftalmologica",
        clinicAddress: settings?.clinicAddress || "Direccion de la clinica",
        clinicLogoUrl: settings?.clinicLogoUrl || "",
        clinicLogoScale: Number.isFinite(Number(settings?.clinicLogoScale)) ? Number(settings?.clinicLogoScale) : 100,
        doctorName: settings?.doctorName || "Joel Venegas",
        doctorTitle: settings?.doctorTitle || "Medico Oftalmologo",
        doctorProfessionalLicense: settings?.doctorProfessionalLicense || "",
        posTaxEnabled: settings?.posTaxEnabled === true,
        posTaxRate: Number.isFinite(Number(settings?.posTaxRate)) ? Number(settings?.posTaxRate) : 16,
        posTicketEnabled: settings?.posTicketEnabled !== false,
        posTicketShowUnitPrice: settings?.posTicketShowUnitPrice !== false,
        posTicketFullDescription: settings?.posTicketFullDescription === true,
        posTicketHeader: settings?.posTicketHeader || "Zen CRM Oftalmo\nClinica oftalmologica\nDireccion de la clinica",
        posTicketFooter: settings?.posTicketFooter || "Gracias por su compra\nRegrese pronto",
        countries: OPERATION_COUNTRIES,
    };
}

export function normalizePhoneDigits(value?: string | null) {
    return String(value || "").replace(/\D/g, "");
}

export function parsePhoneByCountry(value?: string | null, defaultCountryCode?: string | null) {
    const digits = normalizePhoneDigits(value);
    const defaultCountry = getOperationCountry(defaultCountryCode);
    const matched = COUNTRY_BY_CALLING_CODE.find((country) => digits.startsWith(country.callingCode.replace(/\D/g, "")));

    if (!digits) {
        return { country: defaultCountry, nationalNumber: "", fullNumber: "" };
    }

    if (!matched) {
        return { country: defaultCountry, nationalNumber: digits, fullNumber: `${defaultCountry.callingCode.replace(/\D/g, "")}${digits}` };
    }

    const prefix = matched.callingCode.replace(/\D/g, "");
    return {
        country: matched,
        nationalNumber: digits.slice(prefix.length),
        fullNumber: digits,
    };
}

export function composePhoneNumber(countryCode: string | null | undefined, localNumber: string) {
    const country = getOperationCountry(countryCode);
    const localDigits = normalizePhoneDigits(localNumber);
    if (!localDigits) return "";
    const prefix = country.callingCode.replace(/\D/g, "");
    return localDigits.startsWith(prefix) ? localDigits : `${prefix}${localDigits}`;
}

export function formatPhoneForDisplay(value?: string | null, defaultCountryCode?: string | null) {
    const digits = normalizePhoneDigits(value);
    if (!digits) return "";

    const parsed = parsePhoneByCountry(digits, defaultCountryCode);
    const national = parsed.nationalNumber || digits;
    const grouped = national.length <= 4
        ? national
        : national.length <= 7
            ? `${national.slice(0, 3)} ${national.slice(3)}`
            : `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;

    return `${parsed.country.callingCode} ${grouped}`.trim();
}

export function normalizePhoneForOperation(value?: string | null, defaultCountryCode?: string | null) {
    return parsePhoneByCountry(value, defaultCountryCode).fullNumber;
}

export function buildOperationPhoneExample(defaultCountryCode?: string | null) {
    const country = getOperationCountry(defaultCountryCode);
    const samples: Partial<Record<OperationCountryCode, string>> = {
        MX: "4771234567",
        AR: "91123456789",
        US: "2125550187",
        CL: "912345678",
        CO: "3001234567",
        PE: "912345678",
        ES: "612345678",
        BR: "11912345678",
    };
    return `${country.callingCode}${samples[country.code] || "123456789"}`;
}
