import { expect, type Page } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";

/**
 * Entra no painel do jeito que o operador entra. Um lugar só, porque seis
 * specs precisam disto como pré-condição.
 *
 * `login.spec.ts` e o primeiro teste de `caminho-critico.spec.ts` NÃO usam
 * este helper de propósito: nesses dois o login é o objeto do teste, não a
 * pré-condição — se ele mudar, quero ver o teste do login falhar, não o
 * helper esconder a mudança.
 */
export async function entrar(page: Page): Promise<void> {
  await page.goto("/login");
  await aguardarFormularioVivo(page);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
}

/**
 * Espera o formulário estar de fato interativo antes de preencher.
 *
 * Sem isto o teste fica intermitente, e falha de um jeito que não parece o que
 * é: preencher antes de o React hidratar faz a hidratação restaurar o input
 * controlado para "" — só o primeiro campo, porque o segundo já é preenchido
 * depois. O `required` do email vazio então faz a validação nativa cancelar o
 * submit **em silêncio**: nenhuma requisição sai, nenhuma mensagem aparece, e
 * o teste só acusa que continuou em /login.
 *
 * O botão habilitado é o sinal certo porque ele depende das duas coisas: só
 * liga por estado do React (logo, hidratado) e só quando o Turnstile devolve
 * o token (login/page.tsx, `disabled={!token}`). O prazo é maior que o padrão
 * de 5 s porque o token vem pela rede, da Cloudflare.
 */
export async function aguardarFormularioVivo(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled({
    timeout: 20_000,
  });
}
