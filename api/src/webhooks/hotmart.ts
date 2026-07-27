import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env";
import { getSubscriptionUcodes, getAdminEmails } from "../config/env";
import { getDb } from "../db/client";
import { claimEvent, markProcessed, markIgnored } from "../db/webhookEvents";
import { equalStrings } from "../lib/constantTime";
import { upsertUserFromPurchase, findUserByEmail } from "../db/users";
import {
  upsertSubscription,
  findSubscriptionByCode,
  revokeAccess,
  setStatus,
  setAccessUntil,
} from "../db/subscriptions";
import {
  createToken,
  hasPendingToken,
  FIRST_ACCESS_TTL_MS,
} from "../db/authTokens";
import { isDeleted, clearTombstone } from "../db/deletedAccounts";
import { sendMagicLink } from "../lib/email";
import { normalizeEmail, normalizeDocument, hmacHex } from "../lib/hmac";

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

/**
 * Fallback quando `date_next_charge` não vem no payload (o campo é opcional).
 * Curto de propósito: a periodicidade do plano não está no payload de compra,
 * só na API de dados. O cron corrige na primeira execução. O erro possível é
 * dar acesso de menos por até 24h a quem pagou — nunca acesso indefinido a
 * quem não pagou.
 */
export const NO_NEXT_CHARGE_FALLBACK_MS = 604_800_000; // 7 dias

async function handlePurchaseApproved(
  env: Env,
  event: HotmartEvent,
): Promise<Outcome> {
  if (!isSubscriptionProduct(env, event)) {
    return { kind: "ignored", note: "ucode fora de HOTMART_SUBSCRIPTION_UCODES" };
  }

  const subscriberCode = event.data?.subscription?.subscriber?.code;
  if (!subscriberCode) {
    return { kind: "ignored", note: "compra sem subscriber.code" };
  }

  const rawEmail = event.data?.buyer?.email;
  if (!rawEmail) {
    return { kind: "ignored", note: "compra sem email do comprador" };
  }

  const db = getDb(env);
  const email = normalizeEmail(rawEmail);
  const emailHash = await hmacHex(email, env.DOCUMENT_HMAC_KEY);
  const recurrence = event.data?.purchase?.recurrence_number ?? 1;

  // Tombstone: renovação de conta excluída não ressuscita ninguém. Compra nova
  // sim — a tombstone não é banimento perpétuo.
  if (await isDeleted(db, emailHash)) {
    if (recurrence > 1) {
      return { kind: "ignored", note: "conta excluída pelo titular" };
    }
    await clearTombstone(db, emailHash);
  }

  const rawDocument = event.data?.buyer?.document;
  const documentHash = rawDocument
    ? await hmacHex(normalizeDocument(rawDocument), env.DOCUMENT_HMAC_KEY)
    : null;

  const userId = await upsertUserFromPurchase(
    db,
    { email, name: event.data?.buyer?.name ?? null, documentHash },
    getAdminEmails(env),
  );

  const nextCharge = event.data?.purchase?.date_next_charge;
  const accessUntil = nextCharge
    ? new Date(nextCharge)
    : new Date(Date.now() + NO_NEXT_CHARGE_FALLBACK_MS);

  await upsertSubscription(db, {
    subscriberCode,
    userId,
    productUcode: event.data!.product!.ucode!,
    planName: event.data?.subscription?.plan?.name ?? null,
    status: event.data?.subscription?.status ?? "ACTIVE",
    accessUntil,
    lastTransaction: event.data?.purchase?.transaction ?? null,
  });

  // Quatro guardas antes de enviar: senha não definida, primeira recorrência,
  // sem token válido pendente. O envio é awaited — se falhar, a exceção sobe,
  // o evento fica em 'received' e a Hotmart retenta.
  const user = await findUserByEmail(db, email);
  const precisaDefinirSenha = user?.passwordHash == null;
  if (precisaDefinirSenha && recurrence === 1) {
    if (!(await hasPendingToken(db, userId))) {
      const token = await createToken(db, userId, FIRST_ACCESS_TTL_MS);
      await sendMagicLink(env, {
        to: email,
        name: user?.name ?? null,
        token,
        kind: "first_access",
      });
    }
  }

  return { kind: "processed" };
}

/** Eventos de compra que revogam acesso, e o status que cada um grava. */
const REVOKING_EVENTS: Record<string, string> = {
  PURCHASE_REFUNDED: "REFUNDED",
  PURCHASE_CHARGEBACK: "CHARGEBACK",
  PURCHASE_PROTEST: "PROTEST",
};

