import { expect, type Page } from "@playwright/test";
import { SENHA } from "./credenciais.mjs";

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
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("/");
  // A troca de URL é só a metade: o `router.replace` do login ainda está
  // buscando e montando a árvore de "/" quando a asserção acima já passou —
  // Layout dispara `/admin/auth/me`, a própria página dispara
  // `/admin/questions`, tudo em voo. No WebKit, um `page.goto` disparado
  // nesse meio-tempo colide com esse tráfego e é visto como uma segunda
  // navegação concorrente, morrendo com "interrompida por outra navegação"
  // — falha que é do teste seguinte, não deste login. Esperar a rede
  // sossegar fecha essa janela antes de devolver o controle para quem
  // chamou.
  await page.waitForLoadState("networkidle");
}

/**
 * Espera o formulário estar de fato interativo antes de preencher.
 *
 * Preencher antes de o React hidratar faz a hidratação restaurar o input
 * controlado para "". O botão habilitado é o sinal certo porque ele só existe
 * depois que `/admin/auth/contexto` respondeu — o que implica React vivo e
 * estado carregado. O prazo é generoso porque a resposta vem do Worker.
 */
export async function aguardarFormularioVivo(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled({
    timeout: 20_000,
  });
}
