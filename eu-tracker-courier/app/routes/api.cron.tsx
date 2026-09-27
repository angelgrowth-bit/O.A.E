import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { schedulerTick } from "../lib/scheduler.server";

/**
 * Disparador externo del planificador.
 *
 *   curl -X POST https://tu-app.com/api/cron -H "x-eutc-cron-secret: TU_SECRETO"
 *
 * Úsalo en hosts que apagan el proceso cuando no hay tráfico (Vercel, Cloud
 * Run con escalado a cero, etc.), donde el temporizador interno no sobrevive.
 * Llámalo cada 5–10 minutos: la hora exacta de preparación la sigue decidiendo
 * la app, no el cron.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-eutc-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret") ??
    "";

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json(
      {
        ok: false,
        error: "cron_secret_missing",
        message: "Define la variable de entorno CRON_SECRET para poder usar este endpoint.",
      },
      { status: 503 },
    );
  }

  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await schedulerTick();

  return Response.json({
    ok: true,
    ranAt: new Date().toISOString(),
    dispatchedShops: result.dispatched,
    scheduledShops: result.scheduled,
    advancedShipments: result.advancedShipments,
  });
}

export const loader = ({ request }: LoaderFunctionArgs) => handle(request);
export const action = ({ request }: ActionFunctionArgs) => handle(request);
