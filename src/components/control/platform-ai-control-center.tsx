"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bot, Loader2, Plus, Trash2 } from "lucide-react";
import { GEMINI_ROUTER_MODEL_ID, resolveChatModelSelection, SUPPORTED_CHAT_MODELS, type SupportedChatModelOption } from "@/lib/ai/models";
import { AI_PRIMARY, AI_FALLBACK, MAX_AI_PROVIDERS, type PlatformAiRouterView, type PlatformAiProviderView } from "@/lib/ai/platform-router-config";

export type PlatformAiControlView = {
    chatModel: string; geminiKeyConfigured: boolean; openaiKeyConfigured: boolean;
    environmentFallbackEnabled: boolean; encryptionReady: boolean; revision: number; router: PlatformAiRouterView;
};
type ProviderDraft = PlatformAiProviderView & { apiKey: string; clearApiKey: boolean; availableModels?: string[]; checking?: "models" | "test" | null; connectionNotice?: string; connectionError?: boolean };
const field = "mt-1.5 min-h-12 w-full min-w-0 rounded-lg border bg-background px-3 text-base";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium disabled:opacity-40";

export function PlatformAiControlCenter({ initial }: { initial: PlatformAiControlView }) {
    const [state, setState] = useState(initial);
    const [model, setModel] = useState(initial.chatModel);
    const [router, setRouter] = useState(initial.router);
    const [providers, setProviders] = useState<ProviderDraft[]>(initial.router.providers.map(p => ({ ...p, apiKey: "", clearApiKey: false })));
    const [models, setModels] = useState<SupportedChatModelOption[]>(SUPPORTED_CHAT_MODELS.some(m => m.id === initial.chatModel) ? SUPPORTED_CHAT_MODELS : [...SUPPORTED_CHAT_MODELS, resolveChatModelSelection(initial.chatModel)]);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogNotice, setCatalogNotice] = useState("");
    const requestVersions = useRef(new Map<string, number>());
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState("");
    const [failed, setFailed] = useState(false);
    function patchProvider(id: string, patch: Partial<ProviderDraft>) {
        const changed = "baseUrl" in patch || "apiKey" in patch || "clearApiKey" in patch;
        if (changed || "model" in patch) requestVersions.current.set(id, (requestVersions.current.get(id) || 0) + 1);
        setProviders(current => current.map(p => p.id === id ? { ...p, ...(changed ? { availableModels: undefined, connectionNotice: "", checking: null } : {}), ...("model" in patch ? { connectionNotice: "", checking: null } : {}), ...patch } : p));
    }
    async function refreshCatalog() {
        setCatalogLoading(true);
        try {
            const response = await fetch("/api/control/ai/models", { cache: "no-store" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "No se pudo actualizar la lista.");
            setModels(data.models.some((m: SupportedChatModelOption) => m.id === model) ? data.models : [...data.models, resolveChatModelSelection(model)]);
            setCatalogNotice(data.notice);
        } catch (error) { setCatalogNotice(error instanceof Error ? error.message : "No se pudo consultar el catálogo."); }
        finally { setCatalogLoading(false); }
    }
    async function queryProvider(provider: ProviderDraft, action: "models" | "test") {
        const version = (requestVersions.current.get(provider.id) || 0) + 1;
        requestVersions.current.set(provider.id, version);
        patchProvider(provider.id, { checking: action, connectionNotice: "", connectionError: false });
        try {
            const response = await fetch("/api/control/ai/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: provider.id, baseUrl: provider.baseUrl, apiKey: provider.clearApiKey ? "" : provider.apiKey, model: provider.model }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "El endpoint no respondió correctamente.");
            if (requestVersions.current.get(provider.id) !== version) return;
            patchProvider(provider.id, action === "models" ? { availableModels: data.models, connectionNotice: data.models.length ? `${data.models.length} modelos disponibles en este endpoint.` : "El endpoint no devolvió modelos. Puedes escribir el ID y probar la conexión." } : { connectionNotice: `Respuesta de texto recibida en ${(data.elapsedMs / 1000).toFixed(1)} s. La prueba no utiliza datos de clientes.` });
        } catch (error) {
            if (requestVersions.current.get(provider.id) === version) patchProvider(provider.id, { connectionError: true, connectionNotice: error instanceof Error ? error.message : "No se pudo contactar al endpoint." });
        } finally { if (requestVersions.current.get(provider.id) === version) patchProvider(provider.id, { checking: null }); }
    }
    function autoLoad(provider: ProviderDraft) {
        if (provider.baseUrl.trim() && (provider.apiKey.trim().length >= 8 || (provider.apiKeyConfigured && !provider.clearApiKey)) && !provider.availableModels && !provider.checking) void queryProvider(provider, "models");
    }
    function move(id: string, delta: number) {
        const order = [...router.order], from = order.indexOf(id), to = from + delta;
        if (to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        setRouter({ ...router, order });
    }
    function add(kind: "groq" | "gemini" | "custom") {
        if (providers.length >= MAX_AI_PROVIDERS) return;
        const id = crypto.randomUUID();
        const preset = kind === "groq" ? { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "qwen/qwen3.8-27b" }
            : kind === "gemini" ? { name: "Gemini · cuenta adicional", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.6-flash" }
            : { name: "Proveedor compatible", baseUrl: "", model: "" };
        setProviders([...providers, { ...preset, id, enabled: false, apiKeyConfigured: false, apiKey: "", clearApiKey: false }]);
        // New low-cost accounts precede the official providers, retaining earlier custom priority.
        const order = [...router.order];
        order.splice(Math.max(0, order.indexOf(AI_PRIMARY)), 0, id);
        setRouter({ ...router, order });
    }
    async function save() {
        setPending(true); setNotice(""); setFailed(false);
        try {
            const response = await fetch("/api/control/ai", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatModel: model, revision: state.revision, router: { ...router, providers: providers.map(({ id, name, baseUrl, model, enabled, apiKey, clearApiKey }) => ({ id, name, baseUrl, model, enabled, apiKey, clearApiKey })) } }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No fue posible guardar.");
            const refreshed = await fetch("/api/control/ai", { cache: "no-store" });
            if (!refreshed.ok) throw new Error("El cambio se guardó; recarga para consultar su estado.");
            const next = await refreshed.json() as PlatformAiControlView;
            setState(next); setModel(next.chatModel); setRouter(next.router);
            setProviders(next.router.providers.map(p => ({ ...p, apiKey: "", clearApiKey: false })));
            setNotice("Configuración guardada y auditada. Se aplica a los próximos mensajes de todos los negocios.");
        } catch (error) { setFailed(true); setNotice(error instanceof Error ? error.message : "No fue posible guardar."); }
        finally { setPending(false); }
    }
    const fallback = resolveChatModelSelection(model).provider === "gemini" ? "openai:gpt-4o-mini" : GEMINI_ROUTER_MODEL_ID;
    return <section aria-labelledby="platform-ai-title" className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6">
        <header className="flex items-start gap-3"><Bot className="mt-1 size-6 shrink-0 text-primary" /><div className="min-w-0"><h2 id="platform-ai-title" className="text-xl font-semibold">Proveedores de IA de la plataforma</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Elige la prioridad para todos los negocios actuales y nuevos. Esta configuración sólo está disponible en tu panel de control.</p></div></header>
        <form onSubmit={event => { event.preventDefault(); void save(); }} className="mt-6 space-y-6">
            <fieldset disabled={pending} className="min-w-0 space-y-6 disabled:opacity-70">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="min-w-0"><label htmlFor="platform-official-model" className="text-sm font-medium">Modelo oficial principal</label><select id="platform-official-model" className={field} value={model} onChange={event => setModel(event.target.value)}>{models.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select><button type="button" className={`${secondary} mt-2`} disabled={catalogLoading} onClick={() => void refreshCatalog()}>{catalogLoading ? <Loader2 className="size-4 animate-spin" /> : null}Actualizar modelos Gemini</button>{catalogNotice ? <span role="status" className="mt-2 block text-xs leading-5 text-muted-foreground">{catalogNotice}</span> : null}</div>
                    <label className="min-w-0 text-sm font-medium">Espera máxima por proveedor<select className={field} value={router.timeoutMs} onChange={event => setRouter({ ...router, timeoutMs: Number(event.target.value) })}>{[1500, 3000, 4000, 6000, 10000].map(ms => <option key={ms} value={ms}>{ms / 1000} segundos</option>)}</select></label>
                </div>
                <label className="flex min-h-12 items-center justify-between gap-4 rounded-xl border p-4"><span><span className="block font-medium">Usar prioridad y respaldos</span><span className="mt-1 block text-sm text-muted-foreground">Apagado: utiliza únicamente el modelo oficial principal.</span></span><input type="checkbox" className="size-5 shrink-0 accent-primary" checked={router.enabled} onChange={event => setRouter({ ...router, enabled: event.target.checked })} /></label>
                <div><h3 className="font-semibold">Prioridad y respaldos</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Se intenta de arriba hacia abajo, sólo con proveedores activos. Ante un fallo o una respuesta vacía se continúa con el siguiente.</p>
                    <ol aria-label="Prioridad de proveedores" className="mt-4 space-y-2">{router.order.map((id, index) => {
                        const provider = providers.find(p => p.id === id), official = id === AI_PRIMARY || id === AI_FALLBACK;
                        if (!provider && !official) return null;
                        const selected = resolveChatModelSelection(id === AI_PRIMARY ? model : fallback);
                        const name = provider?.name || `${selected.label} · ${id === AI_PRIMARY ? "principal" : "respaldo"}`;
                        const enabled = provider ? provider.enabled : id === AI_PRIMARY ? router.primaryEnabled : router.fallbackEnabled;
                        const ready = provider ? (Boolean(provider.apiKey.trim()) || (provider.apiKeyConfigured && !provider.clearApiKey)) : state.environmentFallbackEnabled && (selected.provider === "gemini" ? state.geminiKeyConfigured : state.openaiKeyConfigured);
                        return <li key={id} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-xl border bg-background p-3 sm:flex sm:flex-nowrap"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm tabular-nums">{index + 1}</span><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{provider?.model || selected.model}{!ready ? " · Falta clave" : ""}</p></div><div className="col-span-2 ml-auto flex shrink-0 items-center gap-2"><label className="flex size-11 items-center justify-center"><span className="sr-only">Activar {name}</span><input type="checkbox" className="size-5 accent-primary" checked={enabled} onChange={event => provider ? patchProvider(id, { enabled: event.target.checked }) : setRouter({ ...router, [id === AI_PRIMARY ? "primaryEnabled" : "fallbackEnabled"]: event.target.checked })} /></label><button type="button" className={`${secondary} w-11 px-0`} disabled={index === 0} aria-label={`Subir ${name}`} onClick={() => move(id, -1)}><ArrowUp className="size-4" /></button><button type="button" className={`${secondary} w-11 px-0`} disabled={index === router.order.length - 1} aria-label={`Bajar ${name}`} onClick={() => move(id, 1)}><ArrowDown className="size-4" /></button></div></li>;
                    })}</ol>
                </div>
                <div><h3 className="font-semibold">Proveedores compatibles con OpenAI</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Agrega Groq, otra cuenta de Gemini u otro endpoint compatible. Verifica que el modelo esté disponible en esa cuenta.</p><div className="mt-3 flex flex-wrap gap-2">{([['groq', 'Agregar Groq'], ['gemini', 'Agregar Gemini'], ['custom', 'Agregar otro']] as const).map(([kind, label]) => <button key={kind} type="button" disabled={providers.length >= MAX_AI_PROVIDERS} className={secondary} onClick={() => add(kind)}><Plus className="size-4" />{label}</button>)}</div>
                    {!state.encryptionReady ? <p role="status" className="mt-3 text-sm text-destructive">Configura la llave de cifrado de la plataforma antes de guardar nuevas claves.</p> : null}
                    <div className="mt-4 space-y-4">{providers.map((provider, index) => <section key={provider.id} aria-label={`Configuración de ${provider.name}`} className="min-w-0 rounded-xl border bg-background p-4"><div className="flex items-center justify-between gap-3"><h4 className="min-w-0 break-words font-medium">{provider.name}</h4><button type="button" className={`${secondary} w-11 shrink-0 px-0 text-destructive`} aria-label={`Quitar ${provider.name}`} onClick={() => { setProviders(providers.filter(p => p.id !== provider.id)); setRouter({ ...router, order: router.order.filter(id => id !== provider.id) }); }}><Trash2 className="size-4" /></button></div>
                        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2"><label className="min-w-0 text-sm font-medium">Nombre<input required maxLength={80} value={provider.name} className={field} onChange={event => patchProvider(provider.id, { name: event.target.value })} /></label><label className="min-w-0 text-sm font-medium">Modelo{provider.availableModels?.length ? <select value={provider.model} className={field} onChange={event => patchProvider(provider.id, { model: event.target.value })}>{!provider.availableModels.includes(provider.model) ? <option value={provider.model}>{provider.model || "Selecciona un modelo"}</option> : null}{provider.availableModels.map(model => <option key={model} value={model}>{model}</option>)}</select> : <input required maxLength={150} value={provider.model} className={field} onChange={event => patchProvider(provider.id, { model: event.target.value })} />}</label></div>
                        <label className="mt-4 block text-sm font-medium">Base URL o endpoint de chat<input required type="url" maxLength={500} value={provider.baseUrl} className={field} onBlur={event => { if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.aiDiagnostic)) autoLoad(provider); }} onChange={event => patchProvider(provider.id, { baseUrl: event.target.value })} /></label>
                        <label htmlFor={`provider-key-${index}`} className="mt-4 block text-sm font-medium">API Key<input id={`provider-key-${index}`} type="password" autoComplete="new-password" maxLength={4096} value={provider.apiKey} className={field} onBlur={event => { if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.dataset.aiDiagnostic)) autoLoad(provider); }} placeholder={provider.apiKeyConfigured ? "Guardada; deja vacío para conservar" : ""} onChange={event => patchProvider(provider.id, { apiKey: event.target.value, clearApiKey: false })} /></label>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">La clave se guarda cifrada y no vuelve al navegador. Si cambias la URL, vuelve a capturarla.</p>
                        {provider.apiKeyConfigured ? <label className="mt-2 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={provider.clearApiKey} onChange={event => patchProvider(provider.id, { clearApiKey: event.target.checked, apiKey: "" })} />Eliminar clave guardada</label> : null}
                        <div className="mt-4 flex flex-wrap gap-2"><button type="button" data-ai-diagnostic="true" className={secondary} disabled={Boolean(provider.checking) || provider.clearApiKey} onClick={() => void queryProvider(provider, "models")}>{provider.checking === "models" ? <Loader2 className="size-4 animate-spin" /> : null}Consultar modelos</button><button type="button" data-ai-diagnostic="true" className={secondary} disabled={Boolean(provider.checking) || !provider.model.trim() || provider.clearApiKey} onClick={() => void queryProvider(provider, "test")}>{provider.checking === "test" ? <Loader2 className="size-4 animate-spin" /> : null}Probar conexión</button></div>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">La prueba envía un mensaje breve y puede consumir tokens del proveedor.</p>
                        {provider.connectionNotice ? <p role={provider.connectionError ? "alert" : "status"} className={`mt-3 text-sm leading-6 ${provider.connectionError ? "text-destructive" : "text-muted-foreground"}`}>{provider.connectionNotice}</p> : null}
                    </section>)}</div>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">Las claves de los modelos oficiales se conservan en los secretos del despliegue. Audio, imágenes y búsqueda semántica mantienen sus proveedores actuales. El orden se aplica a las solicitudes de texto del asistente, las FAQs y sus tareas internas.</p>
                <button type="submit" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground sm:w-auto">{pending ? <Loader2 className="size-4 animate-spin" /> : null}Guardar proveedores</button>
            </fieldset>
            {notice ? <p role={failed ? "alert" : "status"} className={`rounded-xl border p-4 text-sm leading-6 ${failed ? "text-destructive" : ""}`}>{notice}</p> : null}
        </form>
    </section>;
}
