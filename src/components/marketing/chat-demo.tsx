"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CheckCheck, MessageCircle, MoreVertical, Phone, Send, Signal, Wifi } from "lucide-react";

const examples = [
    { name: "Barbería", initial: "B", messages: ["Hola, ¿tienen espacio para un corte?", "¡Hola! Claro. ¿Para qué día te gustaría agendar?", "Para mañana por la tarde.", "Revisemos los horarios disponibles. ¿Prefieres a las 4:00 o a las 6:00?", "A las 6:00, por favor."] },
    { name: "Spa", initial: "S", messages: ["Hola, quiero saber más de sus masajes.", "¡Hola! Con gusto. ¿Buscas relajación o un tratamiento específico?", "Relajación. ¿Cuánto dura la sesión?", "Puedes consultar la duración y el precio en nuestro catálogo. ¿Te ayudo a elegir un horario?", "Sí, para el viernes."] },
    { name: "Salón de uñas", initial: "U", messages: ["¡Hola! ¿Hacen uñas con diseño?", "¡Hola! Sí. Cuéntame qué estilo tienes en mente.", "Algo natural, para una boda.", "¡Qué bonito! Te puedo orientar con los servicios del salón y ayudarte a encontrar un horario.", "Perfecto, quiero agendar."] },
];

export function LandingChatDemo() {
    const [selected, setSelected] = useState(0);
    const [shown, setShown] = useState(2);
    const [paused, setPaused] = useState(false);
    const example = examples[selected];

    useEffect(() => {
        if (paused || shown >= example.messages.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const timer = window.setTimeout(() => setShown((value) => value + 1), 2200);
        return () => window.clearTimeout(timer);
    }, [example, paused, shown]);

    return <div className="landing-demo">
        <div className="landing-demo-tabs" aria-label="Ejemplo de negocio">{examples.map((item, index) => <button type="button" key={item.name} aria-pressed={selected === index} onClick={() => { setSelected(index); setShown(2); }}>{item.name}</button>)}</div>
        <div className="landing-phone" aria-label={`Demostración ilustrativa de una conversación para ${example.name}`}>
            <div className="landing-phone-notch" />
            <div className="landing-phone-status"><span>9:41</span><span><Signal size={12} /><Wifi size={12} /></span></div>
            <div className="landing-phone-header"><ArrowLeft size={18} /><span className="landing-phone-avatar">{example.initial}</span><div><strong>{example.name}</strong><small>Ejemplo de conversación</small></div><Phone size={16} /><MoreVertical size={16} /></div>
            <div className="landing-phone-messages">
                <span className="landing-phone-date">Hoy</span>
                {example.messages.slice(0, shown).map((message, index) => <div key={`${selected}-${index}`} className={`landing-bubble ${index % 2 ? "landing-bubble-agent" : ""}`}><p>{message}</p><small>09:{String(41 + index).padStart(2, "0")} {index % 2 ? <CheckCheck size={13} /> : null}</small></div>)}
                {!paused && shown < example.messages.length ? <div className="landing-typing" aria-label="Escribiendo"><span /><span /><span /></div> : null}
            </div>
            <div className="landing-phone-compose"><span><MessageCircle size={17} /> Mensaje</span><Send size={17} /></div>
        </div>
        <button type="button" className="landing-demo-pause" onClick={() => setPaused((value) => !value)}>{paused ? "Reanudar ejemplo" : "Pausar ejemplo"}</button>
        <p className="landing-demo-caption">Demostración ilustrativa · no envía mensajes reales</p>
    </div>;
}
