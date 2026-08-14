# Runbook — provisionamento e deploy de produção

> Passo a passo para configurar Cloudflare e Hotmart e publicar o que está
> construído: a **API** (fundação de autenticação + webhook + reconciliação +
> rotas do painel) e o **painel administrativo**.
>
> A ordem importa. Cada fase produz um valor que a fase seguinte consome — o
> `aud` do Access só existe depois da aplicação criada, o `database_id` só
> depois do D1, e a Hotmart só consegue entregar webhook depois do Worker
> publicado. Seguir de cima para baixo.
>
> Complementa o [`runbook-verificacao-hotmart.md`](runbook-verificacao-hotmart.md),
> que é a **fase 12** deste aqui.

## Leia isto antes de começar

Três coisas que este runbook descobriu e que mudam o que dá para prometer ao
final dele:

1. **O link mágico aponta para uma página que não existe.**
   `api/src/lib/email.ts:48` monta `${APP_BASE_URL}/definir-senha?token=…`, e o
   painel só tem `/login`, `/`, `/questoes/editar` e `/taxonomias`. A tela
   `/definir-senha` é do frontend do aluno (sub-projeto 4), que ainda não foi
   construído. **Consequência:** um comprador real recebe o email e cai num
   404. O fluxo compra → acesso não fecha com o que existe hoje; o que fecha é
   compra → conta criada no banco → email enviado.
   O painel administrativo, esse sim, funciona ponta a ponta — ele não usa link
   mágico, entra com senha (ver fase 11).

2. **Enviar email para o comprador depende de onboarding do domínio.** A
   documentação da Cloudflare é explícita: *antes* de onboarding do sending
   domain, o Worker só envia para endereços **verificados na conta**; *depois*,
   para qualquer destinatário. Sem essa etapa concluída, o provisionamento
   funciona no banco e falha no email — silenciosamente, do ponto de vista do
   comprador.

3. **Falta uma Worker Route para o webhook.** O `web/README.md` descreve duas
   rotas (`/admin/*` e `/auth/*`), mas o Worker também serve `/webhooks/hotmart`.
   Sem rota para ele, o caminho cai no Pages e a Hotmart recebe **404 em todo
   evento de compra**. Está coberto na fase 8.

---

## Topologia — leia antes de criar qualquer coisa

O domínio é `maisaprovacao.com.br`. São **três** hostnames, e o backend não é
nenhum deles.

```
admin.maisaprovacao.com.br     ← Access cobre o hostname inteiro
  /admin/*     → Worker   (dados do painel)
  /auth/*      → Worker   (login do painel)
  /*           → Pages    (as telas do painel)

app.maisaprovacao.com.br       ← sem Access
  /webhooks/*  → Worker   (Hotmart)
  /auth/*      → Worker   (login do aluno)      [sub-projeto 4]
  /*           → Pages    (front do aluno)      [sub-projeto 4]

media.maisaprovacao.com.br     ← sem Access
  bucket R2 público, hostname sem cookies
```

**Não existe `api.maisaprovacao.com.br`, e isso é decisão de projeto, não
esquecimento.** O Worker é montado *por cima* dos hostnames de frontend,
dividido por caminho. O painel chama caminho relativo e a chamada é
literalmente same-origin — está documentado no próprio código
(`web/admin/src/lib/api.ts:1-7`).

Dar hostname próprio ao backend quebraria três coisas de uma vez:

| O que quebra | Por quê |
|---|---|
| Cookie de sessão | O cliente usa `credentials: "same-origin"`, que não manda cookie para outra origem |
| Ausência de CORS | Passaria a exigir preflight, `Allow-Origin` e `Allow-Credentials` — middleware que o projeto não tem, deliberadamente |
| Access | Sem cookie válido, a borda responde **redirect para o IdP**; um `fetch` cross-origin não consegue segui-lo e você recebe erro opaco, não um 401 legível |

**Regra do Access, que cai do mapa acima:** ele é por hostname, e só o
`admin.` precisa dele. Dentro do `admin.` entra tudo; `app.` e `media.` ficam
inteiramente de fora. Não há caminho a excluir, nem exceção a manter.

> **Por que o webhook mora em `app.` e não em `admin.`** — ele precisa ficar
> fora do Access (a Hotmart não tem identidade no seu IdP). Se morasse em
> `admin.`, seria preciso uma exceção por política de *Bypass*, e exceção é
> frágil no tempo: daqui a seis meses alguém aperta a política, cobre um
> caminho a mais sem perceber, e as compras passam a falhar em silêncio.
> Hostname que nunca teve Access não regride para esse estado.
>
> Se preferir não mexer no `app.` antes do sub-projeto 4, o apex
> `maisaprovacao.com.br/webhooks/*` serve igual. O que importa é ser um
> hostname sem Access.

