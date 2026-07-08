import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createHotmartClient } from "../src/lib/hotmart";

// NOTA: `fetchMock` de "cloudflare:test" foi removido a partir de
// @cloudflare/vitest-pool-workers v0.13.0 (migração para Vitest 4). A
// substituição recomendada pela Cloudflare é mockar `globalThis.fetch`
// diretamente. Ver: migration-guides/migrate-from-vitest-3-to-vitest-4.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createHotmartClient", () => {
  it("authorizeUrl inclui client_id, redirect_uri, response_type e state", () => {
    const url = new URL(createHotmartClient(env).authorizeUrl("st4te"));
    expect(url.origin + url.pathname).toBe("https://hotmart.test/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.test/auth/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st4te");
  });

  it("exchangeCode troca code por access_token", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(env.HOTMART_TOKEN_URL);
      return new Response(JSON.stringify({ access_token: "AT" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const out = await createHotmartClient(env).exchangeCode("the-code");
    expect(out.accessToken).toBe("AT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("exchangeCode lança em status != 2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 401 })),
    );
    await expect(
      createHotmartClient(env).exchangeCode("bad"),
    ).rejects.toThrow();
  });

  it("fetchIdentity mapeia id e email", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(env.HOTMART_USERINFO_URL);
      return new Response(
        JSON.stringify({ id: 987, email: "quem@test.com" }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);
    const id = await createHotmartClient(env).fetchIdentity("AT");
    expect(id).toEqual({ hotmartUserId: "987", email: "quem@test.com" });
  });
});
