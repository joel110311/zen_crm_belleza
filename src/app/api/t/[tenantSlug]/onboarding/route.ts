import {
  BUSINESS_DAY_KEYS,
  BUSINESS_DAY_LABELS,
  buildUniformBusinessWeeklySchedule,
  normalizeBusinessHours,
  timeToMinutes,
  type BusinessDayKey,
  type BusinessWeeklySchedule,
} from "@/lib/calendar/business-hours";
import {
  EMPTY_BUSINESS_POLICIES,
  normalizeBusinessPolicies,
} from "@/lib/ai/business-policies";
import {
  getOperationCountry,
  normalizeOperationCountryCode,
  OPERATION_COUNTRIES,
} from "@/lib/operation-context";
import {
  readTenantJson,
  runTenantMutation,
  tenantData,
  withTenantApi,
} from "@/lib/tenant-api";
import {
  TenantServiceError,
  type TenantServiceContext,
} from "@/lib/tenant-services/context";
import { asRecord } from "@/lib/tenant-services/validation";
import { getTenantSystemSettingsOrDefaults } from "@/lib/tenant-system-settings";

export const runtime = "nodejs";

export const CORE_ONBOARDING_STEPS = [
  "business",
  "hours",
  "service",
  "professional",
  "policies",
  "portal",
] as const;
export const OPTIONAL_ONBOARDING_STEPS = ["team", "channels"] as const;
export const ONBOARDING_STEPS = [
  ...CORE_ONBOARDING_STEPS,
  ...OPTIONAL_ONBOARDING_STEPS,
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const NEXT_STEP: Record<OnboardingStep, number> = {
  business: 2,
  hours: 3,
  service: 4,
  professional: 5,
  policies: 6,
  portal: 7,
  team: 8,
  channels: 9,
};

class OnboardingRequestError extends TenantServiceError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "OnboardingRequestError";
  }
}

function requiredText(
  value: unknown,
  fieldName: string,
  maxLength = 160,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new OnboardingRequestError(`Completa ${fieldName}.`);
  if (text.length > maxLength)
    throw new OnboardingRequestError(
      `${fieldName} no puede exceder ${maxLength} caracteres.`,
    );
  return text;
}

function optionalText(
  value: unknown,
  fieldName: string,
  maxLength = 300,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maxLength)
    throw new OnboardingRequestError(
      `${fieldName} no puede exceder ${maxLength} caracteres.`,
    );
  return text || null;
}

function validTime(value: unknown, fieldName: string): string {
  const text = requiredText(value, fieldName, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))
    throw new OnboardingRequestError(`${fieldName} debe tener formato HH:mm.`);
  return text;
}

function validTimeZone(value: unknown): string {
  const timeZone = requiredText(value, "la zona horaria", 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new OnboardingRequestError("La zona horaria no es válida.");
  }
  return timeZone;
}

function validCountry(value: unknown) {
  const rawCode = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!OPERATION_COUNTRIES.some((country) => country.code === rawCode))
    throw new OnboardingRequestError("Selecciona un país compatible.");
  return normalizeOperationCountryCode(rawCode);
}

function validPrice(value: unknown): number {
  const price = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000)
    throw new OnboardingRequestError(
      "El precio debe ser un número entre 0 y 1,000,000.",
    );
  return Math.round(price * 100) / 100;
}

function validDuration(value: unknown): number {
  const duration = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(duration) || duration < 5 || duration > 720)
    throw new OnboardingRequestError(
      "La duración debe ser un número entero entre 5 y 720 minutos.",
    );
  return duration;
}

function enabledBusinessDays(value: unknown): BusinessDayKey[] {
  if (!Array.isArray(value))
    throw new OnboardingRequestError("Selecciona al menos un día de atención.");
  const days = Array.from(
    new Set(
      value.filter(
        (day): day is BusinessDayKey =>
          typeof day === "string" &&
          (BUSINESS_DAY_KEYS as readonly string[]).includes(day),
      ),
    ),
  );
  if (days.length === 0)
    throw new OnboardingRequestError("Selecciona al menos un día de atención.");
  return days;
}