---

## Fase 0 — Registros DNS

| Hostname | Papel | Consumido por |
|---|---|---|
| `admin.maisaprovacao.com.br` | painel + API do painel | Worker Routes, Access, Pages |
| `app.maisaprovacao.com.br` | webhook hoje, aluno depois | Worker Route, `APP_BASE_URL` |
| `media.maisaprovacao.com.br` | bucket R2 | `MEDIA_PUBLIC_BASE` |

- [ ] Os três com registro DNS **proxied** (nuvem laranja).
- [ ] `app.` ainda não tem origem própria. Worker Route só funciona se existir
      registro DNS para o hostname, então crie um registro placeholder proxied
      agora — um `AAAA` para `100::` (prefixo de descarte) é o padrão para esse
      caso. O Worker atende antes de qualquer origem ser consultada.

> **`media.` merece atenção extra.** A URL absoluta da imagem é **persistida
> dentro do HTML da questão** (`api/src/routes/admin/media.ts` grava
> `${MEDIA_PUBLIC_BASE}/media/<uuid>.<ext>` no enunciado). Trocar essa base
> depois exige reescrever linhas do banco. Não use o `*.r2.dev` de
> conveniência.
>
> Por que sem cookies: um SVG malicioso servido do mesmo host da sessão
> executaria com o cookie do admin. Como o cookie é host-only (`Path=/`, sem
> atributo `Domain`), um subdomínio irmão já resolve.

---

## Fase 1 — D1 → produz `database_id`

```bash
cd api
npx wrangler d1 create mais-aprovacao-db
```

- [ ] Copiar o `database_id` da saída para `api/wrangler.jsonc:9`, no lugar de
      `REPLACE_WITH_REAL_ID_BEFORE_DEPLOY`.

---

## Fase 2 — R2 → produz `MEDIA_PUBLIC_BASE`

```bash
npx wrangler r2 bucket create mais-aprovacao-media
```

- [ ] Dashboard → R2 → `mais-aprovacao-media` → Settings → **Custom Domain** →
      `media.maisaprovacao.com.br`.
- [ ] Conferir que o domínio ficou ativo e que um objeto de teste é servido
      publicamente.
- [ ] `MEDIA_PUBLIC_BASE` = `https://media.maisaprovacao.com.br` — **sem barra
      final**.

