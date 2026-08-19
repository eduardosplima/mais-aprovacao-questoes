# Onde estamos e o que vem a seguir

> **Ponto de entrada para uma janela de contexto nova.** Diz o estado, o que
> bloqueia, qual é o próximo passo, e o que já foi decidido — para não reabrir
> por engano o que foi fechado de propósito. Os detalhes moram nos runbooks e
> nos planos linkados; aqui fica só o que orienta a decisão.
>
> Atualizado em **2026-08-18**. O WebKit, que já deu nome a este documento,
> saiu da lista de pendências nessa data: a suíte e2e roda verde em chromium e
> WebKit. O registro do que era e do que foi encontrado ficou mais abaixo,
> porque duas coisas que ele afirmava estavam erradas e vale saber por quê.

## Estado — 2026-08-18

| Frente | Estado |
|---|---|
| **Sub-projeto 1** — fundação: auth própria, webhook Hotmart, reconciliação, cron | Construído e **publicado** |
| **Sub-projeto 2** — API admin + painel administrativo | Construído e **publicado**. O painel funciona ponta a ponta |
| **Login do admin** — separado do sub-projeto 2, spec própria ([`2026-08-18-login-admin-design.md`](superpowers/specs/2026-08-18-login-admin-design.md)) | Construído na branch `login-admin`, **não publicado** |
| **Sub-projetos 3 e 4** | Não iniciados |
| **Fase 12** do runbook — verificação contra o sandbox | Em andamento, e é onde a atenção está |
| **Fase 13** — virar para produção | Em aberto, por decisão do dono |

Três ressalvas que mudam o que dá para prometer:

- **`master` está à frente do que está publicado.** Dois lotes de conserto de
  painel esperam deploy: o `67eb803` (preview de vídeo, aviso de falha no
  seletor de taxonomia) e o erro de preenchimento no cadastro de taxonomia, de
  2026-08-18 — que trocou o balão nativo do navegador pelo padrão de erro do
  painel e passou a barrar nome só com espaços no cliente. Todos são de
  `web/admin`: publicá-los é o deploy do Pages sozinho, sem tocar no Worker.
  Nenhum é defeito de caminho feliz, então não corre.
- **O fluxo do aluno não fecha.** `api/src/lib/email.ts:48` monta o link
  mágico apontando para `/definir-senha`, que é tela do sub-projeto 4 e não
  existe. Um comprador real recebe o email e cai num 404. O que fecha hoje é
  compra → conta criada no banco → email enviado. O painel administrativo não
  passa por aí: entra com senha.
- **O login do admin está pronto e não publicado.** A branch `login-admin`
  fecha o modelo antigo — admin como linha de `users` com `role='admin'`,
  nascida de uma compra com email em `ADMIN_EMAILS` — e implementa o que a
  spec descreve: admin é a interseção de `ADMIN_EMAILS`
  (`api/wrangler.jsonc`) com uma senha na tabela `admins`, criada só pelo
  `npm run admin:senha`; o painel autentica atrás do Cloudflare Access, sem
  campo de email nem Turnstile na tela de login. Publicar exige, nesta ordem
  (detalhada na spec, §11): aplicar a migração aditiva que cria `admins`,
  publicar o Worker, rodar `admin:senha` para os três emails, publicar o
  Pages do painel, só então aplicar a migração que dropa `users.role`, e
  configurar a aplicação do Cloudflare Access (ligar o *Enable Binding
  Cookie*). Nenhum passo depende do ucode da Hotmart.

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

## Fechado em 2026-08-18: WebKit na suíte e2e

A suíte roda em **chromium e WebKit**, 54 testes em cada, verde nos dois. O
catálogo de 35 falhas que este documento carregava está obsoleto — e estava
errado em dois pontos, que só apareceram quando a medição foi refeita.

**Eram 38 falhas, não 35** (a suíte cresceu desde a contagem antiga), e **todas
tinham a mesma causa**, não várias. A nota de que `visual.spec.ts` falhava
"depois do login ter funcionado" lia o sintoma errado: aquele teste falhava
porque a página era o `/login`, e `getByRole('link', { name: 'Nova questão' })`
devolvia zero elementos.

### Causa 1 — o cookie `Secure` sobre http

Provado com o pote de cookies do navegador: o Worker responde
`Set-Cookie: session=…; HttpOnly; Secure; SameSite=Lax`, o WebKit descarta, o
Chromium guarda. O WebKit não aceita cookie `Secure` por http nem em
`localhost`; o Chromium trata `localhost` como origem confiável.

**Saída escolhida: TLS só no servidor que o Playwright sobe.**
`api/src/lib/cookies.ts` ficou **intocado** — nenhum ramo de desenvolvimento
entrou no código de segurança, e o `secure: true` que os testes exercitam é
exatamente o de produção. `npm run dev` continua em http.

As outras duas saídas que este documento listava foram descartadas com motivo:
tornar `secure` condicional faria a suíte inteira, chromium incluído, deixar de
exercitar o cookie real; recortar o WebKit a um subconjunto entrega menos
cobertura justamente onde o cliente trabalha.

O certificado é auto-assinado, gerado sob demanda por
`web/admin/e2e/certificado.mjs` com o `openssl` do sistema. Nada é baixado — o
`--experimental-https` do Next só busca o mkcert quando não recebe um par de
chave e certificado, e aqui ele recebe.

### Causa 2 — hidratação do React

Só apareceu depois que a primeira caiu, e é a que explicava o resíduo
intermitente. Preencher o formulário antes de o React hidratar faz a hidratação
restaurar o input controlado para `""` — **só o primeiro campo**, porque o
segundo já é preenchido depois. O `required` do email vazio então faz a
validação nativa do navegador cancelar o submit **em silêncio**: nenhuma
requisição sai, nenhuma mensagem aparece, e o teste só acusa que continuou em
`/login`.

A correção é `aguardarFormularioVivo()` em `web/admin/e2e/entrar.ts`, chamada
antes de qualquer preenchimento: espera o botão "Entrar" habilitar, que é o
único sinal que depende das duas condições — React vivo (o botão só liga por
estado) e token do Turnstile presente.

**Isto vale para o chromium também.** Ele nunca expôs a falha porque hidrata
rápido o bastante, mas a corrida sempre esteve lá.

### O que continua sendo verdade

`visual.spec.ts` ainda afirma a *causa* (`appearance: none`) em vez do
*sintoma* (`padding-left`). Com o WebKit na suíte, dá para apertar isso: agora
existe um navegador onde o `padding-left` de fato distingue o código corrigido
do quebrado. É melhoria de teste, não lacuna — a correção do `<select>` já foi
entregue e conferida a olho no Safari.

Cinco testes de rolagem horizontal de `caminho-critico.spec.ts` passavam
**vazios** durante o período vermelho: sem sessão, eles mediam a tela de login
em vez da tela que dizem medir. Agora medem a certa.

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
| Dark theme | Decidido não fazer. O Turnstile foi fixado em `light` por causa disso |
| Vídeo sem gabarito bloqueando o salvamento | Comportamento novo e aprovado. Se incomodar, são ~4 linhas em `web/admin/src/lib/validacao.ts` |
| Rótulos `DISPUTE`/`PROTEST` e `CANCELED`/`EXPIRED` | Divergências de auditoria achadas na conferência dos payloads da Hotmart. Não afetam acesso; ficaram para uma rodada futura |
