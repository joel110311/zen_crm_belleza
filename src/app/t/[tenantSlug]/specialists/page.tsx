import { UserRoundCog } from "lucide-react";
import { SpecialistManagerPanel } from "@/components/settings/specialist-manager-panel";

export default function TenantSpecialistsPage() {
    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserRoundCog className="size-5" /></span>
                <div>
                <h1 className="text-2xl font-bold">Especialistas</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Organiza a las personas que realizan servicios, sus agendas, áreas de trabajo y disponibilidad.
                </p>
                </div>
            </div>
            <SpecialistManagerPanel />
        </div>
    );
}
