/**
 * Constantes y utilidades compartidas entre servidor y navegador.
 * Este archivo NO puede importar nada de `*.server.ts`.
 */

export type ShipmentStatus =
  | "pending"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: "Registrado",
  in_transit: "En tránsito",
  out_for_delivery: "En reparto",
  delivered: "Entregado",
  exception: "Incidencia",
};

/** Tono del badge de Polaris para cada estado. */
export const STATUS_TONE: Record<ShipmentStatus, "info" | "warning" | "success" | "critical" | "neutral"> = {
  pending: "neutral",
  in_transit: "info",
  out_for_delivery: "warning",
  delivered: "success",
  exception: "critical",
};

export const STATUS_PROGRESS: Record<ShipmentStatus, number> = {
  pending: 10,
  in_transit: 50,
  out_for_delivery: 80,
  delivered: 100,
  exception: 100,
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as ShipmentStatus] ?? status;
}

export function statusTone(status: string) {
  return STATUS_TONE[status as ShipmentStatus] ?? "neutral";
}

export function progressFor(status: string): number {
  return STATUS_PROGRESS[status as ShipmentStatus] ?? 10;
}

export const RUN_STATUS_LABELS: Record<string, string> = {
  running: "En curso",
  success: "Correcta",
  partial: "Con incidencias",
  error: "Error",
  skipped: "Omitida",
};

export const TRIGGER_LABELS: Record<string, string> = {
  scheduled: "Automática",
  manual: "Manual",
  cron: "Cron externo",
  webhook: "Webhook",
  backfill: "Pedidos antiguos",
};

/** Dinero con el formato local de España. */
export function formatMoney(amount: string | number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: currency || "EUR",
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** "dentro de 3 h 20 min" / "hace 5 min" */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "—";

  const diffMs = target - now;
  const future = diffMs >= 0;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);

  if (minutes < 1) return future ? "en menos de un minuto" : "hace unos segundos";
  if (minutes < 60) return future ? `en ${minutes} min` : `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    const text = restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
    return future ? `en ${text}` : `hace ${text}`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const text = restHours ? `${days} d ${restHours} h` : `${days} d`;
  return future ? `en ${text}` : `hace ${text}`;
}


/** Por qué un pedido no se ha preparado en una ejecución. */
export type SkipReason =
  | "already_fulfilled"
  | "no_open_fulfillment_orders"
  | "excluded_by_tag"
  | "too_recent"
  | "not_paid"
  | "limit_reached";

const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  already_fulfilled: "Ya tenía envío registrado",
  no_open_fulfillment_orders: "Sin líneas pendientes de preparar",
  excluded_by_tag: "Excluido por etiquetas",
  too_recent: "Demasiado reciente",
  not_paid: "Pedido sin pagar",
  limit_reached: "Se alcanzó el límite de la ejecución",
};

export function skipReasonLabel(reason: SkipReason): string {
  return SKIP_REASON_LABELS[reason] ?? reason;
}
