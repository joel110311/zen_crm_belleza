export function onboardingExitAdvice(destination: string) {
    if (destination.includes("/specialists")) {
        return "Te recomendamos terminar y publicar el asistente primero. Después captura tu equipo, especialidades, disponibilidad y servicios en Negocio → Especialistas.";
    }
    if (destination === "channels" || destination.includes("facebook.com")) {
        return "Te recomendamos terminar y publicar el asistente primero. Después vincula WhatsApp y configura su facturación en Administración → Configuración → Canal WhatsApp.";
    }
    return "Te recomendamos terminar y publicar el asistente primero. Después abre este módulo desde el menú lateral para completar su información.";
}

export function shouldGuardOnboardingLink(href: string, currentUrl: string) {
    const destination = new URL(href, currentUrl);
    const current = new URL(currentUrl);
    return ["http:", "https:"].includes(destination.protocol)
        && (destination.origin !== current.origin || destination.pathname !== current.pathname);
}
