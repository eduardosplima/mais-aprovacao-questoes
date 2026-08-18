# Próxima fase — o WebKit

> Escrito em 2026-08-17 e revisado ao fim da rodada
> ([plano](superpowers/plans/2026-08-17-safari-ano-midia.md)), que entregou os
> outros dois itens e a correção do Safari. Sobrou um. Ele é **autocontido**:
> traz o diagnóstico já feito, o que foi descartado e por quê, e o que falta
> decidir. A intenção é que este documento baste, sem precisar reconstruir o
> raciocínio.

---

## 1. WebKit na suíte e2e — 35 falhas sem causa confirmada

**Estado:** o binário do WebKit está instalado (`webkit-2311` em
`~/Library/Caches/ms-playwright/`). A mudança de configuração foi **revertida**
— comitar uma config que deixa a suíte vermelha é pior que não comitar.

### O que se sabe

Uma rodada completa com os dois navegadores deu **chromium 100% verde, WebKit
com 35 falhas**:

| Spec | Falhas |
|---|---|
| `caminho-critico` | 11 |
| `editor` | 6 |
| `lista` | 5 |
| `visual` | 4 |
| `taxonomias` | 3 |
| `validacao` | 3 |
| `login` | 2 |
| `preview` | 1 |

Este catálogo é anterior às mudanças que esta rodada fez em `visual.spec.ts`
(um teste alterado, um acrescentado) — a linha `visual | 4` é um piso, não a
contagem atual do arquivo.

Duas amostras foram lidas antes de o catálogo detalhado se perder:

- `login.spec.ts` — o teste expira esperando um elemento de pós-login, com a
  página ainda mostrando o formulário de login.
- `visual.spec.ts` → "os botões de inserção e o rodapé do editor exibem
  ícone junto do texto" — falha **depois** do login ter funcionado, num
  `toHaveCount` de `svg` que volta 0.

**Há mais de uma causa.** A hipótese inicial — `api/src/lib/cookies.ts:8` marca
o cookie de sessão como `secure: true`, e o WebKit recusa cookie `Secure` sobre
`http://localhost`, ao contrário do Chromium — explica no máximo parte do
conjunto, porque em `visual.spec.ts` o login funcionou.

### Como refazer

Acrescentar um projeto ao lado do `chromium` em
`web/admin/e2e/playwright.config.ts`:

```ts
{ name: "webkit", use: { ...devices["Desktop Safari"] } },
```

**Não mexer em `workers: 1` nem em `fullyParallel: false`.** Há um D1 local só e
cada spec chama `semear()` no `beforeAll`, que apaga tabelas; paralelismo entre
dois projetos vira corrida entre o seed de um e os testes do outro.

Regenerar o catálogo: `cd web && npm run test -w admin -- --project=webkit`.
**Copiar `web/admin/test-results/` para fora antes de rodar qualquer outra
coisa** — o Playwright limpa esse diretório no início de cada rodada, e foi
assim que o catálogo se perdeu da primeira vez.

### As saídas, e por que nenhuma foi tomada

| Saída | O que pesa contra |
|---|---|
| Tornar `secure` condicional ao protocolo em `cookies.ts` | Altera código sensível a segurança para acomodar teste. Vai contra a postura fail-closed do projeto |
| Servir o dev em HTTPS (`next dev --experimental-https`) | Muda o ferramental de desenvolvimento de todos. Só `:3000` precisaria de TLS — o proxy interno para o `wrangler dev` em `:8787` pode seguir em http |
| Recortar o WebKit a um subconjunto de specs | Entrega menos cobertura do que se pretendia. E o spec que mais interessa (`visual.spec.ts`) está entre os vermelhos |

### O que isto ainda mudaria

**Nada fica bloqueado.** A correção da sobreposição de ícone e texto nos
`<select>` do Safari foi entregue em 2026-08-17: `appearance-none` mais uma
seta desenhada pelo projeto (`IconeSeta` e a prop `seta` do `Controle`).

O que o WebKit mudaria agora é só a **qualidade do teste**. Hoje
`visual.spec.ts` afirma a *causa* — `appearance: none` — porque o *sintoma* não
é observável no chromium: lá o `padding-left` é honrado com ou sem
`appearance-none`, então afirmá-lo passaria dos dois jeitos e não seria
regressão nenhuma. Com o WebKit na suíte, o teste passaria a afirmar
`padding-left` = `44px` num navegador onde isso de fato distingue o código
corrigido do quebrado.

É cobertura melhor, não cobertura ausente. Por isso este item deixou de ter
urgência.

**Verificação ainda pendente, fora da suíte:** ninguém abriu o painel no
Safari de verdade para olhar o `<select>` corrigido. O teste automatizado
prova a causa (`appearance: none`), não o resultado visual — essa checagem
manual segue em aberto.

---

## O que NÃO está pendente

Para não reabrir por engano o que já foi decidido:

| Item | Situação |
|---|---|
| Email do admin vindo do Access | Adiado deliberadamente para conversa própria. Mexe no modelo de duas identidades e no `/auth/login`, que o sub-projeto 4 vai herdar |
| Dark theme | Decidido não fazer. O Turnstile foi fixado em `light` por causa disso |
| Vídeo sem gabarito bloqueando o salvamento | Comportamento novo e aprovado. Se incomodar, são ~4 linhas em `web/admin/src/lib/validacao.ts` |
| Rótulos `DISPUTE`/`PROTEST` e `CANCELED`/`EXPIRED` | Divergências de auditoria achadas na conferência dos payloads da Hotmart. Não afetam acesso; ficaram para uma rodada futura |
