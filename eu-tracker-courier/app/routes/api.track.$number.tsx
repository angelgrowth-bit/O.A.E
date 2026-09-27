import type { LoaderFunctionArgs } from "react-router";

import { clientKey, lookupTracking, rateLimit } from "../lib/tracking-lookup.server";

/**
 * API pública de seguimiento: GET /api/track/EU776017541338896466
 *
 * Devuelve JSON y admite CORS, para que puedas montar tu propia página de
 * seguimiento, una app móvil o un bloque personalizado en el tema.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (!rateLimit(`api:${clientKey(request)}`, 60)) {
    return Response.json(
      { error: "rate_limited", message: "Demasiadas consultas. Inténtalo en un minuto." },
      { status: 429, headers: CORS_HEADERS },
    );
  }

  const result = await lookupTracking(params.number);

  return Response.json(result, {
    status: result.found ? 200 : 404,
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=60" },
  });
};
