"use client";

import { type ReactNode, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileCheck2,
  Loader2,
  Palette,
  ShieldCheck,
  Store,
  UsersRound,
  UserRound,
  WandSparkles,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OPERATION_COUNTRIES } from "@/lib/operation-context";
import {
  BUSINESS_DAY_KEYS,
  BUSINESS_DAY_LABELS,
  type BusinessDayKey,
  type BusinessWeeklySchedule,
} from "@/lib/calendar/business-hours";
import type { BusinessPolicies } from "@/lib/ai/business-policies";
import { TenantChannelSetup } from "@/components/tenant/tenant-channel-setup";

type InitialData = {
  business: {
    clinicName: string;
    clinicSubtitle: string;
    clinicAddress: string;
    operationCountry: string;
    businessTimeZone: string;
    defaultTimeZone: string;
  };
  hours: { weeklySchedule: BusinessWeeklySchedule };
  service: {
    name: string;
    description: string;
    price: number;
    durationMinutes: number;
  };
  specialist: {
    name: string;
    specialty: string;
    email: string;
    linkActor: boolean;
  };
  policies: BusinessPolicies;
  portal: {
    clinicName: string;
    intro: string;
    primaryColor: string;
    paymentInstructions: string;
    visibleServiceIds: string[];
  };
  services: { id: string; name: string }[];
  state: {
    currentStep: number;
    completedSteps: string[];
    skippedSteps: string[];
    completedAt: string | null;
    publishedAt: string | null;
  };
};

type WizardProps = {
  tenantSlug: string;
  ownerName: string;
  initial: InitialData;
  channelsEnabled: boolean;
};
type StepKey =
  | "business"
  | "hours"
  | "service"
  | "professional"
  | "policies"
  | "portal"
  | "team"
  | "channels"
  | "review";

const STEPS: {
  key: StepKey;
  label: string;
  icon: typeof Store;
  optional?: boolean;
}[] = [
  { key: "business", label: "Negocio", icon: Store },
  { key: "hours", label: "Horarios", icon: Clock3 },
  { key: "service", label: "Servicio", icon: WandSparkles },
  { key: "professional", label: "Profesional", icon: UserRound },
  { key: "policies", label: "Políticas", icon: ShieldCheck },
  { key: "portal", label: "Portal", icon: Palette },
  { key: "team", label: "Equipo", icon: UsersRound, optional: true },
  { key: "channels", label: "Canales", icon: Waypoints, optional: true },
  { key: "review", label: "Publicar", icon: FileCheck2 },
];
const CORE_STEPS: StepKey[] = [
  "business",
  "hours",
  "service",
  "professional",
  "policies",
  "portal",
];

function normalizeCompleted(initialState: InitialData["state"]) {
  if (initialState.completedSteps.length)
    return new Set(initialState.completedSteps);
  const legacy = ["business", "hours", "service", "professional"];
  return new Set(
    legacy.slice(0, Math.max(0, Math.min(4, initialState.currentStep - 1))),
  );
}

function firstIncomplete(completed: Set<string>, skipped: Set<string>) {
  const index = STEPS.findIndex(
    (step) =>
      step.key !== "review" &&
      !completed.has(step.key) &&
      !skipped.has(step.key),
  );
  return index === -1 ? STEPS.length - 1 : index;
}

