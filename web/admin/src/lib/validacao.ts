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

/** O enunciado é HTML do editor; vazio de verdade é só a moldura do TipTap. */
function vazio(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
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

  if (entrada.ano) {
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

  if (entrada.videoUrl && !/^https?:\/\//i.test(entrada.videoUrl)) {
    erros.videoUrl = "Use um endereço começando com http:// ou https://.";
  }

  return erros;
}

/** Rótulos para o resumo no topo, na ordem em que aparecem no formulário. */
export const ROTULO_CAMPO: Record<string, string> = {
  enunciado: "Enunciado",
  subjectId: "Assunto",
  bancaId: "Banca",
  ano: "Ano",
  gabarito: "Gabarito comentado",
  videoUrl: "Vídeo do gabarito",
  alternativas: "Alternativas",
};
