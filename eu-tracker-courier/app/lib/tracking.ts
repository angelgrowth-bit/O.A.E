/**
 * Formato de los números de seguimiento de EU TRACKER COURIER.
 *
 * Este módulo es puro: lo usan tanto el servidor como el panel en el
 * navegador, así que no puede importar Prisma ni módulos de Node.
 *
 * Formato (20 caracteres): PP HHHHHH SSSSSSSSSS CC
 *   PP          2 letras  → prefijo (por defecto "EU")
 *   HHHHHH      6 dígitos → código del centro emisor (por defecto "776017")
 *   SSSSSSSSSS 10 dígitos → número de serie único
 *   CC          2 dígitos → dígitos de control (mod 97)
 *
 * Número de referencia del proyecto: EU776017541338896466
 *   EU | 776017 | 5413388964 | 66
 */
export const DEFAULT_PREFIX = "EU";
export const DEFAULT_HUB_CODE = "776017";
export const REFERENCE_NUMBER = "EU776017541338896466";

/** Formato aceptado en la búsqueda pública: 2 letras + 18 dígitos. */
export const TRACKING_PATTERN = /^[A-Z]{2}\d{18}$/;

/** Quita espacios, guiones y pasa a mayúsculas. */
export function normalizeTrackingNumber(input: string | null | undefined): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidTrackingFormat(value: string): boolean {
  return TRACKING_PATTERN.test(normalizeTrackingNumber(value));
}

/** Presentación legible: EU 776017 5413388964 66 */
export function prettyTrackingNumber(value: string): string {
  const n = normalizeTrackingNumber(value);
  if (!TRACKING_PATTERN.test(n)) return n;
  return `${n.slice(0, 2)} ${n.slice(2, 8)} ${n.slice(8, 18)} ${n.slice(18)}`;
}

function mod97(body: string): string {
  return (BigInt(body) % 97n).toString().padStart(2, "0");
}

export function sanitizePrefix(value: string | null | undefined): string {
  const clean = (value ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  return clean.length === 2 ? clean : DEFAULT_PREFIX;
}

export function sanitizeHubCode(value: string | null | undefined): string {
  const clean = (value ?? "").replace(/\D/g, "").slice(0, 6);
  return clean.length === 6 ? clean : DEFAULT_HUB_CODE;
}

export function buildTrackingNumber(prefix: string, hubCode: string, serial: string): string {
  const body = `${sanitizeHubCode(hubCode)}${serial}`;
  return `${sanitizePrefix(prefix)}${body}${mod97(body)}`;
}

/**
 * Comprueba los dígitos de control. Se usa como señal de calidad, no como
 * filtro: la fuente de verdad de una búsqueda siempre es la base de datos,
 * de modo que un número importado a mano también funciona.
 */
export function hasValidChecksum(value: string): boolean {
  const n = normalizeTrackingNumber(value);
  if (!TRACKING_PATTERN.test(n)) return false;
  const digits = n.slice(2);
  return mod97(digits.slice(0, 16)) === digits.slice(16);
}

export const APP_PROXY_SUBPATH = "eu-tracker";

/**
 * Construye la URL de seguimiento que verá el cliente.
 *
 * Orden de preferencia:
 *   1. Plantilla personalizada del comerciante ({{number}} o {number}).
 *   2. Proxy de la tienda → https://tu-tienda.com/apps/eu-tracker?number=...
 *   3. Dominio de la propia app → https://app.ejemplo.com/track?number=...
 */
export function buildTrackingUrl(options: {
  trackingNumber: string;
  appUrl: string;
  storefrontUrl?: string | null;
  template?: string | null;
  useStorefrontProxy?: boolean;
}): string {
  const number = normalizeTrackingNumber(options.trackingNumber);
  const template = (options.template ?? "").trim();

  if (template) {
    return template.replace(/\{\{\s*number\s*\}\}|\{\s*number\s*\}/gi, encodeURIComponent(number));
  }

  if (options.useStorefrontProxy && options.storefrontUrl) {
    const base = options.storefrontUrl.replace(/\/+$/, "");
    return `${base}/apps/${APP_PROXY_SUBPATH}?number=${encodeURIComponent(number)}`;
  }

  const base = (options.appUrl || "").replace(/\/+$/, "");
  return `${base}/track?number=${encodeURIComponent(number)}`;
}
