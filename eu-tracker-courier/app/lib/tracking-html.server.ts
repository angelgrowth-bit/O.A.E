import type { PublicTrackingResult } from "./tracking-lookup.server";

/**
 * Render del bloque de seguimiento como HTML.
 *
 * Se usa en dos sitios con el mismo resultado visual:
 *  - la página `/track` del dominio de la app,
 *  - el proxy `/apps/eu-tracker`, que Shopify incrusta dentro del tema.
 *
 * Los estilos van con el prefijo `eutc-` y usan variables propias para no
 * chocar con el CSS del tema de la tienda.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    // El proxy sirve el HTML como Liquid: neutralizamos las llaves para que
    // ningún dato del envío pueda interpretarse como sintaxis de plantilla.
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

const ICONS: Record<string, string> = {
  registered:
    '<path d="M4 7h16M4 12h16M4 17h10" stroke-linecap="round"/>',
  picked_up:
    '<path d="M3 8l9-4 9 4-9 4-9-4zm0 0v8l9 4 9-4V8" stroke-linejoin="round"/>',
  in_transit:
    '<path d="M3 16V7h11v9M14 10h4l3 3v3h-7" stroke-linejoin="round"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  customs:
    '<path d="M12 3l8 4v5c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V7l8-4z" stroke-linejoin="round"/>',
  arrived:
    '<path d="M3 21h18M6 21V8l6-4 6 4v13M10 21v-5h4v5" stroke-linejoin="round"/>',
  out_for_delivery:
    '<path d="M3 16V7h11v9M14 10h4l3 3v3h-7" stroke-linejoin="round"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  delivered: '<path d="M4 12.5l5 5L20 6.5" stroke-linecap="round" stroke-linejoin="round"/>',
};

function icon(code: string): string {
  const path = ICONS[code] ?? ICONS.in_transit;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${path}</svg>`;
}

export const TRACKING_STYLES = `
.eutc{--eutc-accent:#1f6feb;--eutc-accent-soft:#e8f0fe;--eutc-bg:#ffffff;--eutc-surface:#f7f8fa;--eutc-border:#e3e5e9;--eutc-text:#14161a;--eutc-muted:#61666e;--eutc-ok:#0f8a52;--eutc-ok-soft:#e4f5ec;--eutc-warn:#b26a00;--eutc-warn-soft:#fdf2df;--eutc-radius:14px;
  color:var(--eutc-text);font-family:inherit;line-height:1.55;max-width:760px;margin:0 auto;padding:8px 0 40px;box-sizing:border-box}
.eutc *,.eutc *::before,.eutc *::after{box-sizing:border-box}
@media (prefers-color-scheme:dark){.eutc{--eutc-bg:#14161a;--eutc-surface:#1c1f25;--eutc-border:#2b2f37;--eutc-text:#eef0f3;--eutc-muted:#a0a6b0;--eutc-accent:#5b9bff;--eutc-accent-soft:#1b2740;--eutc-ok:#39c07f;--eutc-ok-soft:#142a20;--eutc-warn:#e2a13c;--eutc-warn-soft:#2d2415}}
.eutc-form{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 22px}
.eutc-form input{flex:1 1 260px;min-width:0;padding:13px 15px;font-size:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;
  border:1px solid var(--eutc-border);border-radius:var(--eutc-radius);background:var(--eutc-bg);color:var(--eutc-text)}
.eutc-form input:focus{outline:2px solid var(--eutc-accent);outline-offset:1px;border-color:transparent}
.eutc-form button{padding:13px 24px;font-size:15px;font-weight:600;border:0;border-radius:var(--eutc-radius);background:var(--eutc-accent);color:#fff;cursor:pointer}
.eutc-form button:hover{filter:brightness(1.07)}
.eutc-card{border:1px solid var(--eutc-border);border-radius:var(--eutc-radius);background:var(--eutc-surface);padding:22px;margin-bottom:18px}
.eutc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.eutc-label{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--eutc-muted);margin:0 0 4px}
.eutc-number{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:clamp(15px,4.3vw,21px);font-weight:700;letter-spacing:.05em;margin:0}
.eutc-number span{white-space:nowrap}
.eutc-badge{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap;
  background:var(--eutc-accent-soft);color:var(--eutc-accent)}
.eutc-badge.is-done{background:var(--eutc-ok-soft);color:var(--eutc-ok)}
.eutc-badge.is-active{background:var(--eutc-warn-soft);color:var(--eutc-warn)}
.eutc-badge i{width:8px;height:8px;border-radius:50%;background:currentColor;display:block}
.eutc-bar{height:7px;border-radius:999px;background:var(--eutc-border);overflow:hidden;margin:20px 0 6px}
.eutc-bar span{display:block;height:100%;border-radius:999px;background:var(--eutc-accent);transition:width .5s ease}
.eutc-bar.is-done span{background:var(--eutc-ok)}
.eutc-steps{display:flex;justify-content:space-between;font-size:11.5px;color:var(--eutc-muted);margin-bottom:4px}
.eutc-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-top:22px;padding-top:20px;border-top:1px solid var(--eutc-border)}
.eutc-fact p{margin:0}
.eutc-fact .eutc-value{font-size:15px;font-weight:600}
.eutc-timeline{list-style:none;margin:0;padding:0}
.eutc-timeline li{position:relative;padding:0 0 26px 46px}
.eutc-timeline li:last-child{padding-bottom:0}
.eutc-timeline li::before{content:"";position:absolute;left:15px;top:30px;bottom:0;width:2px;background:var(--eutc-border)}
.eutc-timeline li:last-child::before{display:none}
.eutc-dot{position:absolute;left:0;top:1px;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;
  background:var(--eutc-accent-soft);color:var(--eutc-accent);border:1px solid var(--eutc-border)}
.eutc-dot svg{width:17px;height:17px}
.eutc-timeline li.is-latest .eutc-dot{background:var(--eutc-accent);color:#fff;border-color:transparent}
.eutc-timeline li.is-delivered .eutc-dot{background:var(--eutc-ok);color:#fff;border-color:transparent}
.eutc-ev-title{margin:0;font-size:15px;font-weight:600}
.eutc-ev-meta{margin:3px 0 0;font-size:13px;color:var(--eutc-muted)}
.eutc-empty{text-align:center;padding:34px 20px}
.eutc-empty h2{margin:0 0 8px;font-size:19px}
.eutc-empty p{margin:0;color:var(--eutc-muted)}
.eutc-hint{font-size:13px;color:var(--eutc-muted);margin:14px 0 0}
.eutc-foot{font-size:12px;color:var(--eutc-muted);text-align:center;margin-top:26px}
`;

export interface RenderOptions {
  /** Acción del formulario de búsqueda (misma URL en la que se muestra). */
  formAction: string;
  heading?: string;
  /** Incluir la etiqueta <style>. En la página propia se incluye aparte. */
  includeStyles?: boolean;
}