export function TenantOnboardingWizard({
  tenantSlug,
  ownerName,
  initial,
  channelsEnabled,
}: WizardProps) {
  const [completedSteps, setCompletedSteps] = useState(() =>
    normalizeCompleted(initial.state),
  );
  const [skippedSteps, setSkippedSteps] = useState(
    () => new Set(initial.state.skippedSteps),
  );
  const [stepIndex, setStepIndex] = useState(() =>
    initial.state.publishedAt
      ? STEPS.length - 1
      : firstIncomplete(
          normalizeCompleted(initial.state),
          new Set(initial.state.skippedSteps),
        ),
  );
  const [maxIndex, setMaxIndex] = useState(() =>
    Math.max(
      0,
      firstIncomplete(
        normalizeCompleted(initial.state),
        new Set(initial.state.skippedSteps),
      ),
    ),
  );
  const [published, setPublished] = useState(
    Boolean(initial.state.publishedAt),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(initial.business);
  const [hours, setHours] = useState(initial.hours);
  const [service, setService] = useState({
    ...initial.service,
    price: String(initial.service.price),
  });
  const [specialist, setSpecialist] = useState(initial.specialist);
  const [policies, setPolicies] = useState(initial.policies);
  const [catalogServices, setCatalogServices] = useState(initial.services);
  const [portal, setPortal] = useState({
    ...initial.portal,
    visibleServiceIds: initial.portal.visibleServiceIds,
  });
  const [channelProvider, setChannelProvider] = useState<
    "META_CLOUD" | "WUZAPI" | "later"
  >("later");
  const timeZones = useMemo(
    () =>
      Array.from(
        new Set([
          initial.business.defaultTimeZone,
          ...OPERATION_COUNTRIES.map((country) => country.timeZone),
        ]),
      ).sort(),
    [initial.business.defaultTimeZone],
  );
  const current = STEPS[stepIndex];
  const coreComplete = CORE_STEPS.every((key) => completedSteps.has(key));

  async function saveStep(
    step: Exclude<StepKey, "review">,
    payload: Record<string, unknown>,
  ) {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(
        `/api/t/${encodeURIComponent(tenantSlug)}/v1/onboarding/${step}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as {
        data?: {
          state?: {
            completedSteps?: string[];
            skippedSteps?: string[];
            initialServiceId?: string | null;
          };
        };
        error?: { message?: string };
      };
      if (!response.ok || !result.data?.state)
        throw new Error(
          result.error?.message || "No fue posible guardar la configuración.",
        );
      setCompletedSteps(new Set(result.data.state.completedSteps || []));
      setSkippedSteps(new Set(result.data.state.skippedSteps || []));
      if (step === "service" && result.data.state.initialServiceId) {
        setCatalogServices((currentServices) =>
          currentServices.some(
            (item) => item.id === result.data?.state?.initialServiceId,
          )
            ? currentServices
            : [
                ...currentServices,
                {
                  id: result.data?.state?.initialServiceId || "",
                  name: service.name.trim() || "Servicio inicial",
                },
              ],
        );
      }
      const next = Math.min(STEPS.length - 1, stepIndex + 1);
      setMaxIndex((currentMax) => Math.max(currentMax, next));
      setStepIndex(next);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Ocurrió un error inesperado.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(
        `/api/t/${encodeURIComponent(tenantSlug)}/v1/onboarding/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ publish: true }),
        },
      );
      const result = (await response.json()) as {
        data?: { state?: { publishedAt?: string | null } };
        error?: { message?: string };
      };
      if (!response.ok || !result.data?.state?.publishedAt)
        throw new Error(
          result.error?.message || "No fue posible publicar la configuración.",
        );
      setPublished(true);
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Ocurrió un error inesperado.",
      );
    } finally {
      setSaving(false);
    }
  }

  function selectCountry(operationCountry: string) {
    const country = OPERATION_COUNTRIES.find(
      (item) => item.code === operationCountry,
    );
    setBusiness((value) => ({
      ...value,
      operationCountry,
      businessTimeZone: country?.timeZone || value.businessTimeZone,
    }));
  }
  function updateBusinessDay(
    day: BusinessDayKey,
    patch: Partial<BusinessWeeklySchedule[BusinessDayKey]>,
  ) {
    setHours((value) => ({
      ...value,
      weeklySchedule: {
        ...value.weeklySchedule,
        [day]: { ...value.weeklySchedule[day], ...patch },
      },
    }));
  }
  function serviceIsVisible(id: string) {
    return (
      portal.visibleServiceIds.length === 0 ||
      portal.visibleServiceIds.includes(id)
    );
  }
  function toggleService(id: string) {
    setPortal((value) => {
      const visible =
        value.visibleServiceIds.length === 0
          ? catalogServices.map((item) => item.id)
          : value.visibleServiceIds;
      return {
        ...value,
        visibleServiceIds: visible.includes(id)
          ? visible.filter((item) => item !== id)
          : [...visible, id],
      };
    });
  }
  function stepBack() {
    setStepIndex((value) => Math.max(0, value - 1));
  }

  if (published)
    return (
      <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <CheckCircle2 className="size-8 text-emerald-600" />
        <p className="mt-5 text-sm font-semibold text-primary">
          Centro de preparación publicado
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Tu agenda y portal ya están listos
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Las políticas, el catálogo inicial y la presentación del portal
          quedaron guardados. Puedes completar el equipo y los canales desde
          Configuración cuando lo necesites.
        </p>
        <div className="mt-5 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <p className="font-medium">Tu primer servicio ya está publicado</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Te recomendamos agregar ahora el resto del catálogo, con sus precios, duraciones, imágenes y especialistas.
          </p>
        </div>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/t/${tenantSlug}/dashboard`}>Abrir panel</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setPublished(false);
              setStepIndex(0);
            }}
          >
            Actualizar configuración
          </Button>
          <Button asChild variant="outline">
            <Link href={`/t/${tenantSlug}/services`}>Agregar más servicios</Link>
          </Button>
        </div>
      </section>
    );

  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <div className="border-b px-5 py-6 sm:px-8">
        <p className="text-sm font-semibold text-primary">
          Centro de preparación
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Dejemos listo tu negocio
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Los primeros seis pasos publican una agenda y portal utilizables.
          Equipo y canales son opcionales y se pueden terminar sin detener el
          lanzamiento.
        </p>
        <ol
          className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
          aria-label="Progreso de configuración"
        >
          {STEPS.map(({ key, label, icon: Icon, optional }, index) => {
            const active = index === stepIndex;
            const available = index <= maxIndex;
            const done = completedSteps.has(key) || skippedSteps.has(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={!available || saving}
                  onClick={() => setStepIndex(index)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed ${active ? "border-primary bg-primary/5 text-primary" : available ? "hover:border-primary/50" : "opacity-45"}`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {done ? <CheckCircle2 className="size-3.5" /> : index + 1}
                  </span>
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {label}
                    {optional ? " · opc." : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="px-5 py-6 sm:px-8 sm:py-8">
        {error ? (
          <p
            role="alert"
            className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {current.key === "business" ? (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStep("business", business);
            }}
          >
            <StepHeading
              title="Identidad del negocio"
              description="Así aparecerá tu negocio dentro del CRM y en el portal de reservas."
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Nombre del negocio">
                <Input
                  required
                  maxLength={160}
                  value={business.clinicName}
                  onChange={(event) =>
                    setBusiness((value) => ({
                      ...value,
                      clinicName: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Descripción corta">
                <Input
                  maxLength={160}
                  value={business.clinicSubtitle}
                  onChange={(event) =>
                    setBusiness((value) => ({
                      ...value,
                      clinicSubtitle: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="País de operación">
                <select
                  required
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={business.operationCountry}
                  onChange={(event) => selectCountry(event.target.value)}
                >
                  {OPERATION_COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Zona horaria">
                <Input
                  required
                  list="tenant-time-zones"
                  value={business.businessTimeZone}
                  onChange={(event) =>
                    setBusiness((value) => ({
                      ...value,
                      businessTimeZone: event.target.value,
                    }))
                  }
                />
                <datalist id="tenant-time-zones">
                  {timeZones.map((timeZone) => (
                    <option key={timeZone} value={timeZone} />
                  ))}
                </datalist>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Dirección (opcional)">
                  <Input
                    maxLength={300}
                    value={business.clinicAddress}
                    onChange={(event) =>
                      setBusiness((value) => ({
                        ...value,
                        clinicAddress: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
            </div>
            <StepFooter saving={saving} label="Guardar y continuar" />
          </form>
        ) : null}
        {current.key === "hours" ? (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStep("hours", hours);
            }}
          >
            <StepHeading
              title="Horario de atención"
              description="El calendario sólo ofrecerá citas dentro de estos días y horarios."
            />
            <div className="space-y-3">
              {BUSINESS_DAY_KEYS.map((day) => {
                const schedule = hours.weeklySchedule[day];
                return (
                  <div key={day} className="grid gap-3 rounded-xl border bg-muted/15 p-4 sm:grid-cols-[150px_1fr] sm:items-center">
                    <label className="flex items-center gap-3 text-sm font-medium">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={schedule.enabled}
                        onChange={(event) => updateBusinessDay(day, { enabled: event.target.checked })}
                      />
                      {BUSINESS_DAY_LABELS[day]}
                    </label>
                    {schedule.enabled ? (
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <Input
                          required
                          aria-label={`Apertura ${BUSINESS_DAY_LABELS[day]}`}
                          type="time"
                          value={schedule.start}
                          onChange={(event) => updateBusinessDay(day, { start: event.target.value })}
                        />
                        <span className="text-sm text-muted-foreground">a</span>
                        <Input
                          required
                          aria-label={`Cierre ${BUSINESS_DAY_LABELS[day]}`}
                          type="time"
                          value={schedule.end}
                          onChange={(event) => updateBusinessDay(day, { end: event.target.value })}
                        />
                      </div>
                    ) : <span className="text-sm text-muted-foreground">Cerrado</span>}
                  </div>
                );
              })}
            </div>
            <StepFooter
              saving={saving}
              label="Guardar y continuar"
              onBack={stepBack}
            />
          </form>
        ) : null}
        {current.key === "service" ? (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStep("service", {
                ...service,
                price: Number(service.price),
                durationMinutes: Number(service.durationMinutes),
              });
            }}
          >
            <StepHeading
              title="Tu primer servicio"
              description="Después podrás ampliar tu catálogo con imágenes, requisitos y precios especiales."
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Nombre del servicio">
                <Input
                  required
                  maxLength={160}
                  value={service.name}
                  onChange={(event) =>
                    setService((value) => ({
                      ...value,
                      name: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Duración en minutos">
                <Input
                  required
                  type="number"
                  min="5"
                  max="720"
                  step="5"
                  value={service.durationMinutes}
                  onChange={(event) =>
                    setService((value) => ({
                      ...value,
                      durationMinutes: Number(event.target.value),
                    }))
                  }
                />
              </Field>
              <Field label="Precio">
                <Input
                  required
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  value={service.price}
                  onChange={(event) =>
                    setService((value) => ({
                      ...value,
                      price: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Descripción (opcional)">
                <Input
                  maxLength={500}
                  value={service.description}
                  onChange={(event) =>
                    setService((value) => ({
                      ...value,
                      description: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            <StepFooter
              saving={saving}
              label="Guardar y continuar"
              onBack={stepBack}
            />
          </form>
        ) : null}
        {current.key === "professional" ? (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStep("professional", specialist);
            }}
          >
            <StepHeading
              title="Primer profesional"
              description="Lo vincularemos con el servicio inicial para que la agenda pueda recibir citas."
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Nombre">
                <Input
                  required
                  maxLength={160}
                  value={specialist.name}
                  onChange={(event) =>
                    setSpecialist((value) => ({
                      ...value,
                      name: event.target.value,
                    }))
                  }
                  placeholder={ownerName}
                />
              </Field>
              <Field label="Especialidad (opcional)">
                <Input
                  maxLength={160}
                  value={specialist.specialty}
                  onChange={(event) =>
                    setSpecialist((value) => ({
                      ...value,
                      specialty: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Correo (opcional)">
                  <Input
                    type="email"
                    maxLength={160}
                    value={specialist.email}
                    onChange={(event) =>
                      setSpecialist((value) => ({
                        ...value,
                        email: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
            </div>
            <label className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
              <input
                className="mt-0.5 size-4"
                type="checkbox"
                checked={specialist.linkActor}
                onChange={(event) =>
                  setSpecialist((value) => ({
                    ...value,
                    linkActor: event.target.checked,
                  }))
                }
              />
              <span>
                <span className="font-medium">Yo soy este profesional</span>
                <span className="mt-1 block text-muted-foreground">
                  Vincula este perfil con tu cuenta para aplicar permisos y
                  agenda personal.
                </span>
              </span>
            </label>
            <StepFooter
              saving={saving}
              label="Guardar y continuar"
              onBack={stepBack}
            />
          </form>
        ) : null}
        {current.key === "policies" ? (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStep("policies", { policies });
            }}
          >
            <StepHeading
              title="Políticas de atención"
              description="Estas reglas se aplican al portal y al asistente. Puedes refinarlas después desde configuración."
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Aviso mínimo para cancelar (horas)">
                <Input
                  type="number"
                  min="0"
                  max="168"
                  value={policies.cancellation.minimumNoticeHours}
                  onChange={(event) =>
                    setPolicies((value) => ({
                      ...value,
                      cancellation: {
                        ...value.cancellation,
                        minimumNoticeHours: Number(event.target.value),
                      },
                    }))
                  }
                />
              </Field>
              <Field label="Tolerancia de llegada (minutos)">
                <Input
                  type="number"
                  min="0"
                  max="60"
                  value={
                    policies.cancellation.lateArrivalToleranceMinutes ?? ""
                  }
                  onChange={(event) =>
                    setPolicies((value) => ({
                      ...value,
                      cancellation: {
                        ...value.cancellation,
                        lateArrivalToleranceMinutes:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      },
                    }))
                  }
                  placeholder="Sin definir"
                />
              </Field>
              <Field label="Acompañantes">
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={policies.companions.policy}
                  onChange={(event) =>
                    setPolicies((value) => ({
                      ...value,
                      companions: {
                        policy: event.target
                          .value as BusinessPolicies["companions"]["policy"],
                      },
                    }))
                  }
                >
                  <option value="not_defined">Sin política definida</option>
                  <option value="allowed">Permitidos</option>
                  <option value="one_only">Máximo uno</option>
                  <option value="not_allowed">No permitidos</option>
                </select>
              </Field>
              <Field label="Consecuencia por aviso tardío">
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={policies.cancellation.lateChangeConsequence}
                  onChange={(event) =>
                    setPolicies((value) => ({
                      ...value,
                      cancellation: {
                        ...value.cancellation,
                        lateChangeConsequence: event.target
                          .value as BusinessPolicies["cancellation"]["lateChangeConsequence"],
                      },
                    }))
                  }
                >
                  <option value="none">Sin cargo</option>
                  <option value="may_charge">Puede aplicar cargo</option>
                  <option value="deposit_lost">Pierde anticipo</option>
                  <option value="human_review">Revisión humana</option>
                </select>
              </Field>
            </div>
            <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
              <input
                className="mt-0.5 size-4"
                type="checkbox"
                checked={policies.deposits.required}
                onChange={(event) =>
                  setPolicies((value) => ({
                    ...value,
                    deposits: {
                      ...value.deposits,
                      required: event.target.checked,
                    },
                  }))
                }
              />
              <span>
                <span className="font-medium">
                  Solicitar anticipo para reservar
                </span>
                <span className="mt-1 block text-muted-foreground">
                  Podrás definir el importe exacto y métodos de pago más
                  adelante.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
              <input
                className="mt-0.5 size-4"
                type="checkbox"
                checked={policies.humanEscalation.triggers.includes(
                  "explicit_request",
                )}
                onChange={(event) =>
                  setPolicies((value) => ({
                    ...value,
                    humanEscalation: {
                      triggers: (event.target.checked
                        ? [
                            ...new Set([
                              ...value.humanEscalation.triggers,
                              "explicit_request" as const,
                            ]),
                          ]
                        : value.humanEscalation.triggers.filter(
                            (trigger) => trigger !== "explicit_request",
                          )) as BusinessPolicies["humanEscalation"]["triggers"],
                    },
                  }))
                }
              />
              <span>
                <span className="font-medium">
                  Escalar cuando el cliente lo solicite
                </span>
                <span className="mt-1 block text-muted-foreground">
                  El asistente no improvisará una respuesta cuando pidan hablar
                  con una persona.
                </span>
              </span>
            </label>
            <StepFooter
              saving={saving}
              label="Guardar y continuar"
              onBack={stepBack}
            />
          </form>
        ) : null}
        {current.key === "portal" ? (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStep("portal", portal);
            }}
          >
            <StepHeading
              title="Portal de reservas"
              description="Define la presentación y los servicios que se mostrarán en tu portal de reservas."
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Nombre visible">
                <Input
                  required
                  maxLength={160}
                  value={portal.clinicName}
                  onChange={(event) =>
                    setPortal((value) => ({
                      ...value,
                      clinicName: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Color principal">
                <div className="flex items-center gap-3">
                  <Input
                    required
                    type="color"
                    value={portal.primaryColor}
                    onChange={(event) =>
                      setPortal((value) => ({
                        ...value,
                        primaryColor: event.target.value.toUpperCase(),
                      }))
                    }
                    className="h-10 w-16 p-1"
                  />
                  <Input
                    required
                    pattern="#[0-9A-Fa-f]{6}"
                    value={portal.primaryColor}
                    onChange={(event) =>
                      setPortal((value) => ({
                        ...value,
                        primaryColor: event.target.value,
                      }))
                    }
                  />
                </div>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Introducción">
                  <textarea
                    required
                    maxLength={500}
                    value={portal.intro}
                    onChange={(event) =>
                      setPortal((value) => ({
                        ...value,
                        intro: event.target.value,
                      }))
                    }
                    className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Indicaciones de pago (opcional)">
                  <Input
                    maxLength={500}
                    value={portal.paymentInstructions}
                    onChange={(event) =>
                      setPortal((value) => ({
                        ...value,
                        paymentInstructions: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">Servicios visibles</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Selecciona los que podrán reservarse desde el portal.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {catalogServices.map((serviceItem) => (
                  <label
                    key={serviceItem.id}
                    className={`cursor-pointer rounded-full border px-3 py-2 text-sm ${serviceIsVisible(serviceItem.id) ? "border-primary bg-primary/10 text-primary" : "bg-background"}`}
                  >
                    <input
                      className="sr-only"
                      type="checkbox"
                      checked={serviceIsVisible(serviceItem.id)}
                      onChange={() => toggleService(serviceItem.id)}
                    />
                    {serviceItem.name}
                  </label>
                ))}
              </div>
            </div>
            <div
              className="rounded-xl border p-4"
              style={{ borderColor: `${portal.primaryColor}66` }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: portal.primaryColor }}
              >
                {portal.clinicName || "Tu negocio"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {portal.intro || "Tu introducción aparecerá aquí."}
              </p>
            </div>
            <StepFooter
              saving={saving}
              label="Guardar portal y continuar"
              onBack={stepBack}
            />
          </form>
        ) : null}
        {current.key === "team" ? (
          <div className="space-y-6">
            <StepHeading
              title="Equipo"
              description="El equipo se administra desde Configuración. Ahí agregas cada profesional, su especialidad, disponibilidad y servicios."
            />
            <div className="rounded-2xl border bg-muted/30 p-5">
              <p className="font-medium">Configura a tu ritmo</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Puedes continuar con la publicación y agregar profesionales después. No se enviarán invitaciones ni correos automáticos.</p>
              <Button asChild className="mt-4" variant="outline"><Link href={`/t/${tenantSlug}/specialists`}>Abrir Especialistas</Link></Button>
            </div>
            <StepFooter
              saving={saving}
              label="Continuar sin configurar equipo"
              onBack={stepBack}
              onNext={() => void saveStep("team", { mode: "skip" })}
            />
          </div>
        ) : null}
        {current.key === "channels" ? (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void saveStep("channels", { provider: channelProvider });
            }}
          >
            <StepHeading
              title="Canales de mensajería"
              description="Meta Cloud API es la integración principal. WuzAPI queda como alternativa explícita. Conectar un canal es opcional y no bloquea la agenda."
            />
            <div className="space-y-3">
              {(
                [
                  [
                    "later",
                    "Configurar después",
                    "Publicar primero sin canal conectado.",
                  ],
                  [
                    "META_CLOUD",
                    "Meta Cloud API",
                    "Canal recomendado para WhatsApp Business.",
                  ],
                  [
                    "WUZAPI",
                    "WuzAPI",
                    "Alternativa si ya operas una instancia compatible.",
                  ],
                ] as const
              ).map(([value, label, description]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${channelProvider === value ? "border-primary bg-primary/5" : ""}`}
                >
                  <input
                    type="radio"
                    name="channel"
                    checked={channelProvider === value}
                    onChange={() => setChannelProvider(value)}
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <TenantChannelSetup
              tenantSlug={tenantSlug}
              enabled={channelsEnabled}
              onConfigured={(provider) => {
                setChannelProvider(provider);
                void saveStep("channels", { provider });
              }}
            />
            <StepFooter
              saving={saving}
              label="Guardar y revisar"
              onBack={stepBack}
            />
          </form>
        ) : null}
        {current.key === "review" ? (
          <div className="space-y-6">
            <StepHeading
              title="Revisión y publicación"
              description="Confirma que el núcleo operativo esté listo. Publicar no crea datos adicionales; sólo marca este espacio como preparado."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {CORE_STEPS.map((key) => (
                <div
                  key={key}
                  className={`flex items-center gap-3 rounded-xl border p-4 text-sm ${completedSteps.has(key) ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}`}
                >
                  {completedSteps.has(key) ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : (
                    <span className="size-5 rounded-full border border-destructive" />
                  )}
                  <span className="font-medium">
                    {STEPS.find((step) => step.key === key)?.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Opcionales</p>
              <p className="mt-1">
                Equipo:{" "}
                {skippedSteps.has("team")
                  ? "configurar después"
                  : completedSteps.has("team")
                    ? "listo"
                    : "pendiente"}
                . Canales:{" "}
                {skippedSteps.has("channels")
                  ? "configurar después"
                  : completedSteps.has("channels")
                    ? "listo"
                    : "pendiente"}
                .
              </p>
            </div>
            <StepFooter
              saving={saving}
              label="Publicar configuración"
              onBack={stepBack}
              onNext={() => void publish()}
              disabled={!coreComplete}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StepHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2 text-sm font-medium">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function StepFooter({
  saving,
  label,
  onBack,
  onNext,
  disabled = false,
}: {
  saving: boolean;
  label: string;
  onBack?: () => void;
  onNext?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
      <Button
        type="button"
        variant="outline"
        disabled={!onBack || saving}
        onClick={onBack}
      >
        <ChevronLeft className="mr-1 size-4" />
        Anterior
      </Button>
      {onNext ? (
        <Button type="button" disabled={saving || disabled} onClick={onNext}>
          {saving ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              {label}
              <CheckCircle2 className="ml-2 size-4" />
            </>
          )}
        </Button>
      ) : (
        <Button type="submit" disabled={saving || disabled}>
          {saving ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              {label}
              <ChevronRight className="ml-1 size-4" />
            </>
          )}
        </Button>
      )}
    </div>
  );
}
