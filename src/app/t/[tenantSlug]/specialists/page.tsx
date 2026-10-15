import styles from "@/components/shared/management-workspace.module.css";
import { UserRoundCog } from "lucide-react";
import { SpecialistManagerPanel } from "@/components/settings/specialist-manager-panel";

export default function TenantSpecialistsPage() {
    return (
        <div className={styles.workspace}>
            <div className={styles.heading}><div><h1><UserRoundCog className="size-6 text-primary" />Especialistas</h1><p>Personas, agendas y disponibilidad de tu equipo.</p></div></div>
            <SpecialistManagerPanel />
        </div>
    );
}
