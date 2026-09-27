import type { ShopSettings } from "@prisma/client";

import prisma from "../db.server";
import { computeNextRunAt, clampHour, safeTimeZone } from "./time";
import { sanitizeHubCode, sanitizePrefix } from "./tracking";

export type { ShopSettings };

/**
 * Devuelve la configuración de la tienda, creándola con valores por defecto
 * la primera vez. Si no hay hora de próxima ejecución, la programa.
 */
export async function getOrCreateSettings(shop: string): Promise<ShopSettings> {
  const existing = await prisma.shopSettings.findUnique({ where: { shop } });
  if (existing) {
    if (existing.automationEnabled && !existing.nextRunAt) {
      return prisma.shopSettings.update({
        where: { shop },
        data: { nextRunAt: computeNextRunAt(toWindow(existing)) },
      });
    }
    return existing;
  }

  const defaults = { shop } as const;
  const created = await prisma.shopSettings.create({ data: defaults });
  return prisma.shopSettings.update({
    where: { shop },
    data: { nextRunAt: computeNextRunAt(toWindow(created)) },
  });
}

export function toWindow(settings: Pick<ShopSettings, "timezone" | "windowStartHour" | "windowEndHour">) {
  return {
    timeZone: safeTimeZone(settings.timezone),
    startHour: clampHour(settings.windowStartHour, 2),
    endHour: clampHour(settings.windowEndHour, 7),
  };
}

export interface SettingsInput {
  automationEnabled?: boolean;
  windowStartHour?: number;
  windowEndHour?: number;
  timezone?: string;
  spreadMinutes?: number;
  prefix?: string;
  hubCode?: string;
  carrierName?: string;
  trackingUrlTemplate?: string;
  useStorefrontProxy?: boolean;
  notifyCustomer?: boolean;
  dryRun?: boolean;
  backfillEnabled?: boolean;
  maxOrdersPerRun?: number;
  minOrderAgeMinutes?: number;
  skipTags?: string;
  onlyTags?: string;
  requirePaid?: boolean;
  transitDaysMin?: number;
  transitDaysMax?: number;
  skipWeekends?: boolean;
  originCity?: string;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanTags(value: unknown): string {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Valida y guarda los ajustes. Cualquier cambio que afecte a la ventana
 * horaria recalcula la próxima ejecución.
 */
export async function updateSettings(shop: string, input: SettingsInput): Promise<ShopSettings> {
  const current = await getOrCreateSettings(shop);

  const timezone = safeTimeZone(input.timezone ?? current.timezone);
  const windowStartHour = clampHour(input.windowStartHour ?? current.windowStartHour, 2);
  let windowEndHour = clampHour(input.windowEndHour ?? current.windowEndHour, 7);
  // Una ventana de longitud cero no tendría sentido: se fuerza a una hora.
  if (windowEndHour === windowStartHour) windowEndHour = (windowStartHour + 1) % 24;

  const transitDaysMin = clampInt(input.transitDaysMin ?? current.transitDaysMin, 0, 60, 2);
  const transitDaysMax = Math.max(
    transitDaysMin,
    clampInt(input.transitDaysMax ?? current.transitDaysMax, 0, 90, 5),
  );

  const data = {
    automationEnabled: input.automationEnabled ?? current.automationEnabled,
    windowStartHour,
    windowEndHour,
    timezone,
    spreadMinutes: clampInt(input.spreadMinutes ?? current.spreadMinutes, 0, 60, 15),
    prefix: sanitizePrefix(input.prefix ?? current.prefix),
    hubCode: sanitizeHubCode(input.hubCode ?? current.hubCode),
    carrierName: (input.carrierName ?? current.carrierName).trim().slice(0, 80) || "EU Tracker Courier",
    trackingUrlTemplate: (input.trackingUrlTemplate ?? current.trackingUrlTemplate).trim().slice(0, 500),
    useStorefrontProxy: input.useStorefrontProxy ?? current.useStorefrontProxy,
    notifyCustomer: input.notifyCustomer ?? current.notifyCustomer,
    dryRun: input.dryRun ?? current.dryRun,
    backfillEnabled: input.backfillEnabled ?? current.backfillEnabled,
    maxOrdersPerRun: clampInt(input.maxOrdersPerRun ?? current.maxOrdersPerRun, 1, 5000, 250),
    minOrderAgeMinutes: clampInt(input.minOrderAgeMinutes ?? current.minOrderAgeMinutes, 0, 20160, 0),
    skipTags: cleanTags(input.skipTags ?? current.skipTags),
    onlyTags: cleanTags(input.onlyTags ?? current.onlyTags),
    requirePaid: input.requirePaid ?? current.requirePaid,
    transitDaysMin,
    transitDaysMax,
    skipWeekends: input.skipWeekends ?? current.skipWeekends,
    originCity: (input.originCity ?? current.originCity).trim().slice(0, 120) || "Madrid, ES",
  };

  const windowChanged =
    data.windowStartHour !== current.windowStartHour ||
    data.windowEndHour !== current.windowEndHour ||
    data.timezone !== current.timezone ||
    (data.automationEnabled && !current.automationEnabled);

  return prisma.shopSettings.update({
    where: { shop },
    data: {
      ...data,
      nextRunAt: data.automationEnabled
        ? windowChanged || !current.nextRunAt
          ? computeNextRunAt({
              timeZone: data.timezone,
              startHour: data.windowStartHour,
              endHour: data.windowEndHour,
            })
          : current.nextRunAt
        : null,
    },
  });
}

/** Lista de etiquetas normalizada a minúsculas. */
export function parseTagList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}
