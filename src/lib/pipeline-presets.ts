export type PipelinePresetId =
  | "custom"
  | "online-store"
  | "consulting"
  | "services"
  | "marketing"
  | "travel-agency";

export type PipelineDraftStage = {
  id?: string;
  localId?: string;
  name: string;
  color: string;
};

export const ACTIVE_STAGE_COLOR_PALETTE = [
  "#A7D3FF",
  "#FEF08A",
  "#FCD67A",
  "#E9A8FD",
  "#BFD9FF",
  "#94EFD0",
  "#FDBA74",
  "#F9A8D4",
];

export const DEFAULT_INCOMING_STAGE_NAME = "Nuevo Lead";
export const DEFAULT_CLOSED_WON_COLOR = "#B9FF4A";
export const DEFAULT_CLOSED_LOST_COLOR = "#CBD5E1";

export type PipelinePresetDefinition = {
  id: PipelinePresetId;
  label: string;
  description: string;
  activeStages: PipelineDraftStage[];
  closedWonName: string;
  closedLostName: string;
};

function buildStages(names: string[]): PipelineDraftStage[] {
  return names.map((name, index) => ({
    name,
    color: ACTIVE_STAGE_COLOR_PALETTE[index % ACTIVE_STAGE_COLOR_PALETTE.length],
  }));
}

export const PIPELINE_PRESETS: PipelinePresetDefinition[] = [
  {
    id: "custom",
    label: "Personalizado",
    description: "Base flexible para adaptar el embudo a tu negocio.",
    activeStages: buildStages(["Contactado", "Calificado", "Propuesta", "Negociacion"]),
    closedWonName: "Cerrado Ganado",
    closedLostName: "Cerrado Perdido",
  },
  {
    id: "online-store",
    label: "Tienda online",
    description: "Pensado para ventas de productos y seguimiento de pedidos.",
    activeStages: buildStages([
      "Contactado",
      "Nueva consulta",
      "Factura enviada",
      "Listo para el envio",
      "Entregado",
    ]),
    closedWonName: "Pedido completado",
    closedLostName: "Pedido abandonado",
  },
  {
    id: "consulting",
    label: "Consultoria",
    description: "Ideal para descubrir, nutrir y cerrar servicios consultivos.",
    activeStages: buildStages([
      "Contactado",
      "Calificar",
      "Nutrir",
      "Presentar",
      "Negociar",
      "Factura enviada",
    ]),
    closedWonName: "Cerrar-ganar",
    closedLostName: "Cerrar-perder",
  },
  {
    id: "services",
    label: "Servicios",
    description: "Para reservar, asignar y entregar servicios recurrentes.",
    activeStages: buildStages([
      "Contactado",
      "Solicitud procesada",
      "Servicio reservado",
      "Especialista asignado",
      "Factura enviada",
    ]),
    closedWonName: "Servicio prestado",
    closedLostName: "Cancelado",
  },
  {
    id: "marketing",
    label: "Marketing",
    description: "Enfocado en discovery, propuesta y seguimiento comercial.",
    activeStages: buildStages([
      "Calificar",
      "Llamada reservada",
      "Preparacion de la propuesta",
      "Envio de la propuesta",
      "Seguimiento",
      "Factura enviada",
    ]),
    closedWonName: "Cerrar-ganar",
    closedLostName: "Cerrar-perder",
  },
  {
    id: "travel-agency",
    label: "Agencia de viajes",
    description: "Orientado a solicitudes, itinerarios, contrato y pago final.",
    activeStages: buildStages([
      "Contactado",
      "Solicitud procesada",
      "Envio del itinerario",
      "Envio del contrato",
      "Factura enviada",
    ]),
    closedWonName: "Pagado",
    closedLostName: "Cancelado",
  },
];

function normalizeStageName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function getPipelinePresetById(id: PipelinePresetId) {
  return PIPELINE_PRESETS.find((preset) => preset.id === id) ?? PIPELINE_PRESETS[0];
}

export function getDefaultStageColor(index: number) {
  return ACTIVE_STAGE_COLOR_PALETTE[index % ACTIVE_STAGE_COLOR_PALETTE.length];
}

export function findMatchingPipelinePreset(params: {
  activeStageNames: string[];
  includeClosingStages: boolean;
  closedWonName?: string | null;
  closedLostName?: string | null;
}): PipelinePresetId {
  const normalizedActive = params.activeStageNames.map(normalizeStageName);
  const normalizedWon = normalizeStageName(params.closedWonName);
  const normalizedLost = normalizeStageName(params.closedLostName);

  for (const preset of PIPELINE_PRESETS.filter((entry) => entry.id !== "custom")) {
    const presetActive = preset.activeStages.map((stage) => normalizeStageName(stage.name));
    if (
      presetActive.length === normalizedActive.length &&
      presetActive.every((name, index) => name === normalizedActive[index]) &&
      (!params.includeClosingStages ||
        (normalizeStageName(preset.closedWonName) === normalizedWon &&
          normalizeStageName(preset.closedLostName) === normalizedLost))
    ) {
      return preset.id;
    }
  }

  return "custom";
}
