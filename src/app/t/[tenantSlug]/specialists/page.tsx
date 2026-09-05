import { SpecialistManagerPanel } from "@/components/settings/specialist-manager-panel";

export default function TenantSpecialistsPage() {
    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Especialistas</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Administra perfiles, agendas, servicios, disponibilidad y bloqueos del equipo.
                </p>
            </div>
            <SpecialistManagerPanel />
        </div>
    );
}
