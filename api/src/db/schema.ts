import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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

/**
 * O admin não é um usuário. Não tem `id` — a chave natural é o email, que é
 * o que o token do Access carrega — e não tem `role`, porque a tabela inteira
 * é o papel. Ter linha aqui só prova que existe senha; o direito de ser admin
 * vem de `ADMIN_EMAILS`, que nenhum código escreve.
 */
export const admins = sqliteTable("admins", {
  email: text("email").primaryKey(),
  passwordHash: text("password_hash").notNull(),
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

/**
 * Uma tabela para as quatro taxonomias (assunto, banca, cargo, nível), porque
 * o CRUD das quatro é idêntico. O preço é que nada aqui impede `banca_id`
 * apontar para um termo de `kind='cargo'` — SQLite não faz CHECK com subquery.
 * A invariante vive em `db/taxonomy.ts` e num teste dedicado.
 */
export const taxonomyTerms = sqliteTable(
  "taxonomy_terms",
  {
    id: text("id").primaryKey(),
    /** 'subject' | 'banca' | 'cargo' | 'level' */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** NULL = ativo. Soft delete: termo apagado some da escolha mas as
     *  questões antigas continuam exibindo o nome dele. */
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    // Parcial: sem o WHERE, apagar "Cespe" e recriá-la colidiria com a linha morta.
    uniqueIndex("taxonomy_terms_kind_slug_idx")
      .on(t.kind, t.slug)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    /** 'multiple_choice' | 'true_false' */
    type: text("type").notNull(),
    /** HTML já sanitizado por lib/sanitizeHtml. Nunca gravar HTML cru. */
    statement: text("statement").notNull(),
    /**
     * Sem `onDelete` de propósito: `NO ACTION` é o padrão do SQLite e é o
     * fail-safe certo aqui. Termo de taxonomia nunca sofre hard delete — o
     * módulo só faz soft delete (`db/taxonomy.ts`) —, então a ação nunca
     * dispara. Se um DELETE cru aparecer um dia, `NO ACTION` recusa apagar um
     * termo em uso, em vez de levar as questões junto (CASCADE) ou deixar a
     * questão sem assunto (SET NULL).
     */
    subjectId: text("subject_id")
      .notNull()
      .references(() => taxonomyTerms.id),
    bancaId: text("banca_id")
      .notNull()
      .references(() => taxonomyTerms.id),
    cargoId: text("cargo_id").references(() => taxonomyTerms.id),
    levelId: text("level_id").references(() => taxonomyTerms.id),
    year: integer("year").notNull(),
    /** 'draft' | 'published' — o aluno só enxerga 'published'. */
    status: text("status").notNull().default("draft"),
    /** SET NULL: a questão é conteúdo da plataforma, não dado pessoal de quem
     *  a cadastrou. Se o admin excluir a conta, a questão fica sem autoria. */
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("questions_subject_idx").on(t.subjectId),
    index("questions_banca_idx").on(t.bancaId),
    index("questions_status_idx").on(t.status),
  ],
);

export const alternatives = sqliteTable(
  "alternatives",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    /** 0-based. Define a letra exibida (0=A, 1=B…). */
    position: integer("position").notNull(),
    body: text("body").notNull(),
    /** Exatamente uma por questão vale 1 — invariante validada na escrita. */
    isCorrect: integer("is_correct").notNull().default(0),
  },
  (t) => [index("alternatives_question_idx").on(t.questionId)],
);

export const explanations = sqliteTable("explanations", {
  questionId: text("question_id")
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  /** URL do Cloudflare Stream. Só a URL — desacopla o vídeo do resto. */
  videoUrl: text("video_url"),
});
