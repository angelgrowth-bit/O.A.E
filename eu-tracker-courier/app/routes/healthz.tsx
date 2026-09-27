import prisma from "../db.server";
import { errorMessage } from "../lib/errors";

/** Comprobación de estado para el monitor de tu hosting. */
export const loader = async () => {
  try {
    const [shops, shipments] = await Promise.all([
      prisma.shopSettings.count(),
      prisma.shipment.count(),
    ]);

    return Response.json({
      ok: true,
      app: "EU TRACKER COURIER",
      time: new Date().toISOString(),
      database: "ok",
      shops,
      shipments,
      schedulerEnabled: process.env.EUTC_DISABLE_SCHEDULER !== "1",
    });
  } catch (error) {
    return Response.json(
      { ok: false, database: "error", message: errorMessage(error) },
      { status: 503 },
    );
  }
};
