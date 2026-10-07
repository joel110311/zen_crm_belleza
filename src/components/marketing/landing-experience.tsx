"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";

const businessNames = ["Estética", "Barbería", "Studio de uñas", "Studio de pestañas", "Spa"];

export function RotatingBusiness() {
    const wordRef = useRef<HTMLSpanElement>(null);
    const indexRef = useRef(0);
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        const word = wordRef.current;
        if (!word) return;
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        let timer: number | undefined;
        let visible = true;
        let index = indexRef.current;
        let letters = businessNames[index].length;
        let deleting = true;
        let stopped = false;
        word.textContent = businessNames[index];
        word.parentElement!.dataset.long = String(businessNames[index].length > 12);

        function clear() { window.clearTimeout(timer); }
        function tick() {
            if (stopped || paused || media.matches || document.hidden || !visible) return;
            if (deleting) {
                letters -= 1;
                word!.textContent = businessNames[index].slice(0, letters);
                if (letters === 0) {
                    deleting = false; index = (index + 1) % businessNames.length;
                    word!.parentElement!.dataset.long = String(businessNames[index].length > 12);
                }
                timer = window.setTimeout(tick, letters === 0 ? 220 : 45);
            } else {
                letters += 1;
                word!.textContent = businessNames[index].slice(0, letters);
                if (letters === businessNames[index].length) deleting = true;
                timer = window.setTimeout(tick, deleting ? 2300 : 90);
            }
        }
        function resume() {
            clear();
            // Leave a complete word visible whenever animation is suspended.
            letters = businessNames[index].length;
            word!.textContent = businessNames[index];
            deleting = true;
            if (!paused && !media.matches && !document.hidden && visible) timer = window.setTimeout(tick, 2300);
        }
        const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); });
        observer.observe(word);
        media.addEventListener("change", resume);
        document.addEventListener("visibilitychange", resume);
        resume();
        return () => { indexRef.current = index; stopped = true; clear(); observer.disconnect(); media.removeEventListener("change", resume); document.removeEventListener("visibilitychange", resume); };
    }, [paused]);

    return <span className="landing-business-word">
        <span className="landing-sr-only">Estética, Barbería, Studio de uñas, Studio de pestañas o Spa</span>
        <span aria-hidden="true" className="landing-business-visual"><span ref={wordRef}>Estética</span><span className={`landing-word-cursor ${paused ? "is-paused" : ""}`} /></span>
        <button type="button" className="landing-word-pause" aria-label={paused ? "Reanudar nombres de negocios" : "Pausar nombres de negocios"} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={12} /> : <Pause size={12} />}</button>
    </span>;
}

export function LandingExperience({ children, className }: { children: ReactNode; className: string }) {
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        const compact = window.matchMedia("(max-width: 900px), (max-height: 700px)");
        const story = root.querySelector<HTMLElement>("[data-product-story]");
        const reveals = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
        let revealObserver: IntersectionObserver | undefined;
        let storyObserver: IntersectionObserver | undefined;
        let heroObserver: IntersectionObserver | undefined;
        let inView = false;
        let raf = 0;
        let target = 0;
        let current = 0;
        let lastTime = 0;
        let lastValue = -1;
        const canMove = () => !reduced.matches && !compact.matches && !document.hidden;

        function paint(value: number) {
            if (!story || Math.abs(lastValue - value) < 0.002) return;
            lastValue = value;
            story.style.setProperty("--journey", value.toFixed(3));
            const step = value < 0.34 ? "agenda" : value < 0.68 ? "clientes" : "atencion";
            if (story.dataset.step !== step) story.dataset.step = step;
        }
        function tick(now: number) {
            const dt = Math.min(64, now - (lastTime || now - 16));
            lastTime = now;
            current += (target - current) * (1 - Math.pow(0.82, dt / 16.667));
            paint(current);
            if (Math.abs(current - target) > 0.001 && canMove() && inView) raf = requestAnimationFrame(tick);
            else { raf = 0; lastTime = 0; }
        }
        function update() {
            if (!story || !canMove() || !inView) return;
            const rect = story.getBoundingClientRect();
            target = Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height - window.innerHeight)));
            if (!raf) raf = requestAnimationFrame(tick);
        }
        function configure() {
            if (!root) return;
            if (raf) cancelAnimationFrame(raf);
            raf = 0; lastTime = 0;
            revealObserver?.disconnect();
            root.dataset.motion = reduced.matches ? "reduced" : "ready";
            root.dataset.visibility = document.hidden ? "hidden" : "visible";
            root.dataset.storyMode = reduced.matches || compact.matches ? "still" : "scroll";
            reveals.forEach((el) => el.classList.remove("reveal-pending"));
            if (!reduced.matches) {
                reveals.forEach((el) => { if (el.getBoundingClientRect().top > window.innerHeight && !el.classList.contains("is-revealed")) el.classList.add("reveal-pending"); });
                revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add("is-revealed");
                    entry.target.classList.remove("reveal-pending");
                    revealObserver?.unobserve(entry.target);
                }), { threshold: 0.08 });
                reveals.forEach((el) => revealObserver?.observe(el));
            }
            if (!canMove()) { paint(1); }
            else { lastValue = -1; update(); }
        }
        if (story) {
            storyObserver = new IntersectionObserver(([entry]) => {
                inView = entry.isIntersecting;
                if (inView) update();
                else if (raf) { cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
            });
            storyObserver.observe(story);
        }
        const hero = root.querySelector(".landing-hero");
        if (hero) {
            heroObserver = new IntersectionObserver(([entry]) => { root.dataset.heroVisible = String(entry.isIntersecting); });
            heroObserver.observe(hero);
        }
        reduced.addEventListener("change", configure);
        compact.addEventListener("change", configure);
        document.addEventListener("visibilitychange", configure);
        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("resize", update);
        configure();
        return () => {
            if (raf) cancelAnimationFrame(raf);
            revealObserver?.disconnect(); storyObserver?.disconnect(); heroObserver?.disconnect();
            reduced.removeEventListener("change", configure); compact.removeEventListener("change", configure);
            document.removeEventListener("visibilitychange", configure);
            window.removeEventListener("scroll", update); window.removeEventListener("resize", update);
        };
    }, []);
    return <div id="inicio" className={className} ref={rootRef}>{children}</div>;
}
