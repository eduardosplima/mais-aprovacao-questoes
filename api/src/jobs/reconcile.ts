import type { Env } from "../config/env";
import { getSubscriptionUcodes, getAdminEmails } from "../config/env";
import { getDb } from "../db/client";
import { upsertUserFromPurchase, findUserByEmail } from "../db/users";
import {
  findSubscriptionByCode,
  upsertSubscription,
  setAccessUntil,
  setStatus,
  revokeAccess,
  listSubscriptionCodes,
} from "../db/subscriptions";
import {
  createToken,
  deleteToken,
  hasPendingToken,
  FIRST_ACCESS_TTL_MS,
} from "../db/authTokens";
import { isDeleted } from "../db/deletedAccounts";
import { sendMagicLink } from "../lib/email";
import { normalizeEmail, hmacHex } from "../lib/hmac";
import { sanitizeName } from "../lib/text";
import {
  fetchAccessToken,
  listSubscriptions,
  type HotmartSubscription,
} from "../lib/hotmartApi";

export interface ReconcileStats {
  created: number;
  corrected: number;
  revoked: number;
  skipped: number;
  missingInApi: number;
}

const ACTIVE_STATUSES = new Set(["ACTIVE", "STARTED", "DELAYED", "OVERDUE"]);

/**
 * Reconciliação diária contra a API de dados da Hotmart.
 *
 * Fecha os dois furos que o webhook deixa quando uma entrega falha:
 * - compra perdida: aluno pagou e não existe no sistema. É o ÚNICO remédio
 *   automático — o recover não ajuda quem não existe.
 * - cancelamento perdido: ex-assinante com acesso pago indefinidamente.
 *
 * REGRA DURA: ausência na listagem NUNCA revoga. Só revoga quando a API
 * retorna explicitamente a assinatura com status não-ativo ou data no passado.
 * Um filtro errado ou uma página perdida revogaria a base inteira.
 */
export async function reconcile(env: Env): Promise<ReconcileStats> {
  const db = getDb(env);
  const stats: ReconcileStats = {
    created: 0,
    corrected: 0,
    revoked: 0,
    skipped: 0,
    missingInApi: 0,
  };

  // Se qualquer página falhar, listSubscriptions lança e nada é tocado.
  const token = await fetchAccessToken(env);
  const remote = await listSubscriptions(env, token);

  const ucodes = getSubscriptionUcodes(env);
  const seen = new Set<string>();

  for (const sub of remote) {
    if (!sub.productUcode || !ucodes.includes(sub.productUcode)) continue;
    seen.add(sub.subscriberCode);

    const email = normalizeEmail(sub.email);
    const emailHash = await hmacHex(email, env.DOCUMENT_HMAC_KEY);

    // A conta excluída pelo titular não volta pelo cron. Assinatura cancelada
    // continua listada com date_next_charge no futuro — sem esta guarda, a
    // exclusão se desfaria na madrugada seguinte.
    if (await isDeleted(db, emailHash)) {
      stats.skipped++;
      continue;
    }

    const existing = await findSubscriptionByCode(db, sub.subscriberCode);
    if (!existing) {
      await provision(env, sub, email);
      stats.created++;
      continue;
    }

    const applied = await applyRemoteState(env, sub, {
      accessUntil: existing.accessUntil,
      status: existing.status,
    });
    if (applied === "revoked") stats.revoked++;
    if (applied === "corrected") stats.corrected++;
  }

  const local = await listSubscriptionCodes(db);
  stats.missingInApi = local.filter((code) => !seen.has(code)).length;

  return stats;
}

/** Webhook de compra perdido: cria a conta e manda o link. */
async function provision(
  env: Env,
  sub: HotmartSubscription,
  email: string,
): Promise<void> {
  const db = getDb(env);

  // A API de dados não devolve o documento do assinante, então o usuário nasce
  // com documentHash nulo — o recover dele valida só o email.
  const userId = await upsertUserFromPurchase(
    db,
    { email, name: sub.name ? sanitizeName(sub.name) : null, documentHash: null },
    getAdminEmails(env),
  );

  await upsertSubscription(db, {
    subscriberCode: sub.subscriberCode,
    userId,
    productUcode: sub.productUcode!,
    planName: sub.planName,
    status: sub.status,
    accessUntil: sub.dateNextCharge ? new Date(sub.dateNextCharge) : null,
    lastTransaction: null,
  });

  const user = await findUserByEmail(db, email);
  if (user?.passwordHash == null && !(await hasPendingToken(db, userId))) {
    const token = await createToken(db, userId, FIRST_ACCESS_TTL_MS);
    try {
      await sendMagicLink(env, {
        to: email,
        name: user?.name ?? null,
        token,
        kind: "first_access",
      });
    } catch (err) {
      await deleteToken(db, token);
      throw err;
    }
  }
}

type Applied = "revoked" | "corrected" | "unchanged";

/**
 * `date_next_charge` é a verdade em qualquer status: numa assinatura cancelada
 * ele é a data do último acesso pago. Por isso a data manda, e o status só
 * decide o que fazer quando ela não vem.
 *
 * `status` é sincronizado aqui só para fins de auditoria — ele NUNCA entra na
 * decisão de revogar/corrigir/manter, que é sempre função da data. Sem isto,
 * uma assinatura cancelada na Hotmart mas ainda dentro do ciclo pago ficava
 * com `status = 'ACTIVE'` no D1 para sempre (o acesso em si continua certo,
 * só a coluna que alguém consultaria num incidente que ficava desatualizada).
 */
async function applyRemoteState(
  env: Env,
  sub: HotmartSubscription,
  existing: { accessUntil: Date | null; status: string },
): Promise<Applied> {
  const db = getDb(env);
  const statusDivergiu = existing.status !== sub.status;

  if (sub.dateNextCharge) {
    if (sub.dateNextCharge <= Date.now()) {
      await revokeAccess(db, sub.subscriberCode, sub.status);
      return "revoked";
    }
    const dataDivergiu = existing.accessUntil?.getTime() !== sub.dateNextCharge;
    if (dataDivergiu) {
      await setAccessUntil(db, sub.subscriberCode, new Date(sub.dateNextCharge));
    }
    if (statusDivergiu) {
      await setStatus(db, sub.subscriberCode, sub.status);
    }
    return dataDivergiu || statusDivergiu ? "corrected" : "unchanged";
  }

  if (!ACTIVE_STATUSES.has(sub.status)) {
    await revokeAccess(db, sub.subscriberCode, sub.status);
    return "revoked";
  }

  if (statusDivergiu) {
    await setStatus(db, sub.subscriberCode, sub.status);
    return "corrected";
  }

  return "unchanged";
}
