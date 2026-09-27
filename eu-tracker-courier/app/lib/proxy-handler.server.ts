import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { renderTrackingHtml } from "./tracking-html.server";
import { clientKey, lookupTracking, rateLimit } from "./tracking-lookup.server";
import { APP_PROXY_SUBPATH } from "./tracking";

/**
 * Página de seguimiento servida a través del proxy de aplicación de Shopify.
 *
 * El cliente la ve en el dominio de la tienda
 * (https://tu-tienda.com/apps/eu-tracker) y con el diseño del tema, porque
 * Shopify envuelve el HTML que devolvemos en el layout de la tienda.
 */
export async function proxyTrackingLoader({ request }: LoaderFunctionArgs) {
  const { liquid, session } = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const number = url.searchParams.get("number") ?? url.searchParams.get("n") ?? "";

  if (!rateLimit(`proxy:${clientKey(request)}`, 40)) {
    return liquid(
      '<div class="eutc"><p>Demasiadas consultas seguidas. Espera un minuto y vuelve a intentarlo.</p></div>',
    );
  }

  // Se limita la búsqueda a la tienda que hace la petición: una tienda nunca
  // puede consultar los envíos de otra.
  const result = await lookupTracking(number, { shop: session?.shop });

  // `format=fragment` lo usa el bloque del tema para inyectar el resultado
  // dentro de la propia página, sin recargar ni salir de ella.
  const fragment = url.searchParams.get("format") === "fragment";

  const html = renderTrackingHtml(result, {
    formAction: `/apps/${APP_PROXY_SUBPATH}`,
    ...(fragment ? {} : { heading: "Seguimiento de tu envío" }),
    includeStyles: true,
  });

  return fragment ? liquid(html, { layout: false }) : liquid(html);
}
