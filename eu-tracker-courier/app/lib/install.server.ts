import prisma from "../db.server";
import { fetchShopInfo } from "./fulfillment.server";
import { getOrCreateSettings, toWindow } from "./settings.server";
import { computeNextRunAt } from "./time";
import { unauthenticated } from "../shopify.server";

/**
 * Preparación de una tienda recién instalada:
 *  - crea sus ajustes con los valores por defecto,
 *  - detecta su zona horaria y su ciudad de origen desde Shopify,
 *  - programa la primera ejecución dentro de la ventana nocturna.
 *
 * Se llama en cada `afterAuth`, así que tiene que ser idempotente.
 */
export async function onShopInstalled(shop: string): Promise<void> {
  try {
    const settings = await getOrCreateSettings(shop);

    let timezone = settings.timezone;
    let originCity = settings.originCity;

    try {
      const { admin } = await unauthenticated.admin(shop);
      const info = await fetchShopInfo(admin);
      if (info.ianaTimezone) timezone = info.ianaTimezone;
      if (info.originCity) originCity = info.originCity;
    } catch (error) {
      console.warn(`[EUTC] No se pudo leer la información de ${shop}:`, error);
    }

    const next = { ...settings, timezone };

    await prisma.shopSettings.update({
      where: { shop },
      data: {
        timezone,
        originCity,
        nextRunAt: settings.automationEnabled ? computeNextRunAt(toWindow(next)) : null,
      },
    });

    console.log(`[EUTC] Tienda lista: ${shop} (${timezone})`);
  } catch (error) {
    console.error(`[EUTC] Error preparando la tienda ${shop}:`, error);
  }
}

/**
 * Desinstalación: se borran las sesiones (obligatorio) y se apaga la
 * automatización, pero **se conservan los envíos**, para que los enlaces de
 * seguimiento que ya tienen los clientes sigan funcionando. Si la tienda
 * vuelve a instalar la app, recupera su historial intacto.
 */
export async function onShopUninstalled(shop: string): Promise<void> {
  await prisma.session.deleteMany({ where: { shop } });
  await prisma.shopSettings.updateMany({
    where: { shop },
    data: { automationEnabled: false, nextRunAt: null },
  });
  console.log(`[EUTC] Tienda desinstalada: ${shop} (envíos conservados)`);
}
