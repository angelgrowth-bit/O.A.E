import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { previewUnfulfilledOrders, runFulfillmentBatch } from "../lib/fulfillment.server";
import { getOrCreateSettings } from "../lib/settings.server";
import { formatInTimeZone, safeTimeZone } from "../lib/time";
import { formatMoney } from "../lib/shared";
import { gidToId } from "../lib/shopify-graphql.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await getOrCreateSettings(shop);
  const timeZone = safeTimeZone(settings.timezone);
  const orders = await previewUnfulfilledOrders(admin, shop, 100);

  return {
    dryRun: settings.dryRun,
    notifyCustomer: settings.notifyCustomer,
    orders: orders.map((order) => ({
      ...order,
      legacyId: gidToId(order.id),
      createdAtLabel: formatInTimeZone(order.createdAt, timeZone),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const orderIds = formData.getAll("orderId").map(String).filter(Boolean);

  const result = await runFulfillmentBatch({
    shop: session.shop,
    trigger: "manual",
    admin,
    ignoreAutomationSwitch: true,
    forceDryRun: intent === "simulate",
    onlyOrderIds: orderIds.length ? orderIds : undefined,
  });

  return { ok: result.status !== "error", message: result.message };
};

export default function OrdersPage() {
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

  const pending = data.orders.filter((order) => !order.existingTrackingNumber);

  const fulfillAll = (intent: "fulfill" | "simulate") => fetcher.submit({ intent }, { method: "POST" });

  const fulfillOne = (orderId: string) =>
    fetcher.submit({ intent: "fulfill", orderId }, { method: "POST" });

  return (
    <s-page heading="Pedidos pendientes de preparar">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => fulfillAll("fulfill")}
        {...(busy || pending.length === 0 ? { disabled: true } : {})}
        {...(busy ? { loading: true } : {})}
      >
        Preparar los {pending.length} pedidos
      </s-button>
      <s-button slot="secondary-actions" onClick={() => fulfillAll("simulate")} {...(busy ? { disabled: true } : {})}>
        Simular sin tocar Shopify
      </s-button>

      {data.dryRun && (
        <s-banner tone="info" heading="Modo simulación activo">
          <s-paragraph>
            Mientras el modo simulación esté activo en Ajustes, ningún botón de esta página modificará
            tus pedidos reales.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading={`${pending.length} pedido(s) sin preparar`}>
        <s-paragraph>
          Aquí aparecen los pedidos abiertos y sin preparar que ya tienes en la tienda, incluidos los
          antiguos. La ejecución automática nocturna procesa esta misma lista.
          {data.notifyCustomer
            ? " Al prepararlos, Shopify enviará el email de confirmación de envío al cliente."
            : " El email de confirmación de envío está desactivado en Ajustes."}
        </s-paragraph>

        {data.orders.length === 0 ? (
          <s-box padding="large-100">
            <s-stack direction="block" gap="small-200" alignItems="center">
              <s-heading>No hay pedidos pendientes</s-heading>
              <s-paragraph>Todos los pedidos de la tienda están preparados.</s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Pedido</s-table-header>
              <s-table-header listSlot="secondary">Cliente</s-table-header>
              <s-table-header>Destino</s-table-header>
              <s-table-header format="currency">Importe</s-table-header>
              <s-table-header listSlot="inline">Pago</s-table-header>
              <s-table-header>Creado</s-table-header>
              <s-table-header>Acción</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.orders.map((order) => (
                <s-table-row key={order.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${order.legacyId}`}>{order.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>{order.customer}</s-table-cell>
                  <s-table-cell>{order.destination || "—"}</s-table-cell>
                  <s-table-cell>{formatMoney(order.total, order.currency)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={order.financialStatus === "PAID" ? "success" : "warning"}>
                      {order.financialStatus === "PAID" ? "Pagado" : order.financialStatus}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{order.createdAtLabel}</s-table-cell>
                  <s-table-cell>
                    {order.existingTrackingNumber ? (
                      <s-text color="subdued" fontVariantNumeric="tabular-nums">
                        {order.existingTrackingNumber}
                      </s-text>
                    ) : order.eligible ? (
                      <s-button
                        variant="tertiary"
                        onClick={() => fulfillOne(order.id)}
                        {...(busy ? { disabled: true } : {})}
                      >
                        Preparar
                      </s-button>
                    ) : (
                      <s-badge tone="neutral">No preparable</s-badge>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
