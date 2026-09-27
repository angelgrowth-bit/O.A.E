/**
 * Prueba de humo de la lógica propia de EU TRACKER COURIER.
 *
 *   npm run selftest
 *
 * No necesita Shopify: comprueba la ventana horaria aleatoria, el formato de
 * los números de seguimiento y el recorrido simulado de los envíos contra la
 * base de datos local.
 */
import prisma from "../app/db.server";
import {
  buildTrackingNumber,
  buildTrackingUrl,
  hasValidChecksum,
  isValidTrackingFormat,
  prettyTrackingNumber,
  REFERENCE_NUMBER,
  sanitizeHubCode,
  sanitizePrefix,
} from "../app/lib/tracking";
import { generateUniqueTrackingNumber } from "../app/lib/tracking.server";
import { computeNextRunAt, getZonedParts, zonedTimeToUtc, addBusinessDays } from "../app/lib/time";
import { estimateDelivery, materializeShipment, planTimeline } from "../app/lib/transit.server";
import { getOrCreateSettings, updateSettings } from "../app/lib/settings.server";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, extra = "") {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${extra ? ` → ${extra}` : ""}`);
  }
}

const TEST_SHOP = "eutc-selftest.myshopify.com";

async function testWindow() {
  const zones = ["Europe/Madrid", "America/New_York", "Asia/Tokyo", "UTC", "Australia/Sydney"];

  for (const timeZone of zones) {
    for (let i = 0; i < 400; i += 1) {
      // Un instante cualquiera del próximo año, incluidos cambios de hora.
      const from = new Date(Date.UTC(2026, 0, 1) + Math.random() * 365 * 24 * 3600 * 1000);
      const next = computeNextRunAt({ timeZone, startHour: 2, endHour: 7 }, from);
      const parts = getZonedParts(next, timeZone);

      check(
        `ventana 02-07 en ${timeZone}`,
        parts.hour >= 2 && parts.hour < 7,
        `obtenido ${parts.hour}:${parts.minute} desde ${from.toISOString()}`,
      );
      check(
        `la próxima ejecución es futura (${timeZone})`,
        next.getTime() > from.getTime(),
        `${next.toISOString()} <= ${from.toISOString()}`,
      );
      check(
        `se ejecuta dentro de 24 h (${timeZone})`,
        next.getTime() - from.getTime() <= 24 * 3600 * 1000 + 1000,
      );
    }
  }

  // Ventana que cruza la medianoche: 22:00 → 06:00
  for (let i = 0; i < 300; i += 1) {
    const from = new Date(Date.UTC(2026, 5, 1) + Math.random() * 120 * 24 * 3600 * 1000);
    const next = computeNextRunAt({ timeZone: "Europe/Madrid", startHour: 22, endHour: 6 }, from);
    const hour = getZonedParts(next, "Europe/Madrid").hour;
    check("ventana nocturna 22-06", hour >= 22 || hour < 6, `obtenido ${hour}`);
  }

  // Reparto uniforme: no siempre la misma hora.
  const hours = new Set<number>();
  const base = new Date("2026-03-15T12:00:00Z");
  for (let i = 0; i < 200; i += 1) {
    hours.add(
      getZonedParts(
        computeNextRunAt({ timeZone: "Europe/Madrid", startHour: 2, endHour: 7 }, base),
        "Europe/Madrid",
      ).hour,
    );
  }
  check("la hora es realmente aleatoria", hours.size >= 4, `horas distintas: ${[...hours].join(",")}`);

  // Cambio de hora de primavera en Madrid (29 de marzo de 2026, 02:00 → 03:00).
  const dstNight = zonedTimeToUtc("Europe/Madrid", 2026, 3, 28, 23, 0, 0);
  const dstRun = computeNextRunAt({ timeZone: "Europe/Madrid", startHour: 2, endHour: 7 }, dstNight);
  const dstHour = getZonedParts(dstRun, "Europe/Madrid").hour;
  check("el cambio de hora no rompe la ventana", dstHour >= 2 && dstHour < 7, `obtenido ${dstHour}`);

  // Días hábiles: nunca cae en fin de semana.
  const friday = zonedTimeToUtc("Europe/Madrid", 2026, 4, 10, 10, 0, 0);
  const plusTwo = addBusinessDays(friday, "Europe/Madrid", 2);
  const weekday = getZonedParts(plusTwo, "Europe/Madrid").weekday;
  check("addBusinessDays salta el fin de semana", weekday === 2, `día de la semana ${weekday}`);
}

async function testTrackingNumbers() {
  check("el número de referencia tiene formato válido", isValidTrackingFormat(REFERENCE_NUMBER));
  check("formato legible", prettyTrackingNumber(REFERENCE_NUMBER) === "EU 776017 5413388964 66");
  check("prefijo saneado", sanitizePrefix("e9u") === "EU", sanitizePrefix("e9u"));
  check("código de centro saneado", sanitizeHubCode("12ab34") === "776017", sanitizeHubCode("12ab34"));
  check("dígitos de control correctos", hasValidChecksum(buildTrackingNumber("EU", "776017", "5413388964")));
  check("detecta un número manipulado", !hasValidChecksum("EU776017541338896400"));

  const generated = new Set<string>();
  for (let i = 0; i < 300; i += 1) {
    const number = await generateUniqueTrackingNumber({ prefix: "EU", hubCode: "776017" });
    check("formato del número generado", /^EU\d{18}$/.test(number), number);
    check("checksum del número generado", hasValidChecksum(number), number);
    check("el número empieza por el código de centro", number.startsWith("EU776017"), number);
    generated.add(number);
  }
  check("los 300 números son únicos", generated.size === 300, `únicos: ${generated.size}`);

  check(
    "URL por proxy de tienda",
    buildTrackingUrl({
      trackingNumber: REFERENCE_NUMBER,
      appUrl: "https://app.test",
      storefrontUrl: "https://mitienda.com/",
      useStorefrontProxy: true,
    }) === `https://mitienda.com/apps/eu-tracker?number=${REFERENCE_NUMBER}`,
  );
  check(
    "URL por dominio de la app",
    buildTrackingUrl({
      trackingNumber: REFERENCE_NUMBER,
      appUrl: "https://app.test/",
      storefrontUrl: "https://mitienda.com",
      useStorefrontProxy: false,
    }) === `https://app.test/track?number=${REFERENCE_NUMBER}`,
  );
  check(
    "plantilla personalizada",
    buildTrackingUrl({
      trackingNumber: REFERENCE_NUMBER,
      appUrl: "https://app.test",
      template: "https://track.mio.com/?n={{number}}",
    }) === `https://track.mio.com/?n=${REFERENCE_NUMBER}`,
  );
}

