import type { Env } from "../config/env";

/**
 * ⚠️ MÓDULO SOMENTE LEITURA — não adicione nada que escreva na Hotmart.
 *
 * Com o cancelamento de assinatura em uso (exclusão de conta, sub-projeto 4),
 * HOTMART_CLIENT_SECRET é uma credencial destrutiva: quem a obtiver pode
 * cancelar toda a base de assinantes. A escrita mora em lib/hotmartCancel.ts,
 * alcançável só pelo caminho de exclusão iniciado pelo titular.
 *
 * O cron de reconciliação importa ESTE módulo. Um bug que o fizesse cancelar
 * assinaturas destruiria a receita do negócio numa única execução às 3h da
 * manhã. Há um teste que trava esta invariante.
 */

export interface HotmartSubscription {
  subscriberCode: string;
  email: string;
  name: string | null;
  status: string;
  productUcode: string | null;
  planName: string | null;
  /** Na assinatura cancelada, é a data do ÚLTIMO acesso pago. */
  dateNextCharge: number | null;
}

/**
 * O `start_date` da API tem default de *hoje − 30 dias* sobre a data de início
 * da assinatura. Sem passá-lo explicitamente com data antiga, toda assinatura
 * veterana parece inexistente — e a reconciliação acharia que a base sumiu.
 */
export const RECONCILE_START_DATE_MS = Date.UTC(2020, 0, 1);

const PAGE_SIZE = 50;

export async function fetchAccessToken(env: Env): Promise<string> {
  const basic = btoa(`${env.HOTMART_CLIENT_ID}:${env.HOTMART_CLIENT_SECRET}`);
  const res = await fetch(env.HOTMART_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.HOTMART_CLIENT_ID,
      client_secret: env.HOTMART_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new Error(`hotmart token falhou: ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("hotmart token ausente na resposta");
  return data.access_token;
}

interface RawSubscription {
  subscriber_code?: string;
  status?: string;
  date_next_charge?: number;
  plan?: { name?: string };
  product?: { ucode?: string };
  subscriber?: { name?: string; email?: string };
}

interface RawPage {
  items?: RawSubscription[];
  page_info?: { next_page_token?: string };
}

/**
 * Lista TODAS as assinaturas da conta, percorrendo a paginação.
 *
 * Não filtra por produto na query: a API filtra por `product_id` (número de 7
 * dígitos), e o que guardamos dos webhooks é o `ucode`. Como o `ucode` vem na
 * resposta, o filtro é feito por quem chama. Evita mais um item de configuração
 * a confirmar.
 *
 * Qualquer página que falhe LANÇA. Uma listagem parcial faria a reconciliação
 * concluir que assinaturas sumiram.
 */
export async function listSubscriptions(
  env: Env,
  accessToken: string,
): Promise<HotmartSubscription[]> {
  const out: HotmartSubscription[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      "/payments/api/v1/subscriptions",
      env.HOTMART_API_BASE_URL,
    );
    url.searchParams.set("max_results", String(PAGE_SIZE));
    url.searchParams.set("start_date", String(RECONCILE_START_DATE_MS));
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`hotmart subscriptions falhou: ${res.status}`);
    }

    const page = (await res.json()) as RawPage;
    for (const item of page.items ?? []) {
      if (!item.subscriber_code || !item.subscriber?.email) continue;
      out.push({
        subscriberCode: item.subscriber_code,
        email: item.subscriber.email,
        name: item.subscriber.name ?? null,
        status: item.status ?? "UNKNOWN",
        productUcode: item.product?.ucode ?? null,
        planName: item.plan?.name ?? null,
        dateNextCharge: item.date_next_charge ?? null,
      });
    }

    pageToken = page.page_info?.next_page_token;
  } while (pageToken);

  return out;
}
