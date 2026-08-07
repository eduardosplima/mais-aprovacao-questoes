import { ApiError } from "./api";

const MENSAGEM: Record<string, string> = {
  // corpo e query
  invalid_request: "Confira os campos — algum valor está fora do formato esperado.",
  invalid_kind: "Tipo de taxonomia desconhecido.",
  invalid_status: "Filtro de situação inválido.",
  invalid_year: "Ano inválido. Use um valor entre 1900 e 2200.",
  // conflito e ausência
  duplicate: "Já existe um termo ativo com esse nome.",
  not_found: "Registro não encontrado. Ele pode ter sido excluído por outra pessoa.",
  // invariantes de questão
  exactly_one_correct: "Marque exatamente uma alternativa como correta.",
  true_false_needs_two: "Questão de certo/errado precisa de exatamente duas alternativas.",
  needs_two_alternatives: "Múltipla escolha precisa de pelo menos duas alternativas.",
  invalid_subject: "Assunto inválido ou excluído. Escolha outro.",
  invalid_banca: "Banca inválida ou excluída. Escolha outra.",
  invalid_cargo: "Cargo inválido ou excluído. Escolha outro.",
  invalid_level: "Nível inválido ou excluído. Escolha outro.",
  // mídia
  missing_file: "Selecione um arquivo.",
  too_large: "Imagem acima de 2 MB. Reduza antes de enviar.",
  unsupported_type: "Formato não suportado. Use PNG, JPEG, WebP ou GIF.",
  // sessão
  invalid_credentials: "Email ou senha inválidos.",
  captcha_failed: "Não conseguimos confirmar que você não é um robô. Recarregue a página.",
  unauthorized: "Sua sessão expirou. Entre novamente.",
  forbidden: "Sua conta não tem permissão de administrador.",
};

export function mensagemDe(erro: unknown): string {
  if (erro instanceof ApiError) {
    return MENSAGEM[erro.codigo] ?? `Erro inesperado (${erro.codigo}).`;
  }
  // Falha de rede: o fetch rejeita sem status nem corpo.
  return "Não foi possível falar com o servidor. Verifique a conexão.";
}