async function testSettings() {
  await getOrCreateSettings(TEST_SHOP);

  const saved = await updateSettings(TEST_SHOP, {
    windowStartHour: 3,
    windowEndHour: 3, // inválido: debe corregirse solo
    transitDaysMin: 8,
    transitDaysMax: 2, // menor que el mínimo: debe subirse
    prefix: "xy1",
    hubCode: "99",
    spreadMinutes: 500,
    skipTags: " Regalo , , urgente ",
    timezone: "Zona/Inventada",
  });

  check("ventana de longitud cero corregida", saved.windowEndHour !== saved.windowStartHour);
  check("días de tránsito coherentes", saved.transitDaysMax >= saved.transitDaysMin);
  check("prefijo normalizado", saved.prefix === "XY", saved.prefix);
  check("código de centro con respaldo", saved.hubCode === "776017", saved.hubCode);
  check("minutos de reparto acotados", saved.spreadMinutes <= 60, String(saved.spreadMinutes));
  check("etiquetas limpias", saved.skipTags === "Regalo, urgente", saved.skipTags);
  check("zona horaria inválida sustituida", saved.timezone === "Europe/Madrid", saved.timezone);

  await updateSettings(TEST_SHOP, {
    windowStartHour: 2,
    windowEndHour: 7,
    timezone: "Europe/Madrid",
    transitDaysMin: 2,
    transitDaysMax: 4,
    prefix: "EU",
    hubCode: "776017",
  });
}

