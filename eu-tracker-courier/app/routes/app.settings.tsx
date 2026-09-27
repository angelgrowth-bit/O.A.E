import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  SubmitTarget,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getOrCreateSettings, updateSettings } from "../lib/settings.server";
import type { SettingsInput, ShopSettings } from "../lib/settings.server";
import { errorMessage } from "../lib/errors";
import { fetchShopInfo } from "../lib/fulfillment.server";
import { formatInTimeZone, safeTimeZone } from "../lib/time";
import { buildTrackingUrl, REFERENCE_NUMBER } from "../lib/tracking";

const COMMON_TIMEZONES = [
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Atlantic/Canary",
  "America/Mexico_City",
  "America/Bogota",
  "America/Argentina/Buenos_Aires",
  "America/Santiago",
  "America/New_York",
  "UTC",
];

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour));

/** Los ajustes tal y como los maneja el formulario del navegador. */
function toClientSettings(settings: ShopSettings) {
  return {
    automationEnabled: settings.automationEnabled,
    windowStartHour: settings.windowStartHour,
    windowEndHour: settings.windowEndHour,
    timezone: settings.timezone,
    spreadMinutes: settings.spreadMinutes,
    prefix: settings.prefix,
    hubCode: settings.hubCode,
    carrierName: settings.carrierName,
    trackingUrlTemplate: settings.trackingUrlTemplate,
    useStorefrontProxy: settings.useStorefrontProxy,
    notifyCustomer: settings.notifyCustomer,
    dryRun: settings.dryRun,
    backfillEnabled: settings.backfillEnabled,
    maxOrdersPerRun: settings.maxOrdersPerRun,
    minOrderAgeMinutes: settings.minOrderAgeMinutes,
    skipTags: settings.skipTags,
    onlyTags: settings.onlyTags,
    requirePaid: settings.requirePaid,
    transitDaysMin: settings.transitDaysMin,
    transitDaysMax: settings.transitDaysMax,
    skipWeekends: settings.skipWeekends,
    originCity: settings.originCity,
  };
}

