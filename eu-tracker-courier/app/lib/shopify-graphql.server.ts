import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import { errorMessage } from "./errors";

/**
 * Envoltorio sobre `admin.graphql` con reintentos.
 *
 * Shopify limita las llamadas por coste (leaky bucket). Cuando responde
 * THROTTLED hay que esperar y reintentar; lo mismo con errores 5xx puntuales.
 */

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ShopifyGraphqlError";
  }
}

const MAX_ATTEMPTS = 5;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GraphqlErrorEntry {
  message?: string;
  extensions?: { code?: string };
}

/** Los errores llegan como array suelto o envueltos en `graphQLErrors`. */
function toErrorList(errors: unknown): GraphqlErrorEntry[] {
  if (Array.isArray(errors)) return errors as GraphqlErrorEntry[];
  if (errors && typeof errors === "object") {
    const nested = (errors as { graphQLErrors?: unknown }).graphQLErrors;
    if (Array.isArray(nested)) return nested as GraphqlErrorEntry[];
  }
  return [];
}

function isThrottled(errors: unknown): boolean {
  return toErrorList(errors).some(
    (error) =>
      error?.extensions?.code === "THROTTLED" || /throttl/i.test(String(error?.message ?? "")),
  );
}

function describe(errors: unknown): string {
  const list = toErrorList(errors);
  if (!list.length) return "Error desconocido de la API de Shopify";
  return list.map((error) => error?.message ?? JSON.stringify(error)).join(" | ");
}

/** Errores de la librería de Shopify: llevan el cuerpo de la respuesta en `body`. */
function bodyErrors(error: unknown): unknown {
  if (error && typeof error === "object") {
    const body = (error as { body?: { errors?: unknown } }).body;
    if (body && typeof body === "object") return body.errors;
  }
  return undefined;
}

export async function adminGraphql<TData>(
  admin: AdminApiContext,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await admin.graphql(query, variables ? { variables } : undefined);

      if (response.status === 429 || response.status >= 500) {
        lastError = new ShopifyGraphqlError(`HTTP ${response.status} desde Shopify`);
        await sleep(attempt * 1500);
        continue;
      }

      const payload = (await response.json()) as { data?: TData; errors?: unknown };

      if (payload?.errors) {
        if (isThrottled(payload.errors) && attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 2000);
          continue;
        }
        throw new ShopifyGraphqlError(describe(payload.errors), payload.errors);
      }

      return payload.data as TData;
    } catch (error) {
      lastError = error;

      if (error instanceof ShopifyGraphqlError) throw error;

      const errors = bodyErrors(error);
      if (errors) {
        if (isThrottled(errors) && attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 2000);
          continue;
        }
        throw new ShopifyGraphqlError(describe(errors), errors);
      }

      if (attempt >= MAX_ATTEMPTS) break;
      await sleep(attempt * 1500);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ShopifyGraphqlError(errorMessage(lastError) || "No se pudo completar la petición a Shopify");
}

/** gid://shopify/Order/12345 → 12345 */
export function gidToId(gid: string | null | undefined): string {
  return String(gid ?? "").split("/").pop() ?? "";
}
