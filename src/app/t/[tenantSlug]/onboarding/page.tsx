import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  DEFAULT_BUSINESS_TIME_ZONE,
  normalizeBusinessHours,
} from "@/lib/calendar/business-hours";
import { requireTenantRuntimeContext } from "@/lib/tenant-context";
import { getTenantSystemSettingsOrDefaults } from "@/lib/tenant-system-settings";
import { normalizeBusinessPolicies } from "@/lib/ai/business-policies";
import { TenantOnboardingWizard } from "./onboarding-wizard";
import { isMultitenantChannelsEnabled } from "@/lib/multitenant-features";

export const dynamic = "force-dynamic";

export default async function TenantOnboardingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await auth();
  const userId =
    typeof (session?.user as { id?: unknown } | undefined)?.id === "string"
      ? (session?.user as { id: string }).id
      : null;
  if (!userId) notFound();

  const tenant = await requireTenantRuntimeContext(userId, tenantSlug, "read");
  if (tenant.role !== "OWNER" && tenant.role !== "ADMIN") notFound();

  const [settings, state] = await Promise.all([
    getTenantSystemSettingsOrDefaults(tenant.db),
    tenant.db.tenantOnboardingState.findUnique({ where: { id: "default" } }),
  ]);
  const [service, specialist, services] = await Promise.all([
    state?.initialServiceId
      ? tenant.db.service.findUnique({
          where: { id: state.initialServiceId },
          select: {
            name: true,
            description: true,
            price: true,
            durationMinutes: true,
          },
        })
      : null,
    state?.initialSpecialistId
      ? tenant.db.specialist.findUnique({
          where: { id: state.initialSpecialistId },
          select: { name: true, specialty: true, email: true, userId: true },
        })
      : null,
    tenant.db.service.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const hours = normalizeBusinessHours(settings);
  const isSeedDefault = settings.clinicName === "Zen CRM Belleza";

  return (
    <main className="min-h-screen bg-muted/30 px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <TenantOnboardingWizard
          tenantSlug={tenant.slug}
          ownerName={tenant.actor.name || ""}
          channelsEnabled={isMultitenantChannelsEnabled()}
          initial={{
            business: {
              clinicName: isSeedDefault
                ? tenant.displayName
                : settings.clinicName,
              clinicSubtitle:
                settings.clinicSubtitle === "Servicios de belleza"
                  ? ""
                  : settings.clinicSubtitle,
              clinicAddress:
                settings.clinicAddress === "Direccion del negocio"
                  ? ""
                  : settings.clinicAddress,
              operationCountry: settings.operationCountry,
              businessTimeZone:
                isSeedDefault &&
                settings.businessTimeZone === DEFAULT_BUSINESS_TIME_ZONE
                  ? tenant.timeZone
                  : settings.businessTimeZone || tenant.timeZone,
              defaultTimeZone: tenant.timeZone,
            },
            hours: {
              weeklySchedule: hours.weeklySchedule,
            },
            service: {
              name: service?.name || "",
              description: service?.description || "",
              price: service?.price || 0,
              durationMinutes: service?.durationMinutes || 60,
            },
            specialist: {
              name: specialist?.name || tenant.actor.name || "",
              specialty: specialist?.specialty || "",
              email: specialist?.email || tenant.actor.email,
              linkActor: specialist
                ? specialist.userId === tenant.actor.id
                : true,
            },
            policies: normalizeBusinessPolicies(settings.businessPolicies),
            portal: {
              clinicName: settings.portalClinicName || settings.clinicName,
              intro:
                settings.portalIntro ||
                "Aparta el horario para tu próximo servicio.",
              primaryColor: settings.portalPrimaryColor || "#4B5F25",
              paymentInstructions: settings.portalPaymentInstructions || "",
              visibleServiceIds: Array.isArray(settings.portalVisibleServiceIds)
                ? settings.portalVisibleServiceIds.filter(
                    (id): id is string => typeof id === "string",
                  )
                : [],
            },
            services,
            state: {
              currentStep: state?.currentStep || 1,
              completedSteps: state?.completedSteps || [],
              skippedSteps: state?.skippedSteps || [],
              completedAt: state?.completedAt?.toISOString() || null,
              publishedAt: state?.publishedAt?.toISOString() || null,
            },
          }}
        />
      </div>
    </main>
  );
}