export type ClientSettings = ReturnType<typeof toClientSettings>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getOrCreateSettings(shop);

  let storefrontUrl: string | null = null;
  try {
    storefrontUrl = (await fetchShopInfo(admin)).storefrontUrl;
  } catch {
    storefrontUrl = `https://${shop}`;
  }

  return {
    shop,
    storefrontUrl,
    appUrl: process.env.SHOPIFY_APP_URL || "",
    nextRunLabel: settings.nextRunAt
      ? formatInTimeZone(settings.nextRunAt, safeTimeZone(settings.timezone))
      : null,
    settings: toClientSettings(settings),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const input = (await request.json()) as SettingsInput;

  try {
    const saved = await updateSettings(session.shop, input);
    return {
      ok: true,
      message: "Ajustes guardados.",
      settings: toClientSettings(saved),
      nextRunLabel: saved.nextRunAt
        ? formatInTimeZone(saved.nextRunAt, safeTimeZone(saved.timezone))
        : null,
    };
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error),
      settings: null as ClientSettings | null,
      nextRunLabel: null,
    };
  }
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [form, setForm] = useState(data.settings);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  // Lo guardado más reciente: la respuesta de la acción si la hay, si no el loader.
  const saved: ClientSettings = fetcher.data?.settings ?? data.settings;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const save = () =>
    fetcher.submit(form as unknown as SubmitTarget, {
      method: "POST",
      encType: "application/json",
    });

  const saving = fetcher.state !== "idle";

  const exampleUrl = buildTrackingUrl({
    trackingNumber: REFERENCE_NUMBER,
    appUrl: data.appUrl,
    storefrontUrl: data.storefrontUrl,
    template: form.trackingUrlTemplate,
    useStorefrontProxy: form.useStorefrontProxy,
  });

  const windowLabel = `${String(form.windowStartHour).padStart(2, "0")}:00 – ${String(
    form.windowEndHour,
  ).padStart(2, "0")}:00`;

  return (
    <s-page heading="Ajustes">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(saving ? { loading: true } : {})}
        {...(!dirty ? { disabled: true } : {})}
      >
        Guardar cambios
      </s-button>

      {dirty && (
        <s-banner tone="warning" heading="Tienes cambios sin guardar">
          <s-paragraph>Pulsa «Guardar cambios» para aplicarlos.</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Automatización nocturna">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Preparar pedidos automáticamente"
            details="Cada día, a una hora aleatoria dentro de la ventana elegida."
            checked={form.automationEnabled}
            onChange={(event) => set("automationEnabled", event.currentTarget.checked)}
          />

          <s-stack direction="inline" gap="base">
            <s-select
              label="Desde las"
              value={String(form.windowStartHour)}
              onChange={(event) => set("windowStartHour", Number(event.currentTarget.value))}
            >
              {HOURS.map((hour) => (
                <s-option key={hour} value={hour}>
                  {hour.padStart(2, "0")}:00
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Hasta las"
              value={String(form.windowEndHour)}
              onChange={(event) => set("windowEndHour", Number(event.currentTarget.value))}
            >
              {HOURS.map((hour) => (
                <s-option key={hour} value={hour}>
                  {hour.padStart(2, "0")}:00
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Zona horaria"
              details="Se detecta sola desde Shopify."
              value={form.timezone}
              onChange={(event) => set("timezone", event.currentTarget.value)}
            >
              {Array.from(new Set([form.timezone, ...COMMON_TIMEZONES])).map((zone) => (
                <s-option key={zone} value={zone}>
                  {zone}
                </s-option>
              ))}
            </s-select>
          </s-stack>

          <s-paragraph>
            Ventana actual: <s-text type="strong">{windowLabel}</s-text> ({form.timezone}).
            {data.nextRunLabel ? ` Próxima ejecución: ${data.nextRunLabel}.` : ""}
          </s-paragraph>

          <s-number-field
            label="Repartir la tanda durante (minutos)"
            details="0 = preparar todo de golpe. Con un valor mayor, los pedidos se van preparando poco a poco para que las horas no sean idénticas."
            min={0}
            max={60}
            value={String(form.spreadMinutes)}
            onChange={(event) => set("spreadMinutes", Number(event.currentTarget.value))}
          />
        </s-stack>
      </s-section>

      <s-section heading="Número de seguimiento">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Prefijo (2 letras)"
              value={form.prefix}
              maxLength={2}
              onChange={(event) => set("prefix", event.currentTarget.value.toUpperCase())}
            />
            <s-text-field
              label="Código de centro (6 dígitos)"
              value={form.hubCode}
              maxLength={6}
              onChange={(event) => set("hubCode", event.currentTarget.value.replace(/\D/g, ""))}
            />
            <s-text-field
              label="Nombre del transportista"
              details="Es lo que ve el cliente en el email de Shopify."
              value={form.carrierName}
              onChange={(event) => set("carrierName", event.currentTarget.value)}
            />
          </s-stack>
          <s-box padding="small-200" background="subdued" borderRadius="base" borderWidth="base">
            <s-stack direction="block" gap="small-400">
              <s-text color="subdued">Formato que se generará</s-text>
              <s-text fontVariantNumeric="tabular-nums" type="strong">
                {form.prefix}
                {form.hubCode}xxxxxxxxxx##
              </s-text>
              <s-text color="subdued">
                10 dígitos de serie + 2 dígitos de control. Referencia del proyecto:{" "}
                {REFERENCE_NUMBER}
              </s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Enlace de seguimiento para el cliente">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Usar el dominio de mi tienda"
            details="Recomendado: el cliente ve tudominio.com/apps/eu-tracker en lugar del dominio de la app."
            checked={form.useStorefrontProxy}
            onChange={(event) => set("useStorefrontProxy", event.currentTarget.checked)}
          />
          <s-url-field
            label="Plantilla de URL personalizada (opcional)"
            details="Si la rellenas, tiene prioridad sobre todo lo demás. Usa {{number}} donde vaya el número."
            placeholder="https://seguimiento.midominio.com/?n={{number}}"
            value={form.trackingUrlTemplate}
            onChange={(event) => set("trackingUrlTemplate", event.currentTarget.value)}
          />
          <s-box padding="small-200" background="subdued" borderRadius="base" borderWidth="base">
            <s-stack direction="block" gap="small-400">
              <s-text color="subdued">Enlace de ejemplo</s-text>
              <s-text fontVariantNumeric="tabular-nums">{exampleUrl}</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Qué pedidos se preparan">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Avisar al cliente por email"
            details="Envía el correo de confirmación de envío de Shopify con el enlace de seguimiento."
            checked={form.notifyCustomer}
            onChange={(event) => set("notifyCustomer", event.currentTarget.checked)}
          />
          <s-switch
            label="Modo simulación"
            details="Genera números y registros, pero no prepara nada en Shopify. Ideal para probar."
            checked={form.dryRun}
            onChange={(event) => set("dryRun", event.currentTarget.checked)}
          />
          <s-switch
            label="Incluir pedidos antiguos"
            details="Procesa también los pedidos sin preparar que ya tenías antes de instalar la app."
            checked={form.backfillEnabled}
            onChange={(event) => set("backfillEnabled", event.currentTarget.checked)}
          />
          <s-switch
            label="Solo pedidos pagados"
            checked={form.requirePaid}
            onChange={(event) => set("requirePaid", event.currentTarget.checked)}
          />

          <s-stack direction="inline" gap="base">
            <s-number-field
              label="Máximo de pedidos por ejecución"
              min={1}
              max={5000}
              value={String(form.maxOrdersPerRun)}
              onChange={(event) => set("maxOrdersPerRun", Number(event.currentTarget.value))}
            />
            <s-number-field
              label="Antigüedad mínima del pedido (minutos)"
              details="Deja margen para cancelaciones de última hora."
              min={0}
              max={20160}
              value={String(form.minOrderAgeMinutes)}
              onChange={(event) => set("minOrderAgeMinutes", Number(event.currentTarget.value))}
            />
          </s-stack>

          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Excluir pedidos con estas etiquetas"
              details="Separadas por comas."
              placeholder="recogida-en-tienda, digital"
              value={form.skipTags}
              onChange={(event) => set("skipTags", event.currentTarget.value)}
            />
            <s-text-field
              label="Incluir solo estas etiquetas"
              details="Si lo rellenas, se ignora todo lo demás."
              placeholder="enviar-ya"
              value={form.onlyTags}
              onChange={(event) => set("onlyTags", event.currentTarget.value)}
            />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Recorrido del envío">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Con estos valores la app calcula los hitos que ve el cliente en la página de seguimiento
            (recogida, tránsito, reparto y entrega).
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-number-field
              label="Días de entrega (mínimo)"
              min={0}
              max={60}
              value={String(form.transitDaysMin)}
              onChange={(event) => set("transitDaysMin", Number(event.currentTarget.value))}
            />
            <s-number-field
              label="Días de entrega (máximo)"
              min={0}
              max={90}
              value={String(form.transitDaysMax)}
              onChange={(event) => set("transitDaysMax", Number(event.currentTarget.value))}
            />
            <s-text-field
              label="Ciudad de origen"
              details='Formato "Ciudad, XX" (código de país).'
              value={form.originCity}
              onChange={(event) => set("originCity", event.currentTarget.value)}
            />
          </s-stack>
          <s-switch
            label="No contar sábados ni domingos"
            checked={form.skipWeekends}
            onChange={(event) => set("skipWeekends", event.currentTarget.checked)}
          />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Cómo funciona">
        <s-unordered-list>
          <s-list-item>
            Cada madrugada se elige una hora al azar dentro de tu ventana y se preparan todos los
            pedidos pendientes.
          </s-list-item>
          <s-list-item>
            Cada pedido recibe un número único y su enlace de seguimiento, que Shopify incluye en el
            email al cliente.
          </s-list-item>
          <s-list-item>
            La página pública de seguimiento se actualiza sola según los días de entrega
            configurados.
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Instalar en otra tienda">
        <s-paragraph>
          Esta misma app vale para todas tus tiendas. Instálala en cada una y tendrá sus propios
          ajustes, su propia hora aleatoria y su propio historial.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
