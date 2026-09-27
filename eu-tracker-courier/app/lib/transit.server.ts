import type { Shipment, ShopSettings, TrackingEvent } from "@prisma/client";

import prisma from "../db.server";
import { getOrCreateSettings } from "./settings.server";
import { STATUS_LABELS, STATUS_PROGRESS, progressFor } from "./shared";
import type { ShipmentStatus } from "./shared";
import {
  addBusinessDays,
  addZonedDays,
  atZonedTime,
  getZonedParts,
  safeTimeZone,
} from "./time";

/**
 * Simulación del recorrido de un envío.
 *
 * Los checkpoints se calculan de forma **determinista** a partir del número de
 * seguimiento: el mismo envío produce siempre exactamente las mismas fechas,
 * de modo que el cliente nunca ve saltos ni incoherencias al recargar.
 *
 * Los eventos se van materializando en base de datos a medida que "ocurren",
 * tanto desde el planificador como de forma perezosa al consultar la página
 * pública, así que la información es correcta aunque el cron se pare.
 */

export interface PlannedCheckpoint {
  code: string;
  title: string;
  detail: string;
  location: string;
  occurredAt: Date;
}

const CODE_TO_STATUS: Record<string, ShipmentStatus> = {
  registered: "pending",
  picked_up: "in_transit",
  in_transit: "in_transit",
  customs: "in_transit",
  arrived: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
};

/** PRNG determinista (mulberry32) sembrado con una cadena. */
function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

const HOUR = 60 * 60 * 1000;

function countryOf(value: string | null | undefined): string {
  const match = /,\s*([A-Za-z]{2})\s*$/.exec(value ?? "");
  return (match?.[1] ?? "").toUpperCase();
}

function cityOf(value: string | null | undefined): string {
  return String(value ?? "").split(",")[0]?.trim() ?? "";
}

/** Número de días de tránsito de este envío concreto (estable). */
function transitDays(random: () => number, settings: ShopSettings): number {
  const min = Math.max(0, settings.transitDaysMin);
  const max = Math.max(min, settings.transitDaysMax);
  return Math.round(between(random, min, max));
}

/**
 * Calcula la fecha estimada de entrega de un envío.
 * Se expone aparte porque se usa al crear el envío, antes de tener eventos.
 */
export function estimateDelivery(
  trackingNumber: string,
  fulfilledAt: Date,
  settings: ShopSettings,
): Date {
  const timeZone = safeTimeZone(settings.timezone);
  const random = seededRandom(`${trackingNumber}:eta`);
  const days = transitDays(random, settings);

  const deliveryDay = settings.skipWeekends
    ? addBusinessDays(fulfilledAt, timeZone, days)
    : addZonedDays(fulfilledAt, timeZone, days);

  const hour = Math.floor(between(random, 11, 18));
  const minute = Math.floor(between(random, 0, 60));
  return atZonedTime(deliveryDay, timeZone, hour, minute, 0);
}

/**
 * Construye el recorrido completo, de principio a fin.
 * Los checkpoints con fecha futura todavía no se muestran al cliente.
 */
export function planTimeline(
  shipment: Pick<
    Shipment,
    | "trackingNumber"
    | "fulfilledAt"
    | "estimatedDeliveryAt"
    | "originCity"
    | "destinationCity"
    | "destinationCountry"
  >,
  settings: ShopSettings,
): PlannedCheckpoint[] {
  const timeZone = safeTimeZone(settings.timezone);
  const random = seededRandom(`${shipment.trackingNumber}:timeline`);

  const origin = shipment.originCity || settings.originCity;
  const originCity = cityOf(origin) || "Centro de origen";
  const destinationCity = shipment.destinationCity || "destino";
  const destinationLabel = shipment.destinationCountry
    ? `${destinationCity}, ${shipment.destinationCountry}`
    : destinationCity;

  const start = shipment.fulfilledAt;
  const eta =
    shipment.estimatedDeliveryAt ?? estimateDelivery(shipment.trackingNumber, start, settings);

  const checkpoints: PlannedCheckpoint[] = [
    {
      code: "registered",
      title: "Envío registrado",
      detail: "Hemos recibido los datos del envío y se ha generado la etiqueta.",
      location: origin,
      occurredAt: start,
    },
    {
      code: "picked_up",
      title: "Recogida efectuada",
      detail: `El paquete ha sido recogido por ${settings.carrierName}.`,
      location: origin,
      occurredAt: new Date(start.getTime() + between(random, 2, 6) * HOUR),
    },
    {
      code: "in_transit",
      title: "En tránsito",
      detail: "Salida del centro logístico de origen.",
      location: `Centro logístico ${originCity}`,
      occurredAt: new Date(start.getTime() + between(random, 10, 17) * HOUR),
    },
  ];

  const originCountry = countryOf(origin);
  const destinationCountry = (shipment.destinationCountry ?? "").toUpperCase();
  const crossesBorder =
    Boolean(originCountry) && Boolean(destinationCountry) && originCountry !== destinationCountry;

  const arrivalDay = addZonedDays(eta, timeZone, -1);
  const arrivalHour = Math.floor(between(random, 19, 23));
  const arrival = atZonedTime(arrivalDay, timeZone, arrivalHour, Math.floor(between(random, 0, 60)));

  if (crossesBorder) {
    const customsAt = new Date(
      checkpoints[2].occurredAt.getTime() +
        Math.max(HOUR, (arrival.getTime() - checkpoints[2].occurredAt.getTime()) * 0.45),
    );
    checkpoints.push({
      code: "customs",
      title: "Trámites aduaneros completados",
      detail: "El envío ha superado los controles aduaneros y continúa su ruta.",
      location: `Hub internacional ${originCountry}`,
      occurredAt: customsAt,
    });
  }

  checkpoints.push({
    code: "arrived",
    title: "Llegada al centro de distribución",
    detail: "El paquete se encuentra en el centro de distribución de destino.",
    location: destinationLabel,
    occurredAt: arrival,
  });

  const etaParts = getZonedParts(eta, timeZone);
  checkpoints.push({
    code: "out_for_delivery",
    title: "En reparto",
    detail: "El paquete ha salido a reparto y se entregará hoy.",
    location: destinationLabel,
    occurredAt: atZonedTime(
      eta,
      timeZone,
      Math.floor(between(random, 7, 10)),
      Math.floor(between(random, 0, 60)),
    ),
  });

  checkpoints.push({
    code: "delivered",
    title: "Entregado",
    detail: "Envío entregado correctamente en la dirección de destino.",
    location: destinationLabel,
    occurredAt: atZonedTime(eta, timeZone, etaParts.hour, etaParts.minute),
  });

  // Se fuerza el orden cronológico estricto: cada paso, al menos 15 minutos
  // después del anterior. Evita rarezas con plazos de entrega muy cortos.
  const ordered = checkpoints.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1].occurredAt.getTime();
    if (ordered[i].occurredAt.getTime() <= previous) {
      ordered[i].occurredAt = new Date(previous + 15 * 60_000);
    }
  }

  return ordered;
}

