# Onde estamos e o que vem a seguir

> **Ponto de entrada para uma janela de contexto nova.** Diz o estado, o que
> bloqueia, qual é o próximo passo, e o que já foi decidido — para não reabrir
> por engano o que foi fechado de propósito. Os detalhes moram nos runbooks e
> nos planos linkados; aqui fica só o que orienta a decisão.
>
> Atualizado em **2026-08-18**. O título anterior era "Próxima fase — o
> WebKit", o que enganava: o WebKit é o item **menos** urgente da lista, e o
> próprio dossiê dele (mantido íntegro mais abaixo) diz que nada fica
> bloqueado por ele.

## Estado — 2026-08-18

| Frente | Estado |
|---|---|
| **Sub-projeto 1** — fundação: auth própria, webhook Hotmart, reconciliação, cron | Construído e **publicado** |
| **Sub-projeto 2** — API admin + painel administrativo | Construído e **publicado**. O painel funciona ponta a ponta |
| **Sub-projetos 3 e 4** | Não iniciados |
| **Fase 12** do runbook — verificação contra o sandbox | Em andamento, e é onde a atenção está |
| **Fase 13** — virar para produção | Em aberto, por decisão do dono |

Duas ressalvas que mudam o que dá para prometer:

- **`master` está à frente do que está publicado.** O commit `67eb803` traz
  dois consertos de painel (preview de vídeo, aviso de falha no seletor de
  taxonomia) que ainda não subiram. São só de `web/admin` — publicá-los é o
  deploy do Pages sozinho, sem tocar no Worker. Nenhum é defeito de caminho
  feliz, então não corre.
- **O fluxo do aluno não fecha.** `api/src/lib/email.ts:48` monta o link
  mágico apontando para `/definir-senha`, que é tela do sub-projeto 4 e não
  existe. Um comprador real recebe o email e cai num 404. O que fecha hoje é
  compra → conta criada no banco → email enviado. O painel administrativo não
  passa por aí: entra com senha.

## O próximo passo: coletar o ucode

**É o único item bloqueante do projeto inteiro**, e não é código — é uma volta
no painel do sandbox da Hotmart.

`HOTMART_SUBSCRIPTION_UCODES` ainda é `REPLACE_WITH_REAL_UCODES` em
`api/wrangler.jsonc`. Enquanto for, o cron das 3h percorre a listagem inteira
todo dia e não casa com nada, e a §7 (reconciliação) da fase 12 fica
travada. O ucode é pedido na fase 11 do runbook de deploy, mora na fase 6 e
destrava a fase 12 — é o único valor que atravessa três fases.

Na mesma sessão de sandbox dá para fechar quase toda a fase 12: uma compra de
teste roda as §3–6 (ponta a ponta, recuperação, cancelamento, idempotência) e,
de quebra, resolve o `PURCHASE_EXPIRED` não capturado e os dois campos
divergentes que a §2 deixou em aberto. Sobram a §8 (Turnstile) e a §9 (LGPD),
que são conferência de log.

Estado detalhado, seção por seção:
[`runbook-verificacao-hotmart.md`](runbook-verificacao-hotmart.md).

## A bifurcação, depois da fase 12

A spec põe o **sub-projeto 3** (responder questões, cota via Durable Objects,
comentários, anotações, favoritos — o Mês 2) antes do **sub-projeto 4**
(frontend do aluno — o Mês 3).

Vale reabrir essa ordem uma vez, com um argumento só: o sub-projeto 4 é o que
faz `/definir-senha` existir, e portanto o único que fecha compra → acesso. Se
a prioridade for ter comprador real entrando na plataforma, ele vem primeiro.
Se a prioridade for ter o que mostrar dentro dela, a ordem da spec está certa.
**Não decidido.**

Quando o sub-projeto 4 começar, três itens do painel deixam de ser polimento e
viram pré-requisito — estão marcados como tal em
[`superpowers/plans/2026-08-07-painel-follow-ups.md`](superpowers/plans/2026-08-07-painel-follow-ups.md),
que é o ledger da dívida do painel.

## Dependência que corre sozinha

`nanoid` 3.3.18 sai do cooldown de 14 dias em **2026-08-21 16:41 UTC**. É o
último achado do audit nos dois workspaces; depois dele os dois ficam limpos
pela primeira vez. Não bloqueia nada e não exige decisão — só a data.

---

## Não é o próximo passo: WebKit na suíte e2e — 35 falhas sem causa confirmada

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

Este catálogo é anterior às mudanças que a rodada Safari/ano/mídia fez em
`visual.spec.ts` (um teste alterado, um acrescentado) — a linha `visual | 4` é
um piso, não a contagem atual do arquivo. **Em 2026-08-18 a suíte cresceu de
novo**: `preview` e `editor` ganharam um teste cada (`67eb803`), então as
linhas `editor | 6` e `preview | 1` também viraram piso. O catálogo precisa ser
regenerado de qualquer jeito; estes números servem só para dimensionar o
trabalho.

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

**A verificação visual foi feita e passou.** Em 2026-08-18, com o Worker e o
Pages já publicados, o painel foi aberto no Safari e os `<select>` apareceram
corretos. Isso fecha a única parte que a suíte não alcançava — o teste prova a
causa (`appearance: none`), e um humano confirmou o resultado.

---

## A dívida do painel mora em outro lugar

Polimento, lacuna de cobertura e dívida de empacotamento do sub-projeto 2 têm
ledger próprio, reconferido contra o código em 2026-08-18:
[`superpowers/plans/2026-08-07-painel-follow-ups.md`](superpowers/plans/2026-08-07-painel-follow-ups.md).
Os dois itens que faziam o painel mentir para o operador foram corrigidos
naquela data; o que resta ali é acessibilidade, tipos, cosmético e os três
pré-requisitos do sub-projeto 4.

---

## O que NÃO está pendente

Para não reabrir por engano o que já foi decidido:

| Item | Situação |
|---|---|
| Email do admin vindo do Access | Adiado deliberadamente para conversa própria. Mexe no modelo de duas identidades e no `/auth/login`, que o sub-projeto 4 vai herdar |
| Dark theme | Decidido não fazer. O Turnstile foi fixado em `light` por causa disso |
| Vídeo sem gabarito bloqueando o salvamento | Comportamento novo e aprovado. Se incomodar, são ~4 linhas em `web/admin/src/lib/validacao.ts` |
| Rótulos `DISPUTE`/`PROTEST` e `CANCELED`/`EXPIRED` | Divergências de auditoria achadas na conferência dos payloads da Hotmart. Não afetam acesso; ficaram para uma rodada futura |
