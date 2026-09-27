import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrCreateSettings } from "../lib/settings.server";
import { formatInTimeZone, safeTimeZone } from "../lib/time";
import { RUN_STATUS_LABELS, skipReasonLabel, TRIGGER_LABELS } from "../lib/shared";
import type { OrderOutcome } from "../lib/fulfillment.server";

const PAGE_SIZE = 20;

function runTone(status: string): "success" | "warning" | "critical" | "neutral" | "info" {
  if (status === "success") return "success";
  if (status === "partial") return "warning";
  if (status === "error") return "critical";
  if (status === "running") return "info";
  return "neutral";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const expandedId = url.searchParams.get("run");

  const settings = await getOrCreateSettings(shop);
  const timeZone = safeTimeZone(settings.timezone);

  const [total, runs] = await Promise.all([
    prisma.runLog.count({ where: { shop } }),
    prisma.runLog.findMany({
      where: { shop },
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const expanded = runs.find((run) => run.id === expandedId);
  let outcomes: OrderOutcome[] = [];
  if (expanded?.details) {
    try {
      outcomes = JSON.parse(expanded.details) as OrderOutcome[];
    } catch {
      outcomes = [];
    }
  }

  return {
    page,
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    expandedId,
    outcomes: outcomes.map((outcome) => ({
      ...outcome,
      reasonLabel: outcome.reason ? skipReasonLabel(outcome.reason) : null,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      trigger: TRIGGER_LABELS[run.trigger] ?? run.trigger,
      status: run.status,
      statusLabel: RUN_STATUS_LABELS[run.status] ?? run.status,
      message: run.message,
      ordersFound: run.ordersFound,
      ordersFulfilled: run.ordersFulfilled,
      ordersSkipped: run.ordersSkipped,
      ordersFailed: run.ordersFailed,
      startedAt: formatInTimeZone(run.startedAt, timeZone),
      duration: run.durationMs ? `${(run.durationMs / 1000).toFixed(1)} s` : "—",
    })),
  };
};

export default function LogsPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params);
  };

  return (
    <s-page heading="Historial de ejecuciones">
      <s-section heading={`${data.total} ejecución(es) registradas`}>
        <s-paragraph>
          Cada línea es una tanda de preparación: la automática de cada madrugada, las que lanzas a
          mano y las que llegan desde un cron externo. Pulsa una fila para ver el detalle pedido a
          pedido.
        </s-paragraph>

        {data.runs.length === 0 ? (
          <s-box padding="large-100">
            <s-stack direction="block" gap="small-200" alignItems="center">
              <s-heading>Todavía no hay ejecuciones</s-heading>
              <s-paragraph>Aparecerán aquí en cuanto la app prepare su primer pedido.</s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table
            variant="auto"
            paginate
            {...(data.page > 1 ? { hasPreviousPage: true } : {})}
            {...(data.page < data.pageCount ? { hasNextPage: true } : {})}
            onNextPage={() => setParam("page", String(data.page + 1))}
            onPreviousPage={() => setParam("page", String(data.page - 1))}
          >
            <s-table-header-row>
              <s-table-header listSlot="primary">Fecha</s-table-header>
              <s-table-header listSlot="kicker">Origen</s-table-header>
              <s-table-header listSlot="inline">Resultado</s-table-header>
              <s-table-header format="numeric">Preparados</s-table-header>
              <s-table-header format="numeric">Omitidos</s-table-header>
              <s-table-header format="numeric">Errores</s-table-header>
              <s-table-header>Duración</s-table-header>
              <s-table-header listSlot="secondary">Mensaje</s-table-header>
              <s-table-header>Detalle</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.runs.map((run) => (
                <s-table-row key={run.id}>
                  <s-table-cell>{run.startedAt}</s-table-cell>
                  <s-table-cell>{run.trigger}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={runTone(run.status)}>{run.statusLabel}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{run.ordersFulfilled}</s-table-cell>
                  <s-table-cell>{run.ordersSkipped}</s-table-cell>
                  <s-table-cell>{run.ordersFailed}</s-table-cell>
                  <s-table-cell>{run.duration}</s-table-cell>
                  <s-table-cell>{run.message ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      onClick={() => setParam("run", data.expandedId === run.id ? null : run.id)}
                    >
                      {data.expandedId === run.id ? "Ocultar" : "Ver"}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {data.expandedId && (
        <s-section heading="Detalle de la ejecución">
          {data.outcomes.length === 0 ? (
            <s-paragraph>Esta ejecución no procesó ningún pedido.</s-paragraph>
          ) : (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header listSlot="primary">Pedido</s-table-header>
                <s-table-header listSlot="inline">Resultado</s-table-header>
                <s-table-header listSlot="secondary">Seguimiento</s-table-header>
                <s-table-header>Motivo / error</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.outcomes.map((outcome) => (
                  <s-table-row key={`${outcome.orderId}-${outcome.result}`}>
                    <s-table-cell>{outcome.orderName}</s-table-cell>
                    <s-table-cell>
                      <s-badge
                        tone={
                          outcome.result === "fulfilled"
                            ? "success"
                            : outcome.result === "failed"
                              ? "critical"
                              : "neutral"
                        }
                      >
                        {outcome.result === "fulfilled"
                          ? "Preparado"
                          : outcome.result === "failed"
                            ? "Error"
                            : "Omitido"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text fontVariantNumeric="tabular-nums">
                        {outcome.trackingNumber ?? "—"}
                      </s-text>
                    </s-table-cell>
                    <s-table-cell>{outcome.error ?? outcome.reasonLabel ?? "—"}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
