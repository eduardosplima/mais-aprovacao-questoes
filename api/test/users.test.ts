import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getDb } from "../src/db/client";
import {
  upsertUser,
  ensureSubscription,
  loadEntitlement,
} from "../src/db/users";

const admins = ["admin@test.com"];

describe("users repo", () => {
  it("cria usuário comum e deriva tier gratuito", async () => {
    const db = getDb(env);
    const id = await upsertUser(
      db,
      { hotmartUserId: "h1", email: "user1@test.com" },
      admins,
    );
    await ensureSubscription(db, id);
    const ent = await loadEntitlement(db, id);
    expect(ent).toEqual({
      userId: id,
      email: "user1@test.com",
      role: "user",
      tier: "gratuito",
    });
  });

  it("concede role admin via allowlist (case-insensitive)", async () => {
    const db = getDb(env);
    const id = await upsertUser(
      db,
      { hotmartUserId: "h2", email: "Admin@Test.com" },
      admins,
    );
    const ent = await loadEntitlement(db, id);
    expect(ent?.role).toBe("admin");
  });

  it("upsert é idempotente pelo e-mail e atualiza hotmartUserId", async () => {
    const db = getDb(env);
    const first = await upsertUser(
      db,
      { hotmartUserId: "h3", email: "dup@test.com" },
      admins,
    );
    const second = await upsertUser(
      db,
      { hotmartUserId: "h3-new", email: "dup@test.com" },
      admins,
    );
    expect(second).toBe(first);
  });

  it("loadEntitlement retorna null para id inexistente", async () => {
    const db = getDb(env);
    expect(await loadEntitlement(db, "nao-existe")).toBeNull();
  });
});
