import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import * as hotmartApi from "../src/lib/hotmartApi";
import {
  fetchAccessToken,
  listSubscriptions,
  RECONCILE_ACCESSION_DATE_MS,
} from "../src/lib/hotmartApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

function subscriptionItem(overrides: Record<string, unknown> = {}) {
  return {
    subscriber_code: "SUB-API-1",
    status: "ACTIVE",
    date_next_charge: Date.now() + 30 * 86400000,
    plan: { name: "Mensal", id: 99 },
    product: { id: 1234567, name: "Mais Aprovação", ucode: "UCODE_ASSINATURA" },
    subscriber: { name: "Aluno API", email: "api@test.com" },
    ...overrides,
  };
}

describe("INVARIANTE: hotmartApi é somente leitura", () => {
  it("não exporta nenhuma função de cancelamento", () => {
    const nomes = Object.keys(hotmartApi);
    const escrita = nomes.filter((n) => /cancel|delete|revoke|refund/i.test(n));

    expect(escrita).toEqual([]);
  });
});

describe("fetchAccessToken", () => {
  it("usa client_credentials com Basic auth", async () => {
    const spy = vi.fn(
      async (_input: RequestInfo | URL, _init: RequestInit) =>
        new Response(JSON.stringify({ access_token: "AT-123" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", spy);

    expect(await fetchAccessToken(env)).toBe("AT-123");

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(env.HOTMART_TOKEN_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Basic " + btoa("cid:csecret"),
    );
    expect(String(init.body)).toContain("grant_type=client_credentials");
  });

  it("lança quando o token endpoint responde erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    await expect(fetchAccessToken(env)).rejects.toThrow();
  });
});

describe("listSubscriptions", () => {
  it("mapeia os campos do retorno", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [subscriptionItem()] }), {
            status: 200,
          }),
      ),
    );

    const [sub] = await listSubscriptions(env, "AT");

    expect(sub).toEqual({
      subscriberCode: "SUB-API-1",
      email: "api@test.com",
      name: "Aluno API",
      status: "ACTIVE",
      productUcode: "UCODE_ASSINATURA",
      planName: "Mensal",
      dateNextCharge: expect.any(Number),
    });
  });

  it("passa accession_date antigo e explícito", async () => {
    const spy = vi.fn(
      async (_input: RequestInfo | URL, _init: RequestInit) =>
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);

    await listSubscriptions(env, "AT");

    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.searchParams.get("accession_date")).toBe(
      String(RECONCILE_ACCESSION_DATE_MS),
    );
    expect(RECONCILE_ACCESSION_DATE_MS).toBeLessThan(Date.UTC(2021, 0, 1));
  });

  it("não passa start_date — a API não conhece esse parâmetro", async () => {
    const spy = vi.fn(
      async (_input: RequestInfo | URL, _init: RequestInit) =>
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);

    await listSubscriptions(env, "AT");

    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.searchParams.get("start_date")).toBeNull();
  });

  it("envia o Bearer token", async () => {
    const spy = vi.fn(
      async (_input: RequestInfo | URL, _init: RequestInit) =>
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);

    await listSubscriptions(env, "AT-XYZ");

    expect(
      (spy.mock.calls[0][1].headers as Record<string, string>).authorization,
    ).toBe("Bearer AT-XYZ");
  });

  it("percorre todas as páginas via next_page_token", async () => {
    let chamada = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        chamada++;
        if (chamada === 1) {
          return new Response(
            JSON.stringify({
              items: [subscriptionItem({ subscriber_code: "P1" })],
              page_info: { next_page_token: "TOKEN-P2" },
            }),
            { status: 200 },
          );
        }
        if (chamada === 2) {
          return new Response(
            JSON.stringify({
              items: [subscriptionItem({ subscriber_code: "P2" })],
              page_info: { next_page_token: "TOKEN-P3" },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            items: [subscriptionItem({ subscriber_code: "P3" })],
            page_info: {},
          }),
          { status: 200 },
        );
      }),
    );

    const subs = await listSubscriptions(env, "AT");

    expect(subs.map((s) => s.subscriberCode)).toEqual(["P1", "P2", "P3"]);
    expect(chamada).toBe(3);
  });

  it("lança quando uma página falha — reconciliação parcial é perigosa", async () => {
    let chamada = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        chamada++;
        if (chamada === 1) {
          return new Response(
            JSON.stringify({
              items: [subscriptionItem()],
              page_info: { next_page_token: "TOKEN-P2" },
            }),
            { status: 200 },
          );
        }
        return new Response("erro", { status: 500 });
      }),
    );

    await expect(listSubscriptions(env, "AT")).rejects.toThrow();
  });

  it("tolera itens sem ucode ou sem date_next_charge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                subscriptionItem({
                  product: { id: 1, name: "Sem ucode" },
                  date_next_charge: undefined,
                }),
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const [sub] = await listSubscriptions(env, "AT");
    expect(sub.productUcode).toBeNull();
    expect(sub.dateNextCharge).toBeNull();
  });
});
