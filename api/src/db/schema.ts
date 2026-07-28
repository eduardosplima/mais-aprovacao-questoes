import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** HMAC-SHA256 do documento (só dígitos). Nunca o documento em claro. */
  documentHash: text("document_hash"),
  /** NULL = o aluno nunca definiu senha. */
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    hotmartSubscriberCode: text("hotmart_subscriber_code").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productUcode: text("product_ucode").notNull(),
    planName: text("plan_name"),
    /** Auditoria. NUNCA entra na decisão de acesso. */
    status: text("status").notNull(),
    /** Fonte da verdade do acesso: assinante enquanto access_until > now. */
    accessUntil: integer("access_until", { mode: "timestamp_ms" }),
    lastTransaction: text("last_transaction"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("subscriptions_user_id_idx").on(t.userId)],
);

export const authTokens = sqliteTable(
  "auth_tokens",
  {
    /** SHA-256 do token opaco. O token em claro só existe no email. */
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("auth_tokens_user_id_idx").on(t.userId)],
);

export const webhookEvents = sqliteTable("webhook_events", {
  /** O `id` do evento Hotmart. Chave de idempotência. */
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  /** 'received' | 'processed' | 'ignored' */
  status: text("status").notNull(),
  note: text("note"),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

export const deletedAccounts = sqliteTable("deleted_accounts", {
  /** HMAC-SHA256 do email normalizado. Nenhum dado legível. */
  emailHash: text("email_hash").primaryKey(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }).notNull(),
});
