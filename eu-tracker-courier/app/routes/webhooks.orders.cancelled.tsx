import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/**
 * Pedido cancelado: se marca el envío como incidencia y se añade un hito
 * visible en la página de seguimiento del cliente.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, payload } = await authenticate.webhook(request);
  if (!session) return new Response();

  const orderId = (payload as { admin_graphql_api_id?: string })?.admin_graphql_api_id;
  if (!orderId) return new Response();

  const shipment = await prisma.shipment.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });
  if (!shipment || shipment.status === "delivered") return new Response();

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { status: "exception" },
  });

  await prisma.trackingEvent.upsert({
    where: { shipmentId_code: { shipmentId: shipment.id, code: "cancelled" } },
    create: {
      shipmentId: shipment.id,
      code: "cancelled",
      title: "Envío cancelado",
      detail: "El pedido asociado a este envío se ha cancelado.",
      location: shipment.originCity,
      occurredAt: new Date(),
    },
    update: {},
  });

  console.log(`[EUTC] Envío ${shipment.trackingNumber} marcado como cancelado (${shop}).`);
  return new Response();
};
