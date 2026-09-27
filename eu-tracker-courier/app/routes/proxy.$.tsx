import { proxyTrackingLoader } from "../lib/proxy-handler.server";

// Cualquier subruta bajo /apps/eu-tracker acaba también en la misma página.
export const loader = proxyTrackingLoader;
