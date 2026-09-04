"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
    ServicesCatalog,
    type ServicesCatalogData,
} from "@/components/services/services-catalog";
import { Button } from "@/components/ui/button";
import { tenantApi, tenantApiBase } from "@/components/tenant/tenant-api-client";

export function ServicesWorkspace({ tenantSlug }: { tenantSlug: string }) {
    const api = tenantApiBase(tenantSlug);
    const [catalog, setCatalog] = useState<ServicesCatalogData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setCatalog(await tenantApi<ServicesCatalogData>(`${api}/services`));
            setError(null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el catálogo.");
        } finally {
            setLoading(false);
        }
    }, [api]);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading && !catalog) {
        return (
            <div className="flex min-h-[28rem] items-center justify-center rounded-2xl border bg-card">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Cargando servicios" />
            </div>
        );
    }

    if (!catalog) {
        return (
            <div className="flex min-h-[28rem] flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center">
                <p className="font-semibold">No pudimos cargar los servicios</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">{error || "Intenta nuevamente."}</p>
                <Button className="mt-4" variant="outline" onClick={() => void load()}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Reintentar
                </Button>
            </div>
        );
    }

    return <ServicesCatalog initialData={catalog} tenantSlug={tenantSlug} />;
}