> Preencher isto também conserta um teste: o e2e `editor.spec.ts:136` ("upload
> de imagem") falha hoje porque o `<img>` inserido recebe
> `src="https://REPLACE_ME_MEDIA_HOST/…"`, não carrega, fica com altura zero e
> o Playwright o considera invisível. O upload em si funciona.

---

## Fase 3 — Email Service → o gate do provisionamento

Esta é a fase que decide se comprador recebe email. Faça-a cedo: propagação de
DNS e verificação de domínio levam tempo, e é o risco nº 1 da seção 10 da spec.

- [ ] Dashboard → Email → **Email Sending** → onboarding do sending domain
      (`maisaprovacao.com.br`).
- [ ] Publicar os registros DNS pedidos. O SPF do return-path tem esta forma:
      `TXT cf-bounce.maisaprovacao.com.br  "v=spf1 include:_spf.mx.cloudflare.net ~all"`
      Somado ao DKIM que o dashboard gerar (seletor `cf-bounce`).
- [ ] Aguardar o domínio aparecer como **onboarded**. Antes disso, envio só
      para destinatários verificados na conta.
- [ ] `EMAIL_FROM` = `nao-responda@maisaprovacao.com.br`, dentro do domínio
      onboarded.

**Dois detalhes do binding para conferir na hora**, porque o produto está em
beta e a documentação se move:

- O binding já está declarado em `wrangler.jsonc` como `send_email` com
  `name: "EMAIL"`, que é o formato correto. A documentação do Email Service
  menciona também um `"remote": true` no binding — conferir se é exigido na
  versão corrente e acrescentar se for.
- O código chama `env.EMAIL.send({ to, from, subject, html, text })`
  (`api/src/lib/email.ts`), que é a forma de objeto do Email Service. Existe
  também a forma antiga, `new EmailMessage(from, to, rawMime)` do Email
  Routing. Se o envio falhar com erro de tipo, é essa a divergência — e a
  correção é uma função de ~15 linhas, como a spec previu.

- [ ] Teste de fumaça: enviar para um endereço **externo** (Gmail) e confirmar
      a chegada, inclusive spam.

---

## Fase 4 — Turnstile → produz duas chaves

- [ ] Dashboard → Turnstile → novo widget para `admin.maisaprovacao.com.br`
      (e depois para `app.`, quando o frontend do aluno existir).
- [ ] **Site key** → vai para o *build* do Pages (fase 9), não para o Worker.
- [ ] **Secret key** → vira segredo do Worker (fase 6).

> Atenção ao acoplamento: `web/admin/src/app/login/page.tsx:11` lê
> `NEXT_PUBLIC_TURNSTILE_SITE_KEY` com fallback `""`. Se a variável faltar no
> build, **o build passa** e o login quebra em produção, sem erro em lugar
> nenhum.

---

## Fase 5 — Zero Trust Access → produz `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD`

O Access é a **camada 1 de duas**, e as duas são independentes de propósito: o
email do JWT do Access **não** identifica o usuário na aplicação. Se
identificasse, o Access viraria fonte de identidade e as camadas deixariam de
ser duas. É por isso que o admin autentica duas vezes.

Fail-closed em `api/src/middleware/access.ts`: sem o header
`Cf-Access-Jwt-Assertion`, `/admin/*` devolve 401 antes de qualquer consulta ao
banco. Access mal configurado **quebra** o painel — não o expõe.

- [ ] Zero Trust → Settings → **Team domain**: `<seutime>.cloudflareaccess.com`.
      Esse é o `ACCESS_TEAM_DOMAIN`, **sem `https://` e sem barra final** — o
      código monta o issuer (`https://${ACCESS_TEAM_DOMAIN}`) e busca o JWKS em
      `${issuer}/cdn-cgi/access/certs`. Colar com o esquema junto produz
      `https://https://…`, e o `catch` devolve um 401 pelado, indistinguível de
      ataque.
- [ ] Access → Applications → **Self-hosted**, cobrindo
      `admin.maisaprovacao.com.br` — o hostname **inteiro**, sem exceção de
      caminho.
- [ ] Política: Google ou GitHub, com MFA, restrita aos seus emails.
- [ ] Copiar a **Application Audience (AUD) tag** → `ACCESS_AUD`.

**Uma aplicação só, um `aud` só.** O Worker valida contra exatamente um
`ACCESS_AUD`. Se um dia você criar uma segunda aplicação (staging, por
exemplo), ela terá AUD próprio e só um dos dois cabe na variável.

**Por que o hostname inteiro, e não só `/admin/*`.** O mínimo que o Worker
exige é que `/admin/*` esteja coberto, que é onde `requireAccess` roda
(`api/src/app.ts:32`). Mas cobrir só isso inverte a ordem da autenticação: as
telas ficariam públicas, você digitaria a senha primeiro e só quando o painel
fosse buscar dados o Access te redirecionaria para o IdP — redirect chegando no
meio de uma chamada `fetch`. Cobrindo o hostname inteiro, a ordem é a
projetada: IdP → painel → senha.

**Sobre `/auth/*` ficar dentro do Access.** Fica, e é o recomendado. Depois de
passar pelo Access o navegador carrega o cookie `CF_Authorization` daquele
hostname, e um `fetch("/auth/login")` same-origin o envia junto — o login
completa normalmente. O ganho é que o endpoint de login some da internet
aberta: só alcança quem já passou pelo seu IdP. O custo é que a Rate Limiting
Rule da fase 10 perde boa parte da utilidade **neste** hostname (ela continua
essencial no `app.`, onde o aluno entra sem Access).

- [ ] `app.` e `media.` **não** têm aplicação Access. Não é esquecimento: o
      aluno e o bucket são públicos, e é o que mantém o webhook alcançável.

---

## Fase 6 — Preencher `wrangler.jsonc` e subir os segredos

| Variável | Valor de produção | Vem da fase |
|---|---|---|
| `database_id` | id do D1 | 1 |
| `MEDIA_PUBLIC_BASE` | `https://media.maisaprovacao.com.br` | 2 |
| `EMAIL_FROM` | `nao-responda@maisaprovacao.com.br` | 3 |
| `ACCESS_TEAM_DOMAIN` | `<seutime>.cloudflareaccess.com` | 5 |
| `ACCESS_AUD` | tag AUD | 5 |
| `HOTMART_SUBSCRIPTION_UCODES` | ucodes, separados por vírgula | 11 |
| `HOTMART_CHECKOUT_URL` | link do checkout | — (ver nota) |
| `APP_BASE_URL` | `https://app.maisaprovacao.com.br` | topologia |
| `ADMIN_EMAILS` | **seu email** | agora |
| `HOTMART_API_BASE_URL` / `HOTMART_TOKEN_URL` | manter **sandbox** | 12 |

- [ ] `ADMIN_EMAILS` preenchido. Vazio, ninguém nunca vira admin — o papel só é
      concedido por essa allowlist, jamais pelo payload.
- [ ] `APP_BASE_URL` apontando para `app.`, ciente de que `/definir-senha`
      ainda não existe lá.
- [ ] `HOTMART_API_BASE_URL` e `HOTMART_TOKEN_URL` **continuam em sandbox** até
      o runbook de verificação passar. Virar para produção é a fase 13.

> `HOTMART_CHECKOUT_URL` é declarada em `config/env.ts:33` e **não é usada por
> nenhum código**. Preencher é inofensivo; é configuração morta, provavelmente
> destinada ao frontend do aluno.

Os seis segredos, um a um:

```bash
cd api
npx wrangler secret put JWT_SECRET             # segredo forte, aleatório
npx wrangler secret put DOCUMENT_HMAC_KEY      # pepper do HMAC de CPF
npx wrangler secret put TURNSTILE_SECRET_KEY   # fase 4
npx wrangler secret put HOTMART_HOTTOK         # fase 11
npx wrangler secret put HOTMART_CLIENT_ID      # fase 11
npx wrangler secret put HOTMART_CLIENT_SECRET  # fase 11
```

- [ ] `npx wrangler secret list` mostra os seis.
- [ ] Nenhum segredo aparece em `wrangler.jsonc`.
- [ ] `ACCESS_DEV_BYPASS` **não** existe em produção (só em `.dev.vars`).

> **`DOCUMENT_HMAC_KEY` não pode mudar depois.** Ele é o pepper do HMAC de CPF;
> trocá-lo invalida todo `document_hash` já gravado e quebra a recuperação de
> acesso de quem já comprou. Gere uma vez, guarde fora da máquina.
>
> **`HOTMART_CLIENT_SECRET` tem poder destrutivo** (spec §5): quem o obtiver
> pode cancelar a base de assinantes. Se a Hotmart permitir credencial
> somente-leitura, use uma para o cron.

---

## Fase 7 — Migrar o banco e publicar o Worker

```bash
cd api
npx wrangler d1 migrations apply mais-aprovacao-db --remote   # note o --remote
npm run deploy
```

- [ ] As duas migrações aplicadas no D1 **remoto**. O `npm run db:migrate:local`
      existente é `--local` e não serve aqui; não há script para o remoto.
- [ ] Cron `0 3 * * *` aparece no dashboard do Worker (vem do `wrangler.jsonc`).
- [ ] Smoke test depois da fase 8:
      `curl https://admin.maisaprovacao.com.br/health` → `{"ok":true}`
      (de dentro do Access, ou ele responde com o redirect do IdP).

---

## Fase 8 — Worker Routes → três, em dois hostnames

Uma Worker Route casa a URL e **não a reescreve**, então os padrões usam os
caminhos que o Worker já serve, sem prefixo:

| Padrão | Serve |
|---|---|
| `admin.maisaprovacao.com.br/admin/*` | Worker — conteúdo do painel |
| `admin.maisaprovacao.com.br/auth/*` | Worker — login do painel |
| `app.maisaprovacao.com.br/webhooks/*` | Worker — **webhook da Hotmart** |
| `admin.maisaprovacao.com.br/*` | Pages — o painel |

- [ ] As três rotas do Worker criadas, apontando para `mais-aprovacao-api`.
- [ ] A do webhook é a que falta na documentação atual. Sem ela, o
      `POST /webhooks/hotmart` devolve 404 para toda compra.
- [ ] Confirmar que o painel **não** tem página em `/admin` nem em `/auth` — as
      rotas do Worker capturam esses caminhos antes do Pages.

---

## Fase 9 — Pages → o painel

O build é estático (`output: 'export'`) e a site key entra **no build**:

```bash
cd web
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key da fase 4> npm run build
npx wrangler pages deploy admin/out --project-name=mais-aprovacao-admin
```

- [ ] Projeto Pages criado e ligado a `admin.maisaprovacao.com.br`.
- [ ] Se usar build automático pelo Git, cadastrar
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY` nas variáveis de build do projeto.
- [ ] Abrir `https://admin.maisaprovacao.com.br/login` — passando primeiro pelo
      IdP — e confirmar que o widget do Turnstile **renderiza** (se a site key
      faltou, ele não aparece).

---

## Fase 10 — Rate Limiting Rules

Proteção de borda, configuração e não código (spec §5).

- [ ] Regra em `app.maisaprovacao.com.br/auth/*` — força bruta de login e
      email-bombing na recuperação. É onde o aluno entra, sem Access na frente.
- [ ] Regra em `app.maisaprovacao.com.br/webhooks/hotmart` — superfície pública
      hostil.
- [ ] Em `admin.`, o Access já filtra antes; regra ali é redundância barata,
      não necessidade.

---

## Fase 11 — Hotmart (sandbox) e o primeiro admin

- [ ] Painel Hotmart → Ferramentas → **Webhook**: URL
      `https://app.maisaprovacao.com.br/webhooks/hotmart`, versão **2.0.0**,
      eventos: `PURCHASE_APPROVED`, `PURCHASE_DELAYED`, `PURCHASE_CANCELED`,
      `PURCHASE_EXPIRED`, `PURCHASE_REFUNDED`, `PURCHASE_CHARGEBACK`,
      `PURCHASE_PROTEST`, `SUBSCRIPTION_CANCELLATION`.
- [ ] Copiar o **hottok** → segredo `HOTMART_HOTTOK`.
- [ ] Ferramentas → Credenciais → `client_id` / `client_secret` da API de
      dados, com leitura de assinaturas **e** cancelamento.
- [ ] **Exigir CPF no checkout.** Sem isso a recuperação de acesso recai só no
      email, e a validação por documento deixa de existir.
- [ ] Anotar os **ucodes** dos produtos de assinatura →
      `HOTMART_SUBSCRIPTION_UCODES`.

**O primeiro admin — problema do ovo e da galinha.** `role=admin` só é
concedido em dois lugares (`webhooks/hotmart.ts:169` e `jobs/reconcile.ts:117`),
os dois exigindo uma compra cujo email esteja em `ADMIN_EMAILS`. Não existe
cadastro de admin. Duas saídas:

- **Compra de teste no sandbox** com o email que está em `ADMIN_EMAILS` — cria
  a conta com `role=admin` e envia o link mágico. Mas o link cai em
  `app.maisaprovacao.com.br/definir-senha`, que não existe: pegue o token na
  query string e chame `POST /auth/set-password` direto (curl), definindo a
  senha.
- **Inserção manual** no D1 remoto, via `npx wrangler d1 execute
  mais-aprovacao-db --remote --command "…"`, no mesmo formato que o
  `web/admin/e2e/seed.mjs` usa: hash `pbkdf2$sha256$100000$<salt>$<hash>`.

- [ ] Admin de produção criado e login em
      `https://admin.maisaprovacao.com.br/login` funcionando — passando **duas
      vezes** por identidade: Access, depois senha.

---

## Fase 12 — Rodar o runbook de verificação

- [ ] [`runbook-verificacao-hotmart.md`](runbook-verificacao-hotmart.md), as
      nove seções, contra o **sandbox**.

Ele existe porque dois valores continuam **inferidos, não confirmados**: o
caminho `/payments/api/v1/subscriptions` (`api/src/lib/hotmartApi.ts`) e o
`HOTMART_TOKEN_URL`. E porque os fixtures do webhook vieram da documentação,
não de tráfego real — os 324 testes podem estar verdes contra um payload que a
Hotmart não envia.

---

## Fase 13 — Virar para produção

Só depois da fase 12 passar inteira.

- [ ] `HOTMART_API_BASE_URL` e `HOTMART_TOKEN_URL` → hosts de produção.
- [ ] `HOTMART_HOTTOK`, `HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET` →
      credenciais de produção.
- [ ] `HOTMART_SUBSCRIPTION_UCODES` → ucodes de produção.
- [ ] Webhook de produção apontando para o Worker.
- [ ] Chaves do Turnstile de produção (as de teste sempre passam).
- [ ] `npm run deploy` e refazer o smoke test da fase 7.
- [ ] Conferir a seção 9 do runbook (LGPD) nos logs reais: nenhum CPF,
      endereço ou telefone.

---

## Pendências que este runbook não resolve

| Item | Onde |
|---|---|
| `/definir-senha` não existe — link mágico cai em 404 | sub-projeto 4 |
| Sem script para migração remota nem para deploy do Pages | `package.json` |
| Sem CI — nada roda a suíte antes de publicar | — |
| `hono@4.12.28` marcado, correção liberada em 2026-08-17 | `api/package.json` |
| `nanoid` marcado nos dois workspaces, 3.3.18 em 2026-08-21 | `api/`, `web/` |
| e2e do upload depende de `MEDIA_PUBLIC_BASE` real | `editor.spec.ts:136` |
