import prisma from "../db.server";
import { getOrCreateSettings } from "./settings.server";
import { progressFor, statusLabel } from "./shared";
import { formatInTimeZone, safeTimeZone } from "./time";
import {
  isValidTrackingFormat,
  normalizeTrackingNumber,
  prettyTrackingNumber,
} from "./tracking";
import { materializeShipment } from "./transit.server";

/**
 * Búsqueda pública de un envío.
 *
 * Solo devuelve información que el destinatario ya conoce (ciudad, país,
 * número de bultos y fechas). Nunca expone el email ni la dirección completa
 * del cliente, porque cualquiera con el número puede consultar esta página.
 */

export interface PublicTrackingEvent {
  code: string;
  title: string;
  detail: string | null;
  location: string | null;
  occurredAt: string;
  occurredAtLabel: string;
}

export interface PublicTrackingResult {
  found: boolean;
  /** invalid_format | not_found | ok */
  reason: "ok" | "invalid_format" | "not_found" | "empty";
  trackingNumber: string;
  prettyNumber: string;
  carrierName: string;
  status: string;
  statusLabel: string;
  progress: number;
  origin: string | null;
  destination: string | null;
  itemCount: number;
  fulfilledAt: string | null;
  fulfilledAtLabel: string | null;
  estimatedDeliveryAt: string | null;
  estimatedDeliveryLabel: string | null;
  deliveredAt: string | null;
  deliveredAtLabel: string | null;
  events: PublicTrackingEvent[];
}

function emptyResult(
  trackingNumber: string,
  reason: PublicTrackingResult["reason"],
): PublicTrackingResult {
  return {
    found: false,
    reason,
    trackingNumber,
    prettyNumber: prettyTrackingNumber(trackingNumber),
    carrierName: "EU Tracker Courier",
    status: "unknown",
    statusLabel: "Sin información",
    progress: 0,
    origin: null,
    destination: null,
    itemCount: 0,
    fulfilledAt: null,
    fulfilledAtLabel: null,
    estimatedDeliveryAt: null,
    estimatedDeliveryLabel: null,
    deliveredAt: null,
    deliveredAtLabel: null,
    events: [],
  };
}

export async function lookupTracking(
  rawNumber: string | null | undefined,
  options: { shop?: string } = {},
): Promise<PublicTrackingResult> {
  const trackingNumber = normalizeTrackingNumber(rawNumber);

  if (!trackingNumber) return emptyResult("", "empty");
  if (!isValidTrackingFormat(trackingNumber)) return emptyResult(trackingNumber, "invalid_format");

  const shipment = await prisma.shipment.findFirst({
    where: {
      trackingNumber,
      ...(options.shop ? { shop: options.shop } : {}),
    },
  });

  if (!shipment) return emptyResult(trackingNumber, "not_found");

  const settings = await getOrCreateSettings(shipment.shop);
  const timeZone = safeTimeZone(settings.timezone);

  // Se materializan los hitos que ya han ocurrido en el momento de la consulta:
  // así la página es correcta aunque el planificador esté parado.
  const { shipment: current, events } = await materializeShipment(shipment, settings);

  const dateOnly: Intl.DateTimeFormatOptions = { dateStyle: "full", timeStyle: undefined };

  return {
    found: true,
    reason: "ok",
    trackingNumber: current.trackingNumber,
    prettyNumber: prettyTrackingNumber(current.trackingNumber),
    carrierName: current.carrierName,
    status: current.status,
    statusLabel: statusLabel(current.status),
    progress: progressFor(current.status),
    origin: current.originCity,
    destination: [current.destinationCity, current.destinationCountry].filter(Boolean).join(", ") || null,
    itemCount: current.itemCount,
    fulfilledAt: current.fulfilledAt.toISOString(),
    fulfilledAtLabel: formatInTimeZone(current.fulfilledAt, timeZone),
    estimatedDeliveryAt: current.estimatedDeliveryAt?.toISOString() ?? null,
    estimatedDeliveryLabel: current.estimatedDeliveryAt
      ? formatInTimeZone(current.estimatedDeliveryAt, timeZone, dateOnly)
      : null,
    deliveredAt: current.deliveredAt?.toISOString() ?? null,
    deliveredAtLabel: current.deliveredAt ? formatInTimeZone(current.deliveredAt, timeZone) : null,
    events: events.map((event) => ({
      code: event.code,
      title: event.title,
      detail: event.detail,
      location: event.location,
      occurredAt: event.occurredAt.toISOString(),
      occurredAtLabel: formatInTimeZone(event.occurredAt, timeZone),
    })),
  };
}

/**
 * Limitador de peticiones en memoria para los endpoints públicos.
 * Evita que alguien pruebe números al azar de forma masiva.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [id, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(id);
      }
    }
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limit;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anon";
}