/**
 * O subscriber code de um evento de compra. Diferente do cancelamento, que o
 * traz um nível acima (data.subscriber.code).
 */
function purchaseSubscriberCode(event: HotmartEvent): string | undefined {
  return event.data?.subscription?.subscriber?.code;
}

async function handleRevocation(
  env: Env,
  event: HotmartEvent,
  status: string,
): Promise<Outcome> {
  const code = purchaseSubscriberCode(event);
  if (!code) return { kind: "ignored", note: "evento sem subscriber.code" };

  const db = getDb(env);
  if (!(await findSubscriptionByCode(db, code))) {
    return { kind: "ignored", note: "subscriber.code desconhecido" };
  }

  await revokeAccess(db, code, status);
  return { kind: "processed" };
}

/**
 * Atraso não corta acesso: o ciclo já pago continua valendo. Só o status muda,
 * e `access_until` fica intocado — a carência é consequência natural do
 * predicado de data.
 */
async function handleDelayed(
  env: Env,
  event: HotmartEvent,
): Promise<Outcome> {
  const code = purchaseSubscriberCode(event);
  if (!code) return { kind: "ignored", note: "evento sem subscriber.code" };

  const db = getDb(env);
  if (!(await findSubscriptionByCode(db, code))) {
    return { kind: "ignored", note: "subscriber.code desconhecido" };
  }

  await setStatus(db, code, "DELAYED");
  return { kind: "processed" };
}

/** Boleto/Pix não pago. Só marca se a assinatura já existir. */
async function handleExpired(
  env: Env,
  event: HotmartEvent,
): Promise<Outcome> {
  const code = purchaseSubscriberCode(event);
  if (!code) return { kind: "ignored", note: "evento sem subscriber.code" };

  const db = getDb(env);
  if (!(await findSubscriptionByCode(db, code))) {
    return { kind: "ignored", note: "assinatura nunca ativada" };
  }

  await setStatus(db, code, "EXPIRED");
  return { kind: "processed" };
}

/**
 * Cancelamento. NÃO filtra por ucode: o payload não traz product.ucode, só
 * product.id e product.name. O casamento pela PK subscriber_code já garante
 * que a assinatura é nossa — código desconhecido é ignorado com segurança.
 *
 * O acesso vale até date_next_charge, que na assinatura cancelada é a data do
 * último acesso pago (documentação da Hotmart).
 */
async function handleCancellation(
  env: Env,
  event: HotmartEvent,
): Promise<Outcome> {
  const code = event.data?.subscriber?.code;
  if (!code) {
    return { kind: "ignored", note: "cancelamento sem subscriber.code" };
  }

  const db = getDb(env);
  if (!(await findSubscriptionByCode(db, code))) {
    return { kind: "ignored", note: "subscriber.code desconhecido" };
  }

  const nextCharge = event.data?.date_next_charge;
  if (nextCharge && nextCharge > Date.now()) {
    await setStatus(db, code, "CANCELLED");
    await setAccessUntil(db, code, new Date(nextCharge));
  } else {
    await revokeAccess(db, code, "CANCELLED");
  }

  return { kind: "processed" };
}

async function dispatch(env: Env, event: HotmartEvent): Promise<Outcome> {
  const revokingStatus = REVOKING_EVENTS[event.event];
  if (revokingStatus) return handleRevocation(env, event, revokingStatus);

  switch (event.event) {
    case "PURCHASE_APPROVED":
      return handlePurchaseApproved(env, event);
    case "PURCHASE_DELAYED":
      return handleDelayed(env, event);
    case "PURCHASE_CANCELED":
    case "PURCHASE_EXPIRED":
      return handleExpired(env, event);
    case "SUBSCRIPTION_CANCELLATION":
      return handleCancellation(env, event);
    case "PURCHASE_COMPLETE":
      return { kind: "ignored", note: "fim da garantia — sem efeito no acesso" };
    default:
      return { kind: "ignored", note: `evento não tratado: ${event.event}` };
  }
}

/**
 * O ucode só existe no payload de COMPRA. O cancelamento não o traz — lá o
 * casamento é pela PK subscriber_code.
 */
export function isSubscriptionProduct(env: Env, event: HotmartEvent): boolean {
  const ucode = event.data?.product?.ucode;
  return !!ucode && getSubscriptionUcodes(env).includes(ucode);
}
