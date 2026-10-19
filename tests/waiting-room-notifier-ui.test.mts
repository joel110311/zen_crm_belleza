import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mts";

async function notification(pathname: string, type = "appointment_request") {
    const states: unknown[] = [], effects: (() => void)[] = [];
    let cursor = 0;
    const hours = loadTsModule("src/lib/calendar/business-hours.ts", {});
    const mod = loadTsModule("src/components/layout/waiting-room-notifier.tsx", {
        react: {
            useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value: unknown) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
            useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useRef: () => ({ current: false }),
            useEffect: (effect: () => void) => effects.push(effect),
        },
        "next/link": "a", "next/navigation": { usePathname: () => pathname },
        "@/components/ui/button": { Button: ({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode }) => asChild ? children : React.createElement("button", props, children) },
        "@/lib/utils": { cn: (...parts: unknown[]) => parts.filter(Boolean).join(" ") },
        "@/lib/tenant-request-routing": loadTsModule("src/lib/tenant-request-routing.ts", {}),
        "@/lib/operation-dates": loadTsModule("src/lib/operation-dates.ts", { "@/lib/calendar/business-hours": hours }),
    }, {
        window: { sessionStorage: { getItem: () => null, setItem() {} }, setInterval: () => 1, clearInterval() {} },
        fetch: async () => Response.json({ locale: "es-MX", timeZone: "America/Mexico_City", notifications: [{
            type, id: "appointment-a", patientName: "Ana Torres", specialistName: "Sofía Ruiz", serviceName: "Manicura", title: "Manicura · Ana Torres",
            phone: "525512345678", startTime: "2026-10-20T17:00:00.000Z", endTime: "2026-10-20T18:00:00.000Z", arrivalAt: null,
        }] }),
    });
    const render = () => { cursor = 0; return renderToStaticMarkup((mod.WaitingRoomNotifier as () => React.ReactNode)()); };
    render(); for (const effect of effects.splice(0)) effect();
    await new Promise(resolve => setTimeout(resolve, 0));
    return render();
}

test("appointment notice identifies client, professional and full business date with one review action", async () => {
    const html = await notification("/t/atelier-belleza/dashboard");
    assert.match(html, /Cliente/); assert.match(html, /Ana Torres/); assert.match(html, /Profesional: Sofía Ruiz/);
    assert.match(html, /20 de octubre de 2026/); assert.match(html, /11:00/);
    assert.match(html, /\/t\/atelier-belleza\/reception\?date=2026-10-20&amp;request=appointment-a/);
    assert.match(html, /Revisar solicitud/); assert.doesNotMatch(html, /525512345678|Entendido|Cerrar notificacion/);
});
test("classic workspace keeps its own review route and waiting-room dismissal", async () => {
    const request = await notification("/dashboard"); assert.match(request, /\/dashboard\/reception\?date=/);
    const waiting = await notification("/t/atelier-belleza/dashboard", "waiting_room");
    assert.match(waiting, /Entendido/); assert.match(waiting, /\/t\/atelier-belleza\/contacts/);
});
