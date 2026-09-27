import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { countUnfulfilledOrders, runFulfillmentBatch } from "../lib/fulfillment.server";
import { getOrCreateSettings } from "../lib/settings.server";
import { rescheduleShop } from "../lib/scheduler.server";
import { atZonedTime, formatInTimeZone, safeTimeZone } from "../lib/time";
import { formatMoney, relativeTime, statusLabel, statusTone } from "../lib/shared";
import { gidToId } from "../lib/shopify-graphql.server";
import { buildTrackingUrl } from "../lib/tracking";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await getOrCreateSettings(shop);
  const timeZone = safeTimeZone(settings.timezone);
  const now = new Date();
  const startOfToday = atZonedTime(now, timeZone, 0, 0, 0);

  const [total, today, inTransit, delivered, recent, lastRun, pendingOrders] = await Promise.all([
    prisma.shipment.count({ where: { shop } }),
    prisma.shipment.count({ where: { shop, fulfilledAt: { gte: startOfToday } } }),
    prisma.shipment.count({ where: { shop, status: { in: ["pending", "in_transit", "out_for_delivery"] } } }),
    prisma.shipment.count({ where: { shop, status: "delivered" } }),
    prisma.shipment.findMany({
      where: { shop },
      orderBy: { fulfilledAt: "desc" },
      take: 6,
    }),
    prisma.runLog.findFirst({ where: { shop }, orderBy: { startedAt: "desc" } }),
    countUnfulfilledOrders(admin, settings),
  ]);

  const sampleUrl = buildTrackingUrl({
    trackingNumber: "EU776017541338896466",
    appUrl: process.env.SHOPIFY_APP_URL || "",
    storefrontUrl: `https://${shop}`,
    template: settings.trackingUrlTemplate,
    useStorefrontProxy: settings.useStorefrontProxy,
  });

  return {
    shop,
    timeZone,
    settings: {
      automationEnabled: settings.automationEnabled,
      dryRun: settings.dryRun,
      notifyCustomer: settings.notifyCustomer,
      carrierName: settings.carrierName,
      windowStartHour: settings.windowStartHour,
      windowEndHour: settings.windowEndHour,
      prefix: settings.prefix,
      hubCode: settings.hubCode,
    },
    nextRunAt: settings.nextRunAt?.toISOString() ?? null,
    nextRunLabel: settings.nextRunAt ? formatInTimeZone(settings.nextRunAt, timeZone) : null,
    lastRunAt: settings.lastRunAt?.toISOString() ?? null,
    stats: { total, today, inTransit, delivered, pendingOrders },
    sampleUrl,
    lastRun: lastRun
      ? {
          status: lastRun.status,
          message: lastRun.message,
          startedAt: lastRun.startedAt.toISOString(),
          ordersFulfilled: lastRun.ordersFulfilled,
          ordersFailed: lastRun.ordersFailed,
        }
      : null,
    recent: recent.map((shipment) => ({
      id: shipment.id,
      orderName: shipment.orderName,
      orderId: gidToId(shipment.orderId),
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      status: shipment.status,
      customerName: shipment.customerName,
      destination: [shipment.destinationCity, shipment.destinationCountry].filter(Boolean).join(", "),
      total: shipment.totalPrice,
      currency: shipment.currency,
      fulfilledAt: formatInTimeZone(shipment.fulfilledAt, timeZone),
      dryRun: shipment.dryRun,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "run-now") {
    const result = await runFulfillmentBatch({
      shop,
      trigger: "manual",
      admin,
      ignoreAutomationSwitch: true,
    });
    return { ok: result.status !== "error", intent, message: result.message };
  }

  if (intent === "toggle-automation") {
    const settings = await getOrCreateSettings(shop);
    const automationEnabled = !settings.automationEnabled;
    await prisma.shopSettings.update({
      where: { shop },
      data: { automationEnabled, nextRunAt: null },
    });
    if (automationEnabled) await rescheduleShop(shop);
    return {
      ok: true,
      intent,
      message: automationEnabled
        ? "Automatización activada. Se ha programado la próxima ejecución."
        : "Automatización desactivada.",
    };
  }

  if (intent === "reschedule") {
    const updated = await rescheduleShop(shop);
    return {
      ok: true,
      intent,
      message: updated?.nextRunAt
        ? "Nueva hora aleatoria asignada."
        : "Activa la automatización para programar una ejecución.",
    };
  }

  return { ok: false, intent, message: "Acción desconocida." };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const submit = (intent: string) => fetcher.submit({ intent }, { method: "POST" });

  const windowLabel = `${String(data.settings.windowStartHour).padStart(2, "0")}:00 – ${String(
    data.settings.windowEndHour,
  ).padStart(2, "0")}:00`;

  return (
    <s-page heading="EU TRACKER COURIER">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => submit("run-now")}
        {...(busy ? { loading: true } : {})}
      >
        Preparar pedidos ahora
      </s-button>
      <s-button slot="secondary-actions" href="/app/settings">
        Ajustes
      </s-button>

      {!data.settings.automationEnabled && (
        <s-banner tone="warning" heading="La automatización está desactivada">
          <s-paragraph>
            Ahora mismo no se prepara ningún pedido de forma automática. Actívala para que la app
            trabaje sola cada madrugada.
          </s-paragraph>
          <s-button slot="primary-action" onClick={() => submit("toggle-automation")}>
            Activar automatización
          </s-button>
        </s-banner>
      )}

      {data.settings.dryRun && (
        <s-banner tone="info" heading="Modo simulación activo">
          <s-paragraph>
            Se generan números de seguimiento y se registra todo, pero <s-text type="strong">no</s-text>{" "}
            se prepara nada en Shopify. Desactívalo en Ajustes cuando quieras ir en serio.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="Resumen">
        <s-paragraph>
          Tienda <s-text type="strong">{data.shop}</s-text> · zona horaria {data.timeZone}
        </s-paragraph>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <StatCard label="Pendientes de preparar" value={data.stats.pendingOrders ?? "—"} tone="warning" />
          <StatCard label="Preparados hoy" value={data.stats.today} tone="success" />
          <StatCard label="En tránsito" value={data.stats.inTransit} tone="info" />
          <StatCard label="Entregados" value={data.stats.delivered} tone="neutral" />
          <StatCard label="Envíos totales" value={data.stats.total} tone="neutral" />
        </s-grid>
      </s-section>

      <s-section heading="Últimos envíos">
        {data.recent.length === 0 ? (
          <s-box padding="large-100">
            <s-stack direction="block" gap="small-200" alignItems="center">
              <s-heading>Todavía no hay envíos</s-heading>
              <s-paragraph>
                Pulsa «Preparar pedidos ahora» para procesar los pedidos que ya tienes, o espera a la
                próxima ejecución automática.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Pedido</s-table-header>
              <s-table-header listSlot="kicker">Seguimiento</s-table-header>
              <s-table-header listSlot="secondary">Cliente</s-table-header>
              <s-table-header>Destino</s-table-header>
              <s-table-header format="currency">Importe</s-table-header>
              <s-table-header listSlot="inline">Estado</s-table-header>
              <s-table-header>Preparado</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.recent.map((shipment) => (
                <s-table-row key={shipment.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${shipment.orderId}`}>
                      {shipment.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text fontVariantNumeric="tabular-nums">{shipment.trackingNumber}</s-text>
                  </s-table-cell>
                  <s-table-cell>{shipment.customerName ?? "—"}</s-table-cell>
                  <s-table-cell>{shipment.destination || "—"}</s-table-cell>
                  <s-table-cell>{formatMoney(shipment.total, shipment.currency)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusTone(shipment.status)}>{statusLabel(shipment.status)}</s-badge>
                    {shipment.dryRun && <s-badge tone="neutral">simulado</s-badge>}
                  </s-table-cell>
                  <s-table-cell>{shipment.fulfilledAt}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        <s-button slot="primary-action" href="/app/shipments" variant="tertiary">
          Ver todos
        </s-button>
      </s-section>

      <s-section slot="aside" heading="Próxima ejecución automática">
        <s-stack direction="block" gap="small-100">
          <s-heading>{data.nextRunLabel ?? "Sin programar"}</s-heading>
          <s-text color="subdued">
            {data.nextRunAt ? relativeTime(data.nextRunAt) : "Activa la automatización para programarla"}
          </s-text>
          <s-divider />
          <s-paragraph>
            Cada día se elige una hora <s-text type="strong">al azar</s-text> dentro de la ventana{" "}
            {windowLabel} ({data.timeZone}).
          </s-paragraph>
          <s-stack direction="inline" gap="small-100">
            <s-button onClick={() => submit("reschedule")} variant="tertiary">
              Sortear otra hora
            </s-button>
            <s-button onClick={() => submit("toggle-automation")} variant="tertiary">
              {data.settings.automationEnabled ? "Desactivar" : "Activar"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Última ejecución">
        {data.lastRun ? (
          <s-stack direction="block" gap="small-100">
            <s-badge tone={data.lastRun.status === "error" ? "critical" : data.lastRun.status === "partial" ? "warning" : "success"}>
              {data.lastRun.status === "success"
                ? "Correcta"
                : data.lastRun.status === "partial"
                  ? "Con incidencias"
                  : data.lastRun.status === "error"
                    ? "Error"
                    : "Omitida"}
            </s-badge>
            <s-paragraph>{data.lastRun.message ?? "—"}</s-paragraph>
            <s-text color="subdued">{relativeTime(data.lastRun.startedAt)}</s-text>
            <s-link href="/app/logs">Ver historial completo</s-link>
          </s-stack>
        ) : (
          <s-paragraph>Todavía no se ha ejecutado ninguna preparación.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Seguimiento para tus clientes">
        <s-stack direction="block" gap="small-100">
          <s-paragraph>Así queda el enlace que recibe el cliente:</s-paragraph>
          <s-box padding="small-200" background="subdued" borderRadius="base" borderWidth="base">
            <s-text fontVariantNumeric="tabular-nums" color="subdued">
              {data.sampleUrl}
            </s-text>
          </s-box>
          <s-paragraph>
            Transportista: <s-text type="strong">{data.settings.carrierName}</s-text>
          </s-paragraph>
          <s-paragraph>
            Formato del número: {data.settings.prefix}
            {data.settings.hubCode}··········CC
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "info" | "success" | "warning" | "neutral";
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="small-400">
        <s-text color="subdued">{label}</s-text>
        <s-text type="strong" tone={tone} fontVariantNumeric="tabular-nums">
          <s-heading>{value}</s-heading>
        </s-text>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
