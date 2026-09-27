import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrCreateSettings } from "../lib/settings.server";
import { formatInTimeZone, safeTimeZone } from "../lib/time";
import { formatMoney, statusLabel, statusTone, STATUS_LABELS } from "../lib/shared";
import { gidToId } from "../lib/shopify-graphql.server";

const PAGE_SIZE = 25;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const status = url.searchParams.get("status") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const format = url.searchParams.get("format");

  const settings = await getOrCreateSettings(shop);
  const timeZone = safeTimeZone(settings.timezone);

  const where = {
    shop,
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { trackingNumber: { contains: query.toUpperCase() } },
            { orderName: { contains: query } },
            { customerName: { contains: query } },
            { customerEmail: { contains: query } },
          ],
        }
      : {}),
  };

  // Exportación a CSV de todo lo que coincide con el filtro actual.
  if (format === "csv") {
    const all = await prisma.shipment.findMany({ where, orderBy: { fulfilledAt: "desc" }, take: 10000 });
    const header = [
      "numero_seguimiento",
      "pedido",
      "estado",
      "cliente",
      "email",
      "destino",
      "pais",
      "importe",
      "moneda",
      "preparado",
      "entrega_estimada",
      "url_seguimiento",
    ];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = all.map((s) =>
      [
        s.trackingNumber,
        s.orderName,
        statusLabel(s.status),
        s.customerName,
        s.customerEmail,
        s.destinationCity,
        s.destinationCountry,
        s.totalPrice,
        s.currency,
        formatInTimeZone(s.fulfilledAt, timeZone),
        formatInTimeZone(s.estimatedDeliveryAt, timeZone),
        s.trackingUrl,
      ]
        .map(escape)
        .join(","),
    );
    // BOM para que Excel abra los acentos correctamente.
    const bom = "\uFEFF";
    const csv = `${bom}${header.join(",")}\n${rows.join("\n")}`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="eu-tracker-envios-${Date.now()}.csv"`,
      },
    });
  }

  const [total, shipments] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      orderBy: { fulfilledAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return {
    query,
    status,
    page,
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    shipments: shipments.map((shipment) => ({
      id: shipment.id,
      orderName: shipment.orderName,
      orderId: gidToId(shipment.orderId),
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      status: shipment.status,
      customerName: shipment.customerName,
      customerEmail: shipment.customerEmail,
      destination: [shipment.destinationCity, shipment.destinationCountry].filter(Boolean).join(", "),
      total: shipment.totalPrice,
      currency: shipment.currency,
      dryRun: shipment.dryRun,
      fulfilledAt: formatInTimeZone(shipment.fulfilledAt, timeZone),
      estimatedDeliveryAt: formatInTimeZone(shipment.estimatedDeliveryAt, timeZone, {
        dateStyle: "medium",
        timeStyle: undefined,
      }),
    })),
  };
};

export default function ShipmentsPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const applyFilter = (next: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    setSearchParams(params);
  };

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(page));
    setSearchParams(params);
  };

  const exportUrl = () => {
    const params = new URLSearchParams(searchParams);
    params.set("format", "csv");
    return `/app/shipments?${params.toString()}`;
  };

  return (
    <s-page heading="Envíos">
      <s-button slot="primary-action" onClick={() => navigate(exportUrl())}>
        Exportar CSV
      </s-button>

      <s-section heading={`${data.total} envío(s)`}>
        <s-stack direction="inline" gap="base" alignItems="end">
          {/* La `key` reinicia el campo cuando cambia el filtro de la URL. */}
          <SearchBox
            key={data.query}
            initial={data.query}
            onSearch={(value) => applyFilter({ q: value })}
          />
          <s-select
            label="Estado"
            value={data.status}
            onChange={(event) => applyFilter({ status: event.currentTarget.value })}
          >
            <s-option value="">Todos</s-option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <s-option key={value} value={value}>
                {label}
              </s-option>
            ))}
          </s-select>
        </s-stack>

        {data.shipments.length === 0 ? (
          <s-box padding="large-100">
            <s-stack direction="block" gap="small-200" alignItems="center">
              <s-heading>Sin resultados</s-heading>
              <s-paragraph>No hay envíos que coincidan con este filtro.</s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table
            variant="auto"
            paginate
            {...(data.page > 1 ? { hasPreviousPage: true } : {})}
            {...(data.page < data.pageCount ? { hasNextPage: true } : {})}
            onNextPage={() => goToPage(data.page + 1)}
            onPreviousPage={() => goToPage(data.page - 1)}
          >
            <s-table-header-row>
              <s-table-header listSlot="primary">Seguimiento</s-table-header>
              <s-table-header listSlot="kicker">Pedido</s-table-header>
              <s-table-header listSlot="secondary">Cliente</s-table-header>
              <s-table-header>Destino</s-table-header>
              <s-table-header format="currency">Importe</s-table-header>
              <s-table-header listSlot="inline">Estado</s-table-header>
              <s-table-header>Preparado</s-table-header>
              <s-table-header>Entrega estimada</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.shipments.map((shipment) => (
                <s-table-row key={shipment.id}>
                  <s-table-cell>
                    <s-link href={shipment.trackingUrl} target="_blank">
                      <s-text fontVariantNumeric="tabular-nums">{shipment.trackingNumber}</s-text>
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={`shopify://admin/orders/${shipment.orderId}`}>
                      {shipment.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{shipment.customerName ?? shipment.customerEmail ?? "—"}</s-table-cell>
                  <s-table-cell>{shipment.destination || "—"}</s-table-cell>
                  <s-table-cell>{formatMoney(shipment.total, shipment.currency)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={statusTone(shipment.status)}>{statusLabel(shipment.status)}</s-badge>
                    {shipment.dryRun && <s-badge tone="neutral">simulado</s-badge>}
                  </s-table-cell>
                  <s-table-cell>{shipment.fulfilledAt}</s-table-cell>
                  <s-table-cell>{shipment.estimatedDeliveryAt}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

function SearchBox({
  initial,
  onSearch,
}: {
  initial: string;
  onSearch: (value: string) => void;
}) {
  const [term, setTerm] = useState(initial);

  return (
    <s-search-field
      label="Buscar"
      placeholder="Número de seguimiento, pedido, cliente o email"
      value={term}
      onInput={(event) => setTerm(event.currentTarget.value)}
      onChange={(event) => onSearch(event.currentTarget.value)}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
