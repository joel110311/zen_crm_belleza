"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Loader2, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { createUser, deleteUser, getUsers, updateUser } from "@/app/actions/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    APP_PERMISSION_GROUPS,
    APP_ROLE_LABELS,
    APP_ROLES,
    FULL_ACCESS_PERMISSION,
    describePermissions,
    getBasePermissions,
    normalizePermissions,
    normalizeRole,
    type AppRole,
    type PermissionKey,
} from "@/lib/permissions";
import { useToast } from "@/components/ui/use-toast";

type UserRow = Awaited<ReturnType<typeof getUsers>>[number];

type UserFormState = {
    name: string;
    email: string;
    password: string;
    role: AppRole;
    permissions: PermissionKey[];
};

const EMPTY_USER: UserFormState = {
    name: "",
    email: "",
    password: "",
    role: "RECEPCION",
    permissions: [],
};

function normalizeOverridePermissions(role: AppRole, permissions: unknown) {
    if (role === "ADMINISTRADOR") return [];
    const base = new Set(getBasePermissions(role));
    return normalizePermissions(permissions).filter((permission) => !base.has(permission));
}

function countExtraPermissions(role: string, permissions: unknown) {
    return normalizeOverridePermissions(normalizeRole(role), permissions).length;
}

export function UserAccessPanel({ currentUserId }: { currentUserId?: string }) {
    const { toast } = useToast();
    const [users, setUsers] = useState<UserRow[]>([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [newUser, setNewUser] = useState<UserFormState>(EMPTY_USER);
    const [editUser, setEditUser] = useState<UserFormState>(EMPTY_USER);
    const [isPending, startTransition] = useTransition();

    const loadUsers = () => {
        startTransition(async () => {
            try {
                const data = await getUsers();
                setUsers(data);
            } catch (error) {
                console.error("Failed to load users:", error);
                toast({ title: "No se pudieron cargar usuarios", variant: "destructive" });
            }
        });
    };

    useEffect(() => {
        loadUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const activeForm = editingUserId ? editUser : newUser;
    const activeAccess = useMemo(() => describePermissions(activeForm), [activeForm]);

    const setRole = (role: AppRole, target: "new" | "edit") => {
        const updater = (current: UserFormState) => ({
            ...current,
            role,
            permissions: normalizeOverridePermissions(role, current.permissions),
        });
        if (target === "new") setNewUser(updater);
        if (target === "edit") setEditUser(updater);
    };

    const togglePermission = (permission: PermissionKey, target: "new" | "edit") => {
        const updater = (current: UserFormState) => {
            const role = normalizeRole(current.role);
            if (role === "ADMINISTRADOR") return current;
            const base = new Set(getBasePermissions(role));
            if (base.has(permission)) return current;

            const next = new Set(current.permissions);
            if (next.has(permission)) {
                next.delete(permission);
            } else {
                next.add(permission);
            }

            return {
                ...current,
                permissions: normalizeOverridePermissions(role, Array.from(next)),
            };
        };

        if (target === "new") setNewUser(updater);
        if (target === "edit") setEditUser(updater);
    };

    const handleCreateUser = () => {
        if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) return;
        startTransition(async () => {
            const result = await createUser({
                name: newUser.name.trim(),
                email: newUser.email.trim(),
                password: newUser.password,
                role: newUser.role,
                permissions: newUser.permissions,
            });
            if (!result.success) {
                toast({ title: "Error", description: result.error, variant: "destructive" });
                return;
            }
            setNewUser(EMPTY_USER);
            setShowAddForm(false);
            loadUsers();
            toast({ title: "Usuario creado" });
        });
    };

    const handleStartEdit = (user: UserRow) => {
        const role = normalizeRole(user.role);
        setEditingUserId(user.id);
        setEditUser({
            name: user.name || "",
            email: user.email,
            password: "",
            role,
            permissions: normalizeOverridePermissions(role, user.permissions),
        });
    };

    const handleUpdateUser = (userId: string) => {
        startTransition(async () => {
            const result = await updateUser(userId, {
                name: editUser.name.trim(),
                email: editUser.email.trim(),
                role: editUser.role,
                permissions: editUser.permissions,
                password: editUser.password || undefined,
            });
            if (!result.success) {
                toast({ title: "Error", description: result.error, variant: "destructive" });
                return;
            }
            setEditingUserId(null);
            setEditUser(EMPTY_USER);
            loadUsers();
            toast({ title: "Usuario actualizado" });
        });
    };

    const handleDeleteUser = (userId: string, name: string | null) => {
        if (!confirm(`Eliminar a ${name || "este usuario"}?`)) return;
        startTransition(async () => {
            const result = await deleteUser(userId);
            if (!result.success) {
                toast({ title: "Error", description: result.error, variant: "destructive" });
                return;
            }
            loadUsers();
            toast({ title: "Usuario eliminado" });
        });
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="font-semibold">Usuarios y permisos</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Define el rol base y agrega permisos extra por casillas. Paciente queda fuera del dashboard y usa solo enlaces de turno/portal.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        El nombre aqui es solo para acceso. El perfil clinico, titulo, cedula, foto y agenda se administran en Especialistas.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={loadUsers} disabled={isPending}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refrescar
                    </Button>
                    <Button variant="outline" onClick={() => setShowAddForm((current) => !current)} className="w-full sm:w-auto">
                        {showAddForm ? <X className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                        {showAddForm ? "Cancelar" : "Agregar"}
                    </Button>
                </div>
            </div>

            {showAddForm ? (
                <UserForm
                    title="Nuevo usuario"
                    form={newUser}
                    target="new"
                    isPending={isPending}
                    effectivePermissions={activeAccess.permissions.length}
                    onChange={setNewUser}
                    onRoleChange={setRole}
                    onPermissionToggle={togglePermission}
                    onSubmit={handleCreateUser}
                    submitLabel="Crear usuario"
                />
            ) : null}

            <div className="space-y-3">
                {users.map((user) => {
                    const isEditing = editingUserId === user.id;
                    const role = normalizeRole(user.role);
                    const access = describePermissions({ role, permissions: user.permissions });
                    const extraCount = countExtraPermissions(role, user.permissions);

                    return (
                        <div key={user.id} className="rounded-2xl border p-4">
                            {isEditing ? (
                                <UserForm
                                    title={`Editar ${user.name || user.email}`}
                                    form={editUser}
                                    target="edit"
                                    isPending={isPending}
                                    effectivePermissions={describePermissions(editUser).permissions.length}
                                    onChange={setEditUser}
                                    onRoleChange={setRole}
                                    onPermissionToggle={togglePermission}
                                    onSubmit={() => handleUpdateUser(user.id)}
                                    submitLabel="Guardar cambios"
                                    onCancel={() => {
                                        setEditingUserId(null);
                                        setEditUser(EMPTY_USER);
                                    }}
                                />
                            ) : (
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-semibold">
                                                {user.name || user.email}
                                                {user.id === currentUserId ? <span className="ml-2 text-xs text-muted-foreground">(Tu)</span> : null}
                                            </p>
                                            <Badge variant={access.hasFullAccess ? "secondary" : "outline"}>
                                                {access.roleLabel}
                                            </Badge>
                                            {access.hasFullAccess ? (
                                                <Badge variant="outline" className="border-primary/30 text-primary">
                                                    <ShieldCheck className="mr-1 h-3 w-3" />
                                                    Control total
                                                </Badge>
                                            ) : null}
                                        </div>
                                        <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {access.permissions.length} permisos efectivos
                                            {extraCount > 0 ? ` · ${extraCount} extra` : ""}
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <Button variant="outline" size="sm" onClick={() => handleStartEdit(user)} className="w-full sm:w-auto">
                                            <Pencil className="mr-2 h-4 w-4" />
                                            Editar
                                        </Button>
                                        {user.id !== currentUserId ? (
                                            <Button variant="ghost" size="sm" className="w-full text-destructive sm:w-auto" onClick={() => handleDeleteUser(user.id, user.name)}>
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                Eliminar
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {users.length === 0 ? (
                    <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                        No hay usuarios registrados.
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function UserForm({
    title,
    form,
    target,
    isPending,
    effectivePermissions,
    onChange,
    onRoleChange,
    onPermissionToggle,
    onSubmit,
    submitLabel,
    onCancel,
}: {
    title: string;
    form: UserFormState;
    target: "new" | "edit";
    isPending: boolean;
    effectivePermissions: number;
    onChange: (updater: UserFormState | ((current: UserFormState) => UserFormState)) => void;
    onRoleChange: (role: AppRole, target: "new" | "edit") => void;
    onPermissionToggle: (permission: PermissionKey, target: "new" | "edit") => void;
    onSubmit: () => void;
    submitLabel: string;
    onCancel?: () => void;
}) {
    const role = normalizeRole(form.role);
    const basePermissions = useMemo(() => new Set(getBasePermissions(role)), [role]);
    const selectedPermissions = useMemo(() => new Set(form.permissions), [form.permissions]);
    const hasFullAccess = role === "ADMINISTRADOR" || selectedPermissions.has(FULL_ACCESS_PERMISSION);

    return (
        <div className="space-y-4 rounded-2xl border bg-muted/15 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="text-sm text-muted-foreground">
                        {effectivePermissions} permisos efectivos con la configuracion actual.
                    </p>
                </div>
                <Badge variant={hasFullAccess ? "secondary" : "outline"}>
                    {hasFullAccess ? "Control total" : APP_ROLE_LABELS[role]}
                </Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <Input
                    placeholder="Nombre"
                    value={form.name}
                    onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
                />
                <Input
                    placeholder="Email"
                    type="email"
                    value={form.email}
                    onChange={(event) => onChange((current) => ({ ...current, email: event.target.value }))}
                />
                <Input
                    placeholder={target === "new" ? "Contraseña" : "Nueva contraseña"}
                    type="password"
                    value={form.password}
                    onChange={(event) => onChange((current) => ({ ...current, password: event.target.value }))}
                />
                <select
                    value={form.role}
                    onChange={(event) => onRoleChange(normalizeRole(event.target.value), target)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                    {APP_ROLES.map((roleOption) => (
                        <option key={roleOption} value={roleOption}>
                            {APP_ROLE_LABELS[roleOption]}
                        </option>
                    ))}
                </select>
            </div>

            <div className="space-y-3">
                {APP_PERMISSION_GROUPS.map((group) => (
                    <div key={group.title} className="rounded-2xl border bg-background/80 p-4">
                        <div className="mb-3">
                            <p className="font-medium">{group.title}</p>
                            <p className="text-xs text-muted-foreground">{group.description}</p>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                            {group.permissions.map((permission) => {
                                const isBase = basePermissions.has(permission.key);
                                const isChecked = hasFullAccess || isBase || selectedPermissions.has(permission.key);
                                const isDisabled = role === "ADMINISTRADOR" || isBase;
                                const isFullAccess = permission.key === FULL_ACCESS_PERMISSION;

                                return (
                                    <label
                                        key={permission.key}
                                        className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-3 transition ${
                                            isChecked ? "border-primary/25 bg-primary/5" : "bg-card hover:border-primary/25"
                                        } ${isDisabled ? "cursor-default opacity-75" : ""}`}
                                    >
                                        <Checkbox
                                            checked={isChecked}
                                            disabled={isDisabled}
                                            onCheckedChange={() => onPermissionToggle(permission.key, target)}
                                            className="mt-0.5"
                                        />
                                        <span className="min-w-0">
                                            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                                {permission.label}
                                                {isBase ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">Base</Badge> : null}
                                                {isFullAccess ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Extra</Badge> : null}
                                            </span>
                                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                                {permission.description}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={onSubmit} disabled={isPending || !form.name || !form.email || (target === "new" && !form.password)} className="w-full sm:w-auto">
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : target === "new" ? <Check className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                    {submitLabel}
                </Button>
                {onCancel ? (
                    <Button variant="ghost" onClick={onCancel} className="w-full sm:w-auto">
                        Cancelar
                    </Button>
                ) : null}
            </div>
        </div>
    );
}
