/** Display labels only; provider and access decisions stay in their existing policies. */
export function billingSubscriptionLabel(status: string) {
  const labels: Record<string, string> = {
    TRIALING: "En prueba",
    ACTIVE: "Activa",
    PAST_DUE: "Pago vencido",
    UNPAID: "Pago pendiente",
    CANCELED: "Cancelada",
    INCOMPLETE: "Activación pendiente",
    INCOMPLETE_EXPIRED: "Activación vencida",
    PAUSED: "Pausada",
  };
  return labels[status] || "Estado por verificar";
}
