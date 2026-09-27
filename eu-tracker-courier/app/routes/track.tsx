import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { renderTrackingHtml, TRACKING_STYLES } from "../lib/tracking-html.server";
import { clientKey, lookupTracking, rateLimit } from "../lib/tracking-lookup.server";

/**
 * Página pública de seguimiento en el dominio de la app.
 * Es la que se enlaza desde los emails de Shopify.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const number = url.searchParams.get("number") ?? url.searchParams.get("n") ?? "";

  if (!rateLimit(`track:${clientKey(request)}`, 40)) {
    throw new Response("Demasiadas consultas. Espera un minuto.", { status: 429 });
  }

  const result = await lookupTracking(number);

  return {
    number: result.trackingNumber,
    found: result.found,
    statusLabel: result.statusLabel,
    styles: TRACKING_STYLES,
    html: renderTrackingHtml(result, { formAction: "/track", includeStyles: false }),
  };
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.number
    ? `${data.number} · Seguimiento de envío`
    : "Seguimiento de envíos · EU TRACKER COURIER";
  return [
    { title },
    {
      name: "description",
      content: "Consulta el estado de tu envío con tu número de seguimiento de EU TRACKER COURIER.",
    },
    { name: "robots", content: "noindex" },
    { name: "color-scheme", content: "light dark" },
  ];
};

export default function TrackPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `${PAGE_STYLES}\n${data.styles}` }} />
      <div className="eutc-page">
        <header className="eutc-topbar">
          <span className="eutc-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M3 8l9-4 9 4v8l-9 4-9-4V8z" strokeLinejoin="round" />
              <path d="M3 8l9 4 9-4M12 12v8" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="eutc-brand">EU TRACKER COURIER</span>
        </header>

        <main dangerouslySetInnerHTML={{ __html: data.html }} />
      </div>
    </>
  );
}

const PAGE_STYLES = `
:root{color-scheme:light dark}
body{margin:0;background:#f2f3f5;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#14161a}
@media (prefers-color-scheme:dark){body{background:#0f1115;color:#eef0f3}}
.eutc-page{max-width:820px;margin:0 auto;padding:28px 18px 56px}
.eutc-topbar{display:flex;align-items:center;gap:11px;margin-bottom:26px}
.eutc-logo{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:#1f6feb;color:#fff;flex:none}
.eutc-logo svg{width:21px;height:21px}
.eutc-brand{font-weight:700;letter-spacing:.06em;font-size:15px}
@media (prefers-color-scheme:dark){.eutc-logo{background:#5b9bff}}
`;
