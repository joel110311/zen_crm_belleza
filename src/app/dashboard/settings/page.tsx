"use client";

import { useEffect, useState, type ChangeEvent, type ComponentType } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    CalendarDays,
    Bot,
    Image as ImageIcon,
    Loader2,
    Palette,
    Percent,
    Play,
    ReceiptText,
    Save,
    Settings,
    Stethoscope,
    Store,
    Trash2,
    Upload,
    Users,
    Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { BusinessPolicyConfigurator } from "@/components/settings/business-policy-configurator";
import { Slider } from "@/components/ui/slider";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import { OPERATION_COUNTRIES, getOperationCountry, normalizeCurrencyList } from "@/lib/operation-context";
import { DEFAULT_BRAND_FAVICON_URL, DEFAULT_BRAND_NAME } from "@/lib/branding";
import { BrandLogo } from "@/components/brand/brand-logo";
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

type SectionId = "theme" | "brand" | "operation" | "users" | "ai" | "whatsapp" | "calendar" | "specialists" | "portal" | "chats";
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
}> = [
    { id: "theme", label: "Apariencia", description: "Tema y estilo general del CRM", icon: Palette },
    { id: "users", label: "Usuarios", description: "Accesos, roles y permisos", icon: Users, permission: "users.manage" },
    { id: "ai", label: "Cerebro IA", description: "Claves y servicios de inteligencia", icon: Bot, permission: "ai.manage", platformInternal: true },
    { id: "whatsapp", label: "Canal WhatsApp", description: "WhatsApp API oficial y conexion alternativa por QR", icon: WhatsAppIcon, permission: "integrations.manage", platformInternal: true },
    { id: "calendar", label: "Calendario", description: "Google Calendar y recordatorios de citas", icon: CalendarDays, permissions: ["calendar.manage", "integrations.manage"] },
    { id: "specialists", label: "Especialistas", description: "Perfiles, agendas, servicios y bloqueos", icon: Stethoscope, permission: "specialists.manage", separateTenantPage: true },
    { id: "chats", label: "Notificaciones", description: "Sonidos y preferencias del inbox", icon: Volume2 },
];

