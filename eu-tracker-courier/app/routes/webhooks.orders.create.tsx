import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrCreateSettings, toWindow } from "../lib/settings.server";
import { computeNextRunAt } from "../lib/time";

/**
 * Pedido nuevo. No se prepara al instante (para eso está la ventana
 * nocturna), pero sirve para asegurarse de que la tienda tiene ajustes y una
 * próxima ejecución programada, aunque la base de datos se haya reiniciado.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);
  if (!session) return new Response();

  const settings = await getOrCreateSettings(shop);
  if (settings.automationEnabled && !settings.nextRunAt) {
    await prisma.shopSettings.update({
      where: { shop },
      data: { nextRunAt: computeNextRunAt(toWindow(settings)) },
    });
  }

  return new Response();
};
