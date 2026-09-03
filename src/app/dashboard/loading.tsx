export default function DashboardLoading() {
    return (
        <div className="apple-loading-shell" aria-label="Cargando contenido" aria-live="polite">
            <div className="apple-loading-heading" />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((item) => <div key={item} className="apple-loading-card" />)}
            </div>
            <div className="apple-loading-panel" />
        </div>
    );
}
