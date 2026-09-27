import prisma from "../db.server";
import { runFulfillmentBatch } from "./fulfillment.server";
import { toWindow } from "./settings.server";
import { computeNextRunAt } from "./time";
import { advancePendingShipments } from "./transit.server";

/**
 * Planificador de EU TRACKER COURIER.
 *
 * Cada tienda tiene una hora de ejecución distinta y **aleatoria** dentro de su
 * ventana local (por defecto entre las 02:00 y las 07:00). El planificador
 * comprueba cada minuto qué tiendas han llegado a su hora.
 *
 * Al despachar una ejecución se reserva el turno de forma atómica
 * (`updateMany` condicionado a `nextRunAt`), de modo que si hubiera varias
 * instancias del servidor solo una prepara los pedidos.
 *
 * En hosts que apagan el proceso cuando no hay tráfico (serverless), llama en
 * su lugar a `POST /api/cron` cada 5-10 minutos con la cabecera del secreto.
 */

const TICK_INTERVAL_MS = 60_000;

interface SchedulerState {
  timer?: ReturnType<typeof setInterval>;
  ticking: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __eutcScheduler: SchedulerState | undefined;
}

const state: SchedulerState = (globalThis.__eutcScheduler ??= { ticking: false });

export interface TickResult {
  dispatched: string[];
  scheduled: string[];
  advancedShipments: number;
}

/** Una pasada del planificador. Segura para llamarla en paralelo. */
export async function schedulerTick(now: Date = new Date()): Promise<TickResult> {
  const result: TickResult = { dispatched: [], scheduled: [], advancedShipments: 0 };

  if (state.ticking) return result;
  state.ticking = true;

  try {
    const shops = await prisma.shopSettings.findMany({
      where: { automationEnabled: true },
    });

    for (const settings of shops) {
      try {
        if (!settings.nextRunAt) {
          await prisma.shopSettings.update({
            where: { shop: settings.shop },
            data: { nextRunAt: computeNextRunAt(toWindow(settings), now) },
          });
          result.scheduled.push(settings.shop);
          continue;
        }

        if (settings.nextRunAt.getTime() > now.getTime()) continue;

        // Reserva atómica del turno: si otra instancia se adelantó, count = 0.
        const claim = await prisma.shopSettings.updateMany({
          where: { shop: settings.shop, nextRunAt: settings.nextRunAt },
          data: {
            nextRunAt: computeNextRunAt(toWindow(settings), now),
            lastRunAt: now,
          },
        });
        if (claim.count === 0) continue;

        result.dispatched.push(settings.shop);

        void runFulfillmentBatch({ shop: settings.shop, trigger: "scheduled" }).catch((error) => {
          console.error(`[EUTC] Ejecución programada fallida en ${settings.shop}:`, error);
        });
      } catch (error) {
        console.error(`[EUTC] Error planificando ${settings.shop}:`, error);
      }
    }

    result.advancedShipments = await advancePendingShipments();
  } catch (error) {
    console.error("[EUTC] Error en el planificador:", error);
  } finally {
    state.ticking = false;
  }

  return result;
}

/** Arranca el temporizador interno. Idempotente. */
export function startScheduler(): void {
  if (process.env.EUTC_DISABLE_SCHEDULER === "1") {
    console.log("[EUTC] Planificador interno desactivado (EUTC_DISABLE_SCHEDULER=1).");
    return;
  }
  if (state.timer) return;

  state.timer = setInterval(() => {
    void schedulerTick();
  }, TICK_INTERVAL_MS);

  // No mantiene vivo el proceso si no hay nada más que hacer.
  state.timer.unref?.();

  // Primera pasada en cuanto arranca el servidor, con un pequeño margen.
  setTimeout(() => void schedulerTick(), 5_000).unref?.();

  console.log("[EUTC] Planificador interno activo (comprobación cada 60 s).");
}

/** Reprograma la próxima ejecución de una tienda dentro de su ventana. */
export async function rescheduleShop(shop: string, from: Date = new Date()) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return null;

  return prisma.shopSettings.update({
    where: { shop },
    data: {
      nextRunAt: settings.automationEnabled ? computeNextRunAt(toWindow(settings), from) : null,
    },
  });
}