function SettingsWorkspace() {
    const pathname = usePathname();
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
    const [clinicName, setClinicName] = useState("Zen CRM Belleza");
    const [clinicSubtitle, setClinicSubtitle] = useState("Servicios de belleza");
    const [clinicAddress, setClinicAddress] = useState("Dirección del negocio");
    const [clinicLogoUrl, setClinicLogoUrl] = useState("");
    const [clinicLogoScale, setClinicLogoScale] = useState(100);
    const [posTaxEnabled, setPosTaxEnabled] = useState(false);
    const [posTaxRate, setPosTaxRate] = useState(16);
    const [posTicketEnabled, setPosTicketEnabled] = useState(true);
    const [posTicketShowUnitPrice, setPosTicketShowUnitPrice] = useState(true);
    const [posTicketFullDescription, setPosTicketFullDescription] = useState(false);
    const [posTicketHeader, setPosTicketHeader] = useState("Zen CRM Belleza\nServicios de belleza\nDirección del negocio");
    const [posTicketFooter, setPosTicketFooter] = useState("Gracias por su compra\nRegrese pronto");
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
    const canAccess = (permission: PermissionKey) => status !== "loading" && hasPermission(sessionUser, permission);

    useEffect(() => {
        const load = async () => {
            try {
                const response = await fetch("/api/settings", { cache: "no-store" });
                const settings = await response.json();
                if (!settings) return;
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
                setBrandFaviconUrl(settings.brandFaviconUrl || DEFAULT_BRAND_FAVICON_URL);
                setClinicName(/oftalm/i.test(settings.clinicName || "") ? "Zen CRM Belleza" : settings.clinicName || "Zen CRM Belleza");
                setClinicSubtitle(/oftalm|cl[ií]nica/i.test(settings.clinicSubtitle || "") ? "Servicios de belleza" : settings.clinicSubtitle || "Servicios de belleza");
                setClinicAddress(settings.clinicAddress || "Dirección del negocio");
                setClinicLogoUrl(settings.clinicLogoUrl || "");
                setClinicLogoScale(Number(settings.clinicLogoScale || 100));
                setPosTaxEnabled(Boolean(settings.posTaxEnabled));
                setPosTaxRate(Number(settings.posTaxRate || 16));
                setPosTicketEnabled(settings.posTicketEnabled !== false);
                setPosTicketShowUnitPrice(settings.posTicketShowUnitPrice !== false);
                setPosTicketFullDescription(Boolean(settings.posTicketFullDescription));
                setPosTicketHeader(settings.posTicketHeader || "Zen CRM Belleza\nServicios de belleza\nDirección del negocio");
                setPosTicketFooter(settings.posTicketFooter || "Gracias por su compra\nRegrese pronto");
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
            } catch (error) {
                console.error("Failed to load settings:", error);
            }
        };

        void load();
        const prefs = getNotificationPrefs();
        setNotifPrefs(prefs);
        setSavedNotifPrefs(prefs);
    }, []);

    useEffect(() => {
        const requestedSection = searchParams.get("section");
        const requestedOperationTab = searchParams.get("tab");
        if (businessOnly) {
            setActiveSection("operation");
            setOperationTab(
                ["brand", "operation", "portal"].includes(requestedOperationTab || "")
                    ? requestedOperationTab as "brand" | "operation" | "portal"
                    : "operation",
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
        } else if (requestedSection && SECTIONS.some((section) => section.id === requestedSection)) {
            const requestedDefinition = SECTIONS.find((section) => section.id === requestedSection);
            if (isTenantWorkspace && (requestedDefinition?.platformInternal || requestedDefinition?.separateTenantPage)) {
                setActiveSection("theme");
            } else {
                setActiveSection(requestedSection as SectionId);
            }
            if (requestedSection === "operation" && ["brand", "operation", "portal"].includes(requestedOperationTab || "")) {
                setOperationTab(requestedOperationTab as "brand" | "operation" | "portal");
            }
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
    }, [businessOnly, isTenantWorkspace, router, searchParams, toast]);

    const updateBusinessDay = (day: BusinessDayKey, patch: Partial<BusinessWeeklySchedule[BusinessDayKey]>) => {
        setBusinessWeeklySchedule((current) => ({
            ...current,
            [day]: { ...current[day], ...patch },
        }));
    };

    const handleSave = async () => {
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
                              posTaxEnabled,
                              posTaxRate,
                              posTicketEnabled,
                              posTicketShowUnitPrice,
                              posTicketFullDescription,
                              posTicketHeader,
                              posTicketFooter,
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
            if (!response.ok) throw new Error("No se pudo guardar la configuracion");
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
        (!isTenantWorkspace || (!section.platformInternal && !section.separateTenantPage)) &&
        (!section.permission || canAccess(section.permission)) &&
        (!section.permissions || section.permissions.some((permission) => canAccess(permission))),
    );

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <LogoCropDialog
                file={logoCrop?.file || null}
                open={Boolean(logoCrop)}
                title={logoCrop?.target === "brand" ? "Ajustar logo del CRM" : "Ajustar logotipo del negocio"}
                isApplying={logoCrop?.target === "brand" ? isUploadingBrandLogo : isUploadingClinicLogo}
                onOpenChange={(open) => !open && setLogoCrop(null)}
                onApply={handleCroppedLogoApply}
            />
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold">
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
                {!businessOnly && isTenantWorkspace && <a href="/delete-account" className="mt-3 inline-block text-sm text-destructive underline">Eliminar mi cuenta</a>}
            </div>

            {!businessOnly ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleSections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;
                    return (
                        <button
                            key={section.id}
                            onClick={() => setActiveSection(section.id)}
                            className={`min-w-0 rounded-2xl border px-4 py-4 text-left transition ${
                                isActive
                                    ? "border-primary bg-primary/5 shadow-sm"
                                    : "bg-card hover:border-primary/35 hover:bg-muted/20"
                            }`}
                        >
                            <div className="flex min-h-[112px] flex-col justify-between gap-4">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-medium">{section.label}</p>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                        {section.description}
                                    </p>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div> : null}

            <div className="rounded-2xl border bg-card p-4 sm:p-5 md:p-7">
                {activeSection === "operation" && (
                    <div className="mb-6 flex w-full max-w-xl border-b">
                        {([
                            { id: "operation", label: "Operación" },
                            { id: "portal", label: "Portal" },
                            { id: "brand", label: "Marca blanca" },
                        ] as const).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setOperationTab(tab.id)}
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
                                <h2 className="font-semibold">Modo de visualizacion</h2>
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
                    <div className="max-w-5xl space-y-5">
                        <div>
                            <h2 className="font-semibold">Marca blanca del CRM</h2>
                            <p className="text-sm text-muted-foreground">
                                Personaliza el nombre, logo y favicon que verá tu equipo en el CRM.
                            </p>
                        </div>

                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                            <div className="space-y-5">
                                <div className="rounded-2xl border bg-muted/10 p-4">
                                    <div className="space-y-2">
                                        <Label>Nombre del CRM</Label>
                                        <Input
                                            value={brandName}
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
                                                <img
                                                    src={brandFaviconUrl || DEFAULT_BRAND_FAVICON_URL}
                                                    alt="Favicon del CRM"
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

                                <Button onClick={handleSave} disabled={isSaving}>
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
                                        <img
                                            src={brandFaviconUrl || DEFAULT_BRAND_FAVICON_URL}
                                            alt=""
                                            className="h-5 w-5 object-contain"
                                        />
                                        <span className="truncate text-sm font-medium">
                                            {brandName || DEFAULT_BRAND_NAME}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeSection === "operation" && operationTab === "operation" && canAccess("settings.manage") && (
                    <div className="max-w-4xl space-y-5">
                        <div>
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
                                <Label>Zona horaria</Label>
                                <Input value={businessTimeZone} onChange={(event) => setBusinessTimeZone(event.target.value)} />
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

                        <div className="rounded-2xl border bg-background p-4">
                            <div>
                                <h2 className="font-semibold">Datos del negocio</h2>
                                <p className="text-sm text-muted-foreground">
                                    Información comercial usada en el portal, comprobantes e impresiones.
                                </p>
                            </div>

                            <div className="mt-4 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                                <div className="rounded-2xl border bg-background p-4">
                                    <Label>Logotipo</Label>
                                    <div className="mt-3 flex flex-col items-center gap-3">
                                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border bg-muted/35">
                                            {clinicLogoUrl ? (
                                                <img
                                                    src={clinicLogoUrl}
                                                    alt="Logotipo del negocio"
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
                                            <Slider
                                                value={[clinicLogoScale]}
                                                min={60}
                                                max={160}
                                                step={5}
                                                onValueChange={(value) => setClinicLogoScale(value[0] ?? 100)}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label>Nombre comercial</Label>
                                        <Input value={clinicName} onChange={(event) => setClinicName(event.target.value)} placeholder="Nombre del negocio" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Subtítulo / giro</Label>
                                        <Input value={clinicSubtitle} onChange={(event) => setClinicSubtitle(event.target.value)} placeholder="Salón, barbería, spa..." />
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>Dirección del negocio</Label>
                                        <Input value={clinicAddress} onChange={(event) => setClinicAddress(event.target.value)} placeholder="Dirección, teléfono, ciudad..." />
                                    </div>
                                </div>
                            </div>

                            <BusinessPolicyConfigurator
                                value={businessPolicies}
                                onChange={setBusinessPolicies}
                                agentName={agentName}
                                onAgentNameChange={setAgentName}
                                escalationPhone={escalationPhone}
                                onEscalationPhoneChange={setEscalationPhone}
                                canManageAi={canAccess("ai.manage")}
                            />

                            <div className="mt-5 rounded-2xl border bg-background p-4">
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
                        </div>

                        <div className="rounded-2xl border bg-background p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h2 className="flex items-center gap-2 font-semibold">
                                        <ReceiptText className="h-4 w-4 text-primary" />
                                        Caja, IVA y ticket
                                    </h2>
                                    <p className="text-sm text-muted-foreground">
                                        Define impuestos de productos y el formato base del ticket de punto de venta.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-2">
                                    <Switch checked={posTicketEnabled} onCheckedChange={setPosTicketEnabled} />
                                    <span className="text-sm font-medium">Ticket activo</span>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                                <div className="space-y-4">
                                    <div className="rounded-2xl border bg-background p-4">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <Label className="flex items-center gap-2 text-base">
                                                    <Percent className="h-4 w-4 text-primary" />
                                                    Productos con IVA
                                                </Label>
                                                <p className="mt-1 text-sm text-muted-foreground">
                                                    Cuando esta activo, presupuestos y tickets muestran subtotal, IVA y total.
                                                </p>
                                            </div>
                                            <Switch checked={posTaxEnabled} onCheckedChange={setPosTaxEnabled} />
                                        </div>
                                        {posTaxEnabled ? (
                                            <div className="mt-4 max-w-[180px] space-y-2">
                                                <Label>IVA (%)</Label>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={posTaxRate}
                                                    onChange={(event) => setPosTaxRate(Number(event.target.value || 0))}
                                                />
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label>Encabezado del ticket</Label>
                                            <Textarea
                                                rows={5}
                                                value={posTicketHeader}
                                                onChange={(event) => setPosTicketHeader(event.target.value)}
                                                placeholder="Nombre del negocio&#10;Direccion&#10;Telefono"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Pie del ticket</Label>
                                            <Textarea
                                                rows={5}
                                                value={posTicketFooter}
                                                onChange={(event) => setPosTicketFooter(event.target.value)}
                                                placeholder="Gracias por su compra&#10;Regrese pronto"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-2">
                                        <label className="flex items-center gap-3 rounded-2xl border bg-background p-4 text-sm">
                                            <Switch checked={posTicketShowUnitPrice} onCheckedChange={setPosTicketShowUnitPrice} />
                                            Incluir precio unitario
                                        </label>
                                        <label className="flex items-center gap-3 rounded-2xl border bg-background p-4 text-sm">
                                            <Switch checked={posTicketFullDescription} onCheckedChange={setPosTicketFullDescription} />
                                            Imprimir descripcion completa
                                        </label>
                                    </div>
                                </div>

                                <div className="rounded-2xl border bg-background p-4">
                                    <p className="mb-3 text-sm font-semibold">Vista previa</p>
                                    <div className="mx-auto max-w-[240px] rounded-lg border bg-white p-3 font-mono text-[11px] leading-5 text-slate-950 shadow-sm">
                                        {(posTicketHeader || "Zen CRM Oftalmo").split("\n").filter(Boolean).map((line, index) => (
                                            <p key={`header-${index}`} className={index === 0 ? "text-center font-bold uppercase" : "text-center"}>
                                                {line}
                                            </p>
                                        ))}
                                        <div className="my-2 border-t border-dashed" />
                                        <div className="flex justify-between">
                                            <span>1 Consulta</span>
                                            <span>$900.00</span>
                                        </div>
                                        {posTicketShowUnitPrice ? (
                                            <p className="text-slate-500">P.U. $900.00</p>
                                        ) : null}
                                        {posTaxEnabled ? (
                                            <>
                                                <div className="mt-2 flex justify-between">
                                                    <span>Subtotal</span>
                                                    <span>$900.00</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span>IVA {posTaxRate || 0}%</span>
                                                    <span>${(900 * ((Number(posTaxRate) || 0) / 100)).toFixed(2)}</span>
                                                </div>
                                            </>
                                        ) : null}
                                        <div className="my-2 border-t border-dashed" />
                                        <div className="flex justify-between text-sm font-bold">
                                            <span>Total</span>
                                            <span>${(900 * (1 + (posTaxEnabled ? (Number(posTaxRate) || 0) / 100 : 0))).toFixed(2)}</span>
                                        </div>
                                        <div className="my-2 border-t border-dashed" />
                                        {(posTicketFooter || "Gracias").split("\n").filter(Boolean).map((line, index) => (
                                            <p key={`footer-${index}`} className="text-center">{line}</p>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Guardar operacion
                        </Button>
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
                        <Button onClick={handleSave} disabled={isSaving}>
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
                    <UserAccessPanel currentUserId={currentUserId} />
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
                                                <button
                                                    key={sound.id}
                                                    onClick={() =>
                                                        setNotifPrefs((current) => ({ ...current, soundType: sound.id }))
                                                    }
                                                    className={`flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-4 text-left transition ${
                                                        notifPrefs.soundType === sound.id
                                                            ? "border-primary bg-primary/5"
                                                            : "bg-background/80 hover:border-primary/30"
                                                    }`}
                                                >
                                                    <div className="min-w-0 pr-4">
                                                        <p className="font-medium">{sound.name}</p>
                                                        <p className="mt-1 text-sm text-muted-foreground">
                                                            {sound.description}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            playNotificationSound(sound.id, notifPrefs.volume);
                                                        }}
                                                        title={`Probar sonido ${sound.name}`}
                                                    >
                                                        <Play className="h-4 w-4" />
                                                    </Button>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="space-y-3 rounded-xl border bg-background/80 px-4 py-4">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <Label>Volumen</Label>
                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Ajusta la intensidad antes de guardar.
                                                    </p>
                                                </div>
                                                <span className="text-sm font-medium text-muted-foreground">
                                                    {Math.round(notifPrefs.volume * 100)}%
                                                </span>
                                            </div>
                                            <Slider
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
            </div>
        </div>
    );
}

export default function SettingsPage() {
    return <SettingsWorkspace />;
}
