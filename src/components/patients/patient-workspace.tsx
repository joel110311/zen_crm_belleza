"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    Calendar,
    CalendarClock,
    CalendarPlus,
    Check,
    CheckCircle2,
    ClipboardList,
    DollarSign,
    Edit2,
    Eye,
    File as FileIcon,
    FileText,
    FlaskConical,
    HeartPulse,
    Loader2,
    Mic,
    MoreVertical,
    Phone,
    Pill,
    Plus,
    Printer,
    RefreshCw,
    Save,
    Search,
    Send,
    Sparkles,
    Square,
    Settings,
    Stethoscope,
    Trash2,
    Upload,
    User,
    X,
    XCircle,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { AppointmentDialog } from "@/components/calendar/appointment-dialog";
import { PhonePrefixInput } from "@/components/shared/phone-prefix-input";
import { useOperationContext } from "@/components/shared/use-operation-context";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import {
    addBudgetPayment,
    deleteBudget,
    deleteClinicalAnalysis,
    deletePatient,
    getPatientWorkspace,
    preparePatientChat,
    saveBudget,
    saveClinicalAnalysis,
    saveConsultation,
    saveEvolutionNote,
    savePatient,
    savePatientHistory,
    summarizeConsultationTranscript,
    updateBudgetStatus,
} from "@/app/actions/patients";
import { createAppointment, updateAppointmentStatus } from "@/app/actions/calendar";
import { normalizeBusinessHours, shiftDateKey } from "@/lib/calendar/business-hours";
import { INBOX_DRAFT_STORAGE_KEY, type InboxDraftPayload } from "@/lib/inbox-drafts";
import {
    DEFAULT_OPERATION_TIME_ZONE,
    dateToOperationInputValue,
    formatDateInOperationZone,
    formatDateTimeInOperationZone,
    getOperationTodayKey,
    operationDateTimeToUtc,
    timeToOperationInputValue,
} from "@/lib/operation-dates";
import { TREATMENT_CATALOG, type ClinicalService } from "@/lib/clinical-services";
import { cn } from "@/lib/utils";

type PatientWorkspacePayload = Awaited<ReturnType<typeof getPatientWorkspace>>;
type PatientSummary = PatientWorkspacePayload["patients"][number];
type PatientDetail = NonNullable<PatientWorkspacePayload["selectedPatient"]>;
type Consultation = PatientDetail["consultations"][number];
type Budget = PatientDetail["budgets"][number];
type ClinicalAnalysis = PatientDetail["clinicalAnalyses"][number];
type PatientQuickAction = "whatsapp" | "confirm" | "reschedule" | "notify" | "attended" | "canceled";
type PatientActionTarget = Pick<PatientSummary, "id" | "firstName" | "lastName" | "phone"> & {
    appointments?: Array<{
        id: string;
        startTime: Date | string;
        endTime: Date | string;
        status: string;
        confirmationStatus: string;
    }>;
};
type RescheduleFormState = {
    patient: PatientActionTarget | null;
    date: string;
    time: string;
    duration: string;
    reason: string;
};

type PatientFormState = {
    id?: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    address: string;
    dob: string;
    sex: string;
    idType: string;
    idNumber: string;
};

type Medication = {
    name: string;
    dose: string;
    frequency: string;
    duration: string;
};

type RecipeContentDraft = {
    medications: Medication[];
    indications: string;
    diagnosis: string;
};

type ConsultationFormState = {
    appointmentId: string;
    chiefComplaint: string;
    notes: string;
    diagnosis: string;
    treatmentPlan: string;
    doctorName: string;
    clinicName: string;
    vitalSigns: {
        systolic: string;
        diastolic: string;
        heartRate: string;
        temperature: string;
        spO2: string;
        weight: string;
        height: string;
    };
    medications: Medication[];
    opticalPrescription: {
        odSphere: string;
        odCylinder: string;
        odAxis: string;
        odAdd: string;
        odDp: string;
        oiSphere: string;
        oiCylinder: string;
        oiAxis: string;
        oiAdd: string;
        oiDp: string;
        lensType: string;
        observations: string;
    };
    glaucoma: {
        pioOd: string;
        pioOi: string;
        cupOd: string;
        cupOi: string;
        visualField: string;
        octNerve: string;
        currentTreatment: string;
        nextControl: string;
    };
    retina: {
        fundus: string;
        diabeticRetinopathy: string;
        macularOct: string;
        procedures: string;
        nextControl: string;
    };
    surgery: {
        type: string;
        consentSigned: boolean;
        checklist: string;
        preopStudies: string;
        postopFollowup: string;
    };
    education: {
        article: string;
        preStudyInstructions: string;
        postStudyInstructions: string;
        automaticMessage: string;
    };
};

type OpticalPrescriptionDraft = ConsultationFormState["opticalPrescription"];

type FilePayload = {
    id: string;
    name: string;
    type: string;
    size: number;
    data: string;
    rotation?: number;
};

type RecipePaperSizeId = "media-carta" | "carta";
type RecipeElementKey = "patientName" | "date" | "patientAge" | "medications" | "diagnosis" | "indications";

type RecipeLayoutElement = {
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    bold: boolean;
    visible: boolean;
    label: string;
};

type RecipeLayoutSettings = {
    enabled: boolean;
    paperSize: RecipePaperSizeId;
    backgroundImage?: string | null;
    elements: Record<RecipeElementKey, RecipeLayoutElement>;
};

const RECIPE_LAYOUT_STORAGE_KEY = "zen-crm-oftalmo-recipe-layout";

type ClinicPrescriptionProfile = {
    clinicName: string;
    clinicSubtitle: string;
    clinicAddress: string;
    clinicLogoUrl: string;
    clinicLogoScale: number;
    doctorName: string;
    doctorTitle: string;
    doctorProfessionalLicense: string;
};

const DEFAULT_CLINIC_PRESCRIPTION_PROFILE: ClinicPrescriptionProfile = {
    clinicName: "Zen CRM Oftalmo",
    clinicSubtitle: "Clinica oftalmologica",
    clinicAddress: "Direccion de la clinica",
    clinicLogoUrl: "",
    clinicLogoScale: 100,
    doctorName: "Joel Venegas",
    doctorTitle: "Medico Oftalmologo",
    doctorProfessionalLicense: "",
};

const RECIPE_PAPER_SIZES: Record<RecipePaperSizeId, { label: string; widthPx: number; heightPx: number; widthCm: number; heightCm: number; widthPt: number; heightPt: number }> = {
    "media-carta": {
        label: "Media Carta",
        widthPx: 528,
        heightPx: 816,
        widthCm: 14,
        heightCm: 21.59,
        widthPt: 396.85,
        heightPt: 612,
    },
    carta: {
        label: "Carta",
        widthPx: 816,
        heightPx: 1056,
        widthCm: 21.59,
        heightCm: 27.94,
        widthPt: 612,
        heightPt: 792,
    },
};

const RECIPE_ELEMENT_COLORS: Record<RecipeElementKey, string> = {
    patientName: "#3b82f6",
    date: "#f59e0b",
    patientAge: "#8b5cf6",
    medications: "#ef4444",
    diagnosis: "#06b6d4",
    indications: "#ec4899",
};

const DEFAULT_RECIPE_LAYOUT: RecipeLayoutSettings = {
    enabled: true,
    paperSize: "media-carta",
    backgroundImage: null,
    elements: {
        patientName: { x: 38, y: 126, width: 360, height: 25, fontSize: 9, bold: true, visible: true, label: "Nombre del Paciente" },
        date: { x: 338, y: 154, width: 140, height: 22, fontSize: 9, bold: true, visible: true, label: "Fecha" },
        patientAge: { x: 38, y: 154, width: 120, height: 22, fontSize: 9, bold: true, visible: true, label: "Edad" },
        medications: { x: 38, y: 190, width: 452, height: 92, fontSize: 9, bold: false, visible: true, label: "Medicamentos" },
        diagnosis: { x: 38, y: 345, width: 420, height: 34, fontSize: 10, bold: false, visible: true, label: "Diagnostico" },
        indications: { x: 38, y: 400, width: 452, height: 68, fontSize: 10, bold: false, visible: true, label: "Indicaciones" },
    },
};

const PATIENT_TABS = [
    { id: "overview", label: "Datos Personales", icon: User },
    { id: "history", label: "Antecedentes", icon: HeartPulse },
    { id: "consultations", label: "Historial Consultas", icon: ClipboardList },
    { id: "optical", label: "Receta optica", icon: Eye },
    { id: "consultation", label: "Nueva Consulta", icon: Stethoscope },
    { id: "budgets", label: "Presupuestos", icon: DollarSign },
    { id: "analysis", label: "Analisis Clinicos", icon: FlaskConical },
    { id: "full-history", label: "Historia Completa", icon: Printer },
] as const;

type PatientTabId = typeof PATIENT_TABS[number]["id"];

const CONSULTATION_TABS = [
    { id: "consulta", label: "Consulta", icon: FileText },
    { id: "glaucoma", label: "Glaucoma", icon: HeartPulse },
    { id: "retina", label: "Retina/Diabetes", icon: Eye },
    { id: "cirugia", label: "Cirugia", icon: ClipboardList },
    { id: "diagnostico", label: "Diagnostico", icon: Stethoscope },
    { id: "tratamiento", label: "Tratamiento", icon: Pill },
    { id: "estudios", label: "Estudios", icon: FlaskConical },
    { id: "educacion", label: "Educacion", icon: FileText },
] as const;

const ID_TYPES = [
    ["INE", "INE/IFE"],
    ["CURP", "CURP"],
    ["PASAPORTE", "Pasaporte"],
    ["CEDULA_PROFESIONAL", "Cedula profesional"],
    ["LICENCIA_CONDUCIR", "Licencia de conducir"],
    ["OTRO", "Otro"],
];

const DIAGNOSIS_CATALOG = [
    "Z01.0 - Examen de ojos y vision",
    "H52.0 - Hipermetropia",
    "H52.1 - Miopia",
    "H52.2 - Astigmatismo",
    "H52.4 - Presbicia",
    "H25.9 - Catarata senil, no especificada",
    "H40.9 - Glaucoma, no especificado",
    "H10.9 - Conjuntivitis, no especificada",
    "H04.1 - Otros trastornos de la glandula lagrimal / ojo seco",
    "H11.0 - Pterigion",
    "H16.9 - Queratitis, no especificada",
    "H35.3 - Degeneracion de la macula y polo posterior",
    "E11.3 - Diabetes mellitus con complicaciones oftalmicas",
    "H33.0 - Desprendimiento de retina con ruptura",
    "H35.0 - Retinopatias de fondo y cambios vasculares retinianos",
    "Z96.1 - Presencia de lente intraocular",
];

const LAB_STUDIES_CATALOG = [
    { id: "oct_macula", name: "OCT macular", category: "Retina" },
    { id: "oct_nervio", name: "OCT de nervio optico / RNFL", category: "Glaucoma" },
    { id: "campo_visual", name: "Campo visual computarizado", category: "Glaucoma" },
    { id: "retinografia", name: "Retinografia / fotografia de fondo", category: "Retina" },
    { id: "fondo_ojo", name: "Fondo de ojo bajo dilatacion", category: "Retina" },
    { id: "topografia", name: "Topografia corneal", category: "Cornea" },
    { id: "paquimetria", name: "Paquimetria corneal", category: "Cornea" },
    { id: "biometria", name: "Biometria ocular", category: "Cirugia" },
    { id: "microscopia", name: "Microscopia especular", category: "Cornea" },
    { id: "tonometria", name: "Tonometria / curva tensional", category: "Glaucoma" },
    { id: "gonioscopia", name: "Gonioscopia", category: "Glaucoma" },
    { id: "usg", name: "Ultrasonido ocular", category: "Imagen" },
    { id: "angiografia", name: "Angiografia fluoresceinica", category: "Retina" },
    { id: "bh", name: "Biometria hematica preoperatoria", category: "Prequirurgico" },
    { id: "qs", name: "Quimica sanguinea preoperatoria", category: "Prequirurgico" },
    { id: "ekg", name: "Electrocardiograma preoperatorio", category: "Prequirurgico" },
];

function patientName(patient?: { firstName?: string | null; lastName?: string | null } | null) {
    return [patient?.firstName, patient?.lastName].filter(Boolean).join(" ") || "Paciente";
}

function initials(patient?: { firstName?: string | null; lastName?: string | null } | null) {
    return `${patient?.firstName?.[0] || ""}${patient?.lastName?.[0] || ""}`.toUpperCase() || "P";
}

const CLINIC_TIME_ZONE = DEFAULT_OPERATION_TIME_ZONE;

type OperationFormatOptions = {
    locale?: string;
    timeZone?: string;
};

function resolveOperationFormat(options?: OperationFormatOptions) {
    return {
        locale: options?.locale || "es-MX",
        timeZone: options?.timeZone || CLINIC_TIME_ZONE,
    };
}

function dateInputValue(value?: Date | string | null, timeZone = CLINIC_TIME_ZONE) {
    if (!value) return "";
    return dateToOperationInputValue(value, timeZone);
}

function formatDate(value?: Date | string | null, fallback = "-", locale = "es-MX", timeZone = CLINIC_TIME_ZONE) {
    if (!value) return fallback;
    return formatDateInOperationZone(value, locale, timeZone, {
        day: "numeric",
        month: "long",
        year: "numeric",
    }) || fallback;
}

function formatDateTime(value?: Date | string | null, fallback = "-", locale = "es-MX", timeZone = CLINIC_TIME_ZONE) {
    if (!value) return fallback;
    return formatDateTimeInOperationZone(value, locale, timeZone, {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }) || fallback;
}

function calculateAge(value?: Date | string | null, timeZone = CLINIC_TIME_ZONE) {
    if (!value) return null;
    const dobKey = dateToOperationInputValue(value, timeZone);
    if (!dobKey) return null;
    const todayKey = getOperationTodayKey(timeZone);
    const [dobYear, dobMonth, dobDay] = dobKey.split("-").map(Number);
    const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
    if ([dobYear, dobMonth, dobDay, todayYear, todayMonth, todayDay].some((part) => Number.isNaN(part))) {
        return null;
    }
    let age = todayYear - dobYear;
    const monthDiff = todayMonth - dobMonth;
    if (monthDiff < 0 || (monthDiff === 0 && todayDay < dobDay)) {
        age -= 1;
    }
    return Math.max(0, age);
}

function ageLabel(value?: Date | string | null, timeZone = CLINIC_TIME_ZONE, fallback = "Edad no registrada") {
    const age = calculateAge(value, timeZone);
    if (age === null) return fallback;
    if (age === 0) return "Menor de 1 año";
    return age === 1 ? "1 año" : `${age} años`;
}

function money(value?: number | null, currency = "MXN", locale = "es-MX") {
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
    }).format(Number(value || 0));
}

function asArray<T = any>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function clampLogoScale(value: unknown) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_CLINIC_PRESCRIPTION_PROFILE.clinicLogoScale;
    return Math.max(50, Math.min(180, numeric));
}

function normalizeClinicPrescriptionProfile(value: unknown): ClinicPrescriptionProfile {
    const record = asRecord(value);
    return {
        clinicName: String(record.clinicName || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.clinicName),
        clinicSubtitle: String(record.clinicSubtitle || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.clinicSubtitle),
        clinicAddress: String(record.clinicAddress || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.clinicAddress),
        clinicLogoUrl: String(record.clinicLogoUrl || ""),
        clinicLogoScale: clampLogoScale(record.clinicLogoScale),
        doctorName: String(record.doctorName || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.doctorName),
        doctorTitle: String(record.doctorTitle || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.doctorTitle),
        doctorProfessionalLicense: String(record.doctorProfessionalLicense || ""),
    };
}

function resolveConsultationProfessional(consultation: Consultation, profile: ClinicPrescriptionProfile) {
    const specialist = consultation.specialist || consultation.appointment?.specialist || null;
    const specialistName = specialist ? (specialist.displayName || specialist.name) : "";
    const specialistTitle = specialist ? (specialist.professionalTitle || specialist.specialty || "") : "";
    const specialistLicense = specialist?.professionalLicense || "";

    return {
        doctorName: specialistName || consultation.doctorName || profile.doctorName || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.doctorName,
        doctorTitle: consultation.professionalTitle || specialistTitle || profile.doctorTitle || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.doctorTitle,
        doctorProfessionalLicense: consultation.professionalLicense || specialistLicense || profile.doctorProfessionalLicense || "",
    };
}

function useClinicPrescriptionProfile() {
    const [profile, setProfile] = useState<ClinicPrescriptionProfile>(DEFAULT_CLINIC_PRESCRIPTION_PROFILE);

    useEffect(() => {
        let active = true;
        fetch("/api/operation-context", { cache: "no-store" })
            .then((response) => response.ok ? response.json() : null)
            .then((settings) => {
                if (active && settings) {
                    setProfile(normalizeClinicPrescriptionProfile(settings));
                }
            })
            .catch((error) => {
                console.error("Failed to load clinic prescription profile:", error);
            });
        return () => {
            active = false;
        };
    }, []);

    return profile;
}

function cloneRecipeLayout(layout: RecipeLayoutSettings = DEFAULT_RECIPE_LAYOUT): RecipeLayoutSettings {
    return {
        enabled: layout.enabled,
        paperSize: layout.paperSize,
        backgroundImage: layout.backgroundImage || null,
        elements: Object.fromEntries(
            Object.entries(layout.elements).map(([key, value]) => [key, { ...value }]),
        ) as Record<RecipeElementKey, RecipeLayoutElement>,
    };
}

function normalizeRecipeLayout(value: unknown): RecipeLayoutSettings {
    const record = asRecord(value);
    const paperSize = record.paperSize === "carta" ? "carta" : "media-carta";
    const elementsRecord = asRecord(record.elements);
    const defaults = cloneRecipeLayout(DEFAULT_RECIPE_LAYOUT);

    for (const key of Object.keys(defaults.elements) as RecipeElementKey[]) {
        const incoming = asRecord(elementsRecord[key]);
        defaults.elements[key] = {
            ...defaults.elements[key],
            ...incoming,
            x: Number.isFinite(Number(incoming.x)) ? Number(incoming.x) : defaults.elements[key].x,
            y: Number.isFinite(Number(incoming.y)) ? Number(incoming.y) : defaults.elements[key].y,
            width: Number.isFinite(Number(incoming.width)) ? Number(incoming.width) : defaults.elements[key].width,
            height: Number.isFinite(Number(incoming.height)) ? Number(incoming.height) : defaults.elements[key].height,
            fontSize: Number.isFinite(Number(incoming.fontSize)) ? Number(incoming.fontSize) : defaults.elements[key].fontSize,
            bold: typeof incoming.bold === "boolean" ? incoming.bold : defaults.elements[key].bold,
            visible: typeof incoming.visible === "boolean" ? incoming.visible : defaults.elements[key].visible,
            label: typeof incoming.label === "string" ? incoming.label : defaults.elements[key].label,
        };
    }

    return {
        enabled: typeof record.enabled === "boolean" ? record.enabled : defaults.enabled,
        paperSize,
        backgroundImage: typeof record.backgroundImage === "string" ? record.backgroundImage : null,
        elements: defaults.elements,
    };
}

function loadRecipeLayout() {
    if (typeof window === "undefined") return cloneRecipeLayout(DEFAULT_RECIPE_LAYOUT);
    const raw = window.localStorage.getItem(RECIPE_LAYOUT_STORAGE_KEY);
    if (!raw) return cloneRecipeLayout(DEFAULT_RECIPE_LAYOUT);

    try {
        return normalizeRecipeLayout(JSON.parse(raw));
    } catch {
        return cloneRecipeLayout(DEFAULT_RECIPE_LAYOUT);
    }
}

function saveRecipeLayout(layout: RecipeLayoutSettings) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RECIPE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

function defaultPatientForm(patient?: PatientDetail | null, timeZone = CLINIC_TIME_ZONE): PatientFormState {
    return {
        id: patient?.id,
        firstName: patient?.firstName || "",
        lastName: patient?.lastName || "",
        phone: patient?.phone || "",
        email: patient?.email || "",
        address: patient?.address || "",
        dob: dateInputValue(patient?.dob, timeZone),
        sex: patient?.sex || "",
        idType: patient?.idType || "",
        idNumber: patient?.idNumber || "",
    };
}

function defaultConsultationForm(parent?: Consultation | null): ConsultationFormState {
    return {
        appointmentId: "",
        chiefComplaint: parent?.diagnosis ? `Seguimiento a diagnostico: ${parent.diagnosis}` : "",
        notes: "",
        diagnosis: "",
        treatmentPlan: "",
        doctorName: "Joel Venegas",
        clinicName: "Zen CRM Oftalmo",
        vitalSigns: {
            systolic: "",
            diastolic: "",
            heartRate: "",
            temperature: "",
            spO2: "",
            weight: "",
            height: "",
        },
        medications: [{ name: "", dose: "", frequency: "", duration: "" }],
        opticalPrescription: {
            odSphere: "",
            odCylinder: "",
            odAxis: "",
            odAdd: "",
            odDp: "",
            oiSphere: "",
            oiCylinder: "",
            oiAxis: "",
            oiAdd: "",
            oiDp: "",
            lensType: "",
            observations: "",
        },
        glaucoma: {
            pioOd: "",
            pioOi: "",
            cupOd: "",
            cupOi: "",
            visualField: "",
            octNerve: "",
            currentTreatment: "",
            nextControl: "",
        },
        retina: {
            fundus: "",
            diabeticRetinopathy: "",
            macularOct: "",
            procedures: "",
            nextControl: "",
        },
        surgery: {
            type: "",
            consentSigned: false,
            checklist: "",
            preopStudies: "",
            postopFollowup: "",
        },
        education: {
            article: "",
            preStudyInstructions: "",
            postStudyInstructions: "",
            automaticMessage: "",
        },
    };
}

function getLocalDateString(timeZone = CLINIC_TIME_ZONE) {
    return getOperationTodayKey(timeZone);
}

function getConsultationStudyRequests(consultation: Consultation) {
    return asArray<{ studies?: string[]; customStudies?: string; date?: string }>(consultation.studyRequests);
}

function getBudgetItems(budget: Budget) {
    return asArray<{ name?: string; description?: string; code?: string; quantity?: number; unitPrice?: number; price?: number }>(budget.items);
}

function getBudgetPayments(budget: Budget) {
    return asArray<{ id?: string; amount?: number; method?: string; date?: string }>(budget.payments);
}

function getBudgetCurrency(budget: Budget, fallback = "MXN") {
    const plan = asRecord(budget.plan);
    const currency = String(plan.currency || fallback || "MXN").trim().toUpperCase();
    return currency || "MXN";
}

function statusLabel(status?: string | null) {
    const value = status || "pending";
    const map: Record<string, string> = {
        pending: "Pendiente",
        accepted: "Aceptado",
        rejected: "Rechazado",
        paid: "Pagado",
        partial: "Parcial",
        draft: "Borrador",
    };
    return map[value] || value;
}

function statusClass(status?: string | null) {
    switch (status) {
        case "accepted":
            return "bg-emerald-100 text-emerald-700 border-emerald-200";
        case "rejected":
            return "bg-red-100 text-red-700 border-red-200";
        case "paid":
            return "bg-blue-100 text-blue-700 border-blue-200";
        case "partial":
            return "bg-orange-100 text-orange-700 border-orange-200";
        default:
            return "bg-amber-100 text-amber-700 border-amber-200";
    }
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
    return (
        <div className="flex items-center justify-between gap-4 border-b border-border/70 py-2 text-sm last:border-0">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-semibold text-foreground">{value || "-"}</span>
        </div>
    );
}

