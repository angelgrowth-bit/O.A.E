import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { onShopUninstalled } from "../lib/install.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`[EUTC] Webhook ${topic} recibido de ${shop}`);

  // Los webhooks pueden repetirse, incluso después de desinstalar: si ya no
  // hay sesión no queda nada que limpiar.
  if (session) await onShopUninstalled(shop);

  return new Response();
};