function renderForm(result: PublicTrackingResult, options: RenderOptions): string {
  return `
<form class="eutc-form" method="get" action="${escapeHtml(options.formAction)}" role="search">
  <label for="eutc-number" class="eutc-label" style="width:100%">Introduce tu número</label>
  <input id="eutc-number" type="text" name="number" value="${escapeHtml(result.trackingNumber)}"
         placeholder="EU776017541338896466" autocomplete="off" spellcheck="false"
         inputmode="latin" aria-label="Número de seguimiento" required>
  <button type="submit">Buscar envío</button>
</form>`;
}

function renderMessage(result: PublicTrackingResult): string {
  if (result.reason === "empty") {
    return `<div class="eutc-card eutc-empty">
      <h2>Consulta tu envío</h2>
      <p>Escribe arriba el número de seguimiento que aparece en tu email de confirmación.</p>
    </div>`;
  }
  if (result.reason === "invalid_format") {
    return `<div class="eutc-card eutc-empty">
      <h2>Ese número no tiene el formato correcto</h2>
      <p>Debe empezar por dos letras y llevar 18 dígitos. Por ejemplo: EU776017541338896466.</p>
    </div>`;
  }
  return `<div class="eutc-card eutc-empty">
    <h2>No encontramos ningún envío con ese número</h2>
    <p>Revisa que esté bien escrito. Si acabas de recibir el email, puede tardar unos minutos en aparecer.</p>
  </div>`;
}

