import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { ShopSettings } from "@prisma/client";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getOrCreateSettings, parseTagList } from "./settings.server";
import type { SkipReason } from "./shared";
import { errorMessage } from "./errors";
import { adminGraphql, sleep } from "./shopify-graphql.server";
import { estimateDelivery, materializeShipment } from "./transit.server";
import { buildTrackingUrl } from "./tracking";
export type { SkipReason } from "./shared";
import { generateUniqueTrackingNumber } from "./tracking.server";
import { safeTimeZone } from "./time";

/**
 * Motor de preparación de pedidos.
 *
 * Busca los pedidos sin preparar de la tienda, genera un número de seguimiento
 * para cada uno y crea el fulfillment correspondiente en Shopify con su
 * información de seguimiento.
 *
 * Es idempotente: la clave única (shop, orderId) de `Shipment` impide que un
 * mismo pedido se prepare dos veces, aunque la ejecución se solape.
 */

const SHOP_INFO_QUERY = `#graphql
  query EutcShopInfo {
    shop {
      name
      ianaTimezone
      currencyCode
      primaryDomain { url host }
      billingAddress { city countryCodeV2 }
    }
  }
`;

const UNFULFILLED_ORDERS_QUERY = `#graphql
  query EutcUnfulfilledOrders($cursor: String, $query: String) {
    orders(first: 15, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        tags
        email
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        customer { displayName }
        shippingAddress { city zip countryCodeV2 country }
        fulfillmentOrders(first: 10) {
          nodes {
            id
            status
            requestStatus
            supportedActions { action }
            assignedLocation { name }
            lineItems(first: 50) { nodes { id remainingQuantity } }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `#graphql
  mutation EutcFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        createdAt
        trackingInfo { company number url }
      }
      userErrors { field message }
    }
  }
`;

const ORDERS_COUNT_QUERY = `#graphql
  query EutcOrdersCount($query: String) {
    ordersCount(query: $query, limit: 10000) { count precision }
  }