export { STATUS_LABELS, STATUS_PROGRESS, progressFor };
export type { ShipmentStatus };

export function statusFromCode(code: string | undefined): ShipmentStatus {
  if (!code) return "pending";
  return CODE_TO_STATUS[code] ?? "pending";
}

export interface MaterializedShipment {
  shipment: Shipment;
  events: TrackingEvent[];
}

/**
 * Escribe en base de datos todos los checkpoints que ya han ocurrido y
 * actualiza el estado del envío. Es idempotente.
 */
export async function materializeShipment(
  shipment: Shipment,
  settings?: ShopSettings,
  now: Date = new Date(),
): Promise<MaterializedShipment> {
  const config = settings ?? (await getOrCreateSettings(shipment.shop));

  let current = shipment;
  if (!current.estimatedDeliveryAt) {
    current = await prisma.shipment.update({
      where: { id: current.id },
      data: {
        estimatedDeliveryAt: estimateDelivery(current.trackingNumber, current.fulfilledAt, config),
      },
    });
  }

  const timeline = planTimeline(current, config);
  const due = timeline.filter((checkpoint) => checkpoint.occurredAt.getTime() <= now.getTime());

  for (const checkpoint of due) {
    await prisma.trackingEvent.upsert({
      where: { shipmentId_code: { shipmentId: current.id, code: checkpoint.code } },
      create: {
        shipmentId: current.id,
        code: checkpoint.code,
        title: checkpoint.title,
        detail: checkpoint.detail,
        location: checkpoint.location,
        occurredAt: checkpoint.occurredAt,
      },
      update: {},
    });
  }

  const latest = due.at(-1);
  const status = statusFromCode(latest?.code);
  const deliveredAt = status === "delivered" ? (latest?.occurredAt ?? null) : null;

  if (
    current.status !== status ||
    current.deliveredAt?.getTime() !== deliveredAt?.getTime() ||
    !current.lastAdvancedAt
  ) {
    current = await prisma.shipment.update({
      where: { id: current.id },
      data: { status, deliveredAt, lastAdvancedAt: now },
    });
  } else {
    current = await prisma.shipment.update({
      where: { id: current.id },
      data: { lastAdvancedAt: now },
    });
  }

  const events = await prisma.trackingEvent.findMany({
    where: { shipmentId: current.id },
    orderBy: { occurredAt: "desc" },
  });

  return { shipment: current, events };
}

/**
 * Avanza en bloque los envíos que aún no están entregados.
 * La llama el planificador cada pocos minutos.
 */
export async function advancePendingShipments(limit = 500): Promise<number> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 20 * 60_000);

  const pending = await prisma.shipment.findMany({
    where: {
      status: { not: "delivered" },
      OR: [{ lastAdvancedAt: null }, { lastAdvancedAt: { lt: cutoff } }],
    },
    orderBy: { fulfilledAt: "asc" },
    take: limit,
  });

  const settingsCache = new Map<string, ShopSettings>();
  let advanced = 0;

  for (const shipment of pending) {
    try {
      let settings = settingsCache.get(shipment.shop);
      if (!settings) {
        settings = await getOrCreateSettings(shipment.shop);
        settingsCache.set(shipment.shop, settings);
      }
      await materializeShipment(shipment, settings, now);
      advanced += 1;
    } catch (error) {
      console.error(`[EUTC] No se pudo avanzar el envío ${shipment.trackingNumber}:`, error);
    }
  }

  return advanced;
}
