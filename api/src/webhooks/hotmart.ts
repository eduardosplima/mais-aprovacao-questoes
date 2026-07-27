import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env";
import { getSubscriptionUcodes } from "../config/env";
import { getDb } from "../db/client";
import { claimEvent, markProcessed, markIgnored } from "../db/webhookEvents";
import { equalStrings } from "../lib/constantTime";

/**
 * Schema tolerante: valida só os campos que consumimos e descarta o resto.
 * A Hotmart adiciona campos sem aviso, e o payload traz endereço, telefone e
 * dados de pagamento que NÃO queremos persistir (minimização LGPD).
 *
 * Cobre os dois formatos numa estrutura só:
 * - compra:       data.subscription.subscriber.code, data.purchase.date_next_charge
 * - cancelamento: data.subscriber.code,              data.date_next_charge
 */
export const hotmartEventSchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  data: z
    .object({
      product: z.object({ ucode: z.string().optional() }).optional(),
      buyer: z
        .object({
          email: z.string().optional(),
          name: z.string().optional(),
          document: z.string().optional(),
        })
        .optional(),
      purchase: z
        .object({
          transaction: z.string().optional(),
          status: z.string().optional(),
          date_next_charge: z.number().optional(),
          recurrence_number: z.number().optional(),
        })
        .optional(),
      subscription: z
        .object({
          status: z.string().optional(),
          plan: z.object({ name: z.string().optional() }).optional(),
          subscriber: z.object({ code: z.string().optional() }).optional(),
        })
        .optional(),
      subscriber: z
        .object({
          code: z.string().optional(),
          email: z.string().optional(),
          name: z.string().optional(),
        })
        .optional(),
      date_next_charge: z.number().optional(),
      cancellation_date: z.number().optional(),
    })
    .optional(),
});

export type HotmartEvent = z.infer<typeof hotmartEventSchema>;

/** Resultado do despacho de um evento. */
export type Outcome = { kind: "processed" } | { kind: "ignored"; note: string };

export const webhooks = new Hono<{ Bindings: Env }>();

webhooks.post("/hotmart", async (c) => {
  const provided = c.req.header("x-hotmart-hottok") ?? "";
  if (!equalStrings(provided, c.env.HOTMART_HOTTOK)) {
    return c.json({ error: "invalid_hottok" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = hotmartEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_payload" }, 400);
  }
  const event = parsed.data;

  const db = getDb(c.env);

  // Idempotência ANTES de qualquer efeito. Só 'processed'/'ignored' deduplicam.
  const claim = await claimEvent(db, event.id, event.event);
  if (claim === "already_done") {
    return c.json({ ok: true, duplicate: true });
  }

  // O evento só vira 'processed' no FIM. Se algo lançar daqui pra frente, a
  // linha fica em 'received', o Worker responde 5xx e a Hotmart retenta.
  const outcome = await dispatch(c.env, event);

  if (outcome.kind === "ignored") {
    await markIgnored(db, event.id, outcome.note);
  } else {
    await markProcessed(db, event.id);
  }

  return c.json({ ok: true });
});

async function dispatch(env: Env, event: HotmartEvent): Promise<Outcome> {
  if (event.event === "PURCHASE_COMPLETE") {
    return { kind: "ignored", note: "fim da garantia — sem efeito no acesso" };
  }

  // Os demais eventos são despachados nas Tasks 10 e 11.
  return { kind: "ignored", note: `evento não tratado: ${event.event}` };
}

/**
 * O ucode só existe no payload de COMPRA. O cancelamento não o traz — lá o
 * casamento é pela PK subscriber_code.
 */
export function isSubscriptionProduct(env: Env, event: HotmartEvent): boolean {
  const ucode = event.data?.product?.ucode;
  return !!ucode && getSubscriptionUcodes(env).includes(ucode);
}
