import { randomInt } from "node:crypto";

import prisma from "../db.server";
import { buildTrackingNumber, sanitizeHubCode, sanitizePrefix } from "./tracking";

export * from "./tracking";

function randomSerial(): string {
  let serial = String(randomInt(1, 10));
  for (let i = 1; i < 10; i += 1) serial += randomInt(0, 10);
  return serial;
}

/**
 * Genera un número que todavía no existe en la base de datos.
 * El índice único de `Shipment.trackingNumber` es la garantía final.
 */
export async function generateUniqueTrackingNumber(options: {
  prefix?: string | null;
  hubCode?: string | null;
}): Promise<string> {
  const prefix = sanitizePrefix(options.prefix);
  const hubCode = sanitizeHubCode(options.hubCode);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = buildTrackingNumber(prefix, hubCode, randomSerial());
    const existing = await prisma.shipment.findUnique({
      where: { trackingNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  throw new Error("No se ha podido generar un número de seguimiento único tras 25 intentos.");
}