async function testTransit() {
  const settings = await getOrCreateSettings(TEST_SHOP);
  const fulfilledAt = new Date("2026-04-06T04:12:00Z"); // lunes de madrugada
  const trackingNumber = await generateUniqueTrackingNumber({ prefix: "EU", hubCode: "776017" });

  const shipment = await prisma.shipment.create({
    data: {
      shop: TEST_SHOP,
      orderId: `gid://shopify/Order/${Date.now()}`,
      orderName: "#TEST",
      trackingNumber,
      trackingUrl: `https://app.test/track?number=${trackingNumber}`,
      carrierName: settings.carrierName,
      originCity: "Madrid, ES",
      destinationCity: "Lisboa",
      destinationCountry: "PT",
      itemCount: 2,
      fulfilledAt,
      estimatedDeliveryAt: estimateDelivery(trackingNumber, fulfilledAt, settings),
    },
  });

  const timeline = planTimeline(shipment, settings);
  check("el recorrido tiene hitos", timeline.length >= 5, String(timeline.length));
  check("empieza por el registro", timeline[0].code === "registered", timeline[0].code);
  check("termina con la entrega", timeline.at(-1)!.code === "delivered", String(timeline.at(-1)?.code));
  check(
    "envío internacional pasa por aduanas",
    timeline.some((step) => step.code === "customs"),
  );
  for (let i = 1; i < timeline.length; i += 1) {
    check(
      "los hitos van en orden cronológico",
      timeline[i].occurredAt.getTime() > timeline[i - 1].occurredAt.getTime(),
      `${timeline[i - 1].code} → ${timeline[i].code}`,
    );
  }

  // El recorrido es determinista: dos cálculos dan lo mismo.
  const again = planTimeline(shipment, settings);
  check(
    "el recorrido es determinista",
    JSON.stringify(timeline) === JSON.stringify(again),
  );

  // Avance en el tiempo: el estado tiene que progresar y no retroceder nunca.
  const eta = shipment.estimatedDeliveryAt!;
  const checkpoints: Array<[string, Date]> = [
    ["recién preparado", new Date(fulfilledAt.getTime() + 30 * 60_000)],
    ["a mitad de camino", new Date((fulfilledAt.getTime() + eta.getTime()) / 2)],
    ["el día de entrega", new Date(eta.getTime() + 60_000)],
    ["una semana después", new Date(eta.getTime() + 7 * 24 * 3600_000)],
  ];

  const order = ["pending", "in_transit", "out_for_delivery", "delivered"];
  let previousRank = -1;
  for (const [label, when] of checkpoints) {
    const { shipment: updated, events } = await materializeShipment(shipment, settings, when);
    const rank = order.indexOf(updated.status);
    check(`estado conocido (${label})`, rank >= 0, updated.status);
    check(`el estado no retrocede (${label})`, rank >= previousRank, `${updated.status}`);
    previousRank = rank;
    check(`hay hitos visibles (${label})`, events.length > 0, String(events.length));
    check(
      `ningún hito del futuro (${label})`,
      events.every((event) => event.occurredAt.getTime() <= when.getTime()),
    );
  }

  const final = await materializeShipment(shipment, settings, new Date(eta.getTime() + 30 * 24 * 3600_000));
  check("acaba entregado", final.shipment.status === "delivered", final.shipment.status);
  check("guarda la fecha de entrega", final.shipment.deliveredAt !== null);
  check(
    "no duplica hitos al repetir",
    new Set(final.events.map((event) => event.code)).size === final.events.length,
  );

  // Entrega local (mismo país): no debería pasar por aduanas.
  const localNumber = await generateUniqueTrackingNumber({ prefix: "EU", hubCode: "776017" });
  const localTimeline = planTimeline(
    { ...shipment, trackingNumber: localNumber, destinationCity: "Sevilla", destinationCountry: "ES" },
    settings,
  );
  check(
    "envío nacional sin aduanas",
    !localTimeline.some((step) => step.code === "customs"),
  );
}

async function cleanup() {
  await prisma.shipment.deleteMany({ where: { shop: TEST_SHOP } });
  await prisma.shopSettings.deleteMany({ where: { shop: TEST_SHOP } });
}

async function main() {
  await cleanup();
  await testWindow();
  await testTrackingNumbers();
  await testSettings();
  await testTransit();
  await cleanup();
  await prisma.$disconnect();

  console.log(`\n  ${passed} comprobaciones correctas`);
  if (failures.length) {
    const unique = [...new Set(failures)];
    console.error(`  ${failures.length} FALLOS (${unique.length} distintos):\n`);
    for (const failure of unique.slice(0, 25)) console.error(`   ✗ ${failure}`);
    process.exit(1);
  }
  console.log("  Todo correcto.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
