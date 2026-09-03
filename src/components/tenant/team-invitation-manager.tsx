"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MailPlus, UserRoundCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TeamPayload = {
    memberships: Array<{
        id: string;
        role: string;
        isActive: boolean;
        user: { name: string; email: string; emailVerifiedAt: string | null };
    }>;
    invitations: Array<{
        id: string;
        email: string;
        role: string;
        status: string;
        expiresAt: string;
        professionalProfileStatus: string | null;
    }>;
    seats: { limit: number; active: number; pending: number; available: number };
};

type Props = {
    tenantSlug: string;
    enabled: boolean;
    onConfigured?: () => void;
};

function apiError(payload: unknown, fallback: string) {
    if (payload && typeof payload === "object" && "error" in payload) {
        const error = (payload as { error?: { message?: unknown } }).error;
        if (typeof error?.message === "string") return error.message;
    }
    return fallback;
}

const ROLE_LABELS: Record<string, string> = {
    OWNER: "Propietario",
    ADMIN: "Administración",
    PROFESSIONAL: "Profesional",
    RECEPTION: "Recepción",
};

export function TeamInvitationManager({ tenantSlug, enabled, onConfigured }: Props) {
    const [team, setTeam] = useState<TeamPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(enabled);
    const [sending, setSending] = useState(false);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("RECEPTION");
    const [professionalName, setProfessionalName] = useState("");
    const [specialty, setSpecialty] = useState("");

    const endpoint = useMemo(() => `/api/t/${encodeURIComponent(tenantSlug)}/v1/invitations`, [tenantSlug]);
    const load = useCallback(async () => {
        if (!enabled) return;
        setLoading(true);
        try {
            const response = await fetch(endpoint, { cache: "no-store" });
            const payload = await response.json().catch(() => null) as { data?: TeamPayload } | null;
            if (!response.ok || !payload?.data) throw new Error(apiError(payload, "No fue posible cargar el equipo."));
            setTeam(payload.data);
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No fue posible cargar el equipo.");
        } finally {
            setLoading(false);
        }
    }, [enabled, endpoint]);

    useEffect(() => { void load(); }, [load]);

    async function invite(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSending(true);
        setError(null);
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({
                    email,
                    role,
                    professionalProfile: role === "PROFESSIONAL" ? { name: professionalName, specialty } : undefined,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new Error(apiError(payload, "No fue posible enviar la invitación."));
            setEmail("");
            setProfessionalName("");
            setSpecialty("");
            onConfigured?.();
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "No fue posible enviar la invitación.");
        } finally {
            setSending(false);
        }
    }

    async function revoke(invitationId: string) {
        setError(null);
        const response = await fetch(`${endpoint}/${encodeURIComponent(invitationId)}`, {
            method: "DELETE",
            headers: { "Idempotency-Key": crypto.randomUUID() },
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            setError(apiError(payload, "No fue posible revocar la invitación."));
            return;
        }
        await load();
    }

    async function setMembership(membershipId: string, isActive: boolean) {
        setError(null);
        const response = await fetch(`/api/t/${encodeURIComponent(tenantSlug)}/v1/memberships/${encodeURIComponent(membershipId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ isActive }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            setError(apiError(payload, "No fue posible actualizar la membresía."));
            return;
        }
        await load();
    }

    if (!enabled) {
        return <div className="rounded-xl border bg-muted/30 p-5 text-sm leading-6 text-muted-foreground">El equipo está listo en el código, pero permanece cerrado hasta configurar correo transaccional y activar <code>MULTITENANT_INVITATIONS_ENABLED</code>.</div>;
    }

    return (
        <div className="space-y-5">
            <div className="rounded-xl border bg-muted/30 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium"><UsersRound className="size-4 text-primary" /> Equipo y asientos</div>
                <p className="mt-1 text-muted-foreground">
                    {team ? `${team.seats.active} activos + ${team.seats.pending} invitaciones de ${team.seats.limit} asientos.` : "Cargando asientos..."}
                </p>
            </div>

            <form className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2" onSubmit={invite}>
                <div className="sm:col-span-2"><p className="font-medium">Invitar a una persona</p><p className="mt-1 text-sm text-muted-foreground">La invitación vence en siete días y nunca incluye una contraseña.</p></div>
                <Field label="Correo electrónico"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></Field>
                <Field label="Rol">
                    <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value)}>
                        <option value="RECEPTION">Recepción</option>
                        <option value="PROFESSIONAL">Profesional</option>
                        <option value="ADMIN">Administración</option>
                    </select>
                </Field>
                {role === "PROFESSIONAL" ? <>
                    <Field label="Nombre profesional"><Input value={professionalName} onChange={(event) => setProfessionalName(event.target.value)} maxLength={160} /></Field>
                    <Field label="Especialidad (opcional)"><Input value={specialty} onChange={(event) => setSpecialty(event.target.value)} maxLength={160} /></Field>
                </> : null}
                <div className="sm:col-span-2 flex justify-end"><Button type="submit" disabled={sending || team?.seats.available === 0}>{sending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <MailPlus className="mr-2 size-4" />}Enviar invitación</Button></div>
            </form>

            {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando equipo…</div> : null}

            {team ? <div className="space-y-3">
                <p className="text-sm font-medium">Miembros</p>
                {team.memberships.map((membership) => <div key={membership.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                    <div><p className="font-medium">{membership.user.name}</p><p className="text-muted-foreground">{membership.user.email} · {ROLE_LABELS[membership.role] || membership.role}</p></div>
                    {membership.role !== "OWNER" ? <Button type="button" variant="outline" size="sm" onClick={() => void setMembership(membership.id, !membership.isActive)}>{membership.isActive ? "Desactivar" : "Reactivar"}</Button> : <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">Propietario</span>}
                </div>)}
                <p className="pt-2 text-sm font-medium">Invitaciones</p>
                {team.invitations.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay invitaciones.</p> : team.invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                    <div><p className="font-medium">{invitation.email}</p><p className="text-muted-foreground">{ROLE_LABELS[invitation.role] || invitation.role} · {invitation.status.toLocaleLowerCase()}</p></div>
                    {invitation.status === "PENDING" ? <Button type="button" variant="ghost" size="sm" onClick={() => void revoke(invitation.id)}>Revocar</Button> : invitation.professionalProfileStatus === "FAILED" ? <span className="text-xs text-amber-700">Perfil profesional pendiente de reintento</span> : <UserRoundCheck className="size-4 text-muted-foreground" />}
                </div>)}
            </div> : null}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="space-y-2"><Label>{label}</Label>{children}</label>;
}
