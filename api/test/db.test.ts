import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { users } from "../src/db/schema";

describe("schema + migrations", () => {
  it("insere e lê um usuário", async () => {
    const db = getDb(env);
    const id = crypto.randomUUID();
    await db
      .insert(users)
      .values({ id, email: "a@a.com", role: "user", createdAt: new Date() })
      .run();
    const row = await db.select().from(users).where(eq(users.id, id)).get();
    expect(row?.email).toBe("a@a.com");
    expect(row?.role).toBe("user");
  });
});