function validWeeklySchedule(value: unknown): BusinessWeeklySchedule {
  const input = asRecord(value);
  const schedule = {} as BusinessWeeklySchedule;
  let enabledCount = 0;

  for (const day of BUSINESS_DAY_KEYS) {
    const dayInput = asRecord(input[day]);
    const enabled = dayInput.enabled === true;
    const start = validTime(dayInput.start, `la apertura del ${BUSINESS_DAY_LABELS[day].toLowerCase()}`);
    const end = validTime(dayInput.end, `el cierre del ${BUSINESS_DAY_LABELS[day].toLowerCase()}`);
    if (enabled && timeToMinutes(end) <= timeToMinutes(start)) {
      throw new OnboardingRequestError(
        `El cierre del ${BUSINESS_DAY_LABELS[day].toLowerCase()} debe ser posterior a su apertura.`,
      );
    }
    if (enabled) enabledCount += 1;
    schedule[day] = { enabled, start, end };
  }

  if (enabledCount === 0) {
    throw new OnboardingRequestError("Selecciona al menos un día de atención.");
  }
  return schedule;
}

function cleanVisibleServiceIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" && /^[a-zA-Z0-9_-]{8,200}$/.test(id),
      ),
    ),
  ].slice(0, 100);
}

function validColor(value: unknown) {
  const color = requiredText(value, "el color principal", 7);
  if (!/^#[0-9A-Fa-f]{6}$/.test(color))
    throw new OnboardingRequestError(
      "El color principal debe ser hexadecimal, por ejemplo #2563EB.",
    );
  return color.toUpperCase();
}

function validStep(value: unknown): OnboardingStep {
  if (
    typeof value === "string" &&
    (ONBOARDING_STEPS as readonly string[]).includes(value)
  )
    return value as OnboardingStep;
  throw new OnboardingRequestError("La etapa de configuración no es válida.");
}

export function serializeOnboardingState(
  state: {
    version: number;
    currentStep: number;
    initialServiceId: string | null;
    initialSpecialistId: string | null;
    completedSteps: string[];
    skippedSteps: string[];
    channelPreference: string | null;
    completedAt: Date | null;
    publishedAt: Date | null;
  } | null,
) {
  return {
    version: state?.version || 2,
    currentStep: state?.currentStep || 1,
    initialServiceId: state?.initialServiceId || null,
    initialSpecialistId: state?.initialSpecialistId || null,
    completedSteps: state?.completedSteps || [],
    skippedSteps: state?.skippedSteps || [],
    channelPreference: state?.channelPreference || null,
    completedAt: state?.completedAt?.toISOString() || null,
    publishedAt: state?.publishedAt?.toISOString() || null,
  };
}

function addProgress(
  current: {
    completedSteps: string[];
    skippedSteps: string[];
    currentStep: number;
  } | null,
  step: OnboardingStep,
  skipped = false,
) {
  const completedSteps = new Set(current?.completedSteps || []);
  const skippedSteps = new Set(current?.skippedSteps || []);
  if (skipped) {
    completedSteps.delete(step);
    skippedSteps.add(step);
  } else {
    skippedSteps.delete(step);
    completedSteps.add(step);
  }
  return {
    version: 2,
    currentStep: Math.max(current?.currentStep || 1, NEXT_STEP[step]),
    completedSteps: [...completedSteps].sort(),
    skippedSteps: [...skippedSteps].sort(),
  };
}

type OnboardingStateDelegate = Pick<
  TenantServiceContext["db"],
  "tenantOnboardingState"
>;

async function stateAfterStep(
  tx: OnboardingStateDelegate,
  step: OnboardingStep,
  extra: Record<string, unknown> = {},
  skipped = false,
) {
  const current = await tx.tenantOnboardingState.findUnique({
    where: { id: "default" },
  });
  const progress = addProgress(current, step, skipped);
  return tx.tenantOnboardingState.upsert({
    where: { id: "default" },
    create: { id: "default", ...progress, ...extra },
    update: { ...progress, ...extra },
  });
}

function readinessFor(state: ReturnType<typeof serializeOnboardingState>) {
  const complete = new Set(state.completedSteps);
  const skipped = new Set(state.skippedSteps);
  const required = CORE_ONBOARDING_STEPS.map((key) => ({
    key,
    complete: complete.has(key),
  }));
  const optional = OPTIONAL_ONBOARDING_STEPS.map((key) => ({
    key,
    complete: complete.has(key),
    skipped: skipped.has(key),
  }));
  return {
    required,
    optional,
    coreComplete: required.every((item) => item.complete),
    published: Boolean(state.publishedAt),
  };
}

export async function getOnboardingPayload(tenant: TenantServiceContext) {
  const [settings, state, services] = await Promise.all([
    getTenantSystemSettingsOrDefaults(tenant.db),
    tenant.db.tenantOnboardingState.findUnique({ where: { id: "default" } }),
    tenant.db.service.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const serializedState = serializeOnboardingState(state);
  return {
    settings: {
      clinicName: settings.clinicName,
      clinicSubtitle: settings.clinicSubtitle,
      clinicAddress: settings.clinicAddress,
      operationCountry: settings.operationCountry,
      businessTimeZone: settings.businessTimeZone,
      businessHoursStart: settings.businessHoursStart,
      businessHoursEnd: settings.businessHoursEnd,
      businessWeeklySchedule: normalizeBusinessHours(settings).weeklySchedule,
      businessPolicies: normalizeBusinessPolicies(settings.businessPolicies),
      portal: {
        enabled: settings.portalEnabled,
        clinicName: settings.portalClinicName || settings.clinicName,
        intro: settings.portalIntro,
        primaryColor: settings.portalPrimaryColor,
        paymentInstructions: settings.portalPaymentInstructions,
        visibleServiceIds: Array.isArray(settings.portalVisibleServiceIds)
          ? settings.portalVisibleServiceIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
      },
    },
    services,
    state: serializedState,
    readiness: readinessFor(serializedState),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await params;
  return withTenantApi(
    request,
    tenantSlug,
    { permission: "services.write" },
    async (tenant) =>
      tenantData(await getOnboardingPayload(tenant), tenant.requestId),
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await params;
  return withTenantApi(
    request,
    tenantSlug,
    { operation: "write", permission: "services.write" },
    async (tenant) => {
      const body = asRecord(await readTenantJson(request));
      const step = validStep(body.action);
      return runTenantMutation(tenant, request, body, async () => ({
        state: serializeOnboardingState(
          await updateOnboardingStep(tenant, step, body),
        ),
      }));
    },
  );
}

/** Shared implementation for the root legacy-compatible endpoint and the named v1 step endpoint. */
export async function updateOnboardingStep(
  tenant: TenantServiceContext,
  step: OnboardingStep,
  body: Record<string, unknown>,
) {
  if (step === "business") {
    const clinicName = requiredText(body.clinicName, "el nombre del negocio");
    const clinicSubtitle = optionalText(
      body.clinicSubtitle,
      "la descripción",
      160,
    );
    const clinicAddress = optionalText(body.clinicAddress, "la dirección", 300);
    const operationCountry = validCountry(body.operationCountry);
    const businessTimeZone = validTimeZone(body.businessTimeZone);
    const country = getOperationCountry(operationCountry);
    return tenant.db.$transaction(async (tx) => {
      await tx.systemSettings.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          clinicName,
          clinicSubtitle,
          clinicAddress,
          brandName: clinicName,
          portalClinicName: clinicName,
          portalSlug: tenant.slug,
          operationCountry,
          phoneDefaultCountry: operationCountry,
          businessTimeZone,
          paymentDefaultCurrency: country.defaultCurrency,
          paymentEnabledCurrencies: country.currencies,
        },
        update: {
          clinicName,
          clinicSubtitle,
          clinicAddress,
          brandName: clinicName,
          portalClinicName: clinicName,
          portalSlug: tenant.slug,
          operationCountry,
          phoneDefaultCountry: operationCountry,
          businessTimeZone,
          paymentDefaultCurrency: country.defaultCurrency,
          paymentEnabledCurrencies: country.currencies,
        },
      });
      return stateAfterStep(tx, step);
    });
  }

  if (step === "hours") {
    let weeklySchedule: BusinessWeeklySchedule;
    if (body.weeklySchedule && typeof body.weeklySchedule === "object") {
      weeklySchedule = validWeeklySchedule(body.weeklySchedule);
    } else {
      // Backward-compatible input for a browser that still has the previous wizard open.
      const start = validTime(body.start, "la hora de inicio");
      const end = validTime(body.end, "la hora de cierre");
      if (timeToMinutes(end) <= timeToMinutes(start))
        throw new OnboardingRequestError(
          "La hora de cierre debe ser posterior a la hora de inicio.",
        );
      const days = enabledBusinessDays(body.enabledDays);
      weeklySchedule = buildUniformBusinessWeeklySchedule(start, end, false);
      for (const day of days) weeklySchedule[day].enabled = true;
    }
    const summary = normalizeBusinessHours({ businessWeeklySchedule: weeklySchedule });
    return tenant.db.$transaction(async (tx) => {
      await tx.systemSettings.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          businessHoursStart: summary.start,
          businessHoursEnd: summary.end,
          businessWeeklySchedule: weeklySchedule,
        },
        update: {
          businessHoursStart: summary.start,
          businessHoursEnd: summary.end,
          businessWeeklySchedule: weeklySchedule,
        },
      });
      return stateAfterStep(tx, step);
    });
  }

  if (step === "service") {
    const name = requiredText(body.name, "el nombre del servicio");
    const price = validPrice(body.price);
    const durationMinutes = validDuration(body.durationMinutes);
    const description = optionalText(body.description, "la descripción", 500);
    return tenant.db.$transaction(async (tx) => {
      const current = await tx.tenantOnboardingState.findUnique({
        where: { id: "default" },
      });
      const category = await tx.serviceCategory.upsert({
        where: { name: "Servicios iniciales" },
        create: {
          name: "Servicios iniciales",
          description: "Servicios creados durante la configuración inicial.",
          color: "#B7923A",
        },
        update: {},
      });
      const currentService = current?.initialServiceId
        ? await tx.service.findUnique({
            where: { id: current.initialServiceId },
          })
        : null;
      const settings = await tx.systemSettings.findFirst({
        select: { operationCountry: true },
      });
      const data = {
        name,
        description,
        categoryId: category.id,
        price,
        durationMinutes,
        currency: getOperationCountry(settings?.operationCountry)
          .defaultCurrency,
        isActive: true,
      };
      const service = currentService
        ? await tx.service.update({ where: { id: currentService.id }, data })
        : await tx.service.create({ data });
      return stateAfterStep(tx, step, { initialServiceId: service.id });
    });
  }

  if (step === "professional") {
    const name = requiredText(body.name, "el nombre del profesional");
    const specialty = optionalText(body.specialty, "la especialidad", 160);
    const email = optionalText(body.email, "el correo", 160);
    if (email && !/^\S+@\S+\.\S+$/.test(email))
      throw new OnboardingRequestError(
        "El correo del profesional no es válido.",
      );
    const linkActor = body.linkActor !== false;
    return tenant.db.$transaction(async (tx) => {
      const current = await tx.tenantOnboardingState.findUnique({
        where: { id: "default" },
      });
      const currentSpecialist = current?.initialSpecialistId
        ? await tx.specialist.findUnique({
            where: { id: current.initialSpecialistId },
          })
        : null;
      const data = {
        name,
        displayName: name,
        specialty,
        email,
        userId: linkActor ? tenant.actor.id : null,
        isActive: true,
      };
      const specialist = currentSpecialist
        ? await tx.specialist.update({
            where: { id: currentSpecialist.id },
            data,
          })
        : await tx.specialist.create({ data });
      if (current?.initialServiceId)
        await tx.specialistService.upsert({
          where: {
            specialistId_serviceId: {
              specialistId: specialist.id,
              serviceId: current.initialServiceId,
            },
          },
          create: {
            specialistId: specialist.id,
            serviceId: current.initialServiceId,
          },
          update: {},
        });
      return stateAfterStep(tx, step, { initialSpecialistId: specialist.id });
    });
  }

  if (step === "policies") {
    const input = asRecord(body.policies);
    const policies = normalizeBusinessPolicies({
      ...EMPTY_BUSINESS_POLICIES,
      ...input,
      identity: {
        ...asRecord(EMPTY_BUSINESS_POLICIES.identity),
        ...asRecord(input.identity),
      },
    });
    return tenant.db.$transaction(async (tx) => {
      await tx.systemSettings.upsert({
        where: { id: "default" },
        create: { id: "default", businessPolicies: policies },
        update: { businessPolicies: policies },
      });
      return stateAfterStep(tx, step);
    });
  }

  if (step === "portal") {
    const clinicName = requiredText(
      body.clinicName,
      "el nombre que verá el cliente",
    );
    const intro =
      optionalText(body.intro, "la introducción", 500) ||
      "Aparta el horario para tu próximo servicio.";
    const primaryColor = validColor(body.primaryColor);
    const paymentInstructions = optionalText(
      body.paymentInstructions,
      "las indicaciones de pago",
      500,
    );
    const visibleServiceIds = cleanVisibleServiceIds(body.visibleServiceIds);
    return tenant.db.$transaction(async (tx) => {
      if (visibleServiceIds.length > 0) {
        const count = await tx.service.count({
          where: { id: { in: visibleServiceIds }, isActive: true },
        });
        if (count !== visibleServiceIds.length)
          throw new OnboardingRequestError(
            "Uno de los servicios seleccionados ya no está disponible.",
          );
      }
      await tx.systemSettings.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          portalEnabled: true,
          portalSlug: tenant.slug,
          portalClinicName: clinicName,
          portalIntro: intro,
          portalPrimaryColor: primaryColor,
          portalPaymentInstructions: paymentInstructions,
          portalVisibleServiceIds: visibleServiceIds,
        },
        update: {
          portalEnabled: true,
          portalSlug: tenant.slug,
          portalClinicName: clinicName,
          portalIntro: intro,
          portalPrimaryColor: primaryColor,
          portalPaymentInstructions: paymentInstructions,
          portalVisibleServiceIds: visibleServiceIds,
        },
      });
      return stateAfterStep(tx, step);
    });
  }

  if (step === "team") {
    if (body.mode !== "skip" && body.mode !== "complete")
      throw new OnboardingRequestError(
        "La acción de equipo no es válida.",
      );
    return tenant.db.$transaction((tx) => stateAfterStep(tx, step, {}, body.mode === "skip"));
  }

  const provider = typeof body.provider === "string" ? body.provider : "later";
  if (!["META_CLOUD", "WUZAPI", "later"].includes(provider))
    throw new OnboardingRequestError("Selecciona un canal compatible.");
  return tenant.db.$transaction((tx) =>
    stateAfterStep(
      tx,
      step,
      { channelPreference: provider === "later" ? null : provider },
      true,
    ),
  );
}

export async function completeTenantOnboarding(
  tenant: TenantServiceContext,
  publish: boolean,
) {
  return tenant.db.$transaction(async (tx) => {
    const state = await tx.tenantOnboardingState.findUnique({
      where: { id: "default" },
    });
    const serialized = serializeOnboardingState(state);
    const readiness = readinessFor(serialized);
    if (!readiness.coreComplete)
      throw new OnboardingRequestError(
        "Completa negocio, horario, servicio, profesional, políticas y portal antes de publicar.",
      );
    const now = new Date();
    return tx.tenantOnboardingState.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        version: 2,
        currentStep: 9,
        completedSteps: [...CORE_ONBOARDING_STEPS],
        completedAt: now,
        publishedAt: publish ? now : null,
      },
      update: {
        currentStep: 9,
        completedAt: state?.completedAt || now,
        publishedAt: publish ? state?.publishedAt || now : state?.publishedAt,
      },
    });
  });
}
