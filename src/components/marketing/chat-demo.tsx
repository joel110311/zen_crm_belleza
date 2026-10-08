"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, CheckCheck, MessageCircle, MoreVertical, Phone, Send, Signal, Wifi } from "lucide-react";
import { chatDemoScenarios as examples } from "./chat-demo-scenarios";

function subscribeMotionPreference(onChange: () => void) {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function serverMotionPreference() { return false; }

export function LandingChatDemo() {
    const demoRef = useRef<HTMLDivElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const previousScenario = useRef(0);
    const [playback, setPlayback] = useState({ selected: 0, step: 1 });
    const [paused, setPaused] = useState(false);
    const reducedMotion = useSyncExternalStore(subscribeMotionPreference, prefersReducedMotion, serverMotionPreference);
    const { selected, step } = playback;
    const example = examples[selected];
    const visibleSteps = example.steps.slice(0, reducedMotion ? example.steps.length : step);
    const messages = visibleSteps.filter((item) => item.type === "message");
    const typing = visibleSteps.at(-1)?.type === "typing";

    useEffect(() => {
        if (paused || reducedMotion) return;
        let timer: number | undefined;
        let visible = false;
        function arm() {
            window.clearTimeout(timer);
            if (!document.hidden && visible) {
                timer = window.setTimeout(() => setPlayback((current) =>
                    current.step >= example.steps.length
                        ? { selected: (current.selected + 1) % examples.length, step: 1 }
                        : { ...current, step: current.step + 1 },
                ), example.steps[step]?.delay ?? 5000);
            }
        }
        const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; arm(); });
        if (demoRef.current) observer.observe(demoRef.current);
        document.addEventListener("visibilitychange", arm);
        return () => { window.clearTimeout(timer); observer.disconnect(); document.removeEventListener("visibilitychange", arm); };
    }, [example, paused, reducedMotion, step]);

    useEffect(() => {
        const pane = messagesRef.current;
        if (!pane) return;
        const changedScenario = previousScenario.current !== selected;
        previousScenario.current = selected;
        // Scroll only the conversation, never the landing page around the phone.
        pane.scrollTo({ top: changedScenario ? 0 : pane.scrollHeight, behavior: reducedMotion || changedScenario ? "instant" : "smooth" });
    }, [selected, step, reducedMotion]);

    useEffect(() => {
        const pane = messagesRef.current;
        if (!pane) return;
        const observer = new ResizeObserver(() => pane.scrollTo({ top: pane.scrollHeight, behavior: "instant" }));
        observer.observe(pane);
        return () => observer.disconnect();
    }, []);

    return <div className="landing-demo" ref={demoRef} data-paused={paused}>
        <div className="landing-demo-tabs" aria-label="Ejemplo de negocio">{examples.map((item, index) => <button type="button" key={item.name} aria-pressed={selected === index} onClick={() => setPlayback({ selected: index, step: 1 })}>{item.name}</button>)}</div>
        <div className="landing-phone" aria-label={`Demostración ilustrativa de una conversación para ${example.name}`}>
            <div className="landing-phone-notch" />
            <div className="landing-phone-status"><span>9:41</span><span><Signal size={12} /><Wifi size={12} /></span></div>
            <div className="landing-phone-header"><ArrowLeft size={18} /><span className="landing-phone-avatar">{example.initial}</span><div><strong>{example.name}</strong><small>Ejemplo de conversación</small></div><Phone size={16} /><MoreVertical size={16} /></div>
            <div className="landing-phone-messages" ref={messagesRef} tabIndex={0} role="region" aria-label="Conversación de ejemplo">
                <span className="landing-phone-date">Hoy</span>
                {messages.map((message, index) => <div key={`${selected}-${index}`} className={`landing-bubble ${message.sender === "agent" ? "landing-bubble-agent" : ""}`}><p>{message.text}</p><small>09:{String(41 + index).padStart(2, "0")} {message.sender === "agent" ? <CheckCheck size={13} /> : null}</small></div>)}
                {typing ? <div className="landing-typing" aria-label="Escribiendo"><span /><span /><span /></div> : null}
            </div>
            <div className="landing-phone-compose"><span><MessageCircle size={17} /> Mensaje</span><Send size={17} /></div>
        </div>
        {!reducedMotion ? <button type="button" className="landing-demo-pause" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Reanudar ejemplo" : "Pausar ejemplo"}</button> : null}
        <p className="landing-demo-caption">Demostración ilustrativa</p>
    </div>;
}
