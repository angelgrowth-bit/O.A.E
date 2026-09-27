/**
 * Crea un envío de ejemplo para poder ver la página pública de seguimiento
 * sin necesidad de conectar una tienda real.
 *
 *   npm run seed:demo
 */
import prisma from "../app/db.server";
import { getOrCreateSettings } from "../app/lib/settings.server";
import { estimateDelivery, materializeShipment } from "../app/lib/transit.server";
import { REFERENCE_NUMBER } from "../app/lib/tracking";

const DEMO_SHOP = "demo.myshopify.com";

async function main() {
  const settings = await getOrCreateSettings(DEMO_SHOP);
  const fulfilledAt = new Date(Date.now() - 36 * 60 * 60 * 1000);

  await prisma.shipment.deleteMany({ where: { trackingNumber: REFERENCE_NUMBER } });

  const shipment = await prisma.shipment.create({
    data: {
      shop: DEMO_SHOP,
      orderId: "gid://shopify/Order/demo",
      orderName: "#1001",
      trackingNumber: REFERENCE_NUMBER,
      trackingUrl: `/track?number=${REFERENCE_NUMBER}`,
      carrierName: settings.carrierName,
      customerName: "Cliente de ejemplo",
      originCity: "Madrid, ES",
      destinationCity: "Barcelona",
      destinationCountry: "ES",
      itemCount: 2,
      totalPrice: "49.90",
      currency: "EUR",
      fulfilledAt,
      estimatedDeliveryAt: estimateDelivery(REFERENCE_NUMBER, fulfilledAt, settings),
    },
  });

  await materializeShipment(shipment, settings);
  console.log(`Envío de ejemplo creado: ${REFERENCE_NUMBER}`);
  console.log(`Ábrelo en: http://localhost:3000/track?number=${REFERENCE_NUMBER}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
