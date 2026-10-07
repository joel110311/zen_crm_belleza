import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, Bot, CalendarDays, Check, ChevronDown, Clock3, HandHeart, Leaf, MessageCircle, Scissors, ShieldCheck, Users } from "lucide-react";
import { DEFAULT_BRAND_NAME } from "@/lib/branding";
import { BrandLogo } from "@/components/brand/brand-logo";
import { landingMoney, landingStartingPrice, landingTrialLabel, type LandingOffer } from "@/lib/landing-offer";
import { LandingChatDemo } from "./chat-demo";
import { LandingExperience, RotatingBusiness } from "./landing-experience";
import { GoogleCalendarMark, WhatsAppMark } from "./integration-marks";
import styles from "./landing.module.css";

const benefits = [
    { icon: CalendarDays, title: "Tu agenda, en orden.", text: "Organiza citas, servicios, horarios y especialistas desde un solo lugar. Menos vueltas, más claridad para tu equipo." },
    { icon: MessageCircle, title: "Cada conversación, a la mano.", text: "Conecta tu canal de WhatsApp y atiende desde la bandeja del CRM. Conserva el contexto de tus clientes y toma el control cuando lo necesites." },
    { icon: Bot, title: "Una IA con tu contexto.", text: "En los planes con chatbot, configura su información, su tono y su autopiloto. Tú decides cuándo responde el agente y cuándo interviene tu equipo." },
];

