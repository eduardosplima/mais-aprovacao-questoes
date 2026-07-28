import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { webhookEvents } from "../src/db/schema";
import {
  claimEvent,
  markProcessed,
  markIgnored,
} from "../src/db/webhookEvents";
import {
  isDeleted,
  markDeleted,
  clearTombstone,
} from "../src/db/deletedAccounts";

const db = () => getDb(env);

describe("claimEvent", () => {
  it("primeiro claim registra como 'received'", async () => {
    expect(await claimEvent(db(), "ev-1", "PURCHASE_APPROVED")).toBe("claimed");

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "ev-1"))
      .get();
    expect(row?.status).toBe("received");
    expect(row?.event).toBe("PURCHASE_APPROVED");
  });

  it("reenvio de evento já processado devolve 'already_done'", async () => {
    await claimEvent(db(), "ev-2", "PURCHASE_APPROVED");
    await markProcessed(db(), "ev-2");
    expect(await claimEvent(db(), "ev-2", "PURCHASE_APPROVED")).toBe(
      "already_done",
    );
  });

  it("reenvio de evento ignorado devolve 'already_done'", async () => {
    await claimEvent(db(), "ev-3", "PURCHASE_COMPLETE");
    await markIgnored(db(), "ev-3", "ucode fora da lista");
    expect(await claimEvent(db(), "ev-3", "PURCHASE_COMPLETE")).toBe(
      "already_done",
    );
  });

  it("evento parado em 'received' é reprocessável", async () => {
    // simula tentativa anterior que morreu antes de marcar processed
    expect(await claimEvent(db(), "ev-4", "PURCHASE_APPROVED")).toBe("claimed");
    expect(await claimEvent(db(), "ev-4", "PURCHASE_APPROVED")).toBe("claimed");
  });

  it("markIgnored grava a nota", async () => {
    await claimEvent(db(), "ev-5", "PURCHASE_APPROVED");
    await markIgnored(db(), "ev-5", "assinante desconhecido");

    const row = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "ev-5"))
      .get();
    expect(row?.status).toBe("ignored");
    expect(row?.note).toBe("assinante desconhecido");
  });

  // Este teste NÃO distingue a implementação atômica (INSERT ... RETURNING)
  // da antiga (select-then-insert): onConflictDoNothing() já garante
  // unicidade de linha na camada de storage independentemente da lógica ao
  // redor, então "só existe uma linha para o id" era verdade nas duas
  // versões. A atomicidade do claimEvent é garantida por inspeção do código
  // (a decisão vitória/derrota vem de uma única instrução INSERT ...
  // RETURNING), não por este teste — o harness roda em processo único e não
  // consegue intercalar de verdade duas escritas conflitantes.
  it("duas chamadas simultâneas com o mesmo id criam apenas uma linha", async () => {
    const [r1, r2] = await Promise.all([
      claimEvent(db(), "ev-concurrent", "PURCHASE_APPROVED"),
      claimEvent(db(), "ev-concurrent", "PURCHASE_APPROVED"),
    ]);
    expect(r1).toBe("claimed");
    expect(r2).toBe("claimed");

    const rows = await db()
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, "ev-concurrent"));
    expect(rows).toHaveLength(1);
  });
});

describe("tombstone", () => {
  it("false para email nunca excluído", async () => {
    expect(await isDeleted(db(), "hash-inexistente")).toBe(false);
  });

  it("markDeleted e depois isDeleted", async () => {
    await markDeleted(db(), "hash-excluido");
    expect(await isDeleted(db(), "hash-excluido")).toBe(true);
  });

  it("markDeleted é idempotente", async () => {
    await markDeleted(db(), "hash-duas-vezes");
    await markDeleted(db(), "hash-duas-vezes");
    expect(await isDeleted(db(), "hash-duas-vezes")).toBe(true);
  });

  it("clearTombstone permite nova compra do mesmo email", async () => {
    await markDeleted(db(), "hash-volta");
    await clearTombstone(db(), "hash-volta");
    expect(await isDeleted(db(), "hash-volta")).toBe(false);
  });

  it("clearTombstone em hash inexistente não lança", async () => {
    await clearTombstone(db(), "hash-nunca-existiu");
    expect(await isDeleted(db(), "hash-nunca-existiu")).toBe(false);
  });
});