function badgeClass(status: string): string {
  if (status === "delivered") return "eutc-badge is-done";
  if (status === "out_for_delivery") return "eutc-badge is-active";
  return "eutc-badge";
}

function renderResult(result: PublicTrackingResult): string {
  const delivered = result.status === "delivered";

  const facts: Array<[string, string]> = [];
  if (result.origin) facts.push(["Origen", result.origin]);
  if (result.destination) facts.push(["Destino", result.destination]);
  if (result.itemCount > 0) {
    facts.push(["Artículos", `${result.itemCount} ${result.itemCount === 1 ? "artículo" : "artículos"}`]);
  }
  if (delivered && result.deliveredAtLabel) {
    facts.push(["Entregado el", result.deliveredAtLabel]);
  } else if (result.estimatedDeliveryLabel) {
    facts.push(["Entrega estimada", result.estimatedDeliveryLabel]);
  }
  facts.push(["Transportista", result.carrierName]);

  const factsHtml = facts
    .map(
      ([label, value]) => `<div class="eutc-fact">
        <p class="eutc-label">${escapeHtml(label)}</p>
        <p class="eutc-value">${escapeHtml(value)}</p>
      </div>`,
    )
    .join("");

  const eventsHtml = result.events
    .map((event, index) => {
      const classes = [
        index === 0 ? "is-latest" : "",
        index === 0 && event.code === "delivered" ? "is-delivered" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const meta = [event.occurredAtLabel, event.location].filter(Boolean).join(" · ");
      return `<li class="${classes}">
        <span class="eutc-dot">${icon(event.code)}</span>
        <p class="eutc-ev-title">${escapeHtml(event.title)}</p>
        <p class="eutc-ev-meta">${escapeHtml(meta)}</p>
        ${event.detail ? `<p class="eutc-ev-meta">${escapeHtml(event.detail)}</p>` : ""}
      </li>`;
    })
    .join("");

  return `
<div class="eutc-card">
  <div class="eutc-head">
    <div>
      <p class="eutc-label">Número de seguimiento</p>
      <p class="eutc-number">${result.prettyNumber
        .split(" ")
        .map((group) => `<span>${escapeHtml(group)}</span>`)
        .join(" ")}</p>
    </div>
    <span class="${badgeClass(result.status)}"><i></i>${escapeHtml(result.statusLabel)}</span>
  </div>

  <div class="eutc-bar${delivered ? " is-done" : ""}" role="progressbar"
       aria-valuenow="${result.progress}" aria-valuemin="0" aria-valuemax="100"
       aria-label="Progreso del envío">
    <span style="width:${result.progress}%"></span>
  </div>
  <div class="eutc-steps">
    <span>Registrado</span><span>En tránsito</span><span>En reparto</span><span>Entregado</span>
  </div>

  <div class="eutc-facts">${factsHtml}</div>
</div>

<div class="eutc-card">
  <p class="eutc-label" style="margin-bottom:16px">Historial del envío</p>
  ${eventsHtml ? `<ul class="eutc-timeline">${eventsHtml}</ul>` : "<p>Todavía no hay movimientos registrados.</p>"}
</div>`;
}

/** Bloque completo: formulario + resultado. */
export function renderTrackingHtml(
  result: PublicTrackingResult,
  options: RenderOptions,
): string {
  const styles = options.includeStyles ? `<style>${TRACKING_STYLES}</style>` : "";
  const heading = options.heading
    ? `<h1 style="font-size:24px;margin:0 0 18px">${escapeHtml(options.heading)}</h1>`
    : "";

  return `${styles}<div class="eutc">
  ${heading}
  ${renderForm(result, options)}
  ${result.found ? renderResult(result) : renderMessage(result)}
  <p class="eutc-foot">Seguimiento facilitado por ${escapeHtml(result.carrierName)}</p>
</div>`;
}
