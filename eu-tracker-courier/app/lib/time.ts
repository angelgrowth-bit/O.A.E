/**
 * Utilidades de zona horaria sin dependencias externas.
 * Todo se apoya en `Intl.DateTimeFormat`, que ya viene en Node y en el navegador.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = domingo
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** ¿Es una zona horaria IANA que este runtime entiende? */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string | null | undefined, fallback = "Europe/Madrid"): string {
  const candidate = (timeZone ?? "").trim();
  if (candidate && isValidTimeZone(candidate)) return candidate;
  return isValidTimeZone(fallback) ? fallback : "UTC";
}

/** Descompone un instante en su hora local dentro de `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(safeTimeZone(timeZone)).formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) lookup[part.type] = part.value;

  let hour = Number(lookup.hour);
  if (hour === 24) hour = 0; // algunos runtimes devuelven 24 para medianoche

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour,
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    weekday: WEEKDAYS[lookup.weekday] ?? 0,
  };
}

/** Desfase de la zona respecto a UTC, en milisegundos, en ese instante. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convierte una hora de pared (año/mes/día/hora local en `timeZone`) al
 * instante UTC correspondiente. Hace dos pasadas para resolver correctamente
 * los cambios de horario de verano.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const zone = safeTimeZone(timeZone);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = naive - timeZoneOffsetMs(new Date(naive), zone);
  const secondOffset = timeZoneOffsetMs(new Date(firstGuess), zone);
  return new Date(naive - secondOffset);
}

/** Suma días naturales sobre la hora local de la zona (no 24h fijas). */
export function addZonedDays(date: Date, timeZone: string, days: number): Date {
  const parts = getZonedParts(date, timeZone);
  return zonedTimeToUtc(
    timeZone,
    parts.year,
    parts.month,
    parts.day + days,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

export function isWeekend(date: Date, timeZone: string): boolean {
  const weekday = getZonedParts(date, timeZone).weekday;
  return weekday === 0 || weekday === 6;
}

/** Avanza `days` días saltando sábados y domingos. */
export function addBusinessDays(date: Date, timeZone: string, days: number): Date {
  let cursor = date;
  let remaining = Math.max(0, Math.round(days));
  let guard = 0;
  while (remaining > 0 && guard < 400) {
    cursor = addZonedDays(cursor, timeZone, 1);
    guard += 1;
    if (!isWeekend(cursor, timeZone)) remaining -= 1;
  }
  return cursor;
}

/** Coloca una fecha en una hora local concreta del mismo día. */
export function atZonedTime(date: Date, timeZone: string, hour: number, minute = 0, second = 0): Date {
  const parts = getZonedParts(date, timeZone);
  return zonedTimeToUtc(timeZone, parts.year, parts.month, parts.day, hour, minute, second);
}

export interface WindowConfig {
  timeZone: string;
  startHour: number;
  endHour: number;
}

/** Duración de la ventana en minutos, soportando ventanas que cruzan medianoche. */
export function windowLengthMinutes(startHour: number, endHour: number): number {
  const span = ((endHour - startHour) % 24 + 24) % 24;
  return (span === 0 ? 24 : span) * 60;
}

/**
 * Calcula el próximo instante de ejecución: un momento aleatorio dentro de la
 * ventana horaria local de la tienda (por defecto 02:00–07:00).
 *
 * - Si ahora mismo estamos dentro de la ventana, elige un momento entre
 *   "ahora" y el cierre de la ventana.
 * - Si la ventana de hoy ya pasó, elige un momento aleatorio de la de mañana.
 */
export function computeNextRunAt(
  config: WindowConfig,
  from: Date = new Date(),
  random: () => number = Math.random,
): Date {
  const timeZone = safeTimeZone(config.timeZone);
  const startHour = clampHour(config.startHour, 2);
  const endHour = clampHour(config.endHour, 7);
  const spanHours = windowLengthMinutes(startHour, endHour) / 60;

  // Se prueban las ventanas que empiezan ayer, hoy y mañana: cubre
  // las que cruzan medianoche y los cambios de horario.
  for (let dayOffset = -1; dayOffset <= 2; dayOffset += 1) {
    const parts = getZonedParts(from, timeZone);
    const windowStart = zonedTimeToUtc(
      timeZone,
      parts.year,
      parts.month,
      parts.day + dayOffset,
      startHour,
      0,
      0,
    );
    // El final se calcula también como hora de pared, no sumando milisegundos:
    // en la noche del cambio de horario la ventana dura una hora menos (o una
    // más), pero la hora local resultante sigue estando dentro del rango.
    // `Date.UTC` normaliza solo las horas >= 24, así que las ventanas que
    // cruzan la medianoche funcionan igual.
    const windowEnd = zonedTimeToUtc(
      timeZone,
      parts.year,
      parts.month,
      parts.day + dayOffset,
      startHour + spanHours,
      0,
      0,
    );

    if (windowEnd.getTime() <= from.getTime()) continue;

    const lowerBound = Math.max(windowStart.getTime(), from.getTime());
    // Se deja al menos un minuto de margen para no programar en el pasado inmediato.
    const upperBound = windowEnd.getTime();
    if (upperBound - lowerBound < 60_000) continue;

    return new Date(lowerBound + Math.floor(random() * (upperBound - lowerBound)));
  }

  // Salvaguarda: dentro de 24 horas.
  return new Date(from.getTime() + 24 * 60 * 60_000);
}

export function clampHour(value: number | null | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

/** Formatea un instante en la zona de la tienda, en español. */
export function formatInTimeZone(
  date: Date | string | null | undefined,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: safeTimeZone(timeZone),
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(value);
}