function openPrintWindow(title: string, html: string) {
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>${title}</title><style>
        body{font-family:Inter,"Segoe UI",Arial,sans-serif;background:#f1f5f9;margin:0;color:#0f172a}
        .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e2e8f0;padding:12px 16px;display:flex;justify-content:space-between;gap:8px}
        button{border:1px solid #cbd5e1;border-radius:999px;background:#fff;padding:8px 14px;font-weight:700;cursor:pointer}
        .page{width:21.59cm;min-height:27.94cm;margin:24px auto;background:#fff;box-shadow:0 16px 48px rgba(15,23,42,.12);padding:1.5cm;box-sizing:border-box}
        .half{width:14cm;min-height:21.59cm}
        h1,h2,h3{margin:0}
        table{width:100%;border-collapse:collapse}
        td,th{border:1px solid #e2e8f0;padding:8px;text-align:left}
        .muted{color:#64748b}
        .section{margin-top:22px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .line{border-bottom:3px solid #2563eb;margin:8px 0 12px}
        @media print{body{background:#fff}.toolbar{display:none}.page{box-shadow:none;margin:0}@page{size:letter;margin:0}}
    </style></head><body><div class="toolbar"><button onclick="window.close()">Volver</button><button onclick="window.print()">Imprimir</button></div>${html}</body></html>`);
    win.document.close();
    win.focus();
}

function escapeHtml(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function htmlLines(value: unknown, fallback = "-") {
    const text = String(value ?? "").trim() || fallback;
    return escapeHtml(text).replace(/\n/g, "<br>");
}

function buildDocumentFileName(
    prefix: string,
    patient: PatientDetail,
    createdAt: Date | string | null | undefined,
    options?: OperationFormatOptions,
) {
    const { timeZone } = resolveOperationFormat(options);
    const name = patientName(patient)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "paciente";
    const datePart = dateInputValue(createdAt, timeZone) || getLocalDateString(timeZone);
    return `${prefix}-${name}-${datePart}.pdf`;
}

async function uploadPdfBlob(blob: Blob, fileName: string) {
    const file = new File([blob], fileName, { type: "application/pdf" });
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload", { method: "POST", body: formData });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo cargar el PDF.");
    }

    return result as {
        success: true;
        url: string;
        fileName: string;
        mimeType: string;
        mediaCategory: "document";
    };
}

async function createRecipePdfBlobFromElement(element: HTMLElement, paperSizeId: RecipePaperSizeId) {
    const [{ toPng }, { jsPDF }] = await Promise.all([
        import("html-to-image"),
        import("jspdf"),
    ]);
    const paper = RECIPE_PAPER_SIZES[paperSizeId];
    const dataUrl = await toPng(element, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
    });
    const doc = new jsPDF({ unit: "pt", format: [paper.widthPt, paper.heightPt] });
    doc.addImage(dataUrl, "PNG", 0, 0, paper.widthPt, paper.heightPt);
    return doc.output("blob") as Blob;
}

async function prepareRecipeDraftForChat(
    patient: PatientDetail,
    consultation: Consultation,
    pdfBlob: Blob,
    options?: OperationFormatOptions,
) {
    const { locale, timeZone } = resolveOperationFormat(options);
    if (!patient.phone) {
        throw new Error("El paciente no tiene telefono registrado.");
    }

    const fileName = buildDocumentFileName("receta", patient, consultation.createdAt, { locale, timeZone });
    const uploadResult = await uploadPdfBlob(pdfBlob, fileName);
    const chatResult = await preparePatientChat(patient.id);
    if (!chatResult.success || !chatResult.conversationId) {
        throw new Error(chatResult.error || "No se pudo abrir el chat del paciente.");
    }

    const caption = `Hola ${patientName(patient)}, te compartimos tu receta del ${formatDate(consultation.createdAt, "-", locale, timeZone)}.`;
    const draft: InboxDraftPayload = {
        conversationId: chatResult.conversationId,
        content: caption,
        mediaUrl: uploadResult.url,
        fileName: uploadResult.fileName || fileName,
        mimeType: uploadResult.mimeType || "application/pdf",
        mediaCategory: "document",
        createdAt: new Date().toISOString(),
        source: "patient-prescription",
    };

    window.sessionStorage.setItem(INBOX_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return chatResult.conversationId;
}

function getOpticalPrescription(consultation: Consultation) {
    return asRecord(asRecord(consultation.studies).opticalPrescription);
}

const OPTICAL_PRESCRIPTION_KEYS: Array<keyof OpticalPrescriptionDraft> = [
    "odSphere",
    "odCylinder",
    "odAxis",
    "odAdd",
    "odDp",
    "oiSphere",
    "oiCylinder",
    "oiAxis",
    "oiAdd",
    "oiDp",
    "lensType",
    "observations",
];

function hasOpticalPrescriptionDraft(optical: Partial<Record<keyof OpticalPrescriptionDraft, unknown>>) {
    return OPTICAL_PRESCRIPTION_KEYS.some((key) => String(optical[key] || "").trim());
}

function hasOpticalPrescription(consultation: Consultation) {
    return hasOpticalPrescriptionDraft(getOpticalPrescription(consultation) as Partial<Record<keyof OpticalPrescriptionDraft, unknown>>);
}

function opticalPrescriptionFromConsultation(consultation?: Consultation | null): OpticalPrescriptionDraft {
    const optical = consultation ? getOpticalPrescription(consultation) : {};
    return {
        odSphere: String(optical.odSphere || ""),
        odCylinder: String(optical.odCylinder || ""),
        odAxis: String(optical.odAxis || ""),
        odAdd: String(optical.odAdd || ""),
        odDp: String(optical.odDp || ""),
        oiSphere: String(optical.oiSphere || ""),
        oiCylinder: String(optical.oiCylinder || ""),
        oiAxis: String(optical.oiAxis || ""),
        oiAdd: String(optical.oiAdd || ""),
        oiDp: String(optical.oiDp || ""),
        lensType: String(optical.lensType || ""),
        observations: String(optical.observations || ""),
    };
}

function latestOpticalPrescription(patient: PatientDetail) {
    return patient.consultations.find((consultation) => hasOpticalPrescription(consultation)) || null;
}

function consultationDisplayTitle(consultation: Consultation) {
    return consultation.type === "optical_prescription" ? "Receta optica" : "Consulta clinica";
}

function printStudyRequest(
    patient: PatientDetail,
    request: { studies?: string[]; customStudies?: string; date?: string },
    options?: OperationFormatOptions,
) {
    const { locale, timeZone } = resolveOperationFormat(options);
    const studies = request.studies || [];
    openPrintWindow("Solicitud de estudios", `
        <main class="page half">
            <header>
                <div class="grid">
                    <div>
                        <h2>Zen CRM Oftalmo</h2>
                        <p class="muted">Solicitud de estudios de laboratorio</p>
                    </div>
                    <div style="text-align:right">
                        <strong>Joel Venegas</strong>
                        <p class="muted">Fecha: ${formatDate(request.date || new Date(), "-", locale, timeZone)}</p>
                    </div>
                </div>
                <div class="line"></div>
            </header>
            <section>
                <p><span class="muted">Paciente:</span> <strong>${patientName(patient)}</strong></p>
                <p><span class="muted">Edad:</span> <strong>${ageLabel(patient.dob, timeZone, "-")}</strong></p>
            </section>
            <section class="section">
                <h3>Estudios solicitados</h3>
                ${studies.map((study) => `<p>- ${study}</p>`).join("")}
                ${request.customStudies ? `<p><strong>Adicionales:</strong> ${request.customStudies}</p>` : ""}
            </section>
        </main>
    `);
}

function printBudget(patient: PatientDetail, budget: Budget, options?: OperationFormatOptions) {
    const { locale, timeZone } = resolveOperationFormat(options);
    const items = getBudgetItems(budget);
    const plan = asRecord(budget.plan);
    const currency = getBudgetCurrency(budget);
    openPrintWindow("Presupuesto", `
        <main class="page">
            <header>
                <div class="grid">
                    <div>
                        <h1>Propuesta de Presupuesto</h1>
                        <p class="muted">Zen CRM Oftalmo</p>
                    </div>
                    <div style="text-align:right">
                        <strong>${patientName(patient)}</strong>
                        <p class="muted">${formatDate(budget.createdAt, "-", locale, timeZone)}</p>
                    </div>
                </div>
                <div class="line"></div>
            </header>
            <section class="section">
                <table>
                    <thead><tr><th>Codigo</th><th>Tratamiento</th><th>Cantidad</th><th>Precio</th></tr></thead>
                    <tbody>
                        ${items.map((item) => `<tr><td>${item.code || "-"}</td><td>${item.name || item.description || "-"}</td><td>${item.quantity || 1}</td><td>${money(item.unitPrice ?? item.price, currency)}</td></tr>`).join("")}
                    </tbody>
                </table>
            </section>
            <section class="section" style="text-align:right">
                <p>Subtotal: ${money(budget.subtotal, currency)}</p>
                <p>Descuento: ${money(budget.discount, currency)}</p>
                <h2>Total: ${money(budget.total, currency)}</h2>
                <p class="muted">Plan: ${plan.type || "Contado"}</p>
            </section>
        </main>
    `);
}

function printFullHistory(patient: PatientDetail, options?: OperationFormatOptions) {
    const { locale, timeZone } = resolveOperationFormat(options);
    const results = patient.clinicalAnalyses.filter((item) => item.kind !== "request");
    openPrintWindow("Historia clinica", `
        <main class="page">
            <header style="text-align:center">
                <h1>Historia Clinica</h1>
                <p class="muted">Zen CRM Oftalmo</p>
            </header>
            <section class="section">
                <h2>Datos del Paciente</h2>
                <div class="grid">
                    <div>
                        <p><strong>Nombre:</strong> ${patientName(patient)}</p>
                        <p><strong>No. Paciente:</strong> ${patient.patientNumber}</p>
                        <p><strong>Fecha Nacimiento:</strong> ${formatDate(patient.dob, "-", locale, timeZone)}</p>
                        <p><strong>Direccion:</strong> ${patient.address || "-"}</p>
                    </div>
                    <div>
                        <p><strong>Telefono:</strong> ${patient.phone || "-"}</p>
                        <p><strong>Email:</strong> ${patient.email || "-"}</p>
                        <p><strong>Sexo:</strong> ${patient.sex || "-"}</p>
                    </div>
                </div>
            </section>
            <section class="section">
                <h2>Antecedentes</h2>
                <p><strong>Alergias:</strong> ${patient.allergies || "-"}</p>
                <p><strong>Patologicos:</strong> ${(patient.pathologicalHistory || "-").replace(/\n/g, "<br>")}</p>
                <p><strong>No patologicos:</strong> ${(patient.nonPathologicalHistory || "-").replace(/\n/g, "<br>")}</p>
            </section>
            <section class="section">
                <h2>Historial de Consultas</h2>
                ${patient.consultations.length ? patient.consultations.map((consultation, index) => `
                    <div style="border-bottom:1px solid #e2e8f0;padding:14px 0">
                        <strong>Consulta #${patient.consultations.length - index}</strong>
                        <p class="muted">${formatDateTime(consultation.createdAt, "-", locale, timeZone)}</p>
                        <p><strong>Motivo:</strong> ${consultation.chiefComplaint}</p>
                        <p><strong>Diagnostico:</strong> ${consultation.diagnosis || "-"}</p>
                        <p><strong>Tratamiento:</strong> ${(consultation.treatmentPlan || "-").replace(/\n/g, "<br>")}</p>
                        ${(() => {
                            const studies = asRecord(consultation.studies);
                            const optical = asRecord(studies.opticalPrescription);
                            const glaucoma = asRecord(studies.glaucoma);
                            const retina = asRecord(studies.retina);
                            const surgery = asRecord(studies.surgery);
                            const blocks: string[] = [];
                            if (hasOpticalPrescription(consultation)) {
                                blocks.push(`<p><strong>Receta optica:</strong><br>OD esf ${optical.odSphere || "-"} cil ${optical.odCylinder || "-"} eje ${optical.odAxis || "-"} ADD ${optical.odAdd || "-"} DP ${optical.odDp || "-"}<br>OI esf ${optical.oiSphere || "-"} cil ${optical.oiCylinder || "-"} eje ${optical.oiAxis || "-"} ADD ${optical.oiAdd || "-"} DP ${optical.oiDp || "-"}<br>Lente: ${optical.lensType || "-"}</p>`);
                            }
                            if ([glaucoma.pioOd, glaucoma.pioOi, glaucoma.visualField, glaucoma.octNerve].some((value) => String(value || "").trim())) {
                                blocks.push(`<p><strong>Glaucoma:</strong><br>PIO OD/OI ${glaucoma.pioOd || "-"}/${glaucoma.pioOi || "-"} mmHg. Excavacion OD/OI ${glaucoma.cupOd || "-"}/${glaucoma.cupOi || "-"}.</p>`);
                            }
                            if ([retina.fundus, retina.diabeticRetinopathy, retina.macularOct, retina.procedures].some((value) => String(value || "").trim())) {
                                blocks.push(`<p><strong>Retina/Diabetes:</strong><br>${[retina.fundus, retina.diabeticRetinopathy, retina.macularOct, retina.procedures].filter(Boolean).join("<br>")}</p>`);
                            }
                            if ([surgery.type, surgery.checklist, surgery.preopStudies, surgery.postopFollowup].some((value) => String(value || "").trim()) || surgery.consentSigned) {
                                blocks.push(`<p><strong>Cirugia:</strong><br>Tipo: ${surgery.type || "-"}<br>Consentimiento: ${surgery.consentSigned ? "firmado" : "pendiente"}<br>${[surgery.checklist, surgery.preopStudies, surgery.postopFollowup].filter(Boolean).join("<br>")}</p>`);
                            }
                            return blocks.join("");
                        })()}
                    </div>
                `).join("") : "<p class='muted'>No hay consultas registradas.</p>"}
            </section>
            <section class="section">
                <h2>Estudios Clinicos</h2>
                ${results.length ? results.map((result) => `<p><strong>${result.title}</strong> - ${formatDate(result.resultDate || result.createdAt, "-", locale, timeZone)}<br><span class="muted">${result.notes || ""}</span></p>`).join("") : "<p class='muted'>No hay estudios registrados.</p>"}
            </section>
        </main>
    `);
}

function sendWhatsApp(phone: string | null | undefined, message: string) {
    const digits = (phone || "").replace(/\D/g, "");
    if (!digits) return false;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, "_blank");
    return true;
}

function defaultRescheduleForm(patient: PatientActionTarget | null = null, timeZone = CLINIC_TIME_ZONE): RescheduleFormState {
    const nextSlot = new Date(Date.now() + 30 * 60_000);

    return {
        patient,
        date: dateToOperationInputValue(nextSlot, timeZone) || getLocalDateString(timeZone),
        time: timeToOperationInputValue(nextSlot, timeZone),
        duration: "30",
        reason: "Consulta",
    };
}

export function PatientWorkspace({
    initialPatients,
    initialSelectedPatient,
}: {
    initialPatients: PatientSummary[];
    initialSelectedPatient: PatientDetail | null;
}) {
    const operationContext = useOperationContext();
    const [patients, setPatients] = useState(initialPatients);
    const [selectedPatient, setSelectedPatient] = useState<PatientDetail | null>(null);
    const [search, setSearch] = useState("");
    const [activeTab, setActiveTab] = useState<PatientTabId>("overview");
    const [patientDialogOpen, setPatientDialogOpen] = useState(false);
    const [patientForm, setPatientForm] = useState<PatientFormState>(() => defaultPatientForm(null, operationContext.timeZone));
    const [followUpParent, setFollowUpParent] = useState<Consultation | null>(null);
    const [workspaceRecipe, setWorkspaceRecipe] = useState<Consultation | null>(null);
    const [attendedPatientIds, setAttendedPatientIds] = useState<string[]>([]);
    const [confirmedPatientIds, setConfirmedPatientIds] = useState<string[]>([]);
    const [rescheduleForm, setRescheduleForm] = useState<RescheduleFormState>(() => defaultRescheduleForm(null, operationContext.timeZone));
    const [rescheduleOpen, setRescheduleOpen] = useState(false);
    const [appointmentDialogOpen, setAppointmentDialogOpen] = useState(false);
    const [appointmentDialogPatient, setAppointmentDialogPatient] = useState<PatientSummary | PatientDetail | null>(null);
    const [businessHours, setBusinessHours] = useState(() => normalizeBusinessHours());
    const [isPreparingWorkspaceRecipe, setIsPreparingWorkspaceRecipe] = useState(false);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();
    const { toast } = useToast();

    const selectedAge = ageLabel(selectedPatient?.dob, operationContext.timeZone);
    const activeTabMeta = PATIENT_TABS.find((tab) => tab.id === activeTab) || PATIENT_TABS[0];

    useEffect(() => {
        let active = true;
        fetch("/api/settings", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((settings) => {
                if (active && settings) setBusinessHours(normalizeBusinessHours(settings));
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, []);

    const refreshWorkspace = (selectedId = selectedPatient?.id, nextSearch = search) => {
        startTransition(async () => {
            const payload = await getPatientWorkspace(nextSearch, selectedId);
            setPatients(payload.patients);
            setSelectedPatient(selectedId ? payload.selectedPatient : null);
        });
    };

    const openAppointmentForPatient = (patient: PatientSummary | PatientDetail) => {
        setAppointmentDialogPatient(patient);
        setAppointmentDialogOpen(true);
    };

    const handleSearch = (value: string) => {
        setSearch(value);
        startTransition(async () => {
            const payload = await getPatientWorkspace(value, undefined);
            setPatients(payload.patients);
        });
    };

    const openNewPatient = () => {
        setPatientForm(defaultPatientForm(null, operationContext.timeZone));
        setPatientDialogOpen(true);
    };

    const openEditPatient = () => {
        if (!selectedPatient) return;
        setPatientForm(defaultPatientForm(selectedPatient, operationContext.timeZone));
        setPatientDialogOpen(true);
    };

    const handleSavePatient = () => {
        startTransition(async () => {
            const result = await savePatient(patientForm);
            if (!result.success || !result.patient) {
                toast({ title: "Error", description: result.error || "No se pudo guardar.", variant: "destructive" });
                return;
            }

            toast({ title: patientForm.id ? "Paciente actualizado" : "Paciente creado" });
            setPatientDialogOpen(false);
            const payload = await getPatientWorkspace(search, result.patient.id);
            setPatients(payload.patients);
            setSelectedPatient(payload.selectedPatient);
            setActiveTab("overview");
        });
    };

    const handleDeletePatient = () => {
        if (!selectedPatient) return;
        if (!confirm(`Eliminar la ficha de ${patientName(selectedPatient)}?`)) return;

        startTransition(async () => {
            const result = await deletePatient(selectedPatient.id);
            if (!result.success) {
                toast({ title: "Error", description: result.error || "No se pudo eliminar.", variant: "destructive" });
                return;
            }
            toast({ title: "Paciente eliminado" });
            const payload = await getPatientWorkspace(search);
            setPatients(payload.patients);
            setSelectedPatient(payload.selectedPatient);
            setActiveTab("overview");
        });
    };

    const startNewConsultation = (parent?: Consultation) => {
        setFollowUpParent(parent || null);
        setActiveTab("consultation");
    };

    const handlePrepareWorkspaceRecipeForChat = async (pdfBlob: Blob) => {
        if (!selectedPatient || !workspaceRecipe) return;

        setIsPreparingWorkspaceRecipe(true);
        try {
            const conversationId = await prepareRecipeDraftForChat(selectedPatient, workspaceRecipe, pdfBlob, operationContext);
            setWorkspaceRecipe(null);
            toast({ title: "Receta lista", description: "Abriendo el chat del paciente con el PDF preparado." });
            router.push(`/dashboard/inbox?conversationId=${encodeURIComponent(conversationId)}&draft=patient-prescription`);
        } catch (error) {
            toast({
                title: "No se pudo preparar la receta",
                description: error instanceof Error ? error.message : "Intentalo de nuevo.",
                variant: "destructive",
            });
        } finally {
            setIsPreparingWorkspaceRecipe(false);
        }
    };

    const selectPatient = (patientId: string, nextTab: PatientTabId = "consultations") => {
        startTransition(async () => {
            const detail = await getPatientWorkspace(search, patientId);
            setSelectedPatient(detail.selectedPatient);
            setActiveTab(nextTab);
            setFollowUpParent(null);
        });
    };

    const handleBackToList = () => {
        setSelectedPatient(null);
        setFollowUpParent(null);
        setActiveTab("overview");
    };

    const handlePatientQuickAction = (patient: PatientActionTarget, action: PatientQuickAction) => {
        const name = patientName(patient);
        const latestAppointment = patient.appointments?.[0] || null;

        if (action === "whatsapp") {
            startTransition(async () => {
                const result = await preparePatientChat(patient.id);
                if (!result.success || !result.conversationId) {
                    toast({
                        title: "No se pudo abrir el chat",
                        description: result.error || "Revisa que el paciente tenga telefono registrado.",
                        variant: "destructive",
                    });
                    return;
                }
                router.push(`/dashboard/inbox?conversationId=${encodeURIComponent(result.conversationId)}`);
            });
            return;
        }

        if (action === "reschedule") {
            setRescheduleForm(defaultRescheduleForm(patient, operationContext.timeZone));
            setRescheduleOpen(true);
            return;
        }

        const messageMap: Partial<Record<typeof action, string>> = {
            notify: `Hola ${name}, te recordamos estar atento a las indicaciones de tu cita.`,
        };

        if (messageMap[action]) {
            const ok = sendWhatsApp(patient.phone, messageMap[action] || "");
            if (!ok) toast({ title: "Sin telefono", description: "El paciente no tiene telefono registrado.", variant: "destructive" });
            return;
        }

        if (action === "confirm") {
            setConfirmedPatientIds((ids) => ids.includes(patient.id) ? ids : [...ids, patient.id]);
            startTransition(async () => {
                if (latestAppointment) {
                    const result = await updateAppointmentStatus(latestAppointment.id, "confirmed");
                    if (!result.success) {
                        toast({ title: "No se pudo confirmar", description: result.error || "Intentalo de nuevo.", variant: "destructive" });
                        return;
                    }
                    await refreshWorkspace(selectedPatient?.id, search);
                }
                toast({ title: "Paciente confirmado" });
            });
            return;
        }

        if (action === "attended") {
            setAttendedPatientIds((ids) => ids.includes(patient.id) ? ids : [...ids, patient.id]);
            startTransition(async () => {
                if (latestAppointment) {
                    const result = await updateAppointmentStatus(latestAppointment.id, "completed");
                    if (!result.success) {
                        toast({ title: "No se pudo marcar atendido", description: result.error || "Intentalo de nuevo.", variant: "destructive" });
                        return;
                    }
                    await refreshWorkspace(selectedPatient?.id, search);
                }
                toast({ title: "Paciente atendido", description: "Se marco con palomita verde en el listado." });
            });
            return;
        }

        if (action === "canceled") {
            startTransition(async () => {
                if (latestAppointment) {
                    const result = await updateAppointmentStatus(latestAppointment.id, "cancelled", "Cancelado desde pacientes");
                    if (!result.success) {
                        toast({ title: "No se pudo cancelar", description: result.error || "Intentalo de nuevo.", variant: "destructive" });
                        return;
                    }
                    await refreshWorkspace(selectedPatient?.id, search);
                }
                toast({ title: "Cita cancelada" });
            });
        }
    };

    const handleSaveReschedule = () => {
        const patient = rescheduleForm.patient;
        if (!patient) return;

        const [hours, minutes] = rescheduleForm.time.split(":").map(Number);
        const duration = Math.max(5, Number(rescheduleForm.duration || 30));
        const startTime = operationDateTimeToUtc(
            rescheduleForm.date,
            `${String(hours || 0).padStart(2, "0")}:${String(minutes || 0).padStart(2, "0")}`,
            operationContext.timeZone,
        );
        const endTime = new Date(startTime.getTime() + duration * 60_000);
        if (startTime <= new Date()) {
            toast({
                title: "Horario no disponible",
                description: "Solo puedes crear citas desde este momento en adelante.",
                variant: "destructive",
            });
            return;
        }

        startTransition(async () => {
            const result = await createAppointment({
                title: `${rescheduleForm.reason || "Consulta"} - ${patientName(patient)}`,
                startTime,
                endTime,
                patientId: patient.id,
                appointmentType: rescheduleForm.reason || "Consulta",
                source: "internal",
                confirmationStatus: "pending",
            });

            if (!result.success) {
                toast({ title: "No se pudo reagendar", description: result.error || "Intentalo de nuevo.", variant: "destructive" });
                return;
            }

            toast({ title: "Cita reagendada", description: `${formatDate(startTime, "-", operationContext.locale, operationContext.timeZone)} ${rescheduleForm.time}` });
            setRescheduleOpen(false);
            await refreshWorkspace(selectedPatient?.id, search);
        });
    };

    return (
        <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-4">
            {!selectedPatient ? (
                <PatientDirectoryView
                    patients={patients}
                    search={search}
                    isPending={isPending}
                    attendedPatientIds={attendedPatientIds}
                    confirmedPatientIds={confirmedPatientIds}
                    onSearch={handleSearch}
                    onNewPatient={openNewPatient}
                    onRefresh={() => refreshWorkspace(undefined, search)}
                    onSelectPatient={(patientId) => selectPatient(patientId, "consultations")}
                    onQuickAction={handlePatientQuickAction}
                    onSchedulePatient={openAppointmentForPatient}
                />
            ) : (
                <>
                    <PatientCareHeader
                        patient={selectedPatient}
                        selectedAge={selectedAge}
                        activeTab={activeTab}
                        isPending={isPending}
                        onBack={handleBackToList}
                        onEdit={openEditPatient}
                        onRefresh={() => refreshWorkspace(selectedPatient.id)}
                        onQuickAction={(action) => handlePatientQuickAction(selectedPatient, action)}
                        onSchedulePatient={() => openAppointmentForPatient(selectedPatient)}
                        onTabChange={setActiveTab}
                    />

                    <Card className="min-h-[calc(100vh-15rem)] rounded-2xl border-border/70 shadow-sm">
                        <CardContent className="p-4 lg:p-6">
                            {activeTab === "overview" ? (
                                <OverviewTab patient={selectedPatient} onEdit={openEditPatient} onNewConsultation={() => startNewConsultation()} onFollowUp={() => setActiveTab("consultations")} />
                            ) : activeTab === "history" ? (
                                <HistoryTab patient={selectedPatient} onSaved={(patient) => setSelectedPatient(patient)} onOpenAnalysis={() => setActiveTab("analysis")} />
                            ) : activeTab === "consultations" ? (
                                <ConsultationsTab
                                    patient={selectedPatient}
                                    onFollowUp={startNewConsultation}
                                    onOpenAnalysis={() => setActiveTab("analysis")}
                                    onSaved={() => refreshWorkspace(selectedPatient.id)}
                                />
                            ) : activeTab === "consultation" ? (
                                <ConsultationTab
                                    patient={selectedPatient}
                                    parent={followUpParent}
                                    onRecipeReady={setWorkspaceRecipe}
                                    onCancel={() => {
                                        setFollowUpParent(null);
                                        setActiveTab("consultations");
                                    }}
                                    onSaved={() => {
                                        setFollowUpParent(null);
                                        refreshWorkspace(selectedPatient.id);
                                        setActiveTab("consultations");
                                    }}
                                />
                            ) : activeTab === "optical" ? (
                                <OpticalPrescriptionTab
                                    patient={selectedPatient}
                                    onSaved={() => refreshWorkspace(selectedPatient.id)}
                                />
                            ) : activeTab === "budgets" ? (
                                <BudgetsTab patient={selectedPatient} onSaved={() => refreshWorkspace(selectedPatient.id)} />
                            ) : activeTab === "analysis" ? (
                                <AnalysisTab patient={selectedPatient} onSaved={() => refreshWorkspace(selectedPatient.id)} />
                            ) : (
                                <FullHistoryTab patient={selectedPatient} />
                            )}
                        </CardContent>
                    </Card>
                </>
            )}

            <PatientDialog
                open={patientDialogOpen}
                form={patientForm}
                pending={isPending}
                onOpenChange={setPatientDialogOpen}
                onFormChange={setPatientForm}
                onSave={handleSavePatient}
                onDelete={patientForm.id ? handleDeletePatient : undefined}
            />
            <ReschedulePatientDialog
                open={rescheduleOpen}
                pending={isPending}
                form={rescheduleForm}
                onOpenChange={setRescheduleOpen}
                onFormChange={setRescheduleForm}
                onSave={handleSaveReschedule}
            />
            <AppointmentDialog
                open={appointmentDialogOpen}
                onOpenChange={(open) => {
                    setAppointmentDialogOpen(open);
                    if (!open) setAppointmentDialogPatient(null);
                }}
                defaultPatient={appointmentDialogPatient}
                defaultPatientId={appointmentDialogPatient?.id || null}
                onSuccess={() => refreshWorkspace(selectedPatient?.id, search)}
                businessHours={businessHours}
            />
            {selectedPatient ? (
                <RecipePrintDialog
                    open={Boolean(workspaceRecipe)}
                    patient={selectedPatient}
                    consultation={workspaceRecipe}
                    isPreparing={isPreparingWorkspaceRecipe}
                    onOpenChange={(open) => {
                        if (!open && !isPreparingWorkspaceRecipe) {
                            setWorkspaceRecipe(null);
                        }
                    }}
                    onSend={handlePrepareWorkspaceRecipeForChat}
                />
            ) : null}
        </div>
    );
}

function PatientDirectoryView({
    patients,
    search,
    isPending,
    attendedPatientIds,
    confirmedPatientIds,
    onSearch,
    onNewPatient,
    onRefresh,
    onSelectPatient,
    onQuickAction,
    onSchedulePatient,
}: {
    patients: PatientSummary[];
    search: string;
    isPending: boolean;
    attendedPatientIds: string[];
    confirmedPatientIds: string[];
    onSearch: (value: string) => void;
    onNewPatient: () => void;
    onRefresh: () => void;
    onSelectPatient: (patientId: string) => void;
    onQuickAction: (patient: PatientSummary, action: PatientQuickAction) => void;
    onSchedulePatient: (patient: PatientSummary) => void;
}) {
    const operationContext = useOperationContext();
    const formatPatientDate = (value?: Date | string | null, fallback = "-") =>
        formatDate(value, fallback, operationContext.locale, operationContext.timeZone);
    const formatPatientMoney = (value?: number | null, currency = operationContext.defaultCurrency) =>
        money(value, currency, operationContext.locale);

    return (
        <div className="space-y-4">
            <section className="rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:px-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">Pacientes</h1>
                        <p className="text-sm text-muted-foreground">Listado operativo para contactar, confirmar y abrir la atencion clinica.</p>
                        <div className="relative mt-4 max-w-4xl">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(event) => onSearch(event.target.value)}
                                placeholder="Buscar nombre del paciente, telefono o ID..."
                                className="h-11 rounded-xl pl-9 text-base"
                            />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className="gap-2 rounded-full" onClick={onRefresh} disabled={isPending}>
                            <RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
                            Refrescar
                        </Button>
                        <Button onClick={onNewPatient} className="gap-2 rounded-full">
                            <Plus className="h-4 w-4" />
                            Nuevo Paciente
                        </Button>
                    </div>
                </div>
            </section>

            <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[150px]">Ultima visita</TableHead>
                                <TableHead>Paciente</TableHead>
                                <TableHead>Contacto</TableHead>
                                <TableHead className="text-center">Historial</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {patients.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                                        No hay pacientes registrados.
                                    </TableCell>
                                </TableRow>
                            ) : patients.map((patient) => {
                                const age = ageLabel(patient.dob, operationContext.timeZone);
                                const hasBalance = Number(patient.balance || 0) > 0;
                                const hasPhone = Boolean(patient.phone);
                                const latestAppointment = patient.appointments?.[0] || null;
                                const isAttended = attendedPatientIds.includes(patient.id) || latestAppointment?.status === "completed";
                                const isConfirmed = confirmedPatientIds.includes(patient.id) || latestAppointment?.confirmationStatus === "confirmed";
                                return (
                                    <TableRow key={patient.id} className="cursor-pointer" onClick={() => onSelectPatient(patient.id)}>
                                        <TableCell>
                                            <div className="inline-flex min-w-28 flex-col items-center rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-primary">
                                                <span className="text-xs font-semibold">{formatPatientDate(patient.lastVisitAt, "Sin visita")}</span>
                                                <span className="mt-0.5 text-[11px] text-primary/75">{patient._count.appointments} cita(s)</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex min-w-64 items-center gap-3">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                                                    {initials(patient)}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="truncate font-semibold text-foreground">{patientName(patient)}</p>
                                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                        <span>ID: {patient.patientNumber}</span>
                                                        <span>{age}</span>
                                                        {patient.email ? <span className="truncate">{patient.email}</span> : null}
                                                    </div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1 text-sm">
                                                <span className={cn("inline-flex items-center gap-1", hasPhone ? "text-foreground" : "text-muted-foreground")}>
                                                    <Phone className="h-3.5 w-3.5" />
                                                    {patient.phone || "Sin telefono"}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {hasPhone ? "Disponible para WhatsApp" : "Completar datos"}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant="outline" className="rounded-full px-3 py-1">
                                                {patient._count.consultations} consulta(s)
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge className={cn("w-fit rounded-full border", hasBalance ? "border-amber-200 bg-amber-100 text-amber-700" : "border-emerald-200 bg-emerald-100 text-emerald-700")}>
                                                        {hasBalance ? `${formatPatientMoney(patient.balance)} pendiente` : "Sin saldo"}
                                                    </Badge>
                                                    {isAttended ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                            Atendido
                                                        </span>
                                                    ) : isConfirmed ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                                            <Check className="h-3.5 w-3.5" />
                                                            Confirmado
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <span className="text-xs text-muted-foreground">{patient._count.appointments > 0 ? "Con historial de citas" : "Sin citas registradas"}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                                            <div className="flex justify-end gap-1.5">
                                                <Button variant="outline" className="h-9 gap-2 rounded-full px-3" onClick={() => onSchedulePatient(patient)} title="Generar cita para este paciente">
                                                    <CalendarPlus className="h-4 w-4" />
                                                    Cita
                                                </Button>
                                                <Button variant="outline" size="icon" className="h-9 w-9 rounded-full text-primary" onClick={() => onQuickAction(patient, "whatsapp")} title="Abrir chat del paciente">
                                                    <WhatsAppIcon className="h-4 w-4" />
                                                </Button>
                                                <Button variant="outline" className="h-9 gap-2 rounded-full px-3" onClick={() => onQuickAction(patient, "confirm")} disabled={isConfirmed || isAttended}>
                                                    <Check className="h-4 w-4" />
                                                    Confirmar
                                                </Button>
                                                <Button className={cn("h-9 gap-2 rounded-full px-3", isAttended && "bg-emerald-600 hover:bg-emerald-600")} onClick={() => onQuickAction(patient, "attended")} disabled={isAttended}>
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    {isAttended ? "Atendido" : "Atendido"}
                                                </Button>
                                                <PatientActionMenu patient={patient} onAction={(action) => onQuickAction(patient, action)} />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}

function PatientActionMenu({ patient, onAction }: { patient: PatientSummary | PatientDetail; onAction: (action: PatientQuickAction) => void }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 rounded-full" title={`Acciones para ${patientName(patient)}`}>
                    <MoreVertical className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => onAction("reschedule")}>
                    <CalendarClock className="h-4 w-4" />
                    Reagendar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onAction("canceled")}>
                    <XCircle className="h-4 w-4" />
                    Cancelado
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function PatientCareHeader({
    patient,
    selectedAge,
    activeTab,
    isPending,
    onBack,
    onEdit,
    onRefresh,
    onQuickAction,
    onSchedulePatient,
    onTabChange,
}: {
    patient: PatientDetail;
    selectedAge: string;
    activeTab: PatientTabId;
    isPending: boolean;
    onBack: () => void;
    onEdit: () => void;
    onRefresh: () => void;
    onQuickAction: (action: PatientQuickAction) => void;
    onSchedulePatient: () => void;
    onTabChange: (tab: PatientTabId) => void;
}) {
    const operationContext = useOperationContext();
    return (
        <Card className="rounded-2xl border-border/70 shadow-sm">
            <CardContent className="space-y-4 p-4 lg:p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full" onClick={onBack} title="Volver a pacientes">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                            {initials(patient)}
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-2xl font-bold tracking-tight text-foreground">{patientName(patient)}</h2>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                <span>{selectedAge}</span>
                                <span>ID: {patient.patientNumber}</span>
                                <span>Telefono: {patient.phone || "-"}</span>
                                <span>Ultima visita: {formatDateTime(patient.lastVisitAt, "-", operationContext.locale, operationContext.timeZone)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 xl:justify-end">
                        <Button variant="outline" className="gap-2 rounded-full" onClick={onSchedulePatient}>
                            <CalendarPlus className="h-4 w-4" />
                            Cita
                        </Button>
                        <Button variant="outline" className="gap-2 rounded-full text-primary" onClick={() => onQuickAction("whatsapp")}>
                            <WhatsAppIcon className="h-4 w-4" />
                            WhatsApp
                        </Button>
                        <Button variant="outline" className="gap-2 rounded-full" onClick={() => onQuickAction("confirm")}>
                            <Check className="h-4 w-4" />
                            Confirmar
                        </Button>
                        <Button variant="outline" className="gap-2 rounded-full" onClick={() => onQuickAction("attended")}>
                            <CheckCircle2 className="h-4 w-4" />
                            Atendido
                        </Button>
                        <Button variant="outline" className="gap-2 rounded-full" onClick={onEdit}>
                            <Edit2 className="h-4 w-4" />
                            Editar datos
                        </Button>
                        <Button variant="outline" size="icon" className="rounded-full" onClick={onRefresh} disabled={isPending} title="Refrescar">
                            <RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
                        </Button>
                        <PatientActionMenu patient={patient} onAction={onQuickAction} />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <nav className="flex min-w-max items-center gap-1 border-t pt-3">
                        {PATIENT_TABS.map((item) => {
                            const Icon = item.icon;
                            const isActive = activeTab === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => onTabChange(item.id)}
                                    className={cn(
                                        "inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium transition",
                                        isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    {item.label}
                                </button>
                            );
                        })}
                    </nav>
                </div>
            </CardContent>
        </Card>
    );
}

function ReschedulePatientDialog({
    open,
    pending,
    form,
    onOpenChange,
    onFormChange,
    onSave,
}: {
    open: boolean;
    pending: boolean;
    form: RescheduleFormState;
    onOpenChange: (open: boolean) => void;
    onFormChange: (form: RescheduleFormState) => void;
    onSave: () => void;
}) {
    const operationContext = useOperationContext();
    const patientLabel = form.patient ? patientName(form.patient) : "Paciente";
    const update = (patch: Partial<RescheduleFormState>) => onFormChange({ ...form, ...patch });
    const todayKey = getOperationTodayKey(operationContext.timeZone);
    const currentOperationTime = timeToOperationInputValue(new Date(), operationContext.timeZone);
    const timeMin = form.date === todayKey ? currentOperationTime : undefined;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Reagendar cita</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="rounded-2xl border bg-muted/35 p-3">
                        <p className="font-semibold">{patientLabel}</p>
                        <p className="text-sm text-muted-foreground">{form.patient?.phone || "Sin telefono registrado"}</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Fecha</Label>
                            <Input type="date" min={todayKey} value={form.date} onChange={(event) => update({ date: event.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Hora</Label>
                            <Input type="time" min={timeMin} value={form.time} onChange={(event) => update({ time: event.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Duracion</Label>
                            <Select value={form.duration} onValueChange={(value) => update({ duration: value })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="15">15 minutos</SelectItem>
                                    <SelectItem value="30">30 minutos</SelectItem>
                                    <SelectItem value="45">45 minutos</SelectItem>
                                    <SelectItem value="60">60 minutos</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Tipo / motivo</Label>
                            <Input value={form.reason} onChange={(event) => update({ reason: event.target.value })} placeholder="Consulta, revision, estudio..." />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
                    <Button onClick={onSave} disabled={pending || !form.date || !form.time}>
                        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                        Guardar cita
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PatientDialog({
    open,
    form,
    pending,
    onOpenChange,
    onFormChange,
    onSave,
    onDelete,
}: {
    open: boolean;
    form: PatientFormState;
    pending: boolean;
    onOpenChange: (open: boolean) => void;
    onFormChange: (form: PatientFormState) => void;
    onSave: () => void;
    onDelete?: () => void;
}) {
    const operationContext = useOperationContext();
    const update = (field: keyof PatientFormState, value: string) => onFormChange({ ...form, [field]: value });
    const computedAge = ageLabel(form.dob, operationContext.timeZone);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{form.id ? "Editar paciente" : "Nuevo paciente"}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Nombre" value={form.firstName} onChange={(value) => update("firstName", value)} />
                    <FormField label="Apellido" value={form.lastName} onChange={(value) => update("lastName", value)} />
                    <div className="space-y-2">
                        <Label>Telefono</Label>
                        <PhonePrefixInput value={form.phone} onChange={(value) => update("phone", value)} />
                    </div>
                    <FormField label="Email" value={form.email} onChange={(value) => update("email", value)} />
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <Label>Fecha de nacimiento</Label>
                            <span className="text-xs text-muted-foreground">{computedAge}</span>
                        </div>
                        <div className="flex gap-2">
                            <Input type="date" value={form.dob} onChange={(event) => update("dob", event.target.value)} />
                            {form.dob ? (
                                <Button type="button" variant="outline" className="shrink-0 rounded-full" onClick={() => update("dob", "")}>
                                    Quitar
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Sexo</Label>
                        <Select value={form.sex || "none"} onValueChange={(value) => update("sex", value === "none" ? "" : value)}>
                            <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Sin especificar</SelectItem>
                                <SelectItem value="masculino">Masculino</SelectItem>
                                <SelectItem value="femenino">Femenino</SelectItem>
                                <SelectItem value="otro">Otro</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Tipo ID</Label>
                        <Select value={form.idType || "none"} onValueChange={(value) => update("idType", value === "none" ? "" : value)}>
                            <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Sin especificar</SelectItem>
                                {ID_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <FormField label="ID numero" value={form.idNumber} onChange={(value) => update("idNumber", value)} />
                    <div className="md:col-span-2">
                        <FormField label="Direccion" value={form.address} onChange={(value) => update("address", value)} />
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:justify-between">
                    {onDelete ? (
                        <Button variant="destructive" onClick={onDelete} disabled={pending}>
                            <Trash2 className="h-4 w-4" />
                            Eliminar
                        </Button>
                    ) : <span />}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button onClick={onSave} disabled={pending}>
                            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Guardar
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function OverviewTab({
    patient,
    onEdit,
    onNewConsultation,
    onFollowUp,
}: {
    patient: PatientDetail;
    onEdit: () => void;
    onNewConsultation: () => void;
    onFollowUp: () => void;
}) {
    const operationContext = useOperationContext();
    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button variant="outline" className="gap-2" onClick={onEdit}>
                    <Edit2 className="h-4 w-4" />
                    Editar Datos
                </Button>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                <Card className="rounded-2xl">
                    <CardHeader><CardTitle className="text-lg">Identificacion</CardTitle></CardHeader>
                    <CardContent>
                        <InfoRow label="No. Paciente" value={patient.patientNumber} />
                        <InfoRow label="Nombre completo" value={patientName(patient)} />
                        <InfoRow label="ID numero" value={patient.idNumber} />
                        <InfoRow label="Fecha de nacimiento" value={formatDate(patient.dob, "-", operationContext.locale, operationContext.timeZone)} />
                        <InfoRow label="Sexo" value={patient.sex} />
                    </CardContent>
                </Card>
                <Card className="rounded-2xl">
                    <CardHeader><CardTitle className="text-lg">Contacto</CardTitle></CardHeader>
                    <CardContent>
                        <InfoRow label="Telefono" value={patient.phone} />
                        <InfoRow label="Email" value={patient.email} />
                        <InfoRow label="Direccion" value={patient.address} />
                    </CardContent>
                </Card>
            </div>

            <button
                onClick={onNewConsultation}
                className="w-full rounded-2xl border border-primary/30 bg-primary/5 p-4 text-left transition hover:bg-primary/10"
            >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-primary">Nueva Consulta</h3>
                        <p className="text-sm text-primary/80">Iniciar un nuevo registro clinico para este paciente.</p>
                    </div>
                    <span className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                        Comenzar <ArrowRight className="h-4 w-4" />
                    </span>
                </div>
            </button>

            <button
                onClick={onFollowUp}
                className="w-full rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left transition hover:bg-amber-100"
            >
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-amber-800">Consulta de Seguimiento</h3>
                        <p className="text-sm text-amber-700">Continuar un diagnostico previo y registrar evolucion.</p>
                    </div>
                    <span className="text-2xl font-bold text-amber-700">#</span>
                </div>
            </button>
        </div>
    );
}

function HistoryTab({
    patient,
    onSaved,
    onOpenAnalysis,
}: {
    patient: PatientDetail;
    onSaved: (patient: PatientDetail) => void;
    onOpenAnalysis: () => void;
}) {
    const operationContext = useOperationContext();
    const [form, setForm] = useState({
        allergies: patient.allergies || "",
        pathologicalHistory: patient.pathologicalHistory || "",
        nonPathologicalHistory: patient.nonPathologicalHistory || "",
    });
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    useEffect(() => {
        setForm({
            allergies: patient.allergies || "",
            pathologicalHistory: patient.pathologicalHistory || "",
            nonPathologicalHistory: patient.nonPathologicalHistory || "",
        });
    }, [patient.id, patient.allergies, patient.pathologicalHistory, patient.nonPathologicalHistory]);

    const clinicalTimeline = patient.clinicalAnalyses
        .map((item) => ({ item, date: item.resultDate || item.createdAt }))
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    return (
        <div className="space-y-6">
            <Card className="rounded-2xl">
                <CardContent className="space-y-4 p-4">
                    <p className="text-sm text-muted-foreground">Registra alergias y antecedentes medicos. Guarda los cambios con el boton Guardar ficha.</p>
                    <TextAreaField label="Alergias" value={form.allergies} onChange={(value) => setForm({ ...form, allergies: value })} rows={3} placeholder="Describe alergias conocidas..." />
                    <TextAreaField label="Antecedentes patologicos" value={form.pathologicalHistory} onChange={(value) => setForm({ ...form, pathologicalHistory: value })} rows={3} placeholder="Enfermedades cronicas, cirugias, hospitalizaciones previas..." />
                    <TextAreaField label="Antecedentes no patologicos" value={form.nonPathologicalHistory} onChange={(value) => setForm({ ...form, nonPathologicalHistory: value })} rows={3} placeholder="Habitos, alimentacion, actividad fisica..." />
                    <div className="flex justify-end">
                        <Button
                            disabled={isPending}
                            onClick={() => startTransition(async () => {
                                const result = await savePatientHistory(patient.id, form);
                                if (!result.success || !result.patient) {
                                    toast({ title: "Error", description: result.error || "No se pudo guardar.", variant: "destructive" });
                                    return;
                                }
                                toast({ title: "Antecedentes actualizados" });
                                onSaved(result.patient as PatientDetail);
                            })}
                        >
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Guardar ficha
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {clinicalTimeline.length > 0 ? (
                <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <FlaskConical className="h-5 w-5 text-primary" />
                            Estudios Clinicos
                        </CardTitle>
                        <Button variant="link" onClick={onOpenAnalysis}>Ver todos</Button>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {clinicalTimeline.slice(0, 5).map(({ item }) => (
                            <div key={item.id} className="flex items-center justify-between rounded-xl bg-muted/50 p-3">
                                <div>
                                    <p className="text-sm font-semibold">
                                        {item.kind === "request" ? `Solicitud: ${asArray<string>(item.studies).slice(0, 2).join(", ") || item.title}` : `Estudios de Gabinete: ${item.title}`}
                                    </p>
                                    <p className="text-xs text-muted-foreground">{formatDate(item.resultDate || item.createdAt, "-", operationContext.locale, operationContext.timeZone)}</p>
                                </div>
                                <Button variant="ghost" size="sm" onClick={onOpenAnalysis}>
                                    <Eye className="h-4 w-4" />
                                    Ver Detalles
                                </Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}

function defaultRecipeContentDraft(consultation: Consultation): RecipeContentDraft {
    const medications = asArray<Medication>(consultation.medications)
        .filter((med) => med.name || med.dose || med.frequency || med.duration)
        .map((med) => ({
            name: med.name || "",
            dose: med.dose || "",
            frequency: med.frequency || "",
            duration: med.duration || "",
        }));

    return {
        medications: medications.length ? medications : [{ name: "", dose: "", frequency: "", duration: "" }],
        indications: consultation.treatmentPlan || "",
        diagnosis: consultation.diagnosis || "",
    };
}

function getRecipeDocumentData(
    patient: PatientDetail,
    consultation: Consultation,
    draft?: RecipeContentDraft,
    options?: OperationFormatOptions,
    profile: ClinicPrescriptionProfile = DEFAULT_CLINIC_PRESCRIPTION_PROFILE,
) {
    const { locale, timeZone } = resolveOperationFormat(options);
    const sourceMeds = draft?.medications ?? asArray<Medication>(consultation.medications);
    const meds = sourceMeds.filter((med) => med.name || med.dose || med.frequency || med.duration);
    const medicationsText = meds.length
        ? meds.map((med) => [
            `${med.name || ""} ${med.dose || ""}`.trim(),
            [med.frequency, med.duration].filter(Boolean).join(" - "),
        ].filter(Boolean).join("\n")).join("\n\n")
        : "Sin medicamentos registrados para esta consulta.";
    const professional = resolveConsultationProfessional(consultation, profile);

    return {
        patientName: patientName(patient),
        date: formatDate(consultation.createdAt, "-", locale, timeZone),
        patientAge: ageLabel(patient.dob, timeZone, "-"),
        medications: medicationsText,
        diagnosis: draft?.diagnosis?.trim() || consultation.diagnosis || "-",
        indications: draft?.indications?.trim() || consultation.treatmentPlan || "-",
        doctorName: professional.doctorName,
        doctorTitle: professional.doctorTitle,
        doctorProfessionalLicense: professional.doctorProfessionalLicense,
        clinicName: profile.clinicName || consultation.clinicName || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.clinicName,
        clinicSubtitle: profile.clinicSubtitle || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.clinicSubtitle,
        clinicAddress: profile.clinicAddress || DEFAULT_CLINIC_PRESCRIPTION_PROFILE.clinicAddress,
        clinicLogoUrl: profile.clinicLogoUrl,
        clinicLogoScale: profile.clinicLogoScale,
    };
}

function getRecipeElementText(key: RecipeElementKey, data: ReturnType<typeof getRecipeDocumentData>) {
    const map: Record<RecipeElementKey, string> = {
        patientName: data.patientName,
        date: data.date,
        patientAge: data.patientAge,
        medications: data.medications,
        diagnosis: data.diagnosis,
        indications: data.indications,
    };
    return map[key] || "-";
}

function RecipeSheet({
    patient,
    consultation,
    paperSize,
    showLetterhead,
    layout,
    showGuide = false,
    editorMode = false,
    contentDraft,
    editingContent = false,
    selectedElement,
    onElementPointerDown,
    onResizePointerDown,
    onSelectElement,
    onContentDraftChange,
}: {
    patient: PatientDetail;
    consultation: Consultation;
    paperSize: RecipePaperSizeId;
    showLetterhead: boolean;
    layout: RecipeLayoutSettings;
    showGuide?: boolean;
    editorMode?: boolean;
    contentDraft?: RecipeContentDraft;
    editingContent?: boolean;
    selectedElement?: RecipeElementKey;
    onElementPointerDown?: (event: React.PointerEvent<HTMLElement>, key: RecipeElementKey) => void;
    onResizePointerDown?: (event: React.PointerEvent<HTMLElement>, key: RecipeElementKey) => void;
    onSelectElement?: (key: RecipeElementKey) => void;
    onContentDraftChange?: (draft: RecipeContentDraft) => void;
}) {
    const operationContext = useOperationContext();
    const clinicProfile = useClinicPrescriptionProfile();
    const data = getRecipeDocumentData(patient, consultation, contentDraft, operationContext, clinicProfile);
    const paper = RECIPE_PAPER_SIZES[paperSize];
    const useCustomLayout = !showLetterhead && layout.enabled;
    const editableDraft = contentDraft || defaultRecipeContentDraft(consultation);

    const updateMedication = (index: number, field: keyof Medication, value: string) => {
        onContentDraftChange?.({
            ...editableDraft,
            medications: editableDraft.medications.map((medication, medicationIndex) => (
                medicationIndex === index ? { ...medication, [field]: value } : medication
            )),
        });
    };

    const addMedication = () => {
        onContentDraftChange?.({
            ...editableDraft,
            medications: [...editableDraft.medications, { name: "", dose: "", frequency: "", duration: "" }],
        });
    };

    const removeMedication = (index: number) => {
        const next = editableDraft.medications.filter((_, medicationIndex) => medicationIndex !== index);
        onContentDraftChange?.({
            ...editableDraft,
            medications: next.length ? next : [{ name: "", dose: "", frequency: "", duration: "" }],
        });
    };

    return (
        <div
            className="relative bg-white text-slate-950 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.7)]"
            style={{ width: paper.widthPx, height: paper.heightPx }}
        >
            {useCustomLayout ? (
                <>
                    {showGuide && layout.backgroundImage ? (
                        <img
                            src={layout.backgroundImage}
                            alt="Guia del recetario"
                            className="absolute inset-0 h-full w-full object-cover opacity-45"
                        />
                    ) : null}
                    {(Object.keys(layout.elements) as RecipeElementKey[]).map((key) => {
                        const element = layout.elements[key];
                        if (!element.visible && !editorMode) return null;
                        const selected = selectedElement === key;
                        return (
                            <div
                                key={key}
                                className={cn(
                                    "absolute whitespace-pre-wrap leading-tight",
                                    editorMode && "cursor-move rounded-[4px] border bg-white/35 px-1 py-0.5",
                                    editorMode && selected ? "ring-2 ring-primary" : "",
                                )}
                                style={{
                                    left: element.x,
                                    top: element.y,
                                    width: element.width,
                                    minHeight: element.height,
                                    fontSize: `${element.fontSize}pt`,
                                    fontWeight: element.bold ? 700 : 400,
                                    opacity: element.visible ? 1 : 0.35,
                                    borderColor: editorMode ? RECIPE_ELEMENT_COLORS[key] : "transparent",
                                }}
                                onPointerDown={(event) => {
                                    onSelectElement?.(key);
                                    onElementPointerDown?.(event, key);
                                }}
                            >
                                {getRecipeElementText(key, data)}
                                {editorMode ? (
                                    <span
                                        className="absolute bottom-0 right-0 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-se-resize rounded-[3px] bg-primary"
                                        onPointerDown={(event) => {
                                            onSelectElement?.(key);
                                            onResizePointerDown?.(event, key);
                                        }}
                                    />
                                ) : null}
                            </div>
                        );
                    })}
                </>
            ) : (
                <div className="h-full p-[38px]">
                    <header>
                        {showLetterhead ? (
                            <>
                                <div className="grid grid-cols-[56px_1fr_1fr_1fr] items-center gap-3">
                                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-2xl font-bold text-primary">
                                        {data.clinicLogoUrl ? (
                                            <img
                                                src={data.clinicLogoUrl}
                                                alt="Logotipo"
                                                className="object-contain"
                                                style={{ width: `${data.clinicLogoScale}%`, height: `${data.clinicLogoScale}%` }}
                                            />
                                        ) : (
                                            <span>+</span>
                                        )}
                                    </div>
                                    <div className="text-[10px] leading-tight">
                                        <p className="font-semibold">{data.clinicName}</p>
                                        <p>{data.clinicSubtitle}</p>
                                    </div>
                                    <div className="text-center leading-tight">
                                        <p className="text-sm font-bold">{data.doctorName}</p>
                                        <p className="text-[10px] text-primary">{data.doctorTitle}</p>
                                    </div>
                                    <div className="text-right text-[9px] leading-tight text-slate-500">
                                        <p>{data.doctorProfessionalLicense ? `Ced. Prof. ${data.doctorProfessionalLicense}` : "Ced. Prof. __________"}</p>
                                        <p>{data.clinicName}</p>
                                    </div>
                                </div>
                                <div className="mt-3 border-b-[3px] border-primary" />
                            </>
                        ) : (
                            <div className="h-16" />
                        )}
                    </header>

                    <section className="mt-2 grid grid-cols-2 gap-4 text-[11px]">
                        <div>
                            <p><span className="text-slate-500">Paciente: </span><span className="font-semibold">{data.patientName}</span></p>
                            <p><span className="text-slate-500">Edad: </span><span className="font-semibold">{data.patientAge}</span></p>
                        </div>
                        <div className="text-right">
                            <p><span className="text-slate-500">Fecha: </span><span className="font-semibold">{data.date}</span></p>
                        </div>
                    </section>

                    <section className={cn("mt-3 text-[11px]", editingContent ? "rounded-none border border-red-400 px-3 py-2" : "rounded-2xl border border-dashed border-slate-300 px-4 py-3")}>
                        {editingContent ? (
                            <div className="space-y-1">
                                {editableDraft.medications.map((medication, index) => (
                                    <div key={index} className="grid grid-cols-[1fr_88px_105px_82px_24px] items-center gap-1">
                                        <input className="h-7 rounded border border-slate-300 px-2 text-[11px] outline-primary" value={medication.name} onChange={(event) => updateMedication(index, "name", event.target.value)} placeholder="Medicamento" />
                                        <input className="h-7 rounded border border-slate-300 px-2 text-[11px] outline-primary" value={medication.dose} onChange={(event) => updateMedication(index, "dose", event.target.value)} placeholder="Dosis" />
                                        <input className="h-7 rounded border border-slate-300 px-2 text-[11px] outline-primary" value={medication.frequency} onChange={(event) => updateMedication(index, "frequency", event.target.value)} placeholder="Frecuencia" />
                                        <input className="h-7 rounded border border-slate-300 px-2 text-[11px] outline-primary" value={medication.duration} onChange={(event) => updateMedication(index, "duration", event.target.value)} placeholder="Duracion" />
                                        <button type="button" className="text-lg leading-none text-destructive" onClick={() => removeMedication(index)}>x</button>
                                    </div>
                                ))}
                                <button type="button" className="text-[11px] font-medium text-primary" onClick={addMedication}>+ Agregar</button>
                            </div>
                        ) : (
                            <p className="whitespace-pre-wrap leading-relaxed">{data.medications}</p>
                        )}
                    </section>

                    <section className={cn("text-[11px]", editingContent ? "mt-10" : "mt-12")}>
                        <p className="font-semibold">Indicaciones:</p>
                        {editingContent ? (
                            <textarea
                                className="mt-2 min-h-[52px] w-full resize-none rounded-xl border border-primary px-3 py-2 text-[11px] outline-primary"
                                value={editableDraft.indications}
                                onChange={(event) => onContentDraftChange?.({ ...editableDraft, indications: event.target.value })}
                                placeholder="Indicaciones para el paciente..."
                            />
                        ) : (
                            <div className="mt-2 min-h-[52px] rounded-xl border border-slate-300 px-3 py-2">
                                <p className="whitespace-pre-wrap">{data.indications}</p>
                            </div>
                        )}
                    </section>

                    <section className="mt-4 text-[11px]">
                        <p className="font-semibold">Diagnostico:</p>
                        {editingContent ? (
                            <input
                                className="mt-2 h-9 w-full rounded-xl border border-slate-300 px-3 text-[11px] outline-primary"
                                value={editableDraft.diagnosis}
                                onChange={(event) => onContentDraftChange?.({ ...editableDraft, diagnosis: event.target.value })}
                                placeholder="Diagnostico..."
                            />
                        ) : (
                            <div className="mt-2 min-h-[38px] rounded-xl border border-slate-300 px-3 py-2">
                                <p className="whitespace-pre-wrap">{data.diagnosis}</p>
                            </div>
                        )}
                    </section>

                    <div className="mt-4 border-b-[3px] border-primary" />
                    <p className="mt-3 text-[10px]">{data.clinicAddress}</p>
                </div>
            )}
        </div>
    );
}

function RecipeLayoutEditorPanel({
    patient,
    consultation,
    layout,
    onChange,
    onBack,
    onSave,
    onReset,
}: {
    patient: PatientDetail;
    consultation: Consultation;
    layout: RecipeLayoutSettings;
    onChange: (layout: RecipeLayoutSettings) => void;
    onBack: () => void;
    onSave: () => void;
    onReset: () => void;
}) {
    const [selectedElement, setSelectedElement] = useState<RecipeElementKey>("patientName");
    const [zoom, setZoom] = useState(1);
    const [showBackground, setShowBackground] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragStateRef = useRef<{
        key: RecipeElementKey;
        mode: "move" | "resize";
        startX: number;
        startY: number;
        element: RecipeLayoutElement;
    } | null>(null);
    const paper = RECIPE_PAPER_SIZES[layout.paperSize];

    const updateElement = (key: RecipeElementKey, patch: Partial<RecipeLayoutElement>) => {
        onChange({
            ...layout,
            elements: {
                ...layout.elements,
                [key]: {
                    ...layout.elements[key],
                    ...patch,
                },
            },
        });
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragStateRef.current;
        if (!drag) return;
        const dx = (event.clientX - drag.startX) / zoom;
        const dy = (event.clientY - drag.startY) / zoom;
        const next = drag.mode === "move"
            ? {
                x: Math.max(0, Math.min(paper.widthPx - 20, drag.element.x + dx)),
                y: Math.max(0, Math.min(paper.heightPx - 20, drag.element.y + dy)),
            }
            : {
                width: Math.max(40, Math.min(paper.widthPx - drag.element.x, drag.element.width + dx)),
                height: Math.max(20, Math.min(paper.heightPx - drag.element.y, drag.element.height + dy)),
            };
        updateElement(drag.key, next);
    };

    const beginDrag = (event: React.PointerEvent<HTMLElement>, key: RecipeElementKey, mode: "move" | "resize") => {
        event.preventDefault();
        event.stopPropagation();
        dragStateRef.current = {
            key,
            mode,
            startX: event.clientX,
            startY: event.clientY,
            element: { ...layout.elements[key] },
        };
        setSelectedElement(key);
    };

    const handleGuideUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            onChange({ ...layout, backgroundImage: typeof reader.result === "string" ? reader.result : null });
            setShowBackground(true);
        };
        reader.readAsDataURL(file);
        event.target.value = "";
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-slate-100">
            <div className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-4 shadow-sm">
                <Button variant="ghost" onClick={onBack} className="gap-2">
                    <ArrowRight className="h-4 w-4 rotate-180" />
                    Volver
                </Button>
                <h2 className="text-xl font-bold">Editor de Diseño de Receta</h2>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onReset} className="gap-2">
                        <RefreshCw className="h-4 w-4" />
                        Restablecer
                    </Button>
                    <Button onClick={onSave} className="gap-2">
                        <Save className="h-4 w-4" />
                        Guardar
                    </Button>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_280px]">
                <aside className="min-h-0 space-y-4 overflow-y-auto border-r bg-background p-4">
                    <div className="rounded-2xl border bg-muted/25 p-4">
                        <h3 className="font-semibold">Activar</h3>
                        <label className="mt-3 flex items-start gap-3 text-sm">
                            <input
                                type="checkbox"
                                checked={layout.enabled}
                                onChange={(event) => onChange({ ...layout, enabled: event.target.checked })}
                                className="mt-1 h-4 w-4"
                            />
                            <span>Usar posiciones personalizadas</span>
                        </label>
                        <p className="mt-2 text-xs text-muted-foreground">Al ocultar membrete, se usaran estas posiciones.</p>
                    </div>

                    <div className="rounded-2xl border bg-muted/25 p-4">
                        <h3 className="font-semibold">Tamano de Pagina</h3>
                        <Select value={layout.paperSize} onValueChange={(value) => onChange({ ...layout, paperSize: value as RecipePaperSizeId })}>
                            <SelectTrigger className="mt-3"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="media-carta">Media Carta (14 x 21.5 cm)</SelectItem>
                                <SelectItem value="carta">Carta (21.59 x 27.94 cm)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="rounded-2xl border bg-muted/25 p-4">
                        <h3 className="font-semibold">Imagen de Guia</h3>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGuideUpload} />
                        <Button variant="outline" className="mt-3 w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                            <Upload className="h-4 w-4" />
                            Subir foto
                        </Button>
                        {layout.backgroundImage ? (
                            <div className="mt-3 flex gap-2">
                                <Button variant="ghost" className="flex-1 gap-2" onClick={() => setShowBackground((value) => !value)}>
                                    {showBackground ? <EyeOffIcon /> : <Eye className="h-4 w-4" />}
                                    {showBackground ? "Ocultar" : "Mostrar"}
                                </Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => onChange({ ...layout, backgroundImage: null })}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    <div className="rounded-2xl border bg-muted/25 p-4">
                        <h3 className="font-semibold">Elementos y Tamano de Letra</h3>
                        <div className="mt-3 space-y-2">
                            {(Object.keys(layout.elements) as RecipeElementKey[]).map((key) => {
                                const element = layout.elements[key];
                                const selected = selectedElement === key;
                                return (
                                    <button
                                        type="button"
                                        key={key}
                                        onClick={() => setSelectedElement(key)}
                                        className={cn(
                                            "w-full rounded-2xl border bg-background p-3 text-left transition",
                                            selected ? "border-primary bg-primary/10" : "hover:bg-muted/50",
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={element.visible}
                                                onClick={(event) => event.stopPropagation()}
                                                onChange={(event) => updateElement(key, { visible: event.target.checked })}
                                            />
                                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: RECIPE_ELEMENT_COLORS[key] }} />
                                            <span className="text-sm font-medium">{element.label}</span>
                                        </div>
                                        <div className="mt-2 flex items-center gap-2 pl-5">
                                            <select
                                                value={element.fontSize}
                                                onClick={(event) => event.stopPropagation()}
                                                onChange={(event) => updateElement(key, { fontSize: Number(event.target.value) })}
                                                className="rounded-full border bg-background px-2 py-1 text-xs"
                                            >
                                                {[8, 9, 10, 11, 12, 14, 16].map((size) => (
                                                    <option key={size} value={size}>{size}pt</option>
                                                ))}
                                            </select>
                                            <Button
                                                type="button"
                                                variant={element.bold ? "default" : "outline"}
                                                size="sm"
                                                className="h-8 w-8 rounded-full p-0 font-bold"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    updateElement(key, { bold: !element.bold });
                                                }}
                                            >
                                                B
                                            </Button>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </aside>

                <main className="min-w-0 overflow-auto bg-slate-200 p-6">
                    <div className="mb-4 flex items-center justify-between">
                        <p className="text-sm text-slate-700">Vista previa (arrastra elementos)</p>
                        <div className="flex rounded-full bg-white p-1 shadow-sm">
                            {[1, 1.5, 2].map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setZoom(value)}
                                    className={cn("rounded-full px-4 py-1 text-sm font-semibold", zoom === value ? "bg-primary text-primary-foreground" : "text-slate-700")}
                                >
                                    {Math.round(value * 100)}%
                                </button>
                            ))}
                        </div>
                        <p className="text-sm font-semibold">{paper.widthCm}cm x {paper.heightCm}cm</p>
                    </div>
                    <div className="min-w-max pb-12">
                        <div
                            style={{ width: paper.widthPx * zoom, height: paper.heightPx * zoom }}
                            onPointerMove={handlePointerMove}
                            onPointerUp={() => { dragStateRef.current = null; }}
                            onPointerLeave={() => { dragStateRef.current = null; }}
                        >
                            <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                                <RecipeSheet
                                    patient={patient}
                                    consultation={consultation}
                                    paperSize={layout.paperSize}
                                    showLetterhead={false}
                                    layout={layout}
                                    showGuide={showBackground}
                                    editorMode
                                    selectedElement={selectedElement}
                                    onSelectElement={setSelectedElement}
                                    onElementPointerDown={(event, key) => beginDrag(event, key, "move")}
                                    onResizePointerDown={(event, key) => beginDrag(event, key, "resize")}
                                />
                            </div>
                        </div>
                    </div>
                </main>

                <aside className="min-h-0 space-y-4 overflow-y-auto border-l bg-background p-4">
                    <div className="rounded-2xl border p-4">
                        <h3 className="font-semibold">Diseño de Receta Personalizado</h3>
                        <p className="mt-3 text-sm text-muted-foreground">Personaliza la posicion de los elementos para que coincidan con papel pre-impreso.</p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                        <h3 className="font-semibold">Como funciona</h3>
                        <p className="mt-3 text-sm">1. Sube una foto de tu recetario vacio como guia.</p>
                        <p className="mt-2 text-sm">2. Arrastra nombre, fecha, medicamentos, diagnostico e indicaciones.</p>
                        <p className="mt-2 text-sm">3. Guarda la configuracion.</p>
                        <p className="mt-2 text-sm">4. Al imprimir sin membrete, el texto caera en esas posiciones.</p>
                    </div>
                    <div className="rounded-2xl border p-4">
                        <h3 className="font-semibold">Estado actual</h3>
                        <p className={cn("mt-3 text-sm font-semibold", layout.enabled ? "text-emerald-600" : "text-muted-foreground")}>
                            {layout.enabled ? "Diseño personalizado activo" : "Diseño personalizado inactivo"}
                        </p>
                    </div>
                    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 text-primary">
                        <h3 className="font-semibold">Controles</h3>
                        <p className="mt-3 text-sm">Arrastra para mover elementos.</p>
                        <p className="mt-2 text-sm">Arrastra la esquina para redimensionar.</p>
                        <p className="mt-2 text-sm">Cambia tamaño y negritas en el panel izquierdo.</p>
                    </div>
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-600">
                        La imagen de guia no se imprime, solo sirve para posicionar.
                    </div>
                </aside>
            </div>
        </div>
    );
}

function EyeOffIcon() {
    return <Eye className="h-4 w-4 opacity-50" />;
}

function RecipePrintDialog({
    open,
    patient,
    consultation,
    isPreparing,
    onOpenChange,
    onSend,
}: {
    open: boolean;
    patient: PatientDetail;
    consultation: Consultation | null;
    isPreparing: boolean;
    onOpenChange: (open: boolean) => void;
    onSend: (blob: Blob) => Promise<void>;
}) {
    const [layout, setLayout] = useState<RecipeLayoutSettings>(() => cloneRecipeLayout(DEFAULT_RECIPE_LAYOUT));
    const [paperSize, setPaperSize] = useState<RecipePaperSizeId>("media-carta");
    const [showLetterhead, setShowLetterhead] = useState(true);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingContent, setEditingContent] = useState(false);
    const [contentDraft, setContentDraft] = useState<RecipeContentDraft>(() => consultation ? defaultRecipeContentDraft(consultation) : { medications: [], indications: "", diagnosis: "" });
    const [isPrinting, setIsPrinting] = useState(false);
    const sheetRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (!open) return;
        const stored = loadRecipeLayout();
        setLayout(stored);
        setPaperSize(stored.paperSize);
        setShowLetterhead(true);
        setEditorOpen(false);
        setEditingContent(false);
        if (consultation) {
            setContentDraft(defaultRecipeContentDraft(consultation));
        }
    }, [consultation, open]);

    if (!consultation) return null;

    const activeLayout = { ...layout, paperSize };
    const paper = RECIPE_PAPER_SIZES[paperSize];

    const handleSaveLayout = () => {
        const next = { ...layout, paperSize: layout.paperSize };
        saveRecipeLayout(next);
        setPaperSize(next.paperSize);
        setLayout(next);
        setEditorOpen(false);
        toast({ title: "Diseño de receta guardado" });
    };

    const handleResetLayout = () => {
        const next = cloneRecipeLayout(DEFAULT_RECIPE_LAYOUT);
        setLayout(next);
        setPaperSize(next.paperSize);
        saveRecipeLayout(next);
        toast({ title: "Diseño restablecido" });
    };

    const handlePrint = async () => {
        if (!sheetRef.current) return;
        setIsPrinting(true);
        try {
            const { toPng } = await import("html-to-image");
            const dataUrl = await toPng(sheetRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: "#ffffff" });
            const win = window.open("", "_blank", "width=900,height=1000");
            if (!win) throw new Error("No se pudo abrir la ventana de impresion.");
            win.document.write(`<!doctype html><html><head><title>Receta</title><style>
                body{margin:0;background:#fff}
                img{display:block;width:${paper.widthCm}cm;height:${paper.heightCm}cm}
                @page{size:${paper.widthCm}cm ${paper.heightCm}cm;margin:0}
                @media print{body{margin:0}}
            </style></head><body><img src="${dataUrl}" onload="setTimeout(() => window.print(), 200)" /></body></html>`);
            win.document.close();
            win.focus();
        } catch (error) {
            toast({
                title: "No se pudo imprimir",
                description: error instanceof Error ? error.message : "Intentalo de nuevo.",
                variant: "destructive",
            });
        } finally {
            setIsPrinting(false);
        }
    };

    const handleSend = async () => {
        if (!sheetRef.current) return;
        const blob = await createRecipePdfBlobFromElement(sheetRef.current, paperSize);
        await onSend(blob);
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !isPreparing && onOpenChange(nextOpen)}>
            <DialogContent
                showCloseButton={false}
                className="h-[94vh] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
                style={{
                    width: "min(1320px, calc(100vw - 32px))",
                    maxWidth: "calc(100vw - 32px)",
                }}
            >
                {editorOpen ? (
                    <RecipeLayoutEditorPanel
                        patient={patient}
                        consultation={consultation}
                        layout={layout}
                        onChange={setLayout}
                        onBack={() => setEditorOpen(false)}
                        onSave={handleSaveLayout}
                        onReset={handleResetLayout}
                    />
                ) : (
                    <div className="flex h-full min-h-0 flex-col bg-slate-100">
                        <div className="flex min-h-16 shrink-0 flex-col gap-3 border-b bg-background px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between lg:py-0">
                            <Button variant="ghost" onClick={() => onOpenChange(false)} className="gap-2">
                                <ArrowRight className="h-4 w-4 rotate-180" />
                                Volver
                            </Button>
                            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                <Select value={paperSize} onValueChange={(value) => {
                                    const next = value as RecipePaperSizeId;
                                    setPaperSize(next);
                                    setLayout((prev) => ({ ...prev, paperSize: next }));
                                }}>
                                    <SelectTrigger className="w-[160px] rounded-full">
                                        <FileText className="mr-2 h-4 w-4" />
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="media-carta">Media Carta</SelectItem>
                                        <SelectItem value="carta">Carta</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button variant={showLetterhead ? "secondary" : "outline"} className="gap-2 rounded-full" onClick={() => setShowLetterhead((value) => !value)}>
                                    <Eye className="h-4 w-4" />
                                    Membrete
                                </Button>
                                <Button
                                    variant={editingContent ? "secondary" : "outline"}
                                    className="gap-2 rounded-full"
                                    onClick={() => setEditingContent((value) => !value)}
                                >
                                    {editingContent ? <Check className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
                                    {editingContent ? "Listo" : "Editar"}
                                </Button>
                                <Button className="gap-2 rounded-full" onClick={handlePrint} disabled={isPrinting || isPreparing}>
                                    {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                                    Imprimir
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="rounded-full"
                                    onClick={() => {
                                        setEditingContent(false);
                                        setEditorOpen(true);
                                    }}
                                    title="Configurar posiciones"
                                >
                                    <Settings className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto p-6">
                            <div className="flex min-w-max justify-center px-2">
                                <div ref={sheetRef}>
                                    <RecipeSheet
                                        patient={patient}
                                        consultation={consultation}
                                        paperSize={paperSize}
                                        showLetterhead={showLetterhead}
                                        layout={activeLayout}
                                        contentDraft={contentDraft}
                                        editingContent={editingContent}
                                        onContentDraftChange={setContentDraft}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex shrink-0 justify-end gap-3 border-t bg-background px-5 py-4">
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPreparing}>
                                Cancelar
                            </Button>
                            <Button onClick={handleSend} disabled={isPreparing} className="gap-2">
                                {isPreparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <WhatsAppIcon className="h-4 w-4" />}
                                Enviar
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function OpticalPrescriptionSheet({
    patient,
    consultation,
    draft,
    paperSize,
    showLetterhead,
    editingContent,
    onDraftChange,
}: {
    patient: PatientDetail;
    consultation: Consultation;
    draft: OpticalPrescriptionDraft;
    paperSize: RecipePaperSizeId;
    showLetterhead: boolean;
    editingContent: boolean;
    onDraftChange: (draft: OpticalPrescriptionDraft) => void;
}) {
    const operationContext = useOperationContext();
    const clinicProfile = useClinicPrescriptionProfile();
    const paper = RECIPE_PAPER_SIZES[paperSize];
    const patientAge = ageLabel(patient.dob, operationContext.timeZone, "-");
    const logoSize = `${clinicProfile.clinicLogoScale}%`;
    const professional = resolveConsultationProfessional(consultation, clinicProfile);

    const update = (field: keyof OpticalPrescriptionDraft, value: string) => {
        onDraftChange({ ...draft, [field]: value });
    };

    const renderValue = (field: keyof OpticalPrescriptionDraft) => {
        if (!editingContent) return draft[field] || "-";
        return (
            <input
                className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-center text-[12px] outline-primary"
                value={draft[field]}
                onChange={(event) => update(field, event.target.value)}
            />
        );
    };

    return (
        <div
            className="relative bg-white text-slate-950 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.7)]"
            style={{ width: paper.widthPx, height: paper.heightPx }}
        >
            <div className="relative h-full p-[48px]">
                <header>
                    {showLetterhead ? (
                        <>
                            <div className="grid grid-cols-[72px_1.25fr_1fr_1fr] items-center gap-4">
                                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-primary/15 bg-primary/10 text-primary">
                                    {clinicProfile.clinicLogoUrl ? (
                                        <img
                                            src={clinicProfile.clinicLogoUrl}
                                            alt="Logotipo"
                                            className="object-contain"
                                            style={{ width: logoSize, height: logoSize }}
                                        />
                                    ) : (
                                        <Plus className="h-7 w-7" />
                                    )}
                                </div>
                                <div className="min-w-0 text-[12px] leading-tight">
                                    <p className="whitespace-pre-wrap text-lg font-bold leading-tight">{clinicProfile.clinicName}</p>
                                    <p className="mt-1 text-slate-600">{clinicProfile.clinicSubtitle}</p>
                                </div>
                                <div className="min-w-0 text-center leading-tight">
                                    <p className="text-base font-bold">{professional.doctorName}</p>
                                    <p className="mt-1 text-[12px] text-primary">{professional.doctorTitle}</p>
                                </div>
                                <div className="min-w-0 text-right text-[10px] leading-tight text-slate-500">
                                    <p>{professional.doctorProfessionalLicense ? `Ced. Prof. ${professional.doctorProfessionalLicense}` : "Ced. Prof. __________"}</p>
                                    <p className="mt-1">{clinicProfile.clinicName}</p>
                                </div>
                            </div>
                            <div className="mt-4 border-b-[3px] border-primary" />
                        </>
                    ) : (
                        <div className="h-24" />
                    )}
                </header>

                <section className="mt-3 grid grid-cols-2 gap-4 text-[13px]">
                    <div>
                        <p><span className="text-slate-500">Paciente: </span><span className="font-bold">{patientName(patient)}</span></p>
                        <p><span className="text-slate-500">Edad: </span><span className="font-bold">{patientAge}</span></p>
                    </div>
                    <div className="text-right">
                        <p><span className="text-slate-500">Fecha: </span><span className="font-bold">{formatDate(consultation.createdAt, "-", operationContext.locale, operationContext.timeZone)}</span></p>
                        <p><span className="text-slate-500">Telefono: </span><span className="font-bold">{patient.phone || "-"}</span></p>
                    </div>
                </section>

                <section className="mt-7 rounded-2xl border border-primary/25 bg-primary/5 px-5 py-4">
                    <h1 className="text-[24px] font-bold leading-none">Receta optica profesional</h1>
                    <p className="mt-2 text-[16px] text-slate-700">Graduacion indicada para elaboracion de lentes.</p>
                </section>

                <section className="mt-6 overflow-hidden rounded-2xl border border-slate-300">
                    <table className="w-full border-collapse text-[14px]">
                        <thead className="bg-slate-50 text-[12px] uppercase tracking-wide text-slate-600">
                            <tr>
                                <th className="border-b border-r border-slate-300 px-3 py-3 text-left">Ojo</th>
                                <th className="border-b border-r border-slate-300 px-3 py-3">Esfera</th>
                                <th className="border-b border-r border-slate-300 px-3 py-3">Cilindro</th>
                                <th className="border-b border-r border-slate-300 px-3 py-3">Eje</th>
                                <th className="border-b border-r border-slate-300 px-3 py-3">ADD</th>
                                <th className="border-b border-slate-300 px-3 py-3">DP</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="border-r border-slate-300 px-3 py-4 text-lg font-bold">OD</td>
                                <td className="border-r border-slate-300 px-3 py-4 text-center text-lg">{renderValue("odSphere")}</td>
                                <td className="border-r border-slate-300 px-3 py-4 text-center text-lg">{renderValue("odCylinder")}</td>
                                <td className="border-r border-slate-300 px-3 py-4 text-center text-lg">{renderValue("odAxis")}</td>
                                <td className="border-r border-slate-300 px-3 py-4 text-center text-lg">{renderValue("odAdd")}</td>
                                <td className="px-3 py-4 text-center text-lg">{renderValue("odDp")}</td>
                            </tr>
                            <tr className="border-t border-slate-300">
                                <td className="border-r border-slate-300 px-3 py-4 text-lg font-bold">OI</td>
                                <td className="border-r border-slate-300 px-3 py-4 text-center text-lg">{renderValue("oiSphere")}</td>
                                <td className="border-r border-slate-300 px-3 py-4 text-center text-lg">{renderValue("oiCylinder")}</td>
                                <td className="border-r border-slate-300 px-3 py-4 text-center text-lg">{renderValue("oiAxis")}</td>
                                <td className="border-r border-slate-300 px-3 py-4 text-center text-lg">{renderValue("oiAdd")}</td>
                                <td className="px-3 py-4 text-center text-lg">{renderValue("oiDp")}</td>
                            </tr>
                        </tbody>
                    </table>
                </section>

                <section className="mt-7 grid grid-cols-2 gap-5 text-[14px]">
                    <div className="rounded-2xl border border-slate-300 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Tipo de lente</p>
                        {editingContent ? (
                            <Input className="mt-3" value={draft.lensType} onChange={(event) => update("lensType", event.target.value)} />
                        ) : (
                            <p className="mt-2 whitespace-pre-wrap text-lg">{draft.lensType || "-"}</p>
                        )}
                    </div>
                    <div className="rounded-2xl border border-slate-300 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Observaciones</p>
                        {editingContent ? (
                            <Textarea className="mt-3 min-h-[72px] resize-none" value={draft.observations} onChange={(event) => update("observations", event.target.value)} />
                        ) : (
                            <p className="mt-2 whitespace-pre-wrap text-lg">{draft.observations || "-"}</p>
                        )}
                    </div>
                </section>

                <footer className="absolute bottom-[48px] left-[48px] right-[48px] grid grid-cols-2 items-end gap-8 text-[12px]">
                    <p className="whitespace-pre-wrap text-slate-700">{clinicProfile.clinicAddress}</p>
                    <div className="text-center">
                        <div className="mx-auto mb-2 h-px w-48 bg-slate-500" />
                        <p className="font-medium">{professional.doctorName}</p>
                        <p>{professional.doctorProfessionalLicense ? `Ced. Prof. ${professional.doctorProfessionalLicense}` : "Ced. Prof. __________"}</p>
                    </div>
                </footer>
            </div>
        </div>
    );
}

function OpticalPrescriptionPrintDialog({
    open,
    patient,
    consultation,
    onOpenChange,
}: {
    open: boolean;
    patient: PatientDetail;
    consultation: Consultation | null;
    onOpenChange: (open: boolean) => void;
}) {
    const [paperSize, setPaperSize] = useState<RecipePaperSizeId>("carta");
    const [showLetterhead, setShowLetterhead] = useState(true);
    const [editingContent, setEditingContent] = useState(false);
    const [draft, setDraft] = useState<OpticalPrescriptionDraft>(() => opticalPrescriptionFromConsultation(consultation));
    const [isPrinting, setIsPrinting] = useState(false);
    const sheetRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (!open) return;
        setPaperSize("carta");
        setShowLetterhead(true);
        setEditingContent(false);
        setDraft(opticalPrescriptionFromConsultation(consultation));
    }, [consultation, open]);

    if (!consultation) return null;

    const paper = RECIPE_PAPER_SIZES[paperSize];

    const handlePrint = async () => {
        if (!sheetRef.current) return;
        setIsPrinting(true);
        try {
            const { toPng } = await import("html-to-image");
            const dataUrl = await toPng(sheetRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: "#ffffff" });
            const win = window.open("", "_blank", "width=940,height=1060");
            if (!win) throw new Error("No se pudo abrir la ventana de impresion.");
            win.document.write(`<!doctype html><html><head><title>Receta optica</title><style>
                body{margin:0;background:#fff}
                img{display:block;width:${paper.widthCm}cm;height:${paper.heightCm}cm}
                @page{size:${paper.widthCm}cm ${paper.heightCm}cm;margin:0}
                @media print{body{margin:0}}
            </style></head><body><img src="${dataUrl}" onload="setTimeout(() => window.print(), 200)" /></body></html>`);
            win.document.close();
            win.focus();
        } catch (error) {
            toast({
                title: "No se pudo imprimir",
                description: error instanceof Error ? error.message : "Intentalo de nuevo.",
                variant: "destructive",
            });
        } finally {
            setIsPrinting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="h-[94vh] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
                style={{ width: "min(1320px, calc(100vw - 32px))", maxWidth: "calc(100vw - 32px)" }}
            >
                <div className="flex h-full min-h-0 flex-col bg-slate-100">
                    <div className="flex min-h-16 shrink-0 flex-col gap-3 border-b bg-background px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between lg:py-0">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} className="gap-2">
                            <ArrowRight className="h-4 w-4 rotate-180" />
                            Volver
                        </Button>
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                            <Select value={paperSize} onValueChange={(value) => setPaperSize(value as RecipePaperSizeId)}>
                                <SelectTrigger className="w-[160px] rounded-full">
                                    <FileText className="mr-2 h-4 w-4" />
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="media-carta">Media Carta</SelectItem>
                                    <SelectItem value="carta">Carta</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button variant={showLetterhead ? "secondary" : "outline"} className="gap-2 rounded-full" onClick={() => setShowLetterhead((value) => !value)}>
                                <Eye className="h-4 w-4" />
                                Membrete
                            </Button>
                            <Button variant={editingContent ? "secondary" : "outline"} className="gap-2 rounded-full" onClick={() => setEditingContent((value) => !value)}>
                                {editingContent ? <Check className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
                                {editingContent ? "Listo" : "Editar"}
                            </Button>
                            <Button className="gap-2 rounded-full" onClick={handlePrint} disabled={isPrinting}>
                                {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                                Imprimir
                            </Button>
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto p-6">
                        <div className="flex min-w-max justify-center px-2">
                            <div ref={sheetRef}>
                                <OpticalPrescriptionSheet
                                    patient={patient}
                                    consultation={consultation}
                                    draft={draft}
                                    paperSize={paperSize}
                                    showLetterhead={showLetterhead}
                                    editingContent={editingContent}
                                    onDraftChange={setDraft}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 justify-end gap-3 border-t bg-background px-5 py-4">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handlePrint} disabled={isPrinting} className="gap-2">
                            {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                            Imprimir
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function ConsultationsTab({
    patient,
    onFollowUp,
    onOpenAnalysis,
    onSaved,
}: {
    patient: PatientDetail;
    onFollowUp: (consultation: Consultation) => void;
    onOpenAnalysis: () => void;
    onSaved: () => void;
}) {
    const operationContext = useOperationContext();
    const clinicProfile = useClinicPrescriptionProfile();
    const [noteConsultationId, setNoteConsultationId] = useState("none");
    const [noteText, setNoteText] = useState("");
    const [recipeToSend, setRecipeToSend] = useState<Consultation | null>(null);
    const [opticalToPrint, setOpticalToPrint] = useState<Consultation | null>(null);
    const [isPreparingRecipe, setIsPreparingRecipe] = useState(false);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();
    const { toast } = useToast();

    const handleSaveNote = () => {
        startTransition(async () => {
            const result = await saveEvolutionNote({
                patientId: patient.id,
                consultationId: noteConsultationId === "none" ? undefined : noteConsultationId,
                note: noteText,
                doctorName: "Joel Venegas",
            });
            if (!result.success) {
                toast({ title: "Error", description: result.error || "No se pudo guardar.", variant: "destructive" });
                return;
            }
            toast({ title: "Evolucion guardada" });
            setNoteText("");
            setNoteConsultationId("none");
            onSaved();
        });
    };

    const openRecipeSendDialog = (consultation: Consultation) => {
        setRecipeToSend(consultation);
    };

    const handlePrepareRecipeForChat = async (pdfBlob: Blob) => {
        if (!recipeToSend) return;

        setIsPreparingRecipe(true);
        try {
            const conversationId = await prepareRecipeDraftForChat(patient, recipeToSend, pdfBlob, operationContext);
            setRecipeToSend(null);
            toast({ title: "Receta lista", description: "Abriendo el chat del paciente con el PDF preparado." });
            router.push(`/dashboard/inbox?conversationId=${encodeURIComponent(conversationId)}&draft=patient-prescription`);
        } catch (error) {
            toast({
                title: "No se pudo preparar la receta",
                description: error instanceof Error ? error.message : "Intentalo de nuevo.",
                variant: "destructive",
            });
        } finally {
            setIsPreparingRecipe(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" className="gap-2 text-primary" onClick={() => sendWhatsApp(patient.phone, `Hola ${patientName(patient)}, te compartimos tu historia clinica.`)}>
                    <WhatsAppIcon className="h-4 w-4" />
                    Enviar historia
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => printFullHistory(patient, operationContext)}>
                    <Printer className="h-4 w-4" />
                    Imprimir historia clinica
                </Button>
            </div>

            <Card className="rounded-2xl">
                <CardContent className="grid gap-4 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
                    <div>
                        <h3 className="font-bold">Agregar nota de evolucion</h3>
                        <p className="text-sm text-muted-foreground">Puedes registrar evolucion general o asociarla a una consulta.</p>
                        <Label className="mt-4 block">Consulta asociada (opcional)</Label>
                        <Select value={noteConsultationId} onValueChange={setNoteConsultationId}>
                            <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Sin consulta</SelectItem>
                                {patient.consultations.map((consultation) => (
                                    <SelectItem key={consultation.id} value={consultation.id}>
                                        {formatDate(consultation.createdAt, "-", operationContext.locale, operationContext.timeZone)} - {consultationDisplayTitle(consultation)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Nota</Label>
                        <Textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={4} placeholder="Evolucion clinica, sintomas, indicaciones..." />
                        <div className="flex justify-end">
                            <Button onClick={handleSaveNote} disabled={isPending || !noteText.trim()}>
                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Guardar evolucion
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {patient.consultations.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">No hay consultas registradas para este paciente.</div>
            ) : patient.consultations.map((consultation) => {
                const requests = getConsultationStudyRequests(consultation);
                const firstRequest = requests[0];
                const isOpticalPrescription = consultation.type === "optical_prescription";
                const professional = resolveConsultationProfessional(consultation, clinicProfile);
                return (
                    <Card key={consultation.id} className="rounded-2xl">
                        <CardContent className="space-y-4 p-4">
                            <div>
                                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Calendar className="h-4 w-4" />
                                    {formatDateTime(consultation.createdAt, "-", operationContext.locale, operationContext.timeZone)}
                                </p>
                                <h3 className="text-lg font-bold">{consultationDisplayTitle(consultation)}</h3>
                                <p className="text-sm text-muted-foreground">Medico: {professional.doctorName}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {isOpticalPrescription ? (
                                    <Button variant="outline" size="sm" disabled={!hasOpticalPrescription(consultation)} onClick={() => setOpticalToPrint(consultation)}>
                                        <Printer className="h-4 w-4" />
                                        Imprimir receta optica
                                    </Button>
                                ) : (
                                    <>
                                        <Button variant="outline" size="sm" onClick={() => onFollowUp(consultation)}>
                                            <span className="font-bold">#</span>
                                            Seguimiento
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={onOpenAnalysis}>
                                            <FlaskConical className="h-4 w-4" />
                                            Analisis
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => openRecipeSendDialog(consultation)}>
                                            <Printer className="h-4 w-4" />
                                            Receta
                                        </Button>
                                        <Button variant="outline" size="sm" disabled={!hasOpticalPrescription(consultation)} onClick={() => setOpticalToPrint(consultation)}>
                                            <Eye className="h-4 w-4" />
                                            Receta optica
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => openRecipeSendDialog(consultation)}>
                                            <WhatsAppIcon className="h-4 w-4 text-primary" />
                                            Enviar receta
                                        </Button>
                                        <Button variant="outline" size="sm" disabled={!firstRequest} onClick={() => firstRequest && printStudyRequest(patient, firstRequest, operationContext)}>
                                            <ClipboardList className="h-4 w-4" />
                                            Solicitud estudios
                                        </Button>
                                        <Button variant="outline" size="sm" className="text-primary" disabled={!firstRequest} onClick={() => {
                                            if (!firstRequest) return;
                                            const studies = firstRequest.studies?.join(", ") || firstRequest.customStudies || "estudios solicitados";
                                            const ok = sendWhatsApp(patient.phone, `Hola ${patientName(patient)}, te compartimos tu solicitud de estudios: ${studies}.`);
                                            if (!ok) toast({ title: "Sin telefono", description: "El paciente no tiene telefono registrado.", variant: "destructive" });
                                        }}>
                                            <WhatsAppIcon className="h-4 w-4" />
                                            Enviar estudios
                                        </Button>
                                    </>
                                )}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-xl border p-3">
                                    <p className="text-xs font-semibold uppercase text-muted-foreground">Diagnostico</p>
                                    <p className="mt-2 text-sm">{consultation.diagnosis || "-"}</p>
                                </div>
                                <div className="rounded-xl border p-3">
                                    <p className="text-xs font-semibold uppercase text-muted-foreground">Plan de tratamiento</p>
                                    <p className="mt-2 whitespace-pre-wrap text-sm">{consultation.treatmentPlan || "-"}</p>
                                </div>
                            </div>
                            {consultation.notes ? (
                                <div className="rounded-xl bg-muted/50 p-3 text-sm">
                                    <p className="font-semibold">Nota de evolucion / Inspec. General</p>
                                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{consultation.notes}</p>
                                </div>
                            ) : null}
                            <OphthalmologySummary consultation={consultation} />
                            {consultation.evolutionNotes.length > 0 ? (
                                <div className="space-y-2">
                                    <p className="text-sm font-semibold">Notas de evolucion</p>
                                    {consultation.evolutionNotes.map((note) => (
                                        <div key={note.id} className="rounded-xl border bg-background p-3 text-sm">
                                            <p className="text-xs text-muted-foreground">{formatDateTime(note.createdAt, "-", operationContext.locale, operationContext.timeZone)} - {note.doctorName || "Sin medico"}</p>
                                            <p className="mt-1 whitespace-pre-wrap">{note.note}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                );
            })}
            <RecipePrintDialog
                open={Boolean(recipeToSend)}
                patient={patient}
                consultation={recipeToSend}
                isPreparing={isPreparingRecipe}
                onOpenChange={(open) => {
                    if (!open && !isPreparingRecipe) {
                        setRecipeToSend(null);
                    }
                }}
                onSend={handlePrepareRecipeForChat}
            />
            <OpticalPrescriptionPrintDialog
                open={Boolean(opticalToPrint)}
                patient={patient}
                consultation={opticalToPrint}
                onOpenChange={(open) => {
                    if (!open) setOpticalToPrint(null);
                }}
            />
        </div>
    );
}

function OphthalmologySummary({ consultation }: { consultation: Consultation }) {
    const studies = asRecord(consultation.studies);
    const optical = asRecord(studies.opticalPrescription);
    const glaucoma = asRecord(studies.glaucoma);
    const retina = asRecord(studies.retina);
    const surgery = asRecord(studies.surgery);
    const education = asRecord(studies.education);
    const hasGlaucoma = [glaucoma.pioOd, glaucoma.pioOi, glaucoma.cupOd, glaucoma.cupOi, glaucoma.visualField, glaucoma.octNerve].some((value) => String(value || "").trim());
    const hasRetina = [retina.fundus, retina.diabeticRetinopathy, retina.macularOct, retina.procedures].some((value) => String(value || "").trim());
    const hasSurgery = [surgery.type, surgery.checklist, surgery.preopStudies, surgery.postopFollowup].some((value) => String(value || "").trim()) || Boolean(surgery.consentSigned);
    const hasEducation = [education.article, education.preStudyInstructions, education.postStudyInstructions, education.automaticMessage].some((value) => String(value || "").trim());

    if (!hasOpticalPrescription(consultation) && !hasGlaucoma && !hasRetina && !hasSurgery && !hasEducation) return null;

    return (
        <div className="grid gap-3 md:grid-cols-2">
            {hasOpticalPrescription(consultation) ? (
                <InfoBox
                    label="Receta optica"
                    value={[
                        `OD: esf ${optical.odSphere || "-"} cil ${optical.odCylinder || "-"} eje ${optical.odAxis || "-"}`,
                        `OI: esf ${optical.oiSphere || "-"} cil ${optical.oiCylinder || "-"} eje ${optical.oiAxis || "-"}`,
                        `Lente: ${optical.lensType || "-"}`,
                    ].join("\n")}
                />
            ) : null}
            {hasGlaucoma ? (
                <InfoBox
                    label="Glaucoma"
                    value={[
                        `PIO OD/OI: ${glaucoma.pioOd || "-"}/${glaucoma.pioOi || "-"} mmHg`,
                        `Excavacion OD/OI: ${glaucoma.cupOd || "-"}/${glaucoma.cupOi || "-"}`,
                        glaucoma.currentTreatment ? `Tratamiento: ${glaucoma.currentTreatment}` : "",
                    ].filter(Boolean).join("\n")}
                />
            ) : null}
            {hasRetina ? (
                <InfoBox
                    label="Retina / Diabetes"
                    value={[
                        retina.diabeticRetinopathy ? `RD: ${retina.diabeticRetinopathy}` : "",
                        retina.macularOct ? `OCT: ${retina.macularOct}` : "",
                        retina.procedures ? `Procedimientos: ${retina.procedures}` : "",
                    ].filter(Boolean).join("\n")}
                />
            ) : null}
            {hasSurgery ? (
                <InfoBox
                    label="Cirugia"
                    value={[
                        surgery.type ? `Tipo: ${surgery.type}` : "",
                        surgery.consentSigned ? "Consentimiento firmado" : "Consentimiento pendiente",
                        surgery.preopStudies ? `Prequirurgicos: ${surgery.preopStudies}` : "",
                    ].filter(Boolean).join("\n")}
                />
            ) : null}
            {hasEducation ? (
                <InfoBox
                    label="Educacion"
                    value={[
                        education.article ? `Tema: ${education.article}` : "",
                        education.automaticMessage ? education.automaticMessage : "",
                    ].filter(Boolean).join("\n")}
                />
            ) : null}
        </div>
    );
}

function OpticalPrescriptionTab({ patient, onSaved }: { patient: PatientDetail; onSaved: () => void }) {
    const operationContext = useOperationContext();
    const clinicProfile = useClinicPrescriptionProfile();
    const [form, setForm] = useState<OpticalPrescriptionDraft>(() => opticalPrescriptionFromConsultation(latestOpticalPrescription(patient)));
    const [printConsultation, setPrintConsultation] = useState<Consultation | null>(null);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();
    const patientAge = ageLabel(patient.dob, operationContext.timeZone, "-");
    const latest = latestOpticalPrescription(patient);
    const canSave = hasOpticalPrescriptionDraft(form);

    useEffect(() => {
        setForm(opticalPrescriptionFromConsultation(latestOpticalPrescription(patient)));
    }, [patient.id]);

    const update = (field: keyof OpticalPrescriptionDraft, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const clearForm = () => {
        setForm(opticalPrescriptionFromConsultation(null));
    };

    const handleSaveAndPrint = () => {
        if (!canSave) {
            toast({ title: "Completa la receta optica", description: "Captura al menos un valor de graduacion, lente u observaciones.", variant: "destructive" });
            return;
        }

        startTransition(async () => {
            const result = await saveConsultation({
                patientId: patient.id,
                type: "optical_prescription",
                chiefComplaint: "Receta optica",
                notes: form.observations,
                diagnosis: "Receta optica",
                treatmentPlan: form.lensType ? `Tipo de lente: ${form.lensType}` : "",
                medications: [],
                studies: { opticalPrescription: form },
                doctorName: clinicProfile.doctorName,
                clinicName: clinicProfile.clinicName,
            });

            if (!result.success || !result.consultation) {
                toast({ title: "Error", description: result.error || "No se pudo guardar la receta optica.", variant: "destructive" });
                return;
            }

            const printableConsultation = {
                ...result.consultation,
                type: "optical_prescription",
                diagnosis: "Receta optica",
                treatmentPlan: form.lensType ? `Tipo de lente: ${form.lensType}` : "",
                studies: { opticalPrescription: form },
            } as unknown as Consultation;

            toast({ title: "Receta optica guardada" });
            setPrintConsultation(printableConsultation);
            onSaved();
        });
    };

    return (
        <div className="space-y-4 pb-4">
            <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Eye className="h-7 w-7" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold">{patientName(patient)}</h2>
                            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1"><Calendar className="h-4 w-4" /> {patientAge}</span>
                                <span className="flex items-center gap-1"><Phone className="h-4 w-4" /> {patient.phone || "-"}</span>
                                {latest ? <span>Ultima receta: {formatDate(latest.createdAt, "-", operationContext.locale, operationContext.timeZone)}</span> : <span>Sin receta optica previa</span>}
                            </div>
                        </div>
                    </div>
                    <div className="rounded-xl border bg-background px-4 py-2 text-sm text-muted-foreground">
                        {formatDateInOperationZone(new Date(), operationContext.locale, operationContext.timeZone, { weekday: "long", day: "numeric", month: "long" })}
                    </div>
                </div>
            </div>

            <Card className="rounded-2xl">
                <CardHeader>
                    <CardTitle className="text-lg">Receta Optica Profesional</CardTitle>
                    <p className="text-sm text-muted-foreground">Documento independiente para graduacion, tipo de lente, DP y observaciones.</p>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="overflow-x-auto rounded-2xl border">
                        <table className="w-full min-w-[760px] text-sm">
                            <thead className="bg-muted/60 text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left">Ojo</th>
                                    <th className="px-3 py-2 text-left">Esfera</th>
                                    <th className="px-3 py-2 text-left">Cilindro</th>
                                    <th className="px-3 py-2 text-left">Eje</th>
                                    <th className="px-3 py-2 text-left">ADD</th>
                                    <th className="px-3 py-2 text-left">DP</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="border-t">
                                    <td className="px-3 py-2 font-bold">OD</td>
                                    <td className="px-3 py-2"><Input value={form.odSphere} onChange={(event) => update("odSphere", event.target.value)} placeholder="-1.25" /></td>
                                    <td className="px-3 py-2"><Input value={form.odCylinder} onChange={(event) => update("odCylinder", event.target.value)} placeholder="-0.50" /></td>
                                    <td className="px-3 py-2"><Input value={form.odAxis} onChange={(event) => update("odAxis", event.target.value)} placeholder="180" /></td>
                                    <td className="px-3 py-2"><Input value={form.odAdd} onChange={(event) => update("odAdd", event.target.value)} placeholder="+2.00" /></td>
                                    <td className="px-3 py-2"><Input value={form.odDp} onChange={(event) => update("odDp", event.target.value)} placeholder="32" /></td>
                                </tr>
                                <tr className="border-t">
                                    <td className="px-3 py-2 font-bold">OI</td>
                                    <td className="px-3 py-2"><Input value={form.oiSphere} onChange={(event) => update("oiSphere", event.target.value)} placeholder="-1.00" /></td>
                                    <td className="px-3 py-2"><Input value={form.oiCylinder} onChange={(event) => update("oiCylinder", event.target.value)} placeholder="-0.75" /></td>
                                    <td className="px-3 py-2"><Input value={form.oiAxis} onChange={(event) => update("oiAxis", event.target.value)} placeholder="175" /></td>
                                    <td className="px-3 py-2"><Input value={form.oiAdd} onChange={(event) => update("oiAdd", event.target.value)} placeholder="+2.00" /></td>
                                    <td className="px-3 py-2"><Input value={form.oiDp} onChange={(event) => update("oiDp", event.target.value)} placeholder="32" /></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Tipo de lente" value={form.lensType} onChange={(value) => update("lensType", value)} placeholder="Monofocal, bifocal, progresivo, filtro azul..." />
                        <TextAreaField label="Observaciones" value={form.observations} onChange={(value) => update("observations", value)} rows={3} placeholder="Uso permanente, antirreflejante, control en..." />
                    </div>
                    <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={clearForm} disabled={isPending}>
                            Limpiar
                        </Button>
                        <Button onClick={handleSaveAndPrint} disabled={isPending || !canSave} className="min-w-52 gap-2">
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                            Guardar e imprimir
                        </Button>
                    </div>
                </CardContent>
            </Card>
            <OpticalPrescriptionPrintDialog
                open={Boolean(printConsultation)}
                patient={patient}
                consultation={printConsultation}
                onOpenChange={(open) => {
                    if (!open) setPrintConsultation(null);
                }}
            />
        </div>
    );
}

function ConsultationTab({
    patient,
    parent,
    onRecipeReady,
    onSaved,
    onCancel,
}: {
    patient: PatientDetail;
    parent?: Consultation | null;
    onRecipeReady: (consultation: Consultation) => void;
    onSaved: () => void;
    onCancel: () => void;
}) {
    const operationContext = useOperationContext();
    const [activeInnerTab, setActiveInnerTab] = useState<string>("consulta");
    const [form, setForm] = useState<ConsultationFormState>(defaultConsultationForm(parent));
    const [medicationHistory, setMedicationHistory] = useState<Medication[]>([]);
    const [studyFilter, setStudyFilter] = useState("");
    const [selectedStudies, setSelectedStudies] = useState<string[]>([]);
    const [customStudies, setCustomStudies] = useState("");
    const [analysisForm, setAnalysisForm] = useState({
        title: "",
        resultDate: getLocalDateString(operationContext.timeZone),
        notes: "",
        files: [] as FilePayload[],
    });
    const [showContext, setShowContext] = useState(true);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    useEffect(() => {
        setForm(defaultConsultationForm(parent));
    }, [parent?.id]);

    useEffect(() => {
        const stored = window.localStorage.getItem("zencrm_medication_history");
        setMedicationHistory(stored ? JSON.parse(stored) : []);
    }, []);

    const patientAge = ageLabel(patient.dob, operationContext.timeZone, "-");
    const bmi = useMemo(() => {
        const weight = Number(form.vitalSigns.weight || 0);
        const height = Number(form.vitalSigns.height || 0);
        if (!weight || !height) return null;
        const meters = height / 100;
        return Number((weight / (meters * meters)).toFixed(1));
    }, [form.vitalSigns.weight, form.vitalSigns.height]);

    const updateVitals = (field: keyof ConsultationFormState["vitalSigns"], value: string) => {
        setForm({ ...form, vitalSigns: { ...form.vitalSigns, [field]: value } });
    };

    const updateMedication = (index: number, field: keyof Medication, value: string) => {
        setForm({
            ...form,
            medications: form.medications.map((medication, medicationIndex) => medicationIndex === index ? { ...medication, [field]: value } : medication),
        });
    };

    const addMedication = (medication?: Medication) => {
        setForm({ ...form, medications: [...form.medications, medication || { name: "", dose: "", frequency: "", duration: "" }] });
    };

    const removeMedication = (index: number) => {
        setForm({ ...form, medications: form.medications.filter((_, medicationIndex) => medicationIndex !== index) });
    };

    const applyTranscriptSummary = (summaryData: unknown) => {
        if (typeof summaryData === "string") {
            setForm((current) => ({ ...current, notes: current.notes ? `${current.notes}\n\n${summaryData}` : summaryData }));
            return;
        }
        const data = asRecord(summaryData);
        setForm((current) => ({
            ...current,
            chiefComplaint: data.motivo_principal || current.chiefComplaint,
            notes: data.nota_evolucion ? (current.notes ? `${current.notes}\n\n${data.nota_evolucion}` : data.nota_evolucion) : current.notes,
            diagnosis: data.diagnostico || current.diagnosis,
            treatmentPlan: data.tratamiento || data.indicaciones || current.treatmentPlan,
            education: {
                ...current.education,
                automaticMessage: data.educacion_paciente || current.education.automaticMessage,
            },
            vitalSigns: {
                ...current.vitalSigns,
                temperature: data.signos_vitales?.temperatura || current.vitalSigns.temperature,
                heartRate: data.signos_vitales?.frecuencia_cardiaca || current.vitalSigns.heartRate,
                spO2: data.signos_vitales?.spo2 || current.vitalSigns.spO2,
                weight: data.signos_vitales?.peso || current.vitalSigns.weight,
                height: data.signos_vitales?.talla || current.vitalSigns.height,
            },
        }));
    };

    const handleFinalize = () => {
        startTransition(async () => {
            const cleanMeds = form.medications.filter((medication) => medication.name.trim());
            const studyNames = selectedStudies
                .map((id) => LAB_STUDIES_CATALOG.find((study) => study.id === id)?.name)
                .filter(Boolean) as string[];
            const studyRequest = studyNames.length || customStudies.trim()
                ? [{ id: `REQ-${Date.now()}`, date: getLocalDateString(operationContext.timeZone), studies: studyNames, customStudies: customStudies.trim() }]
                : [];

            const result = await saveConsultation({
                patientId: patient.id,
                parentId: parent?.id,
                appointmentId: form.appointmentId,
                chiefComplaint: form.chiefComplaint,
                notes: form.notes,
                diagnosis: form.diagnosis,
                treatmentPlan: form.treatmentPlan,
                vitalSigns: form.vitalSigns,
                medications: cleanMeds,
                studies: {
                    glaucoma: form.glaucoma,
                    retina: form.retina,
                    surgery: form.surgery,
                    education: form.education,
                    resultTitle: analysisForm.title,
                    resultDate: analysisForm.resultDate,
                    notes: analysisForm.notes,
                    files: analysisForm.files,
                },
                studyRequests: studyRequest,
                bmi,
                doctorName: form.doctorName,
                clinicName: form.clinicName,
            });

            if (!result.success || !result.consultation) {
                toast({ title: "Error", description: result.error || "No se pudo guardar la consulta.", variant: "destructive" });
                return;
            }

            if (analysisForm.title.trim() && analysisForm.files.length > 0) {
                await saveClinicalAnalysis({
                    patientId: patient.id,
                    kind: "result",
                    title: analysisForm.title,
                    resultDate: analysisForm.resultDate,
                    notes: analysisForm.notes,
                    files: analysisForm.files,
                });
            }

            if (studyRequest.length > 0) {
                await saveClinicalAnalysis({
                    patientId: patient.id,
                    kind: "request",
                    title: studyNames.join(", ") || customStudies.trim(),
                    studies: studyNames,
                    resultDate: getLocalDateString(operationContext.timeZone),
                    notes: customStudies,
                });
            }

            const nextHistory = [
                ...cleanMeds.map((medication) => ({ name: medication.name, dose: medication.dose, frequency: medication.frequency, duration: medication.duration })),
                ...medicationHistory,
            ].filter((medication, index, all) => all.findIndex((item) => item.name.toLowerCase() === medication.name.toLowerCase()) === index).slice(0, 50);
            window.localStorage.setItem("zencrm_medication_history", JSON.stringify(nextHistory));

            toast({ title: "Consulta guardada correctamente" });
            const printableConsultation = {
                ...result.consultation,
                medications: cleanMeds,
                treatmentPlan: form.treatmentPlan,
                diagnosis: form.diagnosis,
                studies: {
                    glaucoma: form.glaucoma,
                    retina: form.retina,
                    surgery: form.surgery,
                    education: form.education,
                },
            } as unknown as Consultation;
            onRecipeReady(printableConsultation);
            onSaved();
        });
    };

    const filteredStudies = LAB_STUDIES_CATALOG.filter((study) => study.name.toLowerCase().includes(studyFilter.toLowerCase()));

    return (
        <div className="space-y-4 pb-4">
            <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <User className="h-7 w-7" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold">{patientName(patient)}</h2>
                            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1"><Calendar className="h-4 w-4" /> {patientAge}</span>
                                <span className="flex items-center gap-1"><Phone className="h-4 w-4" /> {patient.phone || "-"}</span>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-xl border bg-background px-4 py-2 text-sm text-muted-foreground">
                        {formatDateInOperationZone(new Date(), operationContext.locale, operationContext.timeZone, { weekday: "long", day: "numeric", month: "long" })}
                    </div>
                </div>
                {(patient.allergies || patient.pathologicalHistory || patient.nonPathologicalHistory) ? (
                    <div className="mt-4 grid gap-2 md:grid-cols-3">
                        {patient.allergies ? <AlertPill tone="red" label="Alergias" value={patient.allergies} icon={AlertTriangle} /> : null}
                        {patient.pathologicalHistory ? <AlertPill tone="amber" label="Ant. Patologicos" value={patient.pathologicalHistory} icon={HeartPulse} /> : null}
                        {patient.nonPathologicalHistory ? <AlertPill tone="blue" label="Ant. No Patologicos" value={patient.nonPathologicalHistory} icon={FileText} /> : null}
                    </div>
                ) : null}
            </div>

            {parent ? (
                <div className="rounded-2xl border border-amber-300 bg-amber-50">
                    <button type="button" onClick={() => setShowContext(!showContext)} className="flex w-full items-center justify-between p-4 text-left">
                        <div className="flex items-center gap-2 text-amber-900">
                            <ClipboardList className="h-5 w-5" />
                            <span className="font-bold">Contexto Anterior: {formatDate(parent.createdAt, "-", operationContext.locale, operationContext.timeZone)}</span>
                            <Badge className="bg-amber-200 text-amber-900 hover:bg-amber-200">Seguimiento</Badge>
                        </div>
                    </button>
                    {showContext ? (
                        <div className="grid gap-4 border-t border-amber-200 p-4 md:grid-cols-2">
                            <InfoBox label="Diagnostico Previo" value={parent.diagnosis || "No registrado"} />
                            <InfoBox label="Plan de Tratamiento Previo" value={parent.treatmentPlan || "No registrado"} />
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="flex gap-2 overflow-x-auto border-b">
                {CONSULTATION_TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveInnerTab(tab.id)}
                            className={cn(
                                "flex min-w-fit items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition",
                                activeInnerTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <Icon className="h-4 w-4" />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {activeInnerTab === "consulta" ? (
                <Card className="rounded-2xl">
                    <CardHeader><CardTitle className="text-lg">Motivo de Consulta y Evolucion</CardTitle></CardHeader>
                    <CardContent className="space-y-5">
                        <FormField label="Motivo Principal" value={form.chiefComplaint} onChange={(value) => setForm({ ...form, chiefComplaint: value })} placeholder="Ej. Dolor, revision, control..." />
                        <DictationBox onSummaryReady={applyTranscriptSummary} />
                        <TextAreaField label="Nota de Evolucion / Inspec. General" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} rows={5} placeholder="Paciente masculino de... evolucion, hallazgos y exploracion general" />
                        <div className="grid gap-3 md:grid-cols-4">
                            <FormField label="TA sistolica" value={form.vitalSigns.systolic} onChange={(value) => updateVitals("systolic", value)} />
                            <FormField label="TA diastolica" value={form.vitalSigns.diastolic} onChange={(value) => updateVitals("diastolic", value)} />
                            <FormField label="FC" value={form.vitalSigns.heartRate} onChange={(value) => updateVitals("heartRate", value)} />
                            <FormField label="Temp." value={form.vitalSigns.temperature} onChange={(value) => updateVitals("temperature", value)} />
                            <FormField label="SpO2" value={form.vitalSigns.spO2} onChange={(value) => updateVitals("spO2", value)} />
                            <FormField label="Peso kg" value={form.vitalSigns.weight} onChange={(value) => updateVitals("weight", value)} />
                            <FormField label="Talla cm" value={form.vitalSigns.height} onChange={(value) => updateVitals("height", value)} />
                            <div className="rounded-xl border bg-muted/50 p-3">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">IMC</p>
                                <p className="mt-1 text-lg font-bold">{bmi ?? "-"}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ) : activeInnerTab === "glaucoma" ? (
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="text-lg">Seguimiento de Glaucoma</CardTitle>
                        <p className="text-sm text-muted-foreground">PIO, excavacion papilar, campo visual, OCT de nervio optico y tratamiento actual.</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-4">
                            <FormField label="PIO OD" value={form.glaucoma.pioOd} onChange={(value) => setForm({ ...form, glaucoma: { ...form.glaucoma, pioOd: value } })} placeholder="mmHg" />
                            <FormField label="PIO OI" value={form.glaucoma.pioOi} onChange={(value) => setForm({ ...form, glaucoma: { ...form.glaucoma, pioOi: value } })} placeholder="mmHg" />
                            <FormField label="Excavacion OD" value={form.glaucoma.cupOd} onChange={(value) => setForm({ ...form, glaucoma: { ...form.glaucoma, cupOd: value } })} placeholder="0.4" />
                            <FormField label="Excavacion OI" value={form.glaucoma.cupOi} onChange={(value) => setForm({ ...form, glaucoma: { ...form.glaucoma, cupOi: value } })} placeholder="0.5" />
                        </div>
                        <TextAreaField label="Campo visual" value={form.glaucoma.visualField} onChange={(value) => setForm({ ...form, glaucoma: { ...form.glaucoma, visualField: value } })} rows={3} placeholder="Indice MD/PSD, defectos, confiabilidad..." />
                        <TextAreaField label="OCT nervio optico" value={form.glaucoma.octNerve} onChange={(value) => setForm({ ...form, glaucoma: { ...form.glaucoma, octNerve: value } })} rows={3} placeholder="RNFL, GCC, progresion..." />
                        <div className="grid gap-4 md:grid-cols-2">
                            <TextAreaField label="Tratamiento actual" value={form.glaucoma.currentTreatment} onChange={(value) => setForm({ ...form, glaucoma: { ...form.glaucoma, currentTreatment: value } })} rows={3} placeholder="Analogos, beta bloqueador, combinaciones..." />
                            <FormField label="Proximo control" type="date" value={form.glaucoma.nextControl} onChange={(value) => setForm({ ...form, glaucoma: { ...form.glaucoma, nextControl: value } })} />
                        </div>
                    </CardContent>
                </Card>
            ) : activeInnerTab === "retina" ? (
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="text-lg">Seguimiento Retina / Diabetes</CardTitle>
                        <p className="text-sm text-muted-foreground">Fondo de ojo, retinopatia diabetica, OCT macular, procedimientos y proximo control.</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <TextAreaField label="Fondo de ojo" value={form.retina.fundus} onChange={(value) => setForm({ ...form, retina: { ...form.retina, fundus: value } })} rows={4} placeholder="Papila, macula, vasos, periferia..." />
                        <div className="grid gap-4 md:grid-cols-2">
                            <TextAreaField label="Retinopatia diabetica" value={form.retina.diabeticRetinopathy} onChange={(value) => setForm({ ...form, retina: { ...form.retina, diabeticRetinopathy: value } })} rows={3} placeholder="Sin RD, RDNP leve/moderada/severa, RDP..." />
                            <TextAreaField label="OCT macular" value={form.retina.macularOct} onChange={(value) => setForm({ ...form, retina: { ...form.retina, macularOct: value } })} rows={3} placeholder="Edema macular, membrana, grosor central..." />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <TextAreaField label="Fotocoagulacion / inyecciones" value={form.retina.procedures} onChange={(value) => setForm({ ...form, retina: { ...form.retina, procedures: value } })} rows={3} placeholder="Laser, anti-VEGF, esteroide, ojo, lote..." />
                            <FormField label="Proximo control" type="date" value={form.retina.nextControl} onChange={(value) => setForm({ ...form, retina: { ...form.retina, nextControl: value } })} />
                        </div>
                    </CardContent>
                </Card>
            ) : activeInnerTab === "cirugia" ? (
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="text-lg">Cirugia</CardTitle>
                        <p className="text-sm text-muted-foreground">Catarata, pterigion, refractiva, consentimientos, checklist y seguimiento postoperatorio.</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Tipo de cirugia</Label>
                                <Select value={form.surgery.type || "none"} onValueChange={(value) => setForm({ ...form, surgery: { ...form.surgery, type: value === "none" ? "" : value } })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Sin seleccionar</SelectItem>
                                        <SelectItem value="Catarata">Catarata</SelectItem>
                                        <SelectItem value="Pterigion">Pterigion</SelectItem>
                                        <SelectItem value="Refractiva">Refractiva</SelectItem>
                                        <SelectItem value="Retina">Retina</SelectItem>
                                        <SelectItem value="Glaucoma">Glaucoma</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <label className="flex items-center gap-3 rounded-xl border p-3">
                                <input type="checkbox" checked={form.surgery.consentSigned} onChange={(event) => setForm({ ...form, surgery: { ...form.surgery, consentSigned: event.target.checked } })} />
                                <span className="font-semibold">Consentimiento informado firmado</span>
                            </label>
                        </div>
                        <TextAreaField label="Checklist preoperatorio" value={form.surgery.checklist} onChange={(value) => setForm({ ...form, surgery: { ...form.surgery, checklist: value } })} rows={4} placeholder="Lateralidad, lente intraocular, alergias, ayuno, autorizaciones..." />
                        <TextAreaField label="Estudios prequirurgicos" value={form.surgery.preopStudies} onChange={(value) => setForm({ ...form, surgery: { ...form.surgery, preopStudies: value } })} rows={3} placeholder="Biometria, topografia, laboratorios, EKG, valoracion..." />
                        <TextAreaField label="Seguimiento postoperatorio" value={form.surgery.postopFollowup} onChange={(value) => setForm({ ...form, surgery: { ...form.surgery, postopFollowup: value } })} rows={3} placeholder="Dia 1, semana 1, mes 1, datos de alarma..." />
                    </CardContent>
                </Card>
            ) : activeInnerTab === "diagnostico" ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Card className="rounded-2xl">
                        <CardHeader><CardTitle className="text-lg">Diagnostico Principal</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Buscar diagnostico CIE-10</Label>
                                <Input list="diagnosis-list" value={form.diagnosis} onChange={(event) => setForm({ ...form, diagnosis: event.target.value })} placeholder="Escribe codigo o nombre..." />
                                <datalist id="diagnosis-list">
                                    {DIAGNOSIS_CATALOG.map((diagnosis) => <option key={diagnosis} value={diagnosis} />)}
                                </datalist>
                            </div>
                            <TextAreaField label="Sintomas / notas diagnosticas" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} rows={3} />
                        </CardContent>
                    </Card>
                    <Card className="h-fit rounded-2xl">
                        <CardHeader><CardTitle className="text-base">Frecuentes</CardTitle></CardHeader>
                        <CardContent className="space-y-2">
                            {DIAGNOSIS_CATALOG.slice(0, 8).map((diagnosis) => (
                                <button key={diagnosis} type="button" onClick={() => setForm({ ...form, diagnosis })} className="w-full rounded-xl border px-3 py-2 text-left text-sm hover:bg-muted">
                                    {diagnosis}
                                </button>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            ) : activeInnerTab === "tratamiento" ? (
                <div className="space-y-4">
                    <Card className="rounded-2xl">
                        <CardHeader><CardTitle className="text-lg">Receta Medica</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            {form.medications.map((medication, index) => (
                                <div key={index} className="grid gap-2 rounded-xl bg-muted/40 p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                                    <Input value={medication.name} onChange={(event) => updateMedication(index, "name", event.target.value)} placeholder="Medicamento" list="medication-history" />
                                    <Input value={medication.dose} onChange={(event) => updateMedication(index, "dose", event.target.value)} placeholder="Dosis" />
                                    <Input value={medication.frequency} onChange={(event) => updateMedication(index, "frequency", event.target.value)} placeholder="Frecuencia" />
                                    <Input value={medication.duration} onChange={(event) => updateMedication(index, "duration", event.target.value)} placeholder="Duracion" />
                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeMedication(index)} disabled={form.medications.length === 1}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <datalist id="medication-history">
                                {medicationHistory.map((medication) => <option key={medication.name} value={medication.name} />)}
                            </datalist>
                            <Button variant="outline" onClick={() => addMedication()}>
                                <Plus className="h-4 w-4" />
                                Agregar Medicamento
                            </Button>
                            {medicationHistory.length > 0 ? (
                                <div className="flex flex-wrap gap-2 border-t pt-3">
                                    {medicationHistory.slice(0, 8).map((medication) => (
                                        <Button key={medication.name} variant="secondary" size="xs" onClick={() => addMedication(medication)}>
                                            + {medication.name}
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                    <Card className="rounded-2xl">
                        <CardHeader><CardTitle className="text-lg">Indicaciones Generales</CardTitle></CardHeader>
                        <CardContent>
                            <Textarea value={form.treatmentPlan} onChange={(event) => setForm({ ...form, treatmentPlan: event.target.value })} rows={5} placeholder="Instrucciones para el paciente, cuidados generales, dieta..." />
                        </CardContent>
                    </Card>
                </div>
            ) : activeInnerTab === "estudios" ? (
                <div className="space-y-4">
                    <Card className="rounded-2xl">
                        <CardHeader><CardTitle className="text-lg">Solicitud de Estudios</CardTitle></CardHeader>
                        <CardContent className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-3">
                                <Input value={studyFilter} onChange={(event) => setStudyFilter(event.target.value)} placeholder="Filtrar estudios..." />
                                <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-2">
                                    {filteredStudies.map((study) => (
                                        <label key={study.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm", selectedStudies.includes(study.id) ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted")}>
                                            <input
                                                type="checkbox"
                                                checked={selectedStudies.includes(study.id)}
                                                onChange={(event) => {
                                                    setSelectedStudies(event.target.checked ? [...selectedStudies, study.id] : selectedStudies.filter((id) => id !== study.id));
                                                }}
                                            />
                                            {study.name}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label>Seleccionados ({selectedStudies.length})</Label>
                                <div className="min-h-24 rounded-xl border p-3">
                                    {selectedStudies.length === 0 ? (
                                        <p className="text-sm italic text-muted-foreground">Ninguno seleccionado</p>
                                    ) : selectedStudies.map((id) => {
                                        const study = LAB_STUDIES_CATALOG.find((item) => item.id === id);
                                        return (
                                            <div key={id} className="mb-1 flex justify-between rounded-lg bg-muted px-2 py-1 text-sm">
                                                <span>{study?.name}</span>
                                                <button type="button" className="text-destructive" onClick={() => setSelectedStudies(selectedStudies.filter((studyId) => studyId !== id))}>x</button>
                                            </div>
                                        );
                                    })}
                                </div>
                                <TextAreaField label="Estudios adicionales" value={customStudies} onChange={setCustomStudies} rows={3} placeholder="Otros estudios no en la lista..." />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="rounded-2xl">
                        <CardHeader><CardTitle className="text-lg">Registrar Resultado de Analisis</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">Sube imagenes o PDF de resultados de laboratorio o estudios de imagen.</p>
                            <AnalysisFileForm form={analysisForm} onChange={setAnalysisForm} />
                        </CardContent>
                    </Card>
                </div>
            ) : (
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="text-lg">Educacion del Paciente</CardTitle>
                        <p className="text-sm text-muted-foreground">Indicaciones antes/despues de estudios, mensajes postconsulta y explicacion al paciente.</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Articulo para portal / tema educativo</Label>
                            <Select value={form.education.article || "none"} onValueChange={(value) => setForm({ ...form, education: { ...form.education, article: value === "none" ? "" : value } })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Sin seleccionar</SelectItem>
                                    <SelectItem value="Ojo seco">Ojo seco</SelectItem>
                                    <SelectItem value="Glaucoma">Glaucoma</SelectItem>
                                    <SelectItem value="Catarata">Catarata</SelectItem>
                                    <SelectItem value="Retinopatia diabetica">Retinopatia diabetica</SelectItem>
                                    <SelectItem value="Postoperatorio">Cuidados postoperatorios</SelectItem>
                                    <SelectItem value="Estudios">Preparacion para estudios</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <TextAreaField label="Indicaciones antes de estudios" value={form.education.preStudyInstructions} onChange={(value) => setForm({ ...form, education: { ...form.education, preStudyInstructions: value } })} rows={4} placeholder="Dilatacion, acompanante, suspender lentes de contacto..." />
                            <TextAreaField label="Indicaciones despues de estudios/procedimientos" value={form.education.postStudyInstructions} onChange={(value) => setForm({ ...form, education: { ...form.education, postStudyInstructions: value } })} rows={4} placeholder="Vision borrosa por dilatacion, no manejar, datos de alarma..." />
                        </div>
                        <TextAreaField label="Mensaje automatico postconsulta" value={form.education.automaticMessage} onChange={(value) => setForm({ ...form, education: { ...form.education, automaticMessage: value } })} rows={4} placeholder="Hola, estas son tus indicaciones..." />
                        <div className="flex justify-end">
                            <Button variant="outline" className="gap-2 text-primary" onClick={() => {
                                const message = form.education.automaticMessage || [
                                    `Hola ${patientName(patient)}, te compartimos tus indicaciones.`,
                                    form.education.preStudyInstructions,
                                    form.education.postStudyInstructions,
                                ].filter(Boolean).join("\n\n");
                                const ok = sendWhatsApp(patient.phone, message);
                                if (!ok) toast({ title: "Sin telefono", description: "El paciente no tiene telefono registrado.", variant: "destructive" });
                            }}>
                                <WhatsAppIcon className="h-4 w-4" />
                                Enviar indicaciones
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t bg-card/95 p-4 backdrop-blur">
                <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
                <Button size="lg" className="min-w-56" disabled={isPending || !form.chiefComplaint.trim()} onClick={handleFinalize}>
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Finalizar Consulta
                </Button>
            </div>
        </div>
    );
}

function AlertPill({ tone, label, value, icon: Icon }: { tone: "red" | "amber" | "blue"; label: string; value: string; icon: any }) {
    const classes = {
        red: "border-red-200 bg-red-50 text-red-700",
        amber: "border-amber-200 bg-amber-50 text-amber-700",
        blue: "border-blue-200 bg-blue-50 text-blue-700",
    };
    return (
        <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-xs", classes[tone])}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p><strong>{label}: </strong>{value}</p>
        </div>
    );
}

function DictationBox({ onSummaryReady }: { onSummaryReady: (summary: unknown) => void }) {
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [summary, setSummary] = useState("");
    const [isGenerating, startGenerating] = useTransition();
    const recognitionRef = useRef<any>(null);
    const { toast } = useToast();

    const startListening = () => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            toast({ title: "Dictado no disponible", description: "Usa Chrome o Edge para reconocimiento de voz.", variant: "destructive" });
            return;
        }
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "es-MX";
        let finalTranscript = transcript;
        recognition.onstart = () => setIsRecording(true);
        recognition.onresult = (event: any) => {
            let interim = "";
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const result = event.results[i];
                if (result.isFinal) finalTranscript += `${result[0].transcript} `;
                else interim += result[0].transcript;
            }
            setTranscript(finalTranscript + interim);
        };
        recognition.onerror = () => setIsRecording(false);
        recognition.onend = () => {
            setIsRecording(false);
            recognitionRef.current = null;
        };
        recognitionRef.current = recognition;
        recognition.start();
    };

    const stopListening = () => {
        recognitionRef.current?.abort();
        recognitionRef.current = null;
        setIsRecording(false);
    };

    const handleGenerateSummary = () => {
        startGenerating(async () => {
            const result = await summarizeConsultationTranscript(transcript);
            if (!result.success) {
                toast({ title: "No se pudo generar resumen", description: result.error || "Revisa la configuracion de IA.", variant: "destructive" });
                return;
            }
            const text = typeof result.summary === "string" ? result.summary : JSON.stringify(result.summary, null, 2);
            setSummary(text);
            onSummaryReady(result.summary);
            toast({ title: "Resumen aplicado" });
        });
    };

    return (
        <div className="space-y-3 border-t pt-4">
            <Label>Dictado por Voz (opcional)</Label>
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={startListening} disabled={isRecording}>
                    <Mic className={cn("h-4 w-4", isRecording ? "text-muted-foreground" : "text-emerald-600")} />
                    Iniciar
                </Button>
                <Button variant="outline" size="sm" onClick={stopListening} disabled={!isRecording}>
                    <Square className="h-4 w-4" />
                    Detener
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setTranscript(""); setSummary(""); }} disabled={!transcript && !summary}>
                    <Trash2 className="h-4 w-4" />
                    Limpiar
                </Button>
                <Button variant="outline" size="sm" onClick={handleGenerateSummary} disabled={!transcript.trim() || isGenerating}>
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isGenerating ? "Generando..." : "Generar Resumen IA"}
                </Button>
            </div>
            <div className={cn("min-h-20 rounded-xl border bg-muted/40 p-3 text-sm", isRecording && "border-red-300")}>
                <p className="text-xs font-semibold text-muted-foreground">Transcripcion:</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{transcript || "Presiona \"Iniciar\" y comienza a hablar"}</p>
            </div>
            {summary ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <p className="text-xs font-semibold text-primary">Resumen IA:</p>
                    <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} className="mt-2" />
                    <Button size="sm" className="mt-2" onClick={() => onSummaryReady(summary)}>Usar este resumen</Button>
                </div>
            ) : null}
        </div>
    );
}

function BudgetsTab({ patient, onSaved }: { patient: PatientDetail; onSaved: () => void }) {
    const [showCreate, setShowCreate] = useState(false);
    const [selectedTreatments, setSelectedTreatments] = useState<Array<ClinicalService & { tempId: string }>>([]);
    const [customTreatment, setCustomTreatment] = useState({
        name: "",
        category: "Otro",
        price: "",
    });
    const [planType, setPlanType] = useState("Contado");
    const [planDuration, setPlanDuration] = useState(1);
    const [interestRate, setInterestRate] = useState(0);
    const [validityDays, setValidityDays] = useState(15);
    const [operationContext, setOperationContext] = useState({
        locale: "es-MX",
        timeZone: CLINIC_TIME_ZONE,
        currencies: ["MXN"],
        defaultCurrency: "MXN",
        posTaxEnabled: false,
        posTaxRate: 16,
    });
    const [budgetCurrency, setBudgetCurrency] = useState("MXN");
    const [paymentBudget, setPaymentBudget] = useState<Budget | null>(null);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("Efectivo");
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    useEffect(() => {
        let active = true;
        fetch("/api/operation-context", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .then((context) => {
                if (!active || !context) return;
                const currencies = Array.isArray(context.currencies) && context.currencies.length > 0 ? context.currencies : ["MXN"];
                const defaultCurrency = context.defaultCurrency || currencies[0] || "MXN";
                setOperationContext({
                    locale: context.locale || "es-MX",
                    timeZone: context.timeZone || CLINIC_TIME_ZONE,
                    currencies,
                    defaultCurrency,
                    posTaxEnabled: context.posTaxEnabled === true,
                    posTaxRate: Number.isFinite(Number(context.posTaxRate)) ? Number(context.posTaxRate) : 16,
                });
                setBudgetCurrency((current) => currencies.includes(current) ? current : defaultCurrency);
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, []);

    const formatBudgetMoney = (value?: number | null, currency = budgetCurrency) =>
        money(value, currency, operationContext.locale);

    const activeBudgets = patient.budgets.filter((budget) => ["accepted", "paid", "partial"].includes(budget.status));
    const totalBudgeted = activeBudgets.reduce((sum, budget) => sum + budget.total, 0);
    const totalPaid = activeBudgets.reduce((sum, budget) => sum + getBudgetPayments(budget).reduce((paymentSum, payment) => paymentSum + Number(payment.amount || 0), 0), 0);
    const pendingBalance = Math.max(totalBudgeted - totalPaid, 0);
    const subtotal = selectedTreatments.reduce((sum, treatment) => sum + treatment.price, 0);
    const tax = operationContext.posTaxEnabled ? subtotal * ((Number(operationContext.posTaxRate) || 0) / 100) : 0;
    const interest = subtotal * (interestRate / 100);
    const finalTotal = subtotal + tax + interest;
    const paymentCount = planType === "Contado" ? 1 : planDuration;
    const perPayment = finalTotal / Math.max(paymentCount, 1);

    const addTreatment = (treatment: ClinicalService) => {
        setSelectedTreatments((current) => [
            ...current,
            { ...treatment, tempId: `${treatment.id}-${Date.now()}-${Math.random()}` },
        ]);
    };

    const addCustomTreatment = () => {
        const name = customTreatment.name.trim();
        const price = Number(customTreatment.price);
        if (!name || !Number.isFinite(price) || price <= 0) {
            toast({ title: "Captura nombre y precio del concepto", variant: "destructive" });
            return;
        }
        addTreatment({
            id: `custom-${Date.now()}`,
            code: "LIBRE",
            name,
            category: customTreatment.category.trim() || "Otro",
            price,
        });
        setCustomTreatment({ name: "", category: "Otro", price: "" });
    };

    const saveNewBudget = (status: "pending" | "accepted") => {
        startTransition(async () => {
            if (selectedTreatments.length === 0) {
                toast({ title: "Agrega al menos un tratamiento", variant: "destructive" });
                return;
            }
            const result = await saveBudget({
                patientId: patient.id,
                title: "Presupuesto clinico",
                status,
                items: selectedTreatments.map((treatment) => ({
                    id: treatment.id,
                    code: treatment.code,
                    name: treatment.name,
                    price: treatment.price,
                    quantity: 1,
                })),
                plan: {
                    type: planType,
                    duration: planDuration,
                    interest: interestRate,
                    validity: validityDays,
                    currency: budgetCurrency,
                    breakdown: { subtotal, tax, taxRate: operationContext.posTaxRate, total: finalTotal, perPayment, count: paymentCount, interest },
                },
                validUntil: new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000),
            });
            if (!result.success || !result.budget) {
                toast({ title: "Error", description: result.error || "No se pudo guardar.", variant: "destructive" });
                return;
            }
            toast({ title: status === "accepted" ? "Presupuesto aceptado" : "Presupuesto guardado como pendiente" });
            setSelectedTreatments([]);
            setShowCreate(false);
            printBudget(patient, result.budget as Budget, operationContext);
            onSaved();
        });
    };

    const registerPayment = () => {
        if (!paymentBudget) return;
        startTransition(async () => {
            const result = await addBudgetPayment({
                budgetId: paymentBudget.id,
                patientId: patient.id,
                amount: Number(paymentAmount),
                currency: getBudgetCurrency(paymentBudget, operationContext.defaultCurrency),
                method: paymentMethod,
            });
            if (!result.success) {
                toast({ title: "Error", description: result.error || "No se pudo registrar el pago.", variant: "destructive" });
                return;
            }
            toast({ title: "Pago registrado y deuda actualizada" });
            setPaymentBudget(null);
            setPaymentAmount("");
            onSaved();
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Presupuestos y Pagos</h2>
                    <p className="text-sm text-muted-foreground">Administra cotizaciones y estado de cuenta.</p>
                </div>
                {!showCreate ? (
                    <Button onClick={() => setShowCreate(true)}>
                        <Plus className="h-4 w-4" />
                        Nuevo Presupuesto
                    </Button>
                ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <StatCard label="Saldo Pendiente (Deuda)" value={formatBudgetMoney(pendingBalance)} hint={pendingBalance > 0 ? "Requiere pago" : "Al corriente"} tone={pendingBalance > 0 ? "red" : "green"} />
                <StatCard label="Total Presupuestado" value={formatBudgetMoney(totalBudgeted)} hint={`${activeBudgets.length} presupuestos aceptados`} />
                <StatCard label="Estado General" value={pendingBalance > 0 ? "Con Adeudo" : "Sin Adeudo"} hint="Balance del paciente" tone={pendingBalance > 0 ? "red" : "green"} />
            </div>

            {showCreate ? (
                <Card className="rounded-2xl">
                    <CardHeader><CardTitle>Nuevo Presupuesto</CardTitle></CardHeader>
                    <CardContent className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
                        <div className="space-y-3">
                            <h3 className="text-sm font-semibold uppercase text-muted-foreground">Servicios Oftalmologicos</h3>
                            <div className="max-h-[26rem] overflow-y-auto rounded-xl border p-2 [scrollbar-gutter:stable]">
                                {TREATMENT_CATALOG.map((treatment) => (
                                    <button
                                        key={treatment.id}
                                        type="button"
                                        onClick={() => addTreatment(treatment)}
                                        className="flex w-full items-center justify-between rounded-lg p-2 text-left hover:bg-muted"
                                    >
                                        <div>
                                            <p className="text-sm font-semibold">{treatment.name}</p>
                                            <p className="text-xs text-muted-foreground">{treatment.code} - {treatment.category}</p>
                                        </div>
                                        <span className="font-bold text-emerald-600">{formatBudgetMoney(treatment.price)}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="rounded-xl border bg-muted/20 p-3">
                                <p className="text-sm font-semibold">Agregar concepto libre</p>
                                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_130px]">
                                    <Input
                                        value={customTreatment.name}
                                        onChange={(event) => setCustomTreatment((current) => ({ ...current, name: event.target.value }))}
                                        placeholder="Ej. Ajuste de lentes, material, procedimiento..."
                                    />
                                    <Input
                                        value={customTreatment.category}
                                        onChange={(event) => setCustomTreatment((current) => ({ ...current, category: event.target.value }))}
                                        placeholder="Categoria"
                                    />
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={customTreatment.price}
                                        onChange={(event) => setCustomTreatment((current) => ({ ...current, price: event.target.value }))}
                                        placeholder="Precio"
                                    />
                                </div>
                                <Button type="button" variant="outline" className="mt-3 w-full" onClick={addCustomTreatment}>
                                    <Plus className="h-4 w-4" />
                                    Agregar al presupuesto
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold uppercase text-muted-foreground">Resumen</h3>
                                <Badge variant="secondary">{selectedTreatments.length} servicio(s)</Badge>
                            </div>
                            <div className="space-y-3 rounded-xl border p-3">
                                <div className="max-h-[10.25rem] space-y-2 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
                                    {selectedTreatments.length === 0 ? (
                                        <div className="flex h-28 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                                            Agrega tratamientos
                                        </div>
                                    ) : selectedTreatments.map((treatment) => (
                                        <div key={treatment.tempId} className="grid min-h-[4.25rem] gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold">{treatment.name}</p>
                                                <p className="text-xs text-muted-foreground">{treatment.code}</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="font-bold">{formatBudgetMoney(treatment.price)}</span>
                                                <button type="button" className="text-destructive" onClick={() => setSelectedTreatments((current) => current.filter((item) => item.tempId !== treatment.tempId))}>
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="space-y-3 border-t pt-3">
                                    <div className={cn(
                                        "grid gap-3",
                                        planType === "Contado"
                                            ? "md:grid-cols-[140px_minmax(220px,1fr)_160px]"
                                            : "md:grid-cols-[120px_minmax(170px,1fr)_145px_145px_145px]",
                                    )}>
                                        <div className="space-y-2">
                                            <Label>Moneda</Label>
                                            <Select value={budgetCurrency} onValueChange={setBudgetCurrency}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {operationContext.currencies.map((currency) => (
                                                        <SelectItem key={currency} value={currency}>
                                                            {currency}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Tipo de Plan</Label>
                                            <Select value={planType} onValueChange={(value) => {
                                                setPlanType(value);
                                                if (value === "Contado") {
                                                    setPlanDuration(1);
                                                    setInterestRate(0);
                                                }
                                            }}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Contado">Contado (Pago Unico)</SelectItem>
                                                    <SelectItem value="Semanal">Semanal</SelectItem>
                                                    <SelectItem value="Quincenal">Quincenal</SelectItem>
                                                    <SelectItem value="Mensual">Mensual</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <FormField label="Validez (dias)" type="number" value={String(validityDays)} onChange={(value) => setValidityDays(Number(value || 15))} />
                                        {planType !== "Contado" ? (
                                            <>
                                            <FormField label={`No. de ${planType}`} type="number" value={String(planDuration)} onChange={(value) => setPlanDuration(Number(value || 1))} />
                                            <FormField label="Interes (%)" type="number" value={String(interestRate)} onChange={(value) => setInterestRate(Number(value || 0))} />
                                            </>
                                        ) : null}
                                    </div>
                                    <div className="rounded-xl bg-emerald-50 p-3 text-center">
                                        <p className="text-sm font-semibold text-muted-foreground">RESUMEN DE PAGOS</p>
                                        <p className="text-lg font-bold text-emerald-700">{paymentCount} pago(s) de {formatBudgetMoney(perPayment)}</p>
                                    </div>
                                    <div className="space-y-1 rounded-xl border bg-muted/20 px-4 py-3 text-sm">
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Subtotal</span>
                                            <span className="font-semibold">{formatBudgetMoney(subtotal)}</span>
                                        </div>
                                        {operationContext.posTaxEnabled ? (
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground">IVA {operationContext.posTaxRate}%</span>
                                                <span className="font-semibold">{formatBudgetMoney(tax)}</span>
                                            </div>
                                        ) : null}
                                        {interest > 0 ? (
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground">Interes</span>
                                                <span className="font-semibold">{formatBudgetMoney(interest)}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="flex items-center justify-between text-xl font-bold">
                                        <span>Total</span>
                                        <span>{formatBudgetMoney(finalTotal)}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancelar</Button>
                                        <Button variant="outline" className="flex-1" onClick={() => saveNewBudget("pending")} disabled={isPending}>
                                            <Printer className="h-4 w-4" />
                                            Solo Imprimir
                                        </Button>
                                        <Button className="flex-1" onClick={() => saveNewBudget("accepted")} disabled={isPending}>
                                            <Check className="h-4 w-4" />
                                            Aceptar y Generar
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {patient.budgets.length === 0 ? (
                        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">No hay presupuestos registrados</div>
                    ) : patient.budgets.map((budget) => {
                        const payments = getBudgetPayments(budget);
                        const currency = getBudgetCurrency(budget, operationContext.defaultCurrency);
                        return (
                            <Card key={budget.id} className="rounded-2xl">
                                <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <span className="text-lg font-bold">Presupuesto #{budget.id.slice(-4)}</span>
                                            <Badge className={cn("border", statusClass(budget.status))}>{statusLabel(budget.status)}</Badge>
                                            <span className="text-sm text-muted-foreground">{formatDate(budget.createdAt, "-", operationContext.locale, operationContext.timeZone)}</span>
                                        </div>
                                        <div className="mt-2 space-y-1">
                                            {getBudgetItems(budget).map((item, index) => (
                                                <div key={index} className="flex max-w-lg justify-between gap-8 text-sm text-muted-foreground">
                                                    <span>{item.name || item.description}</span>
                                                    <span>{formatBudgetMoney(item.unitPrice ?? item.price, currency)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {payments.length > 0 ? (
                                            <p className="mt-2 text-xs text-muted-foreground">Pagos registrados: {payments.length}</p>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-col items-start gap-2 lg:items-end">
                                        <span className="text-2xl font-bold">{formatBudgetMoney(budget.total, currency)}</span>
                                        <div className="flex flex-wrap gap-2">
                                            {budget.status === "pending" ? (
                                                <>
                                                    <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => startTransition(async () => { await updateBudgetStatus(budget.id, patient.id, "accepted"); onSaved(); })}>
                                                        <Check className="h-4 w-4" /> Aceptar
                                                    </Button>
                                                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => startTransition(async () => { await updateBudgetStatus(budget.id, patient.id, "rejected"); onSaved(); })}>
                                                        <X className="h-4 w-4" /> Rechazar
                                                    </Button>
                                                </>
                                            ) : null}
                                            {(budget.status === "accepted" || budget.status === "partial") ? (
                                                <Button size="sm" onClick={() => setPaymentBudget(budget)}>
                                                    <DollarSign className="h-4 w-4" /> Registrar Pago
                                                </Button>
                                            ) : null}
                                            <Button size="icon-sm" variant="ghost" onClick={() => printBudget(patient, budget, operationContext)}>
                                                <Printer className="h-4 w-4" />
                                            </Button>
                                            <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => startTransition(async () => { await deleteBudget(budget.id, patient.id); onSaved(); })}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            <Dialog open={Boolean(paymentBudget)} onOpenChange={(open) => !open && setPaymentBudget(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Registrar Pago</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <FormField label={`Monto (${paymentBudget ? getBudgetCurrency(paymentBudget, operationContext.defaultCurrency) : budgetCurrency})`} type="number" value={paymentAmount} onChange={setPaymentAmount} />
                        <div className="space-y-2">
                            <Label>Metodo</Label>
                            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Efectivo">Efectivo</SelectItem>
                                    <SelectItem value="Tarjeta">Tarjeta</SelectItem>
                                    <SelectItem value="Transferencia">Transferencia</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPaymentBudget(null)}>Cancelar</Button>
                        <Button onClick={registerPayment} disabled={isPending}>Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function AnalysisTab({ patient, onSaved }: { patient: PatientDetail; onSaved: () => void }) {
    const operationContext = useOperationContext();
    const [showForm, setShowForm] = useState(false);
    const [showRequestForm, setShowRequestForm] = useState(false);
    const [studyFilter, setStudyFilter] = useState("");
    const [selectedStudies, setSelectedStudies] = useState<string[]>([]);
    const [customStudies, setCustomStudies] = useState("");
    const [analysisForm, setAnalysisForm] = useState({
        title: "",
        resultDate: getLocalDateString(operationContext.timeZone),
        results: "",
        notes: "",
        files: [] as FilePayload[],
    });
    const [previewFile, setPreviewFile] = useState<FilePayload | null>(null);
    const [previewZoom, setPreviewZoom] = useState(1);
    const [expandedResult, setExpandedResult] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    const requests = patient.clinicalAnalyses.filter((item) => item.kind === "request");
    const results = patient.clinicalAnalyses.filter((item) => item.kind !== "request");
    const filteredStudies = LAB_STUDIES_CATALOG.filter((study) => study.name.toLowerCase().includes(studyFilter.toLowerCase()));

    const createStudyRequest = () => {
        const studyNames = selectedStudies.map((id) => LAB_STUDIES_CATALOG.find((study) => study.id === id)?.name).filter(Boolean) as string[];
        startTransition(async () => {
            if (studyNames.length === 0 && !customStudies.trim()) {
                toast({ title: "Selecciona al menos un estudio", variant: "destructive" });
                return;
            }
            const result = await saveClinicalAnalysis({
                patientId: patient.id,
                kind: "request",
                title: studyNames.join(", ") || customStudies.trim(),
                studies: studyNames,
                resultDate: getLocalDateString(operationContext.timeZone),
                notes: customStudies,
            });
            if (!result.success) {
                toast({ title: "Error", description: result.error || "No se pudo guardar.", variant: "destructive" });
                return;
            }
            toast({ title: "Solicitud creada" });
            setSelectedStudies([]);
            setCustomStudies("");
            setShowRequestForm(false);
            printStudyRequest(patient, { studies: studyNames, customStudies, date: getLocalDateString(operationContext.timeZone) }, operationContext);
            onSaved();
        });
    };

    const saveAnalysis = () => {
        startTransition(async () => {
            const result = await saveClinicalAnalysis({
                patientId: patient.id,
                kind: "result",
                title: analysisForm.title,
                resultDate: analysisForm.resultDate,
                results: analysisForm.results,
                notes: analysisForm.notes,
                files: analysisForm.files,
            });
            if (!result.success) {
                toast({ title: "Error", description: result.error || "No se pudo guardar.", variant: "destructive" });
                return;
            }
            toast({ title: "Analisis guardado" });
            setAnalysisForm({ title: "", resultDate: getLocalDateString(operationContext.timeZone), results: "", notes: "", files: [] });
            setShowForm(false);
            onSaved();
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-2xl font-bold">
                        <FlaskConical className="h-6 w-6 text-primary" />
                        Analisis Clinicos
                    </h2>
                    <p className="text-sm text-muted-foreground">Resultados y solicitudes de estudios de {patientName(patient)}</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowRequestForm(!showRequestForm)}>
                        <ClipboardList className="h-4 w-4" />
                        Solicitud de Estudios
                    </Button>
                    <Button onClick={() => setShowForm(!showForm)}>
                        <Plus className="h-4 w-4" />
                        Nuevo Analisis
                    </Button>
                </div>
            </div>

            {showRequestForm ? (
                <Card className="rounded-2xl">
                    <CardHeader><CardTitle>Solicitud de Estudios</CardTitle></CardHeader>
                    <CardContent className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-3">
                            <Input value={studyFilter} onChange={(event) => setStudyFilter(event.target.value)} placeholder="Filtrar estudios..." />
                            <div className="max-h-64 overflow-y-auto rounded-xl border p-2">
                                {filteredStudies.map((study) => (
                                    <label key={study.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm", selectedStudies.includes(study.id) ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted")}>
                                        <input
                                            type="checkbox"
                                            checked={selectedStudies.includes(study.id)}
                                            onChange={(event) => setSelectedStudies(event.target.checked ? [...selectedStudies, study.id] : selectedStudies.filter((id) => id !== study.id))}
                                        />
                                        {study.name}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-3">
                            <Label>Seleccionados ({selectedStudies.length})</Label>
                            <div className="min-h-24 rounded-xl border p-3 text-sm">
                                {selectedStudies.length === 0 ? <p className="italic text-muted-foreground">Ninguno seleccionado</p> : selectedStudies.map((id) => {
                                    const study = LAB_STUDIES_CATALOG.find((item) => item.id === id);
                                    return <p key={id}>{study?.name}</p>;
                                })}
                            </div>
                            <TextAreaField label="Estudios adicionales" value={customStudies} onChange={setCustomStudies} rows={3} />
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setShowRequestForm(false)}>Cancelar</Button>
                                <Button onClick={createStudyRequest} disabled={isPending}>
                                    <Printer className="h-4 w-4" />
                                    Crear e Imprimir
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            {showForm ? (
                <Card className="rounded-2xl">
                    <CardHeader><CardTitle>Agregar Analisis</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <FormField label="Fecha" type="date" value={analysisForm.resultDate} onChange={(value) => setAnalysisForm({ ...analysisForm, resultDate: value })} />
                            <FormField label="Tipo de Analisis" value={analysisForm.title} onChange={(value) => setAnalysisForm({ ...analysisForm, title: value })} placeholder="Ej: Biometria Hematica, Quimica Sanguinea..." />
                        </div>
                        <TextAreaField label="Resultados" value={analysisForm.results} onChange={(value) => setAnalysisForm({ ...analysisForm, results: value })} rows={4} placeholder="Ingresar resultados del analisis..." />
                        <AnalysisFileForm form={analysisForm} onChange={setAnalysisForm} includeResults={false} />
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                            <Button onClick={saveAnalysis} disabled={isPending || !analysisForm.title.trim()}>
                                <Save className="h-4 w-4" />
                                Guardar Analisis
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            {requests.length > 0 ? (
                <div className="space-y-3">
                    <h3 className="text-lg font-semibold">Solicitudes de Estudios</h3>
                    {requests.map((request) => (
                        <Card key={request.id} className="rounded-2xl">
                            <CardContent className="flex items-start justify-between gap-4 p-4">
                                <div className="flex gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                                        <ClipboardList className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="text-sm text-muted-foreground">{formatDate(request.resultDate || request.createdAt, "-", operationContext.locale, operationContext.timeZone)}</p>
                                        <ul className="mt-2 text-sm">
                                            {asArray<string>(request.studies).map((study) => <li key={study}>- {study}</li>)}
                                            {request.notes ? <li className="italic text-muted-foreground">{request.notes}</li> : null}
                                        </ul>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="icon-sm" onClick={() => printStudyRequest(patient, { studies: asArray<string>(request.studies), customStudies: request.notes || "", date: String(request.resultDate || request.createdAt) }, operationContext)}>
                                        <Printer className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => startTransition(async () => { await deleteClinicalAnalysis(request.id, patient.id); onSaved(); })}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : null}

            <div className="space-y-3">
                <h3 className="text-lg font-semibold">Resultados de Analisis</h3>
                {results.length === 0 ? (
                    <Card className="rounded-2xl">
                        <CardContent className="p-10 text-center text-muted-foreground">
                            <FlaskConical className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                            No hay analisis registrados.
                        </CardContent>
                    </Card>
                ) : results.map((result) => {
                    const files = asArray<FilePayload>(result.files);
                    const expanded = expandedResult === result.id;
                    return (
                        <Card key={result.id} className="rounded-2xl">
                            <CardContent className="flex items-start justify-between gap-4 p-4">
                                <div className="flex flex-1 gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
                                        <FileText className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="font-semibold">{result.title}</h4>
                                        <p className="text-sm text-muted-foreground">{formatDate(result.resultDate || result.createdAt, "-", operationContext.locale, operationContext.timeZone)}</p>
                                        {result.notes && !expanded ? <p className="mt-1 truncate text-sm italic text-muted-foreground">Notas: {result.notes}</p> : null}
                                        {expanded ? (
                                            <div className="mt-3 space-y-3">
                                                {result.results ? <InfoBox label="Resultados" value={result.results} /> : null}
                                                {result.notes ? <InfoBox label="Notas / Observaciones" value={result.notes} /> : null}
                                                {files.length > 0 ? (
                                                    <div className="space-y-2">
                                                        <p className="text-xs font-semibold uppercase text-muted-foreground">Archivos Adjuntos ({files.length})</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {files.map((file) => (
                                                                file.type?.startsWith("image/") ? (
                                                                    <button key={file.id} type="button" onClick={() => { setPreviewFile(file); setPreviewZoom(1); }}>
                                                                        <img src={file.data} alt={file.name} className="h-24 w-24 rounded-lg border object-cover" />
                                                                    </button>
                                                                ) : (
                                                                    <a key={file.id} href={file.data} download={file.name} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                                                                        <FileIcon className="h-4 w-4" /> {file.name}
                                                                    </a>
                                                                )
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="icon-sm" onClick={() => setExpandedResult(expanded ? null : result.id)}>
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => startTransition(async () => { await deleteClinicalAnalysis(result.id, patient.id); onSaved(); })}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <FilePreview file={previewFile} zoom={previewZoom} onZoom={setPreviewZoom} onClose={() => setPreviewFile(null)} />
        </div>
    );
}

function AnalysisFileForm({
    form,
    onChange,
}: {
    form: { title: string; resultDate: string; notes: string; files: FilePayload[]; results?: string };
    onChange: (form: any) => void;
    includeResults?: boolean;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [previewFile, setPreviewFile] = useState<FilePayload | null>(null);
    const [previewZoom, setPreviewZoom] = useState(1);
    const { toast } = useToast();

    const handleFiles = (files: FileList | null) => {
        Array.from(files || []).forEach((file) => {
            if (file.size > 10 * 1024 * 1024) {
                toast({ title: `${file.name} es mayor a 10MB`, variant: "destructive" });
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                const nextFile: FilePayload = {
                    id: `${Date.now()}-${Math.random()}`,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: String(event.target?.result || ""),
                    rotation: 0,
                };
                onChange({ ...form, files: [...form.files, nextFile] });
            };
            reader.readAsDataURL(file);
        });
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Tipo de Analisis" value={form.title} onChange={(value) => onChange({ ...form, title: value })} placeholder="Ej: Biometria Hematica, Quimica Sanguinea..." />
                <FormField label="Fecha del Analisis" type="date" value={form.resultDate} onChange={(value) => onChange({ ...form, resultDate: value })} />
            </div>
            <TextAreaField label="Observaciones" value={form.notes} onChange={(value) => onChange({ ...form, notes: value })} rows={2} placeholder="Notas o interpretacion de resultados..." />
            <div className="space-y-2">
                <Label>Archivos (Imagenes / PDF)</Label>
                <input ref={inputRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(event) => handleFiles(event.target.files)} />
                <button type="button" onClick={() => inputRef.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-border p-8 text-center transition hover:border-primary hover:bg-primary/5">
                    <Upload className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="font-semibold text-muted-foreground">Haz clic para seleccionar archivos</p>
                    <p className="text-xs text-muted-foreground">Imagenes (JPG, PNG) y PDF - Maximo 10MB por archivo</p>
                </button>
            </div>
            {form.files.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {form.files.map((file) => (
                        <div key={file.id} className="group relative aspect-square overflow-hidden rounded-xl bg-muted">
                            {file.type?.startsWith("image/") ? (
                                <img src={file.data} alt={file.name} className="h-full w-full object-cover" onClick={() => setPreviewFile(file)} />
                            ) : (
                                <button type="button" className="flex h-full w-full flex-col items-center justify-center p-2" onClick={() => setPreviewFile(file)}>
                                    <FileIcon className="mb-2 h-10 w-10 text-red-500" />
                                    <span className="w-full truncate text-xs">{file.name}</span>
                                </button>
                            )}
                            <button
                                type="button"
                                className="absolute right-2 top-2 rounded-full bg-red-600 p-1 text-white opacity-0 transition group-hover:opacity-100"
                                onClick={() => onChange({ ...form, files: form.files.filter((item) => item.id !== file.id) })}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}
            <FilePreview file={previewFile} zoom={previewZoom} onZoom={setPreviewZoom} onClose={() => setPreviewFile(null)} />
        </div>
    );
}

function FullHistoryTab({ patient }: { patient: PatientDetail }) {
    const operationContext = useOperationContext();
    return (
        <div className="space-y-5">
            <div className="flex justify-end">
                <Button variant="outline" className="gap-2" onClick={() => printFullHistory(patient, operationContext)}>
                    <Printer className="h-4 w-4" />
                    Imprimir historia
                </Button>
            </div>
            <section className="rounded-2xl border p-5">
                <h2 className="text-xl font-bold">{patientName(patient)}</h2>
                <p className="text-sm text-muted-foreground">{patient.patientNumber} - {patient.phone || "Sin telefono"} - {ageLabel(patient.dob, operationContext.timeZone, "-")}</p>
            </section>
            <section className="rounded-2xl border p-5">
                <h3 className="font-semibold">Antecedentes</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <InfoRow label="Alergias" value={patient.allergies} />
                    <InfoRow label="Patologicos" value={patient.pathologicalHistory} />
                    <InfoRow label="No patologicos" value={patient.nonPathologicalHistory} />
                    <InfoRow label="Medicacion actual" value={patient.currentMedications} />
                </div>
            </section>
            <section className="rounded-2xl border p-5">
                <h3 className="font-semibold">Consultas</h3>
                <div className="mt-3 space-y-3">
                    {patient.consultations.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No hay consultas registradas.</p>
                    ) : patient.consultations.map((consultation) => (
                        <div key={consultation.id} className="rounded-xl bg-muted/40 p-3">
                            <p className="text-sm font-semibold">{formatDateTime(consultation.createdAt, "-", operationContext.locale, operationContext.timeZone)} - {consultation.diagnosis || "Sin diagnostico"}</p>
                            <p className="text-sm text-muted-foreground">{consultation.chiefComplaint}</p>
                            {consultation.treatmentPlan ? <p className="mt-2 whitespace-pre-wrap text-sm">{consultation.treatmentPlan}</p> : null}
                        </div>
                    ))}
                </div>
            </section>
            <section className="rounded-2xl border p-5">
                <h3 className="font-semibold">Estudios Clinicos</h3>
                <div className="mt-3 space-y-3">
                    {patient.clinicalAnalyses.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No hay estudios registrados.</p>
                    ) : patient.clinicalAnalyses.map((analysis) => (
                        <div key={analysis.id} className="rounded-xl bg-muted/40 p-3">
                            <p className="text-sm font-semibold">{analysis.title}</p>
                            <p className="text-sm text-muted-foreground">{analysis.kind === "request" ? "Solicitud" : "Resultado"} - {formatDate(analysis.resultDate || analysis.createdAt, "-", operationContext.locale, operationContext.timeZone)}</p>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

function FilePreview({
    file,
    zoom,
    onZoom,
    onClose,
}: {
    file: FilePayload | null;
    zoom: number;
    onZoom: (zoom: number) => void;
    onClose: () => void;
}) {
    if (!file) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between rounded-t-xl bg-slate-900 p-4">
                    <span className="max-w-[50%] truncate font-medium text-white">{file.name}</span>
                    <div className="flex items-center gap-2">
                        {file.type?.startsWith("image/") ? (
                            <>
                                <button type="button" className="rounded-lg p-2 text-white hover:bg-white/20" onClick={() => onZoom(Math.max(zoom - 0.25, 0.5))}>
                                    <ZoomOut className="h-5 w-5" />
                                </button>
                                <span className="min-w-12 text-center text-sm font-mono text-white">{Math.round(zoom * 100)}%</span>
                                <button type="button" className="rounded-lg p-2 text-white hover:bg-white/20" onClick={() => onZoom(Math.min(zoom + 0.25, 4))}>
                                    <ZoomIn className="h-5 w-5" />
                                </button>
                            </>
                        ) : null}
                        <button type="button" className="rounded-lg p-2 text-white hover:bg-white/20" onClick={onClose}>
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>
                <div className="flex flex-1 items-center justify-center overflow-auto rounded-b-xl bg-slate-800 p-4">
                    {file.type?.startsWith("image/") ? (
                        <img src={file.data} alt={file.name} className="object-contain transition-transform" style={{ transform: `scale(${zoom})`, maxHeight: zoom > 1 ? "none" : "70vh" }} />
                    ) : file.type === "application/pdf" ? (
                        <iframe src={file.data} className="h-[70vh] w-full rounded-lg bg-white" title={file.name} />
                    ) : (
                        <a href={file.data} download={file.name} className="rounded-xl bg-white px-4 py-2 font-semibold">Descargar archivo</a>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "red" | "green" }) {
    return (
        <Card className="rounded-2xl">
            <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                <p className={cn("mt-1 text-2xl font-bold", tone === "red" && "text-red-600", tone === "green" && "text-emerald-600")}>{value}</p>
                {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
            </CardContent>
        </Card>
    );
}

function InfoBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border bg-background p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{value}</p>
        </div>
    );
}

function FormField({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: string;
}) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        </div>
    );
}

function TextAreaField({
    label,
    value,
    onChange,
    rows = 4,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    placeholder?: string;
}) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} />
        </div>
    );
}
