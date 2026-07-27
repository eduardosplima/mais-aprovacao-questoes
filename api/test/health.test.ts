import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/app";

describe("GET /health", () => {
  it("responde ok", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
