import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { verifyTurnstile } from "../src/lib/turnstile";
import { stubTurnstile } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  it("true quando o siteverify aprova", async () => {
    stubTurnstile(true);
    expect(await verifyTurnstile(env, "token-valido")).toBe(true);
  });

  it("false quando o siteverify reprova", async () => {
    stubTurnstile(false);
    expect(await verifyTurnstile(env, "token-invalido")).toBe(false);
  });

  it("false para token vazio, sem chamar a rede", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await verifyTurnstile(env, "")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("false quando o siteverify responde erro HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("erro", { status: 500 })),
    );
    expect(await verifyTurnstile(env, "qualquer")).toBe(false);
  });

  it("false quando a rede falha (fail-closed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rede caiu");
      }),
    );
    expect(await verifyTurnstile(env, "qualquer")).toBe(false);
  });

  it("envia o secret e o remoteip", async () => {
    const spy = vi.fn(
      async (_input: RequestInfo | URL, _init: RequestInit) =>
        new Response(JSON.stringify({ success: true })),
    );
    vi.stubGlobal("fetch", spy);

    await verifyTurnstile(env, "tok", "203.0.113.9");

    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.secret).toBe("test-turnstile-secret");
    expect(body.response).toBe("tok");
    expect(body.remoteip).toBe("203.0.113.9");
  });
});
