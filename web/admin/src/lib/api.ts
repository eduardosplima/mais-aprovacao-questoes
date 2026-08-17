/**
 * Cliente do Worker.
 *
 * Caminho relativo sempre: em produção o Pages e o Worker dividem
 * `admin.<domínio>` por Worker Route, e em dev o `next dev` reescreve os
 * mesmos dois prefixos. Nos dois casos a chamada é same-origin — por isso
 * `credentials: "same-origin"` basta, e nenhum código de CORS existe aqui.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
  ) {
    super(codigo);
    this.name = "ApiError";
  }
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const res = await fetch(caminho, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : init?.body
          ? { "content-type": "application/json" }
          : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(res.status, corpo?.error ?? "erro_desconhecido");
  }
  return (await res.json()) as T;
}

const json = (dados: unknown) => JSON.stringify(dados);

// ---- tipos, espelhando api/src/db/questions.ts e api/src/db/taxonomy.ts ----

export type TipoQuestao = "multiple_choice" | "true_false";
export type SituacaoQuestao = "draft" | "published";
export type TipoTermo = "subject" | "banca" | "cargo" | "level";

export interface Usuario {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tier: string;
}

export interface Termo {
  id: string;
  kind: TipoTermo;
  name: string;
  slug: string;
}

export interface LinhaQuestao {
  id: string;
  statement: string;
  type: TipoQuestao;
  status: SituacaoQuestao;
  year: number | null;
  subjectName: string | null;
  bancaName: string | null;
}

export interface Alternativa {
  id?: string;
  position?: number;
  body: string;
  isCorrect: boolean;
}

export interface Questao {
  id: string;
  type: TipoQuestao;
  statement: string;
  subjectId: string;
  bancaId: string;
  cargoId: string | null;
  levelId: string | null;
  year: number | null;
  status: SituacaoQuestao;
  alternatives: Required<Alternativa>[];
  explanation: { body: string; videoUrl: string | null } | null;
}

/** O corpo que POST e PATCH aceitam. `status` só existe no POST. */
export interface EntradaQuestao {
  type: TipoQuestao;
  statement: string;
  subjectId: string;
  bancaId: string;
  cargoId?: string | null;
  levelId?: string | null;
  year: number;
  alternatives: { body: string; isCorrect: boolean }[];
  explanation?: { body: string; videoUrl?: string | null };
}

export interface FiltrosQuestao {
  subjectId?: string;
  bancaId?: string;
  cargoId?: string;
  levelId?: string;
  year?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

function queryDe(filtros: FiltrosQuestao): string {
  const p = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    // Filtro vazio é "sem filtro" — a API normaliza string vazia para ausente
    // (api/src/routes/admin/questions.ts:129), mas não mandar é mais honesto.
    if (valor !== undefined && valor !== null && String(valor) !== "") {
      p.set(chave, String(valor));
    }
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  // ---- sessão ----
  me: () => chamar<Usuario>("/auth/me"),
  entrar: (email: string, senha: string, turnstileToken?: string) =>
    chamar<{ ok: true }>("/auth/login", {
      method: "POST",
      body: json({ email, password: senha, turnstileToken }),
    }),
  sair: () => chamar<{ ok: true }>("/auth/logout", { method: "POST" }),

  // ---- taxonomias ----
  termos: (kind: TipoTermo) =>
    chamar<{ terms: Termo[] }>(`/admin/taxonomy?kind=${kind}`).then(
      (r) => r.terms,
    ),
  criarTermo: (kind: TipoTermo, name: string) =>
    chamar<{ term: Termo }>("/admin/taxonomy", {
      method: "POST",
      body: json({ kind, name }),
    }).then((r) => r.term),
  renomearTermo: (id: string, name: string) =>
    chamar<{ term: Termo }>(`/admin/taxonomy/${id}`, {
      method: "PATCH",
      body: json({ name }),
    }).then((r) => r.term),
  excluirTermo: (id: string) =>
    chamar<{ ok: true }>(`/admin/taxonomy/${id}`, { method: "DELETE" }),

  // ---- questões ----
  questoes: (filtros: FiltrosQuestao = {}) =>
    chamar<{ rows: LinhaQuestao[]; total: number }>(
      `/admin/questions${queryDe(filtros)}`,
    ),
  questao: (id: string) =>
    chamar<{ question: Questao }>(`/admin/questions/${id}`).then(
      (r) => r.question,
    ),
  criarQuestao: (entrada: EntradaQuestao, status: SituacaoQuestao) =>
    chamar<{ id: string }>("/admin/questions", {
      method: "POST",
      body: json({ ...entrada, status }),
    }),
  salvarQuestao: (id: string, entrada: EntradaQuestao) =>
    chamar<{ ok: true }>(`/admin/questions/${id}`, {
      method: "PATCH",
      body: json(entrada),
    }),
  publicar: (id: string) =>
    chamar<{ ok: true }>(`/admin/questions/${id}/publish`, { method: "POST" }),
  despublicar: (id: string) =>
    chamar<{ ok: true }>(`/admin/questions/${id}/unpublish`, {
      method: "POST",
    }),
  excluirQuestao: (id: string) =>
    chamar<{ ok: true }>(`/admin/questions/${id}`, { method: "DELETE" }),

  // ---- mídia ----
  enviarImagem: (arquivo: File) => {
    const form = new FormData();
    form.set("file", arquivo);
    return chamar<{ url: string }>("/admin/media", {
      method: "POST",
      body: form,
    }).then((r) => r.url);
  },
};
