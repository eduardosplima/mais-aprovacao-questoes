/**
 * Regras que o cliente sabe conferir antes de enviar.
 *
 * Deliberadamente um subconjunto do schema do servidor, não uma cópia dele:
 * aqui só entra o que dá para apontar num campo da tela. O que a API recusar
 * além disto continua caindo na mensagem genérica de `mensagemDe`, e a API
 * segue sendo a autoridade.
 */

export type CampoQuestao =
  | "enunciado"
  | "subjectId"
  | "bancaId"
  | "ano"
  | "gabarito"
  | "videoUrl"
  | `alternativa-${number}`
  | "alternativas";

export type ErrosQuestao = Partial<Record<CampoQuestao, string>>;

/**
 * O enunciado é HTML do editor; vazio de verdade é só a moldura do TipTap.
 *
 * Uma `<img>` conta como conteúdo mesmo sem texto — o servidor aceita
 * enunciado puramente gráfico (`sanitizeHtml` mantém `img` na allowlist, o
 * editor tem upload de imagem) e barrar isso aqui seria falso positivo.
 */
function vazio(html: string): boolean {
  const semImagens = html.replace(/<img\b[^>]*>/gi, "x");
  return semImagens.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}

/**
 * Mesma regra do servidor (api/src/routes/admin/questions.ts:33-42), copiada
 * em vez de importada: aquele arquivo é rota de Worker, este é lib do painel.
 * `new URL` recusa protocolo relativo, espaço e host malformado — um regex
 * feito à mão divergiria desses casos de borda e devolveria mensagem
 * contraditória (barrar o que a API aceitaria) ou a genérica (deixar passar
 * o que a API recusaria).
 */
function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function validarQuestao(entrada: {
  enunciado: string;
  subjectId: string;
  bancaId: string;
  ano: string;
  gabarito: string;
  videoUrl: string;
  alternativas: { body: string; isCorrect: boolean }[];
}): ErrosQuestao {
  const erros: ErrosQuestao = {};

  if (vazio(entrada.enunciado)) {
    erros.enunciado = "Escreva o enunciado da questão.";
  }
  // explanation.body é z.string().min(1) no servidor
  // (api/src/routes/admin/questions.ts:65) — obrigatório, não opcional.
  if (vazio(entrada.gabarito)) {
    erros.gabarito = "Escreva o gabarito comentado.";
  }
  if (!entrada.subjectId) erros.subjectId = "Escolha o assunto.";
  if (!entrada.bancaId) erros.bancaId = "Escolha a banca.";

  // `vazio()` não serve aqui: ele existe para HTML de editor rico, remove
  // tags e trata <img> como conteúdo. O ano é texto puro vindo de um input
  // que já filtra não-dígitos (editar/page.tsx:289).
  if (!entrada.ano.trim()) {
    erros.ano = "Informe o ano da questão.";
  } else {
    const n = Number(entrada.ano);
    if (n < 1900 || n > 2200) erros.ano = "Use um ano entre 1900 e 2200.";
  }

  entrada.alternativas.forEach((alt, i) => {
    if (alt.body.trim() === "") {
      erros[`alternativa-${i}`] = "Preencha o texto desta alternativa.";
    }
  });

  if (entrada.alternativas.filter((a) => a.isCorrect).length !== 1) {
    // Mesma frase de erros.ts para o código exactly_one_correct — o operador
    // não deve receber texto diferente conforme quem barrou.
    erros.alternativas = "Marque exatamente uma alternativa como correta.";
  }

  if (entrada.videoUrl && !isHttpUrl(entrada.videoUrl)) {
    erros.videoUrl = "Use um endereço começando com http:// ou https://.";
  }

  return erros;
}

/**
 * Rótulos para o resumo no topo. A ordem exibida não vem daqui: o resumo
 * itera `Object.entries(erros)`, cuja ordem é a de inserção dos campos em
 * `validarQuestao`.
 */
export const ROTULO_CAMPO: Record<string, string> = {
  enunciado: "Enunciado",
  subjectId: "Assunto",
  bancaId: "Banca",
  ano: "Ano",
  gabarito: "Gabarito comentado",
  videoUrl: "Vídeo do gabarito",
  alternativas: "Alternativas",
};
