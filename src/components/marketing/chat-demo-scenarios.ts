type DemoStep =
    | { type: "message"; sender: "customer" | "agent"; text: string; delay: number }
    | { type: "typing"; delay: number };

export const chatDemoScenarios: { name: string; initial: string; steps: DemoStep[] }[] = [
    {
        name: "Barbería", initial: "B", steps: [
            { type: "message", sender: "customer", text: "Hola, me gustaría agendar un corte, por favor.", delay: 1000 },
            { type: "typing", delay: 1500 },
            { type: "message", sender: "agent", text: "¡Hola! Claro que sí. ¿El corte sería para dama, caballero o niño?", delay: 2000 },
            { type: "message", sender: "customer", text: "Para caballero. ¿Qué horarios tienen disponibles hoy?", delay: 2500 },
            { type: "typing", delay: 1500 },
            { type: "message", sender: "agent", text: "Hoy tenemos espacios libres a las 4:00 p.m. y a las 6:00 p.m. ¿Te reservo alguno?", delay: 2500 },
            { type: "message", sender: "customer", text: "A las 6:00 p.m. me queda perfecto.", delay: 2000 },
            { type: "typing", delay: 1200 },
            { type: "message", sender: "agent", text: "¡Cita confirmada para hoy a las 6:00 p.m.! Te enviaremos un recordatorio una hora antes. ¡Nos vemos pronto!", delay: 3000 },
        ],
    },
    {
        name: "Spa", initial: "S", steps: [
            { type: "message", sender: "customer", text: "Hola, busco información sobre sus masajes relajantes.", delay: 1000 },
            { type: "typing", delay: 1500 },
            { type: "message", sender: "agent", text: "¡Hola! Contamos con masajes de 60 y 90 minutos con aromaterapia incluida. ¿Te interesaría conocer los precios?", delay: 2500 },
            { type: "message", sender: "customer", text: "Sí, por favor. ¿Cuánto cuesta el de 60 minutos?", delay: 2000 },
            { type: "typing", delay: 1500 },
            { type: "message", sender: "agent", text: "El de 60 minutos tiene un costo de $600 y te ayuda a liberar toda la tensión. ¿Para qué día de la semana te gustaría reservar?", delay: 3000 },
            { type: "message", sender: "customer", text: "Para este viernes por la tarde, saliendo del trabajo.", delay: 2500 },
            { type: "typing", delay: 1500 },
            { type: "message", sender: "agent", text: "¡Excelente idea! Te he reservado un espacio el viernes a las 6:00 p.m. Te esperamos para que te relajes al máximo.", delay: 2500 },
        ],
    },
    {
        name: "Studio de uñas", initial: "U", steps: [
            { type: "message", sender: "customer", text: "Quiero regalar un día de spa para el cumpleaños de mi mamá.", delay: 1000 },
            { type: "typing", delay: 1500 },
            { type: "message", sender: "agent", text: "¡Qué excelente regalo! Manejamos Certificados Digitales. ¿Te gustaría regalar un monto específico o un paquete armado?", delay: 3000 },
            { type: "message", sender: "customer", text: "Un paquete que incluya masaje y facial estaría muy bien.", delay: 2500 },
            { type: "typing", delay: 1500 },
            { type: "message", sender: "agent", text: 'Te sugiero el paquete "Renovación Total" que cuesta $1,500 e incluye ambas experiencias. ¿Te envío el enlace para hacer la compra en línea?', delay: 3500 },
            { type: "message", sender: "customer", text: "Sí, por favor, pásame el link para pagarlo ahorita.", delay: 2000 },
            { type: "typing", delay: 1500 },
            { type: "message", sender: "agent", text: "Aquí tienes tu enlace de pago seguro: [Link de pago]. Una vez completado, podrás descargar el certificado personalizado para tu mamá al instante.", delay: 3500 },
        ],
    },
];
