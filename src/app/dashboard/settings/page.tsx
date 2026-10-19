"use client";

import { useWorkspaceAccess } from "@/components/layout/workspace-access-context";
import layout from "@/components/shared/management-workspace.module.css";
import styles from "@/components/shared/business-workspace.module.css";
import settings from "@/components/shared/settings-workspace.module.css";
import { useCallback, useEffect, useState, type ChangeEvent, type ComponentType } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    CalendarDays,
    Bot,
    Image as ImageIcon,
    Loader2,
    Palette,
    Play,
    ReceiptText,
    Save,
    Settings,
    Store,
    Trash2,
    Upload,
    Users,
    UserRoundCog,
    Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeCustomizer } from "@/components/theme-customizer";
import { useToast } from "@/components/ui/use-toast";
import {
    getNotificationPrefs,
    NOTIFICATION_SOUNDS,
    playNotificationSound,
    saveNotificationPrefs,
    type NotificationPrefs,
} from "@/lib/notificationSounds";
import { WhatsAppGatewayPanel } from "@/components/settings/whatsapp-gateway-panel";
import { MetaWhatsAppPanel } from "@/components/settings/meta-whatsapp-panel";
import { GoogleCalendarPanel } from "@/components/settings/google-calendar-panel";
import { AppointmentReminderSettingsPanel } from "@/components/settings/appointment-reminder-settings-panel";
import { SpecialistManagerPanel } from "@/components/settings/specialist-manager-panel";
import { PortalContentPanel } from "@/components/settings/portal-content-panel";
import { LogoCropDialog } from "@/components/settings/logo-crop-dialog";
import { UserAccessPanel } from "@/components/settings/user-access-panel";
import { TeamInvitationManager } from "@/components/tenant/team-invitation-manager";
import { BusinessPolicyConfigurator } from "@/components/settings/business-policy-configurator";
import { TenantChannelSetup } from "@/components/tenant/tenant-channel-setup";
import { Slider } from "@/components/ui/slider";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import { OPERATION_COUNTRIES, getOperationCountry, normalizeCurrencyList } from "@/lib/operation-context";
import { DEFAULT_BRAND_FAVICON_URL, DEFAULT_BRAND_NAME, resolveBrandFavicon } from "@/lib/branding";
import { BrandLogo } from "@/components/brand/brand-logo";
import { tenantSlugFromPath } from "@/lib/tenant-request-routing";
import {
    BUSINESS_DAY_KEYS,
    BUSINESS_DAY_LABELS,
    normalizeBusinessHours,
    type BusinessDayKey,
    type BusinessWeeklySchedule,
} from "@/lib/calendar/business-hours";
import {
    EMPTY_BUSINESS_POLICIES,
    normalizeBusinessPolicies,
    type BusinessPolicies,
} from "@/lib/ai/business-policies";

type SectionId = "theme" | "brand" | "operation" | "users" | "ai" | "whatsapp" | "tenantChannels" | "calendar" | "specialists" | "portal" | "chats";
type LogoCropTarget = "brand" | "clinic";

const SECTIONS: Array<{
    id: SectionId;
    label: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    permission?: PermissionKey;
    permissions?: PermissionKey[];
    platformInternal?: boolean;
    separateTenantPage?: boolean;
    tenantOnly?: boolean;
}> = [
    { id: "theme", label: "Apariencia", description: "Tema y estilo general del CRM", icon: Palette },
    { id: "users", label: "Usuarios", description: "Accesos, roles y permisos", icon: Users, permission: "users.manage" },
    { id: "ai", label: "Asistente IA", description: "Claves y servicios de inteligencia", icon: Bot, permission: "ai.manage", platformInternal: true },
    { id: "whatsapp", label: "Canal WhatsApp", description: "WhatsApp API oficial y conexion alternativa por QR", icon: WhatsAppIcon, permission: "integrations.manage", platformInternal: true },
    { id: "tenantChannels", label: "WhatsApp", description: "Conecta WhatsApp de forma oficial o mediante una conexión no oficial por QR", icon: WhatsAppIcon, permission: "integrations.manage", tenantOnly: true },
    { id: "calendar", label: "Calendario", description: "Google Calendar y recordatorios de citas", icon: CalendarDays, permissions: ["calendar.manage", "integrations.manage"] },
    { id: "specialists", label: "Especialistas", description: "Equipo, servicios, agenda y disponibilidad", icon: UserRoundCog, permission: "specialists.manage", separateTenantPage: true },
    { id: "chats", label: "Notificaciones", description: "Sonidos y preferencias del inbox", icon: Volume2 },
];