export function CrmLanding({ offer, preview = false }: { offer: LandingOffer; preview?: boolean }) {
    const trialLabel = landingTrialLabel(offer.trialDays);
    const startingPrice = landingStartingPrice(offer.plans.filter((plan) => plan.slug === "esencial"));
    const aiStartingPrice = landingStartingPrice(offer.plans.filter((plan) => plan.slug === "automatiza" || plan.slug === "pro"));
    const faqs = [
        { question: "¿Cómo empiezo la prueba?", answer: `Crea tu cuenta, confirma tu correo y sigue el asistente para configurar el negocio, los horarios y tu primer servicio. ${offer.trialDays ? `La prueba para cuentas elegibles dura ${offer.trialDays} días y comienza cuando tu espacio está listo.` : "La duración vigente de la prueba se confirma al crear tu espacio."} No necesitas registrar una tarjeta para comenzar.` },
        { question: "¿El plan Esencial incluye chatbot?", answer: "No. Esencial incluye CRM, agenda, portal de reservas y operación sin chatbot. Si quieres respuestas automáticas con IA, puedes elegir Automatiza o Pro." },
        { question: "¿Cómo conecto WhatsApp?", answer: "Desde Configuración → Canal WhatsApp puedes elegir la conexión oficial de Meta o la alternativa por QR, según disponibilidad. La conexión oficial requiere una cuenta de Meta compatible; sus cargos de mensajería son independientes del plan del CRM." },
        { question: "¿Puedo desactivar las respuestas automáticas?", answer: "Sí. Puedes pausar el autopiloto del agente y continuar atendiendo de forma manual. El CRM sigue recibiendo mensajes aunque la IA esté pausada." },
        { question: "¿Me cobran automáticamente al terminar la prueba?", answer: "No. En esta etapa eliges tu plan y completas el pago en Mercado Pago. Cada pago cubre un mes de servicio; no hay renovación automática. Puedes consultar los planes sin registrar una tarjeta." },
        { question: "¿Tengo que activar el portal de reservas?", answer: "No. El portal es opcional. Puedes activarlo en el asistente inicial o configurarlo después; también puedes usar el CRM sólo para la operación interna." },
    ];

    return <LandingExperience className={styles.landing}>
        <a className="landing-skip" href="#contenido">Ir al contenido</a>
        {preview ? <div className="landing-preview-note">Vista local · precios $200 / $500 / $800 MXN · prueba de 14 días · sin publicar</div> : null}
        <header className="landing-header"><div className="landing-header-inner landing-container">
            <a href="#inicio" className="landing-brand" aria-label={`${DEFAULT_BRAND_NAME}, inicio`}><span className="landing-brand-icon"><BrandLogo brandName={DEFAULT_BRAND_NAME} className="h-14 w-14" /></span><span>Zen CRM<small>Cuidado Personal · por Synapselogik</small></span></a>
            <nav aria-label="Navegación principal"><a className="landing-desktop-link" href="#producto">Cómo funciona</a><a className="landing-desktop-link" href="#precios">Planes</a><Link href="/login" prefetch={false} className="landing-login">Iniciar sesión</Link><Link href="/signup" prefetch={false} className="landing-button landing-button-small">{offer.trialDays ? `Prueba ${offer.trialDays} días` : "Empezar"}<ArrowRight size={16} /></Link></nav>
        </div></header>
        <main id="contenido" tabIndex={-1}>
            <section className="landing-hero landing-container">
                <div className="landing-hero-intro">
                    <p className="landing-eyebrow"><span /> Cuidado personal, con inteligencia artificial</p>
                    <h1>El CRM con IA<br />para tu<br /><RotatingBusiness /></h1>
                    <p className="landing-hero-copy">Inteligencia artificial que responde por WhatsApp. Citas, clientes y equipo en un mismo lugar, para que puedas dedicarte a atender a tu cliente.</p>
                    <div className="landing-hero-actions"><Link href="/signup" prefetch={false} className="landing-button">{trialLabel}<ArrowRight size={18} /></Link><a href="#producto" className="landing-button landing-button-outline">Conoce el CRM<ArrowDown size={17} /></a></div>
                    <p className="landing-hero-reassurance"><Check size={15} /> Sin tarjeta para empezar. Sin cobro automático.</p>
                    <a href="#integraciones" className="landing-hero-integrations"><span><WhatsAppMark size={18} /> API oficial de WhatsApp</span><span><GoogleCalendarMark size={18} /> Google Calendar</span></a>
                    {startingPrice !== null || aiStartingPrice !== null ? <div className="landing-hero-offer">{startingPrice !== null ? <span>CRM sin chatbot <strong>desde {landingMoney(startingPrice)}</strong></span> : null}{aiStartingPrice !== null ? <span>CRM + IA <strong>desde {landingMoney(aiStartingPrice)}</strong></span> : null}<small>MXN / mes</small></div> : null}
                </div>
                <div className="landing-hero-art">
                    <svg className="landing-botanical" viewBox="0 0 500 620" fill="none" aria-hidden="true"><path d="M45 560C80 400 342 454 364 116M364 116C309 199 210 167 218 99C294 84 347 104 364 116ZM290 330C317 205 446 189 461 237C420 309 342 339 290 330Z" stroke="currentColor" strokeWidth="1.4" /><path d="M123 467C95 372 3 359 14 305C113 312 147 392 123 467Z" stroke="currentColor" strokeWidth="1.4" /></svg>
                    <div className="landing-hero-phone"><LandingChatDemo /></div>
                    <div className="landing-art-note"><span><Bot size={18} /></span><p>Una IA que conoce<small>tus servicios y tu forma de atender.</small></p></div>
                    <span className="landing-art-caption">Tu atención, con un poco más de calma.</span>
                </div>
            </section>
            <div className="landing-audiences landing-container"><span>Diseñado para el cuidado personal</span><p><Scissors size={17} /> Estéticas y barberías</p><p><HandHeart size={17} /> Uñas y pestañas</p><p><Leaf size={17} /> Spas y bienestar</p></div>
            <section className="landing-pause-section landing-container" data-reveal><p className="landing-eyebrow">Para quienes cuidan de los demás</p><h2>Cuida de tus clientes.<br /><span>Dale calma a tu día.</span></h2><a href="#producto" className="landing-scroll-cue" aria-label="Ver cómo funciona el CRM"><ArrowDown size={20} /></a></section>
            <section id="producto" className="landing-product-section" data-product-story data-step="agenda">
                <div className="landing-product-sticky landing-container">
                    <div className="landing-product-heading" data-reveal><p className="landing-eyebrow">Un solo lugar. Todo conectado.</p><h2>Más orden.<br /><span>Más tiempo para ti.</span></h2></div>
                    <div className="landing-product-stage"><div className="landing-dashboard-preview"><div className="landing-window-top"><span /><span /><span /><p>Zen CRM · Tu centro de operaciones</p><ShieldCheck size={15} /></div><Image src="https://res.cloudinary.com/dgre2xit2/image/upload/v1788436856/crm_asmne7.png" alt="Ejemplo del dashboard de Zen CRM: agenda, especialistas, actividad de clientes y mensajes recientes" width={1200} height={650} sizes="(max-width: 900px) 94vw, 1040px" unoptimized /><div className="landing-product-label"><CalendarDays size={16} /> Agenda + clientes + WhatsApp</div></div></div>
                    <div className="landing-story-chapters">{[{ key: "agenda", number: "01", title: "Tu agenda", text: "Citas, servicios y especialistas. Cada horario en su lugar." }, { key: "clientes", number: "02", title: "Tus clientes", text: "Conserva su historial para recibirlos con atención personal." }, { key: "atencion", number: "03", title: "Tu atención", text: "WhatsApp e IA con tu contexto. Tú decides cuándo intervenir." }].map((chapter) => <div className="landing-story-chapter" data-chapter={chapter.key} key={chapter.key}><small>{chapter.number}</small><div><h3>{chapter.title}</h3><p>{chapter.text}</p></div></div>)}</div>
                </div>
            </section>
            <section id="integraciones" className="landing-integrations landing-container" data-reveal>
                <div><p className="landing-eyebrow">Tus herramientas, conectadas</p><h2>Ya las usas.<br /><span>Ahora trabajan juntas.</span></h2></div>
                <div className="landing-integration-list">
                    <article><span className="landing-integration-logo"><WhatsAppMark size={34} /></span><div><h3>API oficial de WhatsApp</h3><p>Conecta tu número mediante la plataforma oficial de Meta. Recibe y atiende mensajes en el CRM, con tu equipo o con el agente de IA.</p><small>Se configura desde Canal WhatsApp.</small></div></article>
                    <article><span className="landing-integration-logo"><GoogleCalendarMark size={34} /></span><div><h3>Google Calendar</h3><p>Vincula tu cuenta de Google para consultar la disponibilidad y sincronizar las citas. Tu equipo puede seguir usando su calendario habitual.</p><small>Se configura desde Calendario.</small></div></article>
                </div>
            </section>
            <section id="beneficios" className="landing-section landing-container">
                <p className="landing-eyebrow">Menos trabajo repetitivo. Más atención personal.</p><h2>El cuidado empieza<br /><span>por una buena organización.</span></h2>
                <div className="landing-benefits">{benefits.map(({ icon: Icon, title, text }) => <article key={title} data-reveal><span className="landing-feature-icon"><Icon size={24} /></span><h3>{title}</h3><p>{text}</p></article>)}</div>
            </section>
            <section className="landing-workflow landing-container" data-reveal>
                <div><p className="landing-eyebrow">De la primera cita al seguimiento</p><h2>Menos pestañas.<br />Más conexión.</h2><p>Tu catálogo, los horarios de tu equipo, las reservas y el historial de tus clientes se encuentran en el mismo CRM.</p><Link href="/signup" prefetch={false} className="landing-text-link">Configurar mi negocio<ArrowRight size={18} /></Link></div>
                <ol>{[{ icon: Users, title: "Crea el espacio de tu negocio", text: "Tu cuenta, tu equipo y tu información, separados de otros negocios." }, { icon: CalendarDays, title: "Prepara tu agenda y servicios", text: "El asistente te acompaña. El portal y los canales se pueden completar después." }, { icon: MessageCircle, title: "Conecta y empieza a atender", text: "Conversa desde la bandeja y activa la IA cuando tengas listo su contexto." }].map(({ icon: Icon, title, text }, index) => <li key={title}><span><Icon size={20} /></span><div><small>PASO 0{index + 1}</small><h3>{title}</h3><p>{text}</p></div><Check size={18} /></li>)}</ol>
            </section>
            <section id="precios" className="landing-section landing-container">
                <p className="landing-eyebrow">Un plan para cada etapa</p><h2>Empieza simple.<br /><span>Crece a tu ritmo.</span></h2><p className="landing-section-copy">{offer.trialDays ? `Conoce el CRM durante ${offer.trialDays} días. Después, elige lo que tu negocio necesita.` : "Consulta los planes vigentes y elige lo que tu negocio necesita."}</p>
                <div className="landing-pricing">{offer.plans.map((plan) => <article data-reveal key={plan.slug} className={plan.slug === "automatiza" ? "landing-plan landing-plan-featured" : "landing-plan"}>{plan.slug === "automatiza" ? <span className="landing-plan-badge">Para automatizar tu atención</span> : null}<p className="landing-plan-name">{plan.name}</p><p className="landing-plan-description">{plan.description}</p><p className="landing-plan-price">{plan.monthlyAmountCents !== null ? landingMoney(plan.monthlyAmountCents, plan.currency) : "Consultar"}<small>{plan.currency} / mes</small></p><ul>{["Agenda y gestión de clientes", "Catálogo y especialistas", "Portal de reservas opcional", "Bandeja de conversaciones"].map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul><Link href="/signup" prefetch={false} className={`landing-button ${plan.slug === "automatiza" ? "" : "landing-button-outline"}`}>{trialLabel}<ArrowRight size={16} /></Link><small className="landing-plan-note">Elige tu plan dentro del CRM.</small></article>)}</div>
                {!offer.plans.length ? <p className="landing-catalog-unavailable">Los precios no están disponibles en este momento. Puedes iniciar sesión para consultar tu plan o volver a intentarlo más tarde.</p> : null}
                <p className="landing-pricing-note"><ShieldCheck size={16} /> Pago seguro con Mercado Pago · sin renovación automática.<br />Los cargos del canal oficial de WhatsApp, cuando correspondan, se pagan por separado.</p>
            </section>
            <section id="faq" className="landing-faq landing-container" data-reveal><div><p className="landing-eyebrow">Antes de empezar</p><h2>Buenas preguntas.<br /><span>Respuestas claras.</span></h2><p>Sin letras pequeñas sobre lo que incluye cada plan.</p></div><div>{faqs.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown size={18} /></summary><p>{item.answer}</p></details>)}</div></section>
            <section className="landing-final landing-container" data-reveal><span className="landing-feature-icon"><Clock3 size={24} /></span><h2>Haz espacio para lo que importa.</h2><p>Empieza con tu negocio, tu primer servicio y tu agenda.<br />Nos encargamos de reunirlos en un solo lugar.</p><div><Link href="/signup" prefetch={false} className="landing-button">{trialLabel}<ArrowRight size={18} /></Link><Link href="/login" prefetch={false} className="landing-button landing-button-outline">Ya tengo cuenta</Link></div></section>
        </main>
        <footer className="landing-footer landing-container"><div><strong>{DEFAULT_BRAND_NAME}</strong><p>Una solución de Synapselogik para tu negocio.</p></div><nav aria-label="Información legal"><Link href="/terms" prefetch={false}>Términos</Link><Link href="/privacy" prefetch={false}>Privacidad</Link><Link href="/delete-account" prefetch={false}>Eliminación de cuenta</Link></nav></footer>
    </LandingExperience>;
}