`;

interface ShopInfoResponse {
  shop?: {
    name?: string | null;
    ianaTimezone?: string | null;
    currencyCode?: string | null;
    primaryDomain?: { url?: string | null; host?: string | null } | null;
    billingAddress?: { city?: string | null; countryCodeV2?: string | null } | null;
  } | null;
}

interface UserError {
  field?: string[] | null;
  message: string;
}

interface FulfillmentCreateResponse {
  fulfillmentCreate?: {
    fulfillment?: { id?: string | null } | null;
    userErrors?: UserError[] | null;
  } | null;
}

interface OrdersCountResponse {
  ordersCount?: { count?: number | null; precision?: string | null } | null;
}

export interface ShopInfo {
  name: string;
  ianaTimezone: string;
  currencyCode: string;
  storefrontUrl: string | null;
  originCity: string | null;
}

export async function fetchShopInfo(admin: AdminApiContext): Promise<ShopInfo> {
  const data = await adminGraphql<ShopInfoResponse>(admin, SHOP_INFO_QUERY);
  const shop = data?.shop ?? {};
  const city = shop.billingAddress?.city ?? null;
  const country = shop.billingAddress?.countryCodeV2 ?? null;

  return {
    name: shop.name ?? "",
    ianaTimezone: safeTimeZone(shop.ianaTimezone),
    currencyCode: shop.currencyCode ?? "EUR",
    storefrontUrl: shop.primaryDomain?.url ?? null,
    originCity: city ? (country ? `${city}, ${country}` : city) : null,
  };
}

export interface OrderOutcome {
  orderId: string;
  orderName: string;
  result: "fulfilled" | "skipped" | "failed";
  trackingNumber?: string;
  reason?: SkipReason;
  error?: string;
}

export interface RunResult {
  runLogId: string;
  shop: string;
  trigger: string;
  status: "success" | "partial" | "error" | "skipped";
  ordersFound: number;
  ordersFulfilled: number;
  ordersFailed: number;
  ordersSkipped: number;
  message: string;
  outcomes: OrderOutcome[];
  durationMs: number;
}

/** Evita que dos ejecuciones de la misma tienda se pisen en el mismo proceso. */
const runningShops = new Set<string>();

export function isShopRunning(shop: string): boolean {
  return runningShops.has(shop);
}

function buildOrderSearchQuery(settings: ShopSettings): string {
  const parts = ["status:open", "fulfillment_status:unfulfilled"];
  if (settings.requirePaid) parts.push("financial_status:paid");
  return parts.join(" AND ");
}

interface RawOrder {
  id: string;
  name: string;
  createdAt: string;
  tags: string[];
  email: string | null;
  displayFinancialStatus: string | null;
  currentTotalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  customer?: { displayName?: string } | null;
  shippingAddress?: {
    city?: string | null;
    zip?: string | null;
    countryCodeV2?: string | null;
    country?: string | null;
  } | null;
  fulfillmentOrders: {
    nodes: Array<{
      id: string;
      status: string;
      requestStatus: string | null;
      supportedActions: Array<{ action: string }>;
      assignedLocation?: { name?: string | null } | null;
      lineItems: { nodes: Array<{ id: string; remainingQuantity: number }> };
    }>;
  };
}

interface OrdersResponse {
  orders?: {
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
    nodes?: RawOrder[] | null;
  } | null;
}

async function fetchUnfulfilledOrders(
  admin: AdminApiContext,
  settings: ShopSettings,
  limit: number,
): Promise<RawOrder[]> {
  const searchQuery = buildOrderSearchQuery(settings);
  const orders: RawOrder[] = [];
  let cursor: string | null = null;

  while (orders.length < limit) {
    const data: OrdersResponse = await adminGraphql<OrdersResponse>(
      admin,
      UNFULFILLED_ORDERS_QUERY,
      { cursor, query: searchQuery },
    );
    const connection = data?.orders;
    if (!connection) break;

    orders.push(...(connection.nodes ?? []));

    const nextCursor = connection.pageInfo?.endCursor ?? null;
    if (!connection.pageInfo?.hasNextPage || !nextCursor) break;
    cursor = nextCursor;
  }

  return orders.slice(0, limit);
}

/** Fulfillment orders que realmente se pueden preparar ahora mismo. */
function eligibleFulfillmentOrders(order: RawOrder) {
  return (order.fulfillmentOrders?.nodes ?? []).filter((fulfillmentOrder) => {
    if (fulfillmentOrder.status !== "OPEN") return false;
    const actions = (fulfillmentOrder.supportedActions ?? []).map((a) => a.action);
    if (!actions.includes("CREATE_FULFILLMENT")) return false;
    const remaining = (fulfillmentOrder.lineItems?.nodes ?? []).reduce(
      (total, item) => total + (item.remainingQuantity ?? 0),
      0,
    );
    return remaining > 0;
  });
}

export interface RunOptions {
  shop: string;
  trigger: "scheduled" | "manual" | "cron" | "webhook" | "backfill";
  /** Cliente admin ya autenticado (rutas del panel). Si falta se resuelve solo. */
  admin?: AdminApiContext;
  /** Fuerza la simulación aunque los ajustes digan lo contrario. */
  forceDryRun?: boolean;
  /** Prepara solo estos pedidos (GIDs). Se usa desde la tabla del panel. */
  onlyOrderIds?: string[];
  /** Ignora `automationEnabled`. Lo usan las ejecuciones manuales. */
  ignoreAutomationSwitch?: boolean;
}

/**
 * Ejecuta una tanda de preparación. Devuelve siempre un resumen, incluso
 * cuando falla, para poder mostrarlo en el panel y guardarlo en el historial.
 */
export async function runFulfillmentBatch(options: RunOptions): Promise<RunResult> {
  const { shop, trigger } = options;
  const startedAt = Date.now();

  const runLog = await prisma.runLog.create({
    data: { shop, trigger, status: "running" },
  });

  const finish = async (
    result: Omit<RunResult, "runLogId" | "shop" | "trigger" | "durationMs">,
  ): Promise<RunResult> => {
    const durationMs = Date.now() - startedAt;
    await prisma.runLog.update({
      where: { id: runLog.id },
      data: {
        status: result.status,
        ordersFound: result.ordersFound,
        ordersFulfilled: result.ordersFulfilled,
        ordersFailed: result.ordersFailed,
        ordersSkipped: result.ordersSkipped,
        message: result.message,
        details: JSON.stringify(result.outcomes).slice(0, 100_000),
        finishedAt: new Date(),
        durationMs,
      },
    });
    return { ...result, runLogId: runLog.id, shop, trigger, durationMs };
  };

  if (runningShops.has(shop)) {
    return finish({
      status: "skipped",
      ordersFound: 0,
      ordersFulfilled: 0,
      ordersFailed: 0,
      ordersSkipped: 0,
      message: "Ya había una ejecución en curso para esta tienda.",
      outcomes: [],
    });
  }

  runningShops.add(shop);

  try {
    const settings = await getOrCreateSettings(shop);

    if (!settings.automationEnabled && !options.ignoreAutomationSwitch) {
      return finish({
        status: "skipped",
        ordersFound: 0,
        ordersFulfilled: 0,
        ordersFailed: 0,
        ordersSkipped: 0,
        message: "La automatización está desactivada en los ajustes.",
        outcomes: [],
      });
    }

    const admin = options.admin ?? (await unauthenticated.admin(shop)).admin;
    const shopInfo = await fetchShopInfo(admin);

    // La zona horaria real de la tienda manda sobre el valor por defecto.
    if (shopInfo.ianaTimezone && shopInfo.ianaTimezone !== settings.timezone) {
      await prisma.shopSettings.update({
        where: { shop },
        data: { timezone: shopInfo.ianaTimezone },
      });
      settings.timezone = shopInfo.ianaTimezone;
    }

    const dryRun = options.forceDryRun || settings.dryRun;
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const skipTags = parseTagList(settings.skipTags);
    const onlyTags = parseTagList(settings.onlyTags);
    const minAgeMs = settings.minOrderAgeMinutes * 60_000;
    const now = Date.now();

    let orders = await fetchUnfulfilledOrders(admin, settings, settings.maxOrdersPerRun);

    if (options.onlyOrderIds?.length) {
      const wanted = new Set(options.onlyOrderIds);
      orders = orders.filter((order) => wanted.has(order.id));
    }

    const outcomes: OrderOutcome[] = [];
    let fulfilled = 0;
    let failed = 0;
    let skipped = 0;

    // Reparto de la tanda en el tiempo, para que las marcas horarias no sean
    // todas idénticas. Tope de 30 s por pedido para no eternizar la ejecución.
    const spreadMs = Math.max(0, settings.spreadMinutes) * 60_000;
    const perOrderDelay = orders.length > 1 ? Math.min(30_000, spreadMs / orders.length) : 0;

    for (const [index, order] of orders.entries()) {
      const outcome: OrderOutcome = {
        orderId: order.id,
        orderName: order.name,
        result: "skipped",
      };

      try {
        const existing = await prisma.shipment.findUnique({
          where: { shop_orderId: { shop, orderId: order.id } },
          select: { id: true, trackingNumber: true },
        });
        if (existing) {
          outcome.reason = "already_fulfilled";
          outcome.trackingNumber = existing.trackingNumber;
          skipped += 1;
          outcomes.push(outcome);
          continue;
        }

        const orderTags = (order.tags ?? []).map((tag) => tag.toLowerCase());
        if (skipTags.length && orderTags.some((tag) => skipTags.includes(tag))) {
          outcome.reason = "excluded_by_tag";
          skipped += 1;
          outcomes.push(outcome);
          continue;
        }
        if (onlyTags.length && !orderTags.some((tag) => onlyTags.includes(tag))) {
          outcome.reason = "excluded_by_tag";
          skipped += 1;
          outcomes.push(outcome);
          continue;
        }

        if (minAgeMs > 0 && now - new Date(order.createdAt).getTime() < minAgeMs) {
          outcome.reason = "too_recent";
          skipped += 1;
          outcomes.push(outcome);
          continue;
        }

        if (settings.requirePaid && order.displayFinancialStatus !== "PAID") {
          outcome.reason = "not_paid";
          skipped += 1;
          outcomes.push(outcome);
          continue;
        }

        const fulfillmentOrders = eligibleFulfillmentOrders(order);
        if (!fulfillmentOrders.length) {
          outcome.reason = "no_open_fulfillment_orders";
          skipped += 1;
          outcomes.push(outcome);
          continue;
        }

        const trackingNumber = await generateUniqueTrackingNumber({
          prefix: settings.prefix,
          hubCode: settings.hubCode,
        });
        const trackingUrl = buildTrackingUrl({
          trackingNumber,
          appUrl,
          storefrontUrl: shopInfo.storefrontUrl,
          template: settings.trackingUrlTemplate,
          useStorefrontProxy: settings.useStorefrontProxy,
        });

        const fulfillmentIds: string[] = [];

        if (!dryRun) {
          // Un fulfillment por cada fulfillment order: cada uno puede estar
          // asignado a una ubicación distinta y Shopify no los mezcla.
          for (const fulfillmentOrder of fulfillmentOrders) {
            const data = await adminGraphql<FulfillmentCreateResponse>(admin, FULFILLMENT_CREATE_MUTATION, {
              fulfillment: {
                lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fulfillmentOrder.id }],
                notifyCustomer: settings.notifyCustomer,
                trackingInfo: {
                  company: settings.carrierName,
                  number: trackingNumber,
                  url: trackingUrl,
                },
              },
            });

            const userErrors = data?.fulfillmentCreate?.userErrors ?? [];
            if (userErrors.length) {
              throw new Error(
                userErrors.map((e) => `${(e.field ?? []).join(".")}: ${e.message}`).join(" | "),
              );
            }

            const id = data?.fulfillmentCreate?.fulfillment?.id;
            if (id) fulfillmentIds.push(id);
          }
        }

        const itemCount = fulfillmentOrders.reduce(
          (total, fulfillmentOrder) =>
            total +
            (fulfillmentOrder.lineItems?.nodes ?? []).reduce(
              (sum, item) => sum + (item.remainingQuantity ?? 0),
              0,
            ),
          0,
        );

        const fulfilledAt = new Date();
        const originCity = shopInfo.originCity || settings.originCity;

        const shipment = await prisma.shipment.create({
          data: {
            shop,
            orderId: order.id,
            orderName: order.name,
            orderNumber: Number(order.name.replace(/\D/g, "")) || null,
            trackingNumber,
            trackingUrl,
            carrierName: settings.carrierName,
            status: "pending",
            customerName: order.customer?.displayName ?? null,
            customerEmail: order.email ?? null,
            destinationCity: order.shippingAddress?.city ?? null,
            destinationZip: order.shippingAddress?.zip ?? null,
            destinationCountry: order.shippingAddress?.countryCodeV2 ?? null,
            originCity,
            itemCount,
            totalPrice: order.currentTotalPriceSet?.shopMoney?.amount ?? null,
            currency: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? shopInfo.currencyCode,
            fulfillmentIds: fulfillmentIds.join(","),
            dryRun,
            fulfilledAt,
            estimatedDeliveryAt: estimateDelivery(trackingNumber, fulfilledAt, settings),
          },
        });

        await materializeShipment(shipment, settings);

        outcome.result = "fulfilled";
        outcome.trackingNumber = trackingNumber;
        fulfilled += 1;
        outcomes.push(outcome);
      } catch (error) {
        outcome.result = "failed";
        outcome.error = errorMessage(error).slice(0, 500);
        failed += 1;
        outcomes.push(outcome);
        console.error(`[EUTC] Error preparando ${order.name} de ${shop}:`, error);
      }

      if (perOrderDelay > 0 && index < orders.length - 1) {
        await sleep(perOrderDelay);
      }
    }

    const status: RunResult["status"] =
      failed > 0 ? (fulfilled > 0 ? "partial" : "error") : "success";

    const messageParts = [`${fulfilled} pedido(s) preparado(s)`];
    if (skipped) messageParts.push(`${skipped} omitido(s)`);
    if (failed) messageParts.push(`${failed} con error`);
    if (dryRun) messageParts.push("(modo simulación: no se ha tocado Shopify)");

    return finish({
      status,
      ordersFound: orders.length,
      ordersFulfilled: fulfilled,
      ordersFailed: failed,
      ordersSkipped: skipped,
      message: messageParts.join(" · "),
      outcomes,
    });
  } catch (error) {
    const message = errorMessage(error).slice(0, 1000);
    console.error(`[EUTC] Ejecución fallida en ${shop}:`, error);
    return finish({
      status: "error",
      ordersFound: 0,
      ordersFulfilled: 0,
      ordersFailed: 0,
      ordersSkipped: 0,
      message,
      outcomes: [],
    });
  } finally {
    runningShops.delete(shop);
  }
}

/**
 * Vista previa de los pedidos sin preparar, para la pestaña "Pedidos".
 * No modifica nada.
 */
export async function previewUnfulfilledOrders(
  admin: AdminApiContext,
  shop: string,
  limit = 50,
) {
  const settings = await getOrCreateSettings(shop);
  const orders = await fetchUnfulfilledOrders(admin, settings, limit);

  const existing = await prisma.shipment.findMany({
    where: { shop, orderId: { in: orders.map((order) => order.id) } },
    select: { orderId: true, trackingNumber: true },
  });
  const byOrderId = new Map(existing.map((s) => [s.orderId, s.trackingNumber]));

  return orders.map((order) => ({
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    customer: order.customer?.displayName ?? order.email ?? "—",
    destination: [order.shippingAddress?.city, order.shippingAddress?.countryCodeV2]
      .filter(Boolean)
      .join(", "),
    total: order.currentTotalPriceSet?.shopMoney?.amount ?? null,
    currency: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
    financialStatus: order.displayFinancialStatus ?? "—",
    tags: order.tags ?? [],
    eligible: eligibleFulfillmentOrders(order).length > 0,
    existingTrackingNumber: byOrderId.get(order.id) ?? null,
  }));
}


/**
 * Cuántos pedidos sin preparar hay ahora mismo.
 * Devuelve `null` si la tienda no soporta la consulta, para que el panel
 * pueda seguir funcionando sin el dato.
 */
export async function countUnfulfilledOrders(
  admin: AdminApiContext,
  settings: ShopSettings,
): Promise<number | null> {
  try {
    const data = await adminGraphql<OrdersCountResponse>(admin, ORDERS_COUNT_QUERY, {
      query: buildOrderSearchQuery(settings),
    });
    const count = data?.ordersCount?.count;
    return typeof count === "number" ? count : null;
  } catch (error) {
    console.warn("[EUTC] No se pudo contar los pedidos pendientes:", error);
    return null;
  }
}