export function SettingsWorkspace({
    billingHref,
    channelsEnabled = false,
    invitationsEnabled = false,
}: {
    billingHref?: string;
    channelsEnabled?: boolean;
    invitationsEnabled?: boolean;
}) {
    const { readOnly } = useWorkspaceAccess();
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [businessBaseline, setBusinessBaseline] = useState<{operation:string;brand:string} | null>(null);
    const pathname = usePathname();
    const tenantSlug = tenantSlugFromPath(pathname);
    const isTenantWorkspace = /^\/t\/[^/]+(?:\/|$)/.test(pathname);
    const businessOnly = pathname === "/dashboard/business" || /^\/t\/[^/]+\/business$/.test(pathname);
    const [activeSection, setActiveSection] = useState<SectionId>(businessOnly ? "operation" : "theme");
    const [operationTab, setOperationTab] = useState<"brand" | "operation" | "portal">(businessOnly ? "operation" : "brand");
    const [openaiKey, setOpenaiKey] = useState("");
    const [geminiKey, setGeminiKey] = useState("");
    const [whatsappBaseUrl, setWhatsappBaseUrl] = useState("");
    const [whatsappAdminToken, setWhatsappAdminToken] = useState("");
    const [whatsappUserToken, setWhatsappUserToken] = useState("");
    const [whatsappInstanceName, setWhatsappInstanceName] = useState("zen-crm");
    const [whatsappProxyEnabled, setWhatsappProxyEnabled] = useState(false);
    const [whatsappProxyUrl, setWhatsappProxyUrl] = useState("");
    const [operationCountry, setOperationCountry] = useState("MX");
    const [phoneDefaultCountry, setPhoneDefaultCountry] = useState("MX");
    const [businessTimeZone, setBusinessTimeZone] = useState("America/Mexico_City");
    const [businessWeeklySchedule, setBusinessWeeklySchedule] = useState<BusinessWeeklySchedule>(() => normalizeBusinessHours().weeklySchedule);
    const [businessPolicies, setBusinessPolicies] = useState<BusinessPolicies>(EMPTY_BUSINESS_POLICIES);
    const [agentName, setAgentName] = useState("Asistente del negocio");
    const [escalationPhone, setEscalationPhone] = useState("");
    const [paymentDefaultCurrency, setPaymentDefaultCurrency] = useState("MXN");
    const [paymentEnabledCurrencies, setPaymentEnabledCurrencies] = useState<string[]>(["MXN"]);
    const [brandName, setBrandName] = useState(DEFAULT_BRAND_NAME);
    const [brandLogoUrl, setBrandLogoUrl] = useState("");
    const [brandFaviconUrl, setBrandFaviconUrl] = useState(DEFAULT_BRAND_FAVICON_URL);
    const [clinicName, setClinicName] = useState("Zen CRM Cuidado Personal");
    const [clinicSubtitle, setClinicSubtitle] = useState("Servicios de cuidado personal");
    const [clinicAddress, setClinicAddress] = useState("Dirección del negocio");
    const [clinicLogoUrl, setClinicLogoUrl] = useState("");
    const [clinicLogoScale, setClinicLogoScale] = useState(100);
    const [reminderWhatsAppEnabled, setReminderWhatsAppEnabled] = useState(true);
    const [appointmentRemindersEnabled, setAppointmentRemindersEnabled] = useState(true);
    const [appointmentReminderOffsets, setAppointmentReminderOffsets] = useState<number[]>([1440, 240]);
    const [appointmentReminderProvider, setAppointmentReminderProvider] = useState<"wuzapi" | "meta">("wuzapi");
    const [appointmentReminderSendOnlyConfirmed, setAppointmentReminderSendOnlyConfirmed] = useState(true);
    const [appointmentReminderWuzapiTemplate, setAppointmentReminderWuzapiTemplate] = useState("");
    const [appointmentReminderMetaTemplate24h, setAppointmentReminderMetaTemplate24h] = useState("");
    const [appointmentReminderMetaTemplate4h, setAppointmentReminderMetaTemplate4h] = useState("");
    const [appointmentReminderMetaLanguage, setAppointmentReminderMetaLanguage] = useState("es");
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingBrandLogo, setIsUploadingBrandLogo] = useState(false);
    const [isUploadingBrandFavicon, setIsUploadingBrandFavicon] = useState(false);
    const [isUploadingClinicLogo, setIsUploadingClinicLogo] = useState(false);
    const [logoCrop, setLogoCrop] = useState<{ file: File; target: LogoCropTarget } | null>(null);
    const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
        enabled: true,
        soundType: "gentle",
        volume: 0.5,
    });
    const [savedNotifPrefs, setSavedNotifPrefs] = useState<NotificationPrefs>({
        enabled: true,
        soundType: "gentle",
        volume: 0.5,
    });

    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session, status } = useSession();
    const sessionUser = session?.user as { id?: string; role?: string; permissions?: unknown } | undefined;
    const currentUserId = sessionUser?.id;
    const canAccess = useCallback((permission: PermissionKey) => status !== "loading" && hasPermission(sessionUser, permission), [status, sessionUser]);
    const canManageBusiness = canAccess("settings.manage");
    const canManagePortal = canAccess("portal.manage");

    useEffect(() => {
        const load = async () => {
            try {
                const response = await fetch("/api/settings", { cache: "no-store" });
                if (!response.ok) throw new Error("No se pudo cargar la configuración.");
                const settings = await response.json();
                if (!settings || typeof settings !== "object") throw new Error("La configuración no está disponible.");
                setOpenaiKey(settings.openaiApiKey || "");
                setGeminiKey(settings.geminiApiKey || "");
                setWhatsappBaseUrl(settings.whatsappBaseUrl || "");
                setWhatsappAdminToken(settings.whatsappAdminToken || "");
                setWhatsappUserToken(settings.whatsappUserToken || "");
                setWhatsappInstanceName(settings.whatsappInstanceName || "zen-crm");
                setWhatsappProxyEnabled(Boolean(settings.whatsappProxyEnabled));
                setWhatsappProxyUrl(settings.whatsappProxyUrl || "");
                const country = getOperationCountry(settings.operationCountry || "MX");
                setOperationCountry(country.code);
                setPhoneDefaultCountry(settings.phoneDefaultCountry || country.code);
                setBusinessTimeZone(settings.businessTimeZone || country.timeZone);
                setBusinessWeeklySchedule(normalizeBusinessHours(settings).weeklySchedule);
                setBusinessPolicies(normalizeBusinessPolicies(settings.businessPolicies));
                setAgentName(settings.agentName || "Asistente del negocio");
                setEscalationPhone(settings.escalationPhone || "");
                const currencies = normalizeCurrencyList(settings.paymentEnabledCurrencies, country.code);
                setPaymentEnabledCurrencies(currencies);
                setPaymentDefaultCurrency(
                    currencies.includes(settings.paymentDefaultCurrency)
                        ? settings.paymentDefaultCurrency
                        : country.defaultCurrency,
                );
                setBrandName(settings.brandName || DEFAULT_BRAND_NAME);
                setBrandLogoUrl(settings.brandLogoUrl || "");
                setBrandFaviconUrl(resolveBrandFavicon(settings.brandFaviconUrl));
                setClinicName(/oftalm/i.test(settings.clinicName || "") ? "Zen CRM Cuidado Personal" : settings.clinicName || "Zen CRM Cuidado Personal");
                setClinicSubtitle(/oftalm|cl[ií]nica/i.test(settings.clinicSubtitle || "") ? "Servicios de cuidado personal" : settings.clinicSubtitle || "Servicios de cuidado personal");
                setClinicAddress(settings.clinicAddress || "Dirección del negocio");
                setClinicLogoUrl(settings.clinicLogoUrl || "");
                setClinicLogoScale(Number(settings.clinicLogoScale || 100));
                setReminderWhatsAppEnabled(settings.reminderWhatsAppEnabled !== false);
                setAppointmentRemindersEnabled(settings.appointmentRemindersEnabled !== false);
                setAppointmentReminderOffsets(
                    Array.isArray(settings.appointmentReminderOffsets)
                        ? settings.appointmentReminderOffsets
                            .map((value: unknown) => Number(value))
                            .filter((value: number) => Number.isFinite(value) && value > 0)
                        : [1440, 240],
                );
                setAppointmentReminderProvider(settings.appointmentReminderProvider === "meta" ? "meta" : "wuzapi");
                setAppointmentReminderSendOnlyConfirmed(settings.appointmentReminderSendOnlyConfirmed !== false);
                setAppointmentReminderWuzapiTemplate(settings.appointmentReminderWuzapiTemplate || "");
                setAppointmentReminderMetaTemplate24h(settings.appointmentReminderMetaTemplate24h || "");
                setAppointmentReminderMetaTemplate4h(settings.appointmentReminderMetaTemplate4h || "");
                setAppointmentReminderMetaLanguage(settings.appointmentReminderMetaLanguage || "es");
                setSettingsLoaded(true); setLoadError("");
            } catch (error) {
                setLoadError(error instanceof Error ? error.message : "No se pudo cargar la configuración.");
                console.error("Failed to load settings:", error);
            }
        };

        void load();
        const prefs = getNotificationPrefs();
        setNotifPrefs(prefs);
        setSavedNotifPrefs(prefs);
    }, [loadAttempt]);

    useEffect(() => {
        const requestedSection = searchParams.get("section");
        const requestedOperationTab = searchParams.get("tab");
        if (businessOnly) {
            setActiveSection("operation");
            setOperationTab(
                requestedOperationTab === "portal" && canManagePortal ? "portal"
                    : requestedOperationTab === "brand" && canManageBusiness ? "brand"
                    : canManageBusiness ? "operation" : canManagePortal ? "portal" : "operation",
            );
            return;
        }
        if (requestedSection === "templates") {
            router.replace("/dashboard/templates");
            return;
        }

        if (requestedSection === "operation" || requestedSection === "brand" || requestedSection === "portal") {
            const tab = requestedSection === "operation" ? requestedOperationTab || "operation" : requestedSection;
            router.replace(`/dashboard/business?tab=${encodeURIComponent(tab)}`);
            return;
        } else {
            const definition = SECTIONS.find((section) => section.id === requestedSection);
            const allowed = definition &&
                (!definition.tenantOnly || isTenantWorkspace) &&
                (!isTenantWorkspace || (!definition.platformInternal && !definition.separateTenantPage)) &&
                (!definition.permission || canAccess(definition.permission)) &&
                (!definition.permissions || definition.permissions.some(permission => canAccess(permission)));
            setActiveSection(allowed ? definition.id : "theme");
        }

        const googleState = searchParams.get("google");
        if (googleState === "connected") {
            toast({
                title: "Google Calendar conectado",
                description: "La cuenta quedo enlazada y ya se hizo una primera sincronizacion.",
            });
        } else if (googleState === "error") {
            toast({
                title: "No se pudo conectar Google Calendar",
                description: searchParams.get("reason") || "La autorizacion fallo.",
                variant: "destructive",
            });
        }
    }, [businessOnly, isTenantWorkspace, router, searchParams, toast, canManageBusiness, canManagePortal, canAccess]);

    const updateBusinessDay = (day: BusinessDayKey, patch: Partial<BusinessWeeklySchedule[BusinessDayKey]>) => {
        setBusinessWeeklySchedule((current) => ({
            ...current,
            [day]: { ...current[day], ...patch },
        }));
    };

    const operationSnapshot = JSON.stringify({ operationCountry, phoneDefaultCountry, paymentDefaultCurrency, paymentEnabledCurrencies, businessTimeZone, businessWeeklySchedule, businessPolicies, agentName, escalationPhone, clinicName, clinicSubtitle, clinicAddress, clinicLogoUrl, clinicLogoScale });
    const brandSnapshot = JSON.stringify({ brandName, brandLogoUrl, brandFaviconUrl });
    useEffect(() => { if (settingsLoaded && businessBaseline === null) setBusinessBaseline({operation:operationSnapshot,brand:brandSnapshot}); }, [settingsLoaded,businessBaseline,operationSnapshot,brandSnapshot]);
    const businessDirty = businessOnly && businessBaseline !== null && (businessBaseline.operation !== operationSnapshot || businessBaseline.brand !== brandSnapshot);
    const currentBusinessDirty = businessBaseline !== null && (operationTab === "brand" ? businessBaseline.brand !== brandSnapshot : businessBaseline.operation !== operationSnapshot);
    useEffect(() => { if (!businessDirty) return; const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";}; window.addEventListener("beforeunload",warn); return ()=>window.removeEventListener("beforeunload",warn); },[businessDirty]);
    const handleSave = async () => {
        if (readOnly || !settingsLoaded || isSaving || (businessOnly && !canManageBusiness)) return false;
        const normalizedHours = normalizeBusinessHours({ businessTimeZone, businessWeeklySchedule });
        setIsSaving(true);
        try {
            const saveSection = activeSection === "operation" ? operationTab : activeSection;
            const settingsPayload =
                saveSection === "ai"
                    ? {
                          openaiApiKey: openaiKey,
                          geminiApiKey: geminiKey,
                      }
                    : saveSection === "brand"
                        ? {
                              brandName: brandName.trim() || DEFAULT_BRAND_NAME,
                              brandLogoUrl,
                              brandFaviconUrl: brandFaviconUrl || DEFAULT_BRAND_FAVICON_URL,
                          }
                    : saveSection === "operation"
                        ? {
                              operationCountry,
                              phoneDefaultCountry,
                              paymentDefaultCurrency,
                              paymentEnabledCurrencies,
                              businessTimeZone,
                              businessHoursStart: normalizedHours.start,
                              businessHoursEnd: normalizedHours.end,
                              businessWeeklySchedule: normalizedHours.weeklySchedule,
                              businessPolicies: normalizeBusinessPolicies(businessPolicies),
                              ...(canAccess("ai.manage") ? { agentName, escalationPhone } : {}),
                              clinicName,
                              clinicSubtitle,
                              clinicAddress,
                              clinicLogoUrl,
                              clinicLogoScale,
                          }
                    : saveSection === "calendar"
                        ? {
                              ...(canAccess("calendar.manage")
                                  ? {
                                        reminderWhatsAppEnabled,
                                        appointmentRemindersEnabled,
                                        appointmentReminderOffsets,
                                        appointmentReminderProvider,
                                        appointmentReminderSendOnlyConfirmed,
                                        appointmentReminderWuzapiTemplate,
                                        appointmentReminderMetaTemplate24h,
                                        appointmentReminderMetaTemplate4h,
                                        appointmentReminderMetaLanguage,
                                    }
                                  : {}),
                          }
                        : {
                              whatsappBaseUrl,
                              whatsappAdminToken,
                              whatsappUserToken,
                              whatsappInstanceName,
                              whatsappProxyEnabled,
                              whatsappProxyUrl,
                          };

            const response = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settingsPayload),
            });
            if (!response.ok) { const result=await response.json().catch(()=>null); throw new Error(result?.error || "No se pudo guardar la configuración."); }
            if (saveSection === "operation" || saveSection === "brand") setBusinessBaseline(current => ({ operation: current?.operation || operationSnapshot, brand: current?.brand || brandSnapshot, [saveSection]: saveSection === "operation" ? operationSnapshot : brandSnapshot }));
            router.refresh();
            toast({ title: "Configuracion guardada" });
            return true;
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Fallo al guardar",
                variant: "destructive",
            });
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    const uploadImageAsset = async (file: File) => {
        if (readOnly || !settingsLoaded) throw new Error("Tu cuenta está en modo de solo lectura.");
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/upload", { method: "POST", body: formData });
        const result = await response.json();
        if (!response.ok || !result?.success || !result.url || result.mediaCategory !== "image") {
            throw new Error(result?.error || "El archivo debe ser una imagen valida.");
        }
        return result.url as string;
    };

    const handleLogoFileSelected = (target: LogoCropTarget, event: ChangeEvent<HTMLInputElement>) => {
        if (readOnly || !settingsLoaded) return;
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            toast({ title: "Selecciona una imagen válida", variant: "destructive" });
            return;
        }
        setLogoCrop({ file, target });
    };

    const handleCroppedLogoApply = async (croppedFile: File) => {
        if (!logoCrop) return;
        const target = logoCrop.target;
        if (target === "brand") setIsUploadingBrandLogo(true);
        else setIsUploadingClinicLogo(true);
        try {
            const url = await uploadImageAsset(croppedFile);
            if (target === "brand") {
                setBrandLogoUrl(url);
            } else {
                setClinicLogoUrl(url);
                setClinicLogoScale(100);
            }
            setLogoCrop(null);
            toast({ title: target === "brand" ? "Logo del CRM ajustado" : "Logotipo del negocio ajustado" });
        } catch (error) {
            toast({
                title: "No se pudo cargar el logotipo",
                description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
                variant: "destructive",
            });
        } finally {
            if (target === "brand") setIsUploadingBrandLogo(false);
            else setIsUploadingClinicLogo(false);
        }
    };

    const handleBrandFaviconUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        setIsUploadingBrandFavicon(true);
        try {
            const url = await uploadImageAsset(file);
            setBrandFaviconUrl(url);
            toast({ title: "Favicon cargado" });
        } catch (error) {
            toast({
                title: "No se pudo cargar el favicon",
                description: error instanceof Error ? error.message : "Intentalo de nuevo.",
                variant: "destructive",
            });
        } finally {
            setIsUploadingBrandFavicon(false);
        }
    };

    const hasNotifChanges =
        notifPrefs.enabled !== savedNotifPrefs.enabled ||
        notifPrefs.soundType !== savedNotifPrefs.soundType ||
        Math.abs(notifPrefs.volume - savedNotifPrefs.volume) > 0.001;

    const handleNotifSave = () => {
        saveNotificationPrefs(notifPrefs);
        setSavedNotifPrefs(notifPrefs);
        toast({
            title: "Preferencias guardadas",
            description: "Las notificaciones del inbox ya quedaron actualizadas.",
        });
    };

    const handleNotifReset = () => {
        setNotifPrefs(savedNotifPrefs);
    };

    const selectedOperationCountry = getOperationCountry(operationCountry);
    const phoneCountry = getOperationCountry(phoneDefaultCountry);

    const handleOperationCountryChange = (countryCode: string) => {
        const country = getOperationCountry(countryCode);
        setOperationCountry(country.code);
        setPhoneDefaultCountry(country.code);
        setBusinessTimeZone(country.timeZone);
        setPaymentEnabledCurrencies(country.currencies);
        setPaymentDefaultCurrency(country.defaultCurrency);
    };

    const visibleSections = SECTIONS.filter((section) =>
        (!section.tenantOnly || isTenantWorkspace) &&
        (!isTenantWorkspace || (!section.platformInternal && !section.separateTenantPage)) &&
        (!section.permission || canAccess(section.permission)) &&
        (!section.permissions || section.permissions.some((permission) => canAccess(permission))),
    );

    const selectSection = (section: SectionId) => {
        if (!visibleSections.some(item => item.id === section)) return;
        setActiveSection(section);
        const params = new URLSearchParams(searchParams.toString());
        params.set("section", section);
        params.delete("google");
        params.delete("reason");
        router.replace(`${pathname}?${params}`, { scroll: false });
    };
    const selectedSection = visibleSections.find(section => section.id === activeSection);

    return (
        <div className={businessOnly ? `${layout.workspace} ${styles.business}` : `${layout.workspace} ${settings.workspace}`} data-business-workspace={businessOnly || undefined} data-settings-workspace={!businessOnly || undefined}>
            <LogoCropDialog
                file={logoCrop?.file || null}
                open={Boolean(logoCrop)}
                title={logoCrop?.target === "brand" ? "Ajustar logo del CRM" : "Ajustar logotipo del negocio"}
                isApplying={logoCrop?.target === "brand" ? isUploadingBrandLogo : isUploadingClinicLogo}
                onOpenChange={(open) => !open && setLogoCrop(null)}
                onApply={handleCroppedLogoApply}
            />
            <div className={layout.heading}>
                <div><h1 className="flex items-center gap-2 text-2xl font-bold">
                    {businessOnly ? <Store className="h-6 w-6 text-primary" /> : <Settings className="h-6 w-6 text-primary" />}
                    {businessOnly ? "Mi Negocio" : "Configuración"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    {businessOnly
                        ? "Administra la operación, la información comercial, el portal y la marca de tu negocio."
                        : isTenantWorkspace
                            ? "Administra la apariencia, los usuarios, el calendario y las notificaciones del negocio."
                            : "Ajusta la apariencia, los canales y las integraciones del CRM sin tocar la operación diaria del equipo."}
                </p>
            </div></div>

            {loadError && <p role="alert" className="rounded-xl border p-4 text-sm text-destructive">{loadError} <Button variant="outline" onClick={() => setLoadAttempt(value => value+1)}>Reintentar</Button></p>}
            {businessOnly && !settingsLoaded && !loadError && <p role="status" className="text-sm text-muted-foreground">Cargando información del negocio…</p>}
            {businessOnly && readOnly && <p className={layout.readonly}>Solo lectura. Puedes consultar tu configuración y tu portal.</p>}
            {!businessOnly && readOnly && <p className={layout.readonly}>Solo lectura. Puedes consultar la configuración; reactiva un plan para modificarla.</p>}
            <div className={businessOnly ? undefined : settings.frame}>
            {!businessOnly && <nav aria-label="Secciones de configuración" className={settings.navigation}>
                <div className={settings.mobileNavigation}>
                    <Label htmlFor="settings-section">Sección</Label>
                    <select id="settings-section" value={selectedSection?.id || "theme"} onChange={event => selectSection(event.target.value as SectionId)}>
                        {visibleSections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
                    </select>
                </div>
                <div className={settings.desktopNavigation}>
                    {visibleSections.map(section => {
                        const Icon = section.icon;
                        return <button type="button" key={section.id} onClick={() => selectSection(section.id)} aria-current={activeSection === section.id ? "page" : undefined} className={settings.navItem}>
                            <Icon className="size-5 shrink-0" />
                            <span><strong>{section.label}</strong><small>{section.description}</small></span>
                        </button>;
                    })}
                </div>
                {billingHref && <Link href={billingHref} className={settings.billingLink}><ReceiptText className="size-4 shrink-0" />Plan y facturación<span aria-hidden="true">↗</span></Link>}
            </nav>}
            <div data-business-panel className={businessOnly ? "rounded-2xl border bg-card p-4 sm:p-5 md:p-7" : settings.content}>
                {!businessOnly && selectedSection && <header className={settings.sectionHeading}><h2>{selectedSection.label}</h2><p>{selectedSection.description}</p></header>}
                <fieldset className={businessOnly ? undefined : settings.fields} disabled={!businessOnly && !["theme", "chats"].includes(activeSection) && (readOnly || !settingsLoaded)}>
                {activeSection === "operation" && (
                    <div role="tablist" aria-label="Secciones del negocio" className={businessOnly ? layout.tabs : "mb-6 flex w-full max-w-xl border-b"}>
                        {([
                            { id: "operation", label: "Negocio" },
                            { id: "portal", label: "Portal" },
                            { id: "brand", label: "Marca" },
                        ] as const).filter(tab => tab.id === "portal" ? canManagePortal : canManageBusiness).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab" aria-selected={operationTab === tab.id} onClick={() => { setOperationTab(tab.id); if (businessOnly) { const params=new URLSearchParams(searchParams.toString()); params.set("tab",tab.id); router.replace(`${pathname}?${params}`,{scroll:false}); } }}
                                className={`relative flex-1 px-3 py-3 text-sm font-medium transition ${
                                    operationTab === tab.id
                                        ? "text-primary after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                )}

                {activeSection === "theme" && (
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Palette className="h-4 w-4 text-primary" />
                                <h2 className="font-semibold">Modo de visualización</h2>
                            </div>
                            <ThemeToggle />
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Palette className="h-4 w-4 text-primary" />
                                <h2 className="font-semibold">Tema de colores</h2>
                            </div>
                            <ThemeCustomizer />
                        </div>
                    </div>
                )}

                {activeSection === "operation" && operationTab === "brand" && canAccess("settings.manage") && (
                    <fieldset disabled={readOnly || isSaving || !settingsLoaded} className="max-w-5xl space-y-5">
                        <div>
                            <h2 className="font-semibold">Marca blanca del CRM</h2>
                            <p className="text-sm text-muted-foreground">
                                Personaliza el nombre, logo y favicon que verá tu equipo en el CRM.
                            </p>
                        </div>

                        <div className={styles.brandGrid}>
                            <div className="space-y-5">
                                <div className="rounded-2xl border bg-muted/10 p-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="business-brandName">Nombre del CRM</Label>
                                        <Input
                                            id="business-brandName" value={brandName}
                                            onChange={(event) => setBrandName(event.target.value)}
                                            placeholder={DEFAULT_BRAND_NAME}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Se mostrará en sidebar, login y título del navegador.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-2xl border bg-background p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <Label>Logo del CRM</Label>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    Ideal PNG, WEBP o SVG con fondo transparente.
                                                </p>
                                            </div>
                                            {brandLogoUrl ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="rounded-full text-destructive"
                                                    onClick={() => setBrandLogoUrl("")}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            ) : null}
                                        </div>
                                        <div className="mt-4 flex min-h-28 items-center justify-center rounded-2xl border bg-muted/25 p-4">
                                            <BrandLogo
                                                brandName={brandName || DEFAULT_BRAND_NAME}
                                                logoUrl={brandLogoUrl}
                                                className="h-20 w-20 text-primary"
                                            />
                                        </div>
                                        <label className="mt-3 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border bg-background text-sm font-medium transition hover:bg-muted/50">
                                            {isUploadingBrandLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                            Elegir y ajustar
                                            <input
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                                className="hidden"
                                                onChange={(event) => handleLogoFileSelected("brand", event)}
                                                disabled={isUploadingBrandLogo}
                                            />
                                        </label>
                                    </div>

                                    <div className="rounded-2xl border bg-background p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <Label>Favicon</Label>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    Icono de la pestaña del navegador.
                                                </p>
                                            </div>
                                            {brandFaviconUrl && brandFaviconUrl !== DEFAULT_BRAND_FAVICON_URL ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="rounded-full text-destructive"
                                                    onClick={() => setBrandFaviconUrl(DEFAULT_BRAND_FAVICON_URL)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            ) : null}
                                        </div>
                                        <div className="mt-4 flex min-h-28 items-center justify-center rounded-2xl border bg-muted/25 p-4">
                                            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border bg-background p-2 shadow-sm">
                                                <Image
                                                    src={brandFaviconUrl || DEFAULT_BRAND_FAVICON_URL}
                                                    alt="Favicon del CRM"
                                                    width={64}
                                                    height={64}
                                                    unoptimized
                                                    className="h-full w-full object-contain"
                                                />
                                            </div>
                                        </div>
                                        <label className="mt-3 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border bg-background text-sm font-medium transition hover:bg-muted/50">
                                            {isUploadingBrandFavicon ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                            Subir favicon
                                            <input
                                                type="file"
                                                accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico"
                                                className="hidden"
                                                onChange={handleBrandFaviconUpload}
                                                disabled={isUploadingBrandFavicon}
                                            />
                                        </label>
                                    </div>
                                </div>

                                <Button className={businessOnly ? "hidden" : undefined} onClick={handleSave} disabled={readOnly || isSaving || !settingsLoaded}>
                                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Guardar marca blanca
                                </Button>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-2xl border bg-background p-4">
                                    <p className="text-sm font-semibold">Vista previa</p>
                                    <div className="mt-4 overflow-hidden rounded-2xl border bg-sidebar text-sidebar-foreground shadow-sm">
                                        <div className="flex items-center gap-3 border-b border-white/8 bg-white/6 px-4 py-4">
                                            <BrandLogo
                                                brandName={brandName || DEFAULT_BRAND_NAME}
                                                logoUrl={brandLogoUrl}
                                                className="h-9 w-9 text-white"
                                            />
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-white">
                                                    {brandName || DEFAULT_BRAND_NAME}
                                                </p>
                                                <p className="text-xs text-sidebar-foreground/50">Workspace operativo</p>
                                            </div>
                                        </div>
                                        <div className="space-y-2 p-4">
                                            <div className="h-9 rounded-xl bg-white/8" />
                                            <div className="h-9 rounded-xl bg-primary/25" />
                                            <div className="h-9 rounded-xl bg-white/8" />
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-2xl border bg-muted/15 p-4">
                                    <p className="text-sm font-semibold">Pestaña del navegador</p>
                                    <div className="mt-3 flex items-center gap-3 rounded-full border bg-background px-4 py-3 shadow-sm">
                                        <Image
                                            src={brandFaviconUrl || DEFAULT_BRAND_FAVICON_URL}
                                            alt=""
                                            width={20}
                                            height={20}
                                            unoptimized
                                            className="h-5 w-5 object-contain"
                                        />
                                        <span className="truncate text-sm font-medium">
                                            {brandName || DEFAULT_BRAND_NAME}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </fieldset>
                )}

                {activeSection === "operation" && operationTab === "operation" && canAccess("settings.manage") && (
                    <div className={styles.businessSections}>
                        <fieldset className={styles.form} disabled={readOnly || isSaving || !settingsLoaded}>                        <div className="rounded-2xl border bg-background p-4">
                            <div>
                                <h2 className="font-semibold">Datos del negocio</h2>
                                <p className="text-sm text-muted-foreground">
                                    Información pública usada para presentar correctamente el negocio.
                                </p>
                            </div>

                            <div className="mt-4 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                                <details className={styles.section}><summary>Logotipo y tamaño</summary><div className="p-4">
                                    <Label>Logotipo</Label>
                                    <div className="mt-3 flex flex-col items-center gap-3">
                                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border bg-muted/35">
                                            {clinicLogoUrl ? (
                                                <Image
                                                    src={clinicLogoUrl}
                                                    alt="Logotipo del negocio"
                                                    width={96}
                                                    height={96}
                                                    unoptimized
                                                    className="object-contain"
                                                    style={{
                                                        width: `${Math.max(50, Math.min(180, clinicLogoScale))}%`,
                                                        height: `${Math.max(50, Math.min(180, clinicLogoScale))}%`,
                                                    }}
                                                />
                                            ) : (
                                                <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="flex w-full gap-2">
                                            <label className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border bg-background text-sm font-medium transition hover:bg-muted/50">
                                                {isUploadingClinicLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                                Elegir y ajustar
                                                <input type="file" accept="image/*" className="hidden" onChange={(event) => handleLogoFileSelected("clinic", event)} disabled={isUploadingClinicLogo} />
                                            </label>
                                            {clinicLogoUrl ? (
                                                <Button type="button" variant="outline" size="icon" className="rounded-full text-destructive" onClick={() => setClinicLogoUrl("")}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            ) : null}
                                        </div>
                                        <div className="w-full space-y-2">
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span>Tamano</span>
                                                <span>{clinicLogoScale}%</span>
                                            </div>
                                            <Slider thumbLabel="Tamaño del logo"
                                                value={[clinicLogoScale]}
                                                min={60}
                                                max={160}
                                                step={5}
                                                onValueChange={(value) => setClinicLogoScale(value[0] ?? 100)}
                                            />
                                        </div>
                                    </div>
                                </div></details>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="business-clinicName">Nombre comercial</Label>
                                        <Input id="business-clinicName" value={clinicName} onChange={(event) => setClinicName(event.target.value)} placeholder="Nombre del negocio" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="business-clinicSubtitle">Subtítulo / giro</Label>
                                        <Input id="business-clinicSubtitle" value={clinicSubtitle} onChange={(event) => setClinicSubtitle(event.target.value)} placeholder="Salón, barbería, spa..." />
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label htmlFor="business-clinicAddress">Dirección del negocio</Label>
                                        <Input id="business-clinicAddress" value={clinicAddress} onChange={(event) => setClinicAddress(event.target.value)} placeholder="Dirección, teléfono, ciudad..." />
                                    </div>
                                </div>
                            </div>

                        </div></fieldset>

                        <details className={styles.section}><summary>Horarios de atención</summary><fieldset className={`${styles.form} ${styles.sectionBody}`} disabled={readOnly || isSaving || !settingsLoaded}>                            <div className="mt-5 rounded-2xl border bg-background p-4">
                                <h3 className="font-semibold">Horario de atención del negocio</h3>
                                <div className="mt-4 divide-y rounded-xl border">
                                    {BUSINESS_DAY_KEYS.map((day) => {
                                        const schedule = businessWeeklySchedule[day];
                                        return (
                                            <div key={day} className="grid items-center gap-3 px-3 py-3 sm:grid-cols-[110px_1fr]">
                                                <label className="flex items-center gap-2 text-sm font-medium">
                                                    <Switch checked={schedule.enabled} onCheckedChange={(enabled) => updateBusinessDay(day, { enabled })} />
                                                    {BUSINESS_DAY_LABELS[day]}
                                                </label>
                                                {schedule.enabled ? (
                                                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                                        <Input type="time" value={schedule.start} onChange={(event) => updateBusinessDay(day, { start: event.target.value })} aria-label={`Apertura ${BUSINESS_DAY_LABELS[day]}`} />
                                                        <span className="text-xs text-muted-foreground">a</span>
                                                        <Input type="time" value={schedule.end} onChange={(event) => updateBusinessDay(day, { end: event.target.value })} aria-label={`Cierre ${BUSINESS_DAY_LABELS[day]}`} />
                                                    </div>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground">Cerrado</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>


</fieldset></details>
                        <details className={styles.section}><summary>País, moneda y zona horaria</summary><fieldset className={`${styles.form} ${styles.sectionBody}`} disabled={readOnly || isSaving || !settingsLoaded}>                        <div>
                            <h2 className="font-semibold">Pais de operacion</h2>
                            <p className="text-sm text-muted-foreground">
                                Define defaults de telefono, moneda, zona horaria, calendario y recordatorios automaticos.
                            </p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Pais principal</Label>
                                <Select value={operationCountry} onValueChange={handleOperationCountryChange}>
                                    <SelectTrigger className="h-11 bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {OPERATION_COUNTRIES.map((country) => (
                                            <SelectItem key={country.code} value={country.code}>
                                                {country.name} ({country.code})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Prefijo telefonico default</Label>
                                <Select value={phoneDefaultCountry} onValueChange={setPhoneDefaultCountry}>
                                    <SelectTrigger className="h-11 bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[selectedOperationCountry, ...OPERATION_COUNTRIES.filter((country) => country.code !== selectedOperationCountry.code)].map((country) => (
                                            <SelectItem key={country.code} value={country.code}>
                                                {country.name} {country.callingCode}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    En telefonos nuevos aparecera primero {phoneCountry.name} {phoneCountry.callingCode}.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="business-businessTimeZone">Zona horaria</Label>
                                <Input id="business-businessTimeZone" value={businessTimeZone} onChange={(event) => setBusinessTimeZone(event.target.value)} />
                                <p className="text-xs text-muted-foreground">
                                    Se usa en calendario, disponibilidad del portal, IA de agenda y recordatorios.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>Moneda default</Label>
                                <Select value={paymentDefaultCurrency} onValueChange={setPaymentDefaultCurrency}>
                                    <SelectTrigger className="h-11 bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {paymentEnabledCurrencies.map((currency) => (
                                            <SelectItem key={currency} value={currency}>
                                                {currency}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Monedas habilitadas: {paymentEnabledCurrencies.join(", ")}.
                                </p>
                            </div>
                        </div>

</fieldset></details>
                        <details className={styles.section}><summary>Políticas y atención del asistente</summary><div className={styles.sectionBody}>                            <BusinessPolicyConfigurator
                                readOnly={readOnly || isSaving || !settingsLoaded}
                                value={businessPolicies}
                                onChange={setBusinessPolicies}
                                agentName={agentName}
                                onAgentNameChange={setAgentName}
                                escalationPhone={escalationPhone}
                                onEscalationPhoneChange={setEscalationPhone}
                                canManageAi={canAccess("ai.manage")}
                            />

</div></details>
                        {!businessOnly && <Button onClick={handleSave} disabled={readOnly || isSaving || !settingsLoaded}>Guardar operación</Button>}
                    </div>
                )}

                {activeSection === "ai" && !isTenantWorkspace && canAccess("ai.manage") && (
                    <div className="max-w-xl space-y-4">
                        <div>
                            <h2 className="font-semibold">Inteligencia artificial</h2>
                            <p className="text-sm text-muted-foreground">Credenciales para el cerebro del CRM.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="openai">OpenAI API key</Label>
                            <Input id="openai" type="password" value={openaiKey} onChange={(event) => setOpenaiKey(event.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="gemini">Gemini API key</Label>
                            <Input id="gemini" type="password" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} />
                        </div>
                        <Button onClick={handleSave} disabled={readOnly || isSaving || !settingsLoaded}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Guardar cambios
                        </Button>
                    </div>
                )}

                {activeSection === "whatsapp" && !isTenantWorkspace && canAccess("integrations.manage") && (
                    <div className="space-y-6">
                        <MetaWhatsAppPanel />

                        <WhatsAppGatewayPanel
                            whatsappBaseUrl={whatsappBaseUrl}
                            whatsappAdminToken={whatsappAdminToken}
                            whatsappUserToken={whatsappUserToken}
                            whatsappInstanceName={whatsappInstanceName}
                            whatsappProxyEnabled={whatsappProxyEnabled}
                            whatsappProxyUrl={whatsappProxyUrl}
                            onChange={(field, value) => {
                                if (field === "whatsappBaseUrl") setWhatsappBaseUrl(value);
                                if (field === "whatsappAdminToken") setWhatsappAdminToken(value);
                                if (field === "whatsappUserToken") setWhatsappUserToken(value);
                                if (field === "whatsappInstanceName") setWhatsappInstanceName(value);
                                if (field === "whatsappProxyUrl") setWhatsappProxyUrl(value);
                            }}
                            onProxyEnabledChange={setWhatsappProxyEnabled}
                            onSave={handleSave}
                            isSaving={isSaving}
                        />
                    </div>
                )}

                {activeSection === "tenantChannels" && isTenantWorkspace && tenantSlug && canAccess("integrations.manage") && (
                    <div className="space-y-5">
                        <div>
                            <h2 className="font-semibold">WhatsApp del negocio</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Elige la conexión oficial de WhatsApp o vincula un teléfono mediante QR, ahora o después del asistente inicial.
                            </p>
                        </div>
                        <TenantChannelSetup tenantSlug={tenantSlug} enabled={channelsEnabled} />
                    </div>
                )}

                {activeSection === "calendar" && (
                    <div className="space-y-6">
                        {canAccess("calendar.manage") ? (
                            <AppointmentReminderSettingsPanel
                                enabled={appointmentRemindersEnabled && reminderWhatsAppEnabled}
                                offsets={appointmentReminderOffsets}
                                provider={appointmentReminderProvider}
                                sendOnlyConfirmed={appointmentReminderSendOnlyConfirmed}
                                wuzapiTemplate={appointmentReminderWuzapiTemplate}
                                metaTemplate24h={appointmentReminderMetaTemplate24h}
                                metaTemplate4h={appointmentReminderMetaTemplate4h}
                                metaLanguage={appointmentReminderMetaLanguage}
                                onEnabledChange={(value) => {
                                    setAppointmentRemindersEnabled(value);
                                    setReminderWhatsAppEnabled(value);
                                }}
                                onOffsetsChange={setAppointmentReminderOffsets}
                                onProviderChange={setAppointmentReminderProvider}
                                onSendOnlyConfirmedChange={setAppointmentReminderSendOnlyConfirmed}
                                onWuzapiTemplateChange={setAppointmentReminderWuzapiTemplate}
                                onMetaTemplate24hChange={setAppointmentReminderMetaTemplate24h}
                                onMetaTemplate4hChange={setAppointmentReminderMetaTemplate4h}
                                onMetaLanguageChange={setAppointmentReminderMetaLanguage}
                                onSave={handleSave}
                                isSaving={isSaving}
                            />
                        ) : null}

                        {canAccess("integrations.manage") ? (
                            <GoogleCalendarPanel />
                        ) : null}
                    </div>
                )}

                {activeSection === "specialists" && !isTenantWorkspace && canAccess("specialists.manage") && (
                    <SpecialistManagerPanel />
                )}

                {activeSection === "operation" && operationTab === "portal" && canAccess("portal.manage") && (
                    <PortalContentPanel />
                )}

                {activeSection === "users" && canAccess("users.manage") && (
                    <div className="min-w-0 space-y-8">
                        {isTenantWorkspace && tenantSlug && <TeamInvitationManager tenantSlug={tenantSlug} enabled={invitationsEnabled} />}
                        <UserAccessPanel currentUserId={currentUserId} allowCreate={!isTenantWorkspace} />
                    </div>
                )}

                {activeSection === "chats" && (
                    <div className="max-w-3xl space-y-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="font-semibold">Notificaciones</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Define el sonido del inbox y aplica los cambios cuando estes conforme.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    onClick={handleNotifReset}
                                    disabled={!hasNotifChanges}
                                >
                                    Cancelar cambios
                                </Button>
                                <Button
                                    onClick={handleNotifSave}
                                    disabled={!hasNotifChanges}
                                >
                                    <Save className="mr-2 h-4 w-4" />
                                    Guardar preferencias
                                </Button>
                            </div>
                        </div>

                        <div className="rounded-2xl border bg-muted/15 p-5">
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-3 rounded-xl border bg-background/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="pr-4">
                                        <Label htmlFor="notif-toggle" className="text-base">Activar notificaciones</Label>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            Reproduce un sonido cuando entra un mensaje nuevo en el inbox.
                                        </p>
                                    </div>
                                    <Switch
                                        id="notif-toggle"
                                        checked={notifPrefs.enabled}
                                        onCheckedChange={(checked) =>
                                            setNotifPrefs((current) => ({ ...current, enabled: checked }))
                                        }
                                    />
                                </div>

                                {notifPrefs.enabled ? (
                                    <>
                                        <div className="space-y-2">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="font-medium">Sonido</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        Elige el tono que mejor encaje con tu forma de trabajo.
                                                    </p>
                                                </div>
                                                <span className="text-xs text-muted-foreground">
                                                    Vista previa disponible
                                                </span>
                                            </div>

                                            {NOTIFICATION_SOUNDS.map((sound) => (
                                                <div key={sound.id} className={settings.soundRow} data-selected={notifPrefs.soundType === sound.id}>
                                                    <button type="button" aria-pressed={notifPrefs.soundType === sound.id} className={settings.soundChoice}
                                                        onClick={() => setNotifPrefs(current => ({ ...current, soundType: sound.id }))}>
                                                        <span className="font-medium">{sound.name}</span>
                                                        <span className="mt-1 block text-sm text-muted-foreground">{sound.description}</span>
                                                    </button>
                                                    <Button type="button" variant="ghost" size="icon" aria-label={`Probar sonido ${sound.name}`}
                                                        onClick={() => playNotificationSound(sound.id, notifPrefs.volume)}>
                                                        <Play className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="space-y-3 rounded-xl border bg-background/80 px-4 py-4">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <Label id="notification-volume-label">Volumen</Label>
                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Ajusta la intensidad antes de guardar.
                                                    </p>
                                                </div>
                                                <span className="text-sm font-medium text-muted-foreground">
                                                    {Math.round(notifPrefs.volume * 100)}%
                                                </span>
                                            </div>
                                            <Slider thumbLabel="Volumen de notificaciones" aria-labelledby="notification-volume-label"
                                                min={0}
                                                max={100}
                                                step={1}
                                                value={[Math.round(notifPrefs.volume * 100)]}
                                                onValueChange={([value]) =>
                                                    setNotifPrefs((current) => ({ ...current, volume: value / 100 }))
                                                }
                                            />
                                            <div className="flex justify-end">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => playNotificationSound(notifPrefs.soundType, notifPrefs.volume)}
                                                >
                                                    <Play className="mr-2 h-4 w-4" />
                                                    Probar volumen
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="rounded-xl border border-dashed bg-background/70 px-4 py-5 text-sm text-muted-foreground">
                                        Las notificaciones estan desactivadas. Si las vuelves a activar, podras elegir tono y volumen antes de guardar.
                                    </div>
                                )}

                                <p className="text-xs text-muted-foreground">
                                    Los cambios de esta seccion no se aplican hasta pulsar <span className="font-medium text-foreground">Guardar preferencias</span>.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </fieldset>
            </div>
            </div>
            {businessOnly && operationTab !== "portal" && <div className={layout.saveBar} role="region" aria-label="Guardar información del negocio"><p className="hidden sm:block text-sm text-muted-foreground">{currentBusinessDirty ? "Cambios sin guardar" : "Información del negocio"}</p><div><Button onClick={handleSave} disabled={!canManageBusiness || readOnly || isSaving || !settingsLoaded || isUploadingClinicLogo || isUploadingBrandLogo || isUploadingBrandFavicon}>{isSaving && <Loader2 className="size-4 animate-spin" />}Guardar {operationTab === "brand" ? "marca" : "negocio"}</Button></div></div>}
        </div>
    );
}

export default function SettingsPage() {
    return <SettingsWorkspace />;
}
