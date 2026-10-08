import assert from "node:assert/strict";
import test from "node:test";
import { applyUnreadBrowserBadge, getTotalUnreadCount } from "../src/lib/inbox-browser-badge.ts";
import { BRAND_LOTUS_PATHS } from "../src/lib/brand-lotus.ts";

test("el contador sigue contando sobre el favicon personalizado o la flor; evita carreras al limpiarlo", async () => {
    const saved = new Map<string, PropertyDescriptor | undefined>();
    const install = (key: string, value: unknown) => {
        saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    };
    const numbers: string[] = [];
    const imageUrls: string[] = [];
    const paths: string[] = [];
    let dynamic: { href: string; remove: () => void; setAttribute: () => void } | null = null;
    let failImage = false;
    let delayed = false;
    const pendingLoads: (() => void)[] = [];
    const documentMock = {
        title: "Mi Spa",
        querySelectorAll: () => [{ href: "/favicon.ico" }, { href: "/mi-icono.svg" }],
        querySelector: () => dynamic,
        head: { appendChild: (link: typeof dynamic) => { dynamic = link; } },
        createElement: (tag: string) => tag === "link" ? {
            href: "", setAttribute: () => {}, remove: () => { dynamic = null; },
        } : {
            getContext: () => new Proxy({}, { get: (_target, name) => {
                if (name === "fillText") return (text: string) => { numbers.push(text); };
                if (name === "stroke") return (path?: { d: string }) => { if (path) paths.push(path.d); };
                return () => {};
            } }),
            toDataURL: () => "data:image/png;base64,test-badge",
        },
    };
    class MockImage {
        onload = () => {}; onerror = () => {};
        set src(url: string) {
            imageUrls.push(url);
            const load = () => { if (failImage) this.onerror(); else this.onload(); };
            if (delayed) pendingLoads.push(load); else queueMicrotask(load);
        }
    }
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    install("document", documentMock);
    install("window", { dispatchEvent: () => {} });
    install("Image", MockImage);
    install("Path2D", class { d: string; constructor(d: string) { this.d = d; } });
    try {
        assert.equal(getTotalUnreadCount({ a: 3, b: 2 }), 5);
        applyUnreadBrowserBadge({ a: 3, b: 2 }); await settle();
        assert.equal(documentMock.title, "(5) Mi Spa");
        assert.equal(numbers.at(-1), "5");
        assert.equal(imageUrls.at(-1), "/mi-icono.svg");
        assert.ok(dynamic);

        documentMock.querySelectorAll = () => [{ href: "/favicon.ico" }, { href: "/brand/lotus-favicon.svg" }];
        failImage = true;
        applyUnreadBrowserBadge({ a: 15 }); await settle();
        assert.equal(numbers.at(-1), "9+");
        assert.equal(imageUrls.at(-1), "/brand/lotus-favicon.svg");
        assert.deepEqual(paths, [...BRAND_LOTUS_PATHS]);
        applyUnreadBrowserBadge({ a: 120 }); await settle();
        assert.equal(documentMock.title, "(99+) Mi Spa");
        assert.equal(numbers.at(-1), "99");

        delayed = true; failImage = false;
        applyUnreadBrowserBadge({ a: 7 });
        applyUnreadBrowserBadge({});
        assert.equal(documentMock.title, "Mi Spa");
        assert.equal(dynamic, null);
        pendingLoads.forEach((load) => load()); await settle();
        assert.equal(dynamic, null); // Una carga vieja no puede restaurar un contador ya leido.
        delayed = false;
        documentMock.title = "Otro Spa";
        applyUnreadBrowserBadge({ a: 2 }); await settle();
        assert.equal(documentMock.title, "(2) Otro Spa");
    } finally {
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
