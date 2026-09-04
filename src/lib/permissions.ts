export const APP_ROLES = ["ADMINISTRADOR", "PROFESIONAL", "RECEPCION"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const APP_ROLE_LABELS: Record<AppRole, string> = {
    ADMINISTRADOR: "Administrador",
    PROFESIONAL: "Profesional",
    RECEPCION: "Recepcion / Administrativo / Caja",
};

export const FULL_ACCESS_PERMISSION = "system.fullAccess";

export const APP_PERMISSION_GROUPS = [
    {
        title: "Sistema",
        description: "Control global, usuarios e integraciones.",
        permissions: [
            {
                key: FULL_ACCESS_PERMISSION,
                label: "Control total",
                description: "Habilita todos los módulos del CRM para el equipo interno.",
            },
            {
                key: "users.manage",
                label: "Usuarios y permisos",
                description: "Crear usuarios, cambiar roles y asignar permisos extra.",
            },
            {
                key: "settings.manage",
                label: "Configuracion general",
                description: "Apariencia, preferencias generales y ajustes internos.",
            },
            {
                key: "integrations.manage",
                label: "Integraciones",
                description: "Credenciales de Google Calendar, WhatsApp API oficial, canal QR y otras APIs.",
            },
        ],
    },
    {
        title: "Operacion",
        description: "Flujo diario de agenda, recepcion y comunicacion.",
        permissions: [
            {
                key: "dashboard.view",
                label: "Dashboard",
                description: "Ver indicadores y resumen operativo.",
            },
            {
                key: "contacts.manage",
                label: "Contactos",
                description: "Crear, editar, importar, exportar o depurar contactos.",
            },
            {
                key: "chats.manage",
                label: "Chats",
                description: "Responder conversaciones, asignar chats y manejar bot/humano.",
            },
            {
                key: "templates.manage",
                label: "Plantillas",
                description: "Administrar respuestas guardadas, plantillas oficiales y cotizaciones.",
            },
            {
                key: "campaigns.manage",
                label: "Envios masivos",
                description: "Crear, ejecutar e importar audiencias para campañas.",
            },
        ],
    },
    {
        title: "Agenda",
        description: "Calendarios, recepcion y portal.",
        permissions: [
            {
                key: "calendar.manage",
                label: "Calendario",
                description: "Ver, crear, editar, confirmar y mover citas.",
            },
            {
                key: "reception.manage",
                label: "Recepcion",
                description: "Check-in, sala de espera, llegada y flujo administrativo.",
            },
            {
                key: "specialists.manage",
                label: "Especialistas",
                description: "Perfiles, agendas, bloqueos y asignacion de calendarios.",
            },
            {
                key: "services.manage",
                label: "Servicios",
                description: "Catalogo, categorias, precios, duraciones y asignacion de especialistas.",
            },
            {
                key: "portal.manage",
                label: "Portal del cliente",
                description: "Articulos, turnos publicos, indicaciones y contenido del portal.",
            },
        ],
    },
    {
        title: "Clinica",
        description: "Clientes, consultas e IA clínica.",
        permissions: [
            {
                key: "patients.manage",
                label: "Clientes",
                description: "Ficha del cliente, datos personales y antecedentes.",
            },
            {
                key: "clinical.manage",
                label: "Consultas clinicas",
                description: "Historia, recetas, estudios, evolucion, diagnostico y tratamiento.",
            },
            {
                key: "ai.manage",
                label: "Cerebro IA",
                description: "Base de conocimiento, prompts, modelos y funciones IA.",
            },
        ],
    },
    {
        title: "Finanzas",
        description: "Caja, presupuestos y reportes.",
        permissions: [
            {
                key: "billing.manage",
                label: "Caja y presupuestos",
                description: "Ingresos, egresos, pagos, presupuestos y links de pago.",
            },
            {
                key: "reports.view",
                label: "Reportes",
                description: "Reportes clinicos, financieros y operativos.",
            },
        ],
    },
] as const;

export type PermissionKey =
    (typeof APP_PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export type PermissionDefinition = {
    key: PermissionKey;
    label: string;
    description: string;
};

export const APP_PERMISSIONS = APP_PERMISSION_GROUPS.reduce<PermissionDefinition[]>(
    (permissions, group) => [
        ...permissions,
        ...(group.permissions as readonly PermissionDefinition[]),
    ],
    [],
);
export const APP_PERMISSION_KEYS = APP_PERMISSIONS.map((permission) => permission.key) as PermissionKey[];

const PERMISSION_KEY_SET = new Set<string>(APP_PERMISSION_KEYS);

const BASE_ROLE_PERMISSIONS: Record<AppRole, PermissionKey[]> = {
    ADMINISTRADOR: APP_PERMISSION_KEYS,
    PROFESIONAL: [
        "dashboard.view",
        "contacts.manage",
        "patients.manage",
        "clinical.manage",
        "calendar.manage",
        "chats.manage",
        "templates.manage",
        "billing.manage",
    ],
    RECEPCION: [
        "dashboard.view",
        "contacts.manage",
        "patients.manage",
        "calendar.manage",
        "reception.manage",
        "billing.manage",
        "chats.manage",
        "templates.manage",
    ],
};

export type AccessSubject = {
    role?: string | null;
    permissions?: unknown;
};

export function normalizeRole(role?: string | null): AppRole {
    if (role === "SUPERADMIN") return "ADMINISTRADOR";
    if (role === "ADMIN") return "RECEPCION";
    if (role && (APP_ROLES as readonly string[]).includes(role)) return role as AppRole;
    return "RECEPCION";
}

export function normalizePermissions(input: unknown): PermissionKey[] {
    const raw = Array.isArray(input) ? input : [];
    return Array.from(
        new Set(
            raw
                .filter((value): value is string => typeof value === "string")
                .filter((value) => PERMISSION_KEY_SET.has(value)),
        ),
    ) as PermissionKey[];
}

export function getBasePermissions(role?: string | null) {
    return BASE_ROLE_PERMISSIONS[normalizeRole(role)];
}

export function getEffectivePermissions(subject?: AccessSubject | null): PermissionKey[] {
    const role = normalizeRole(subject?.role);
    const overrides = normalizePermissions(subject?.permissions);
    if (role === "ADMINISTRADOR" || overrides.includes(FULL_ACCESS_PERMISSION)) {
        return APP_PERMISSION_KEYS;
    }
    return Array.from(new Set([...BASE_ROLE_PERMISSIONS[role], ...overrides]));
}

export function hasPermission(subject: AccessSubject | null | undefined, permission: PermissionKey) {
    return getEffectivePermissions(subject).includes(permission);
}

export function hasAnyPermission(subject: AccessSubject | null | undefined, permissions: PermissionKey[]) {
    const effective = new Set(getEffectivePermissions(subject));
    return permissions.some((permission) => effective.has(permission));
}

export function getRoleLabel(role?: string | null) {
    return APP_ROLE_LABELS[normalizeRole(role)];
}

export function describePermissions(subject?: AccessSubject | null) {
    const role = normalizeRole(subject?.role);
    const overrides = normalizePermissions(subject?.permissions);
    return {
        role,
        roleLabel: APP_ROLE_LABELS[role],
        permissions: getEffectivePermissions(subject),
        overrides,
        hasFullAccess: role === "ADMINISTRADOR" || overrides.includes(FULL_ACCESS_PERMISSION),
    };
}
