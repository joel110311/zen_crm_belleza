"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type TransitionPhase = "idle" | "leaving" | "entering";

/**
 * Keeps the current route visible while the next Server Component payload loads, then performs
 * a short out/in transition. Navigation remains interruptible and reduced-motion is respected.
 */
export function ApplePageTransition({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const routeKey = `${pathname}?${searchParams.toString()}`;
    const resetTimer = useRef<number | null>(null);
    const [rendered, setRendered] = useState(() => ({ key: routeKey, children }));
    const [phase, setPhase] = useState<TransitionPhase>("idle");

    useEffect(() => {
        function beginLeaving(event: MouseEvent) {
            const target = event.target instanceof Element ? event.target.closest("a") : null;
            if (!target || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (target.target === "_blank" || target.hasAttribute("download")) return;

            const href = target.getAttribute("href");
            if (!href || href.startsWith("#")) return;

            const destination = new URL(href, window.location.href);
            if (destination.origin !== window.location.origin || destination.href === window.location.href) return;

            setPhase("leaving");
            if (resetTimer.current) window.clearTimeout(resetTimer.current);
            resetTimer.current = window.setTimeout(() => setPhase("idle"), 10_000);
        }

        document.addEventListener("click", beginLeaving, { capture: true });
        return () => document.removeEventListener("click", beginLeaving, { capture: true });
    }, []);

    useEffect(() => {
        let firstFrame = 0;
        let secondFrame = 0;

        if (routeKey === rendered.key) {
            firstFrame = window.requestAnimationFrame(() => {
                setRendered((current) => current.children === children ? current : { ...current, children });
            });
            return () => window.cancelAnimationFrame(firstFrame);
        }

        if (resetTimer.current) window.clearTimeout(resetTimer.current);
        firstFrame = window.requestAnimationFrame(() => {
            setRendered({ key: routeKey, children });
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                setPhase("idle");
                return;
            }
            setPhase("entering");
            secondFrame = window.requestAnimationFrame(() => setPhase("idle"));
        });
        return () => {
            window.cancelAnimationFrame(firstFrame);
            window.cancelAnimationFrame(secondFrame);
        };
    }, [children, rendered.key, routeKey]);

    useEffect(() => () => {
        if (resetTimer.current) window.clearTimeout(resetTimer.current);
    }, []);

    return (
        <div className="apple-page-transition" data-transition-phase={phase} data-route-key={rendered.key}>
            {rendered.children}
        </div>
    );
}
