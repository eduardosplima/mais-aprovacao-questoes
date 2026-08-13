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

3. **Falta uma Worker Route.** O `web/README.md` descreve duas rotas
   (`/admin/*` e `/auth/*`), mas o Worker também serve `/webhooks/hotmart`. Sem
   uma terceira rota, esse caminho cai no Pages e a Hotmart recebe **404 em
   todo evento de compra**. Está coberto na fase 8.

---

## Fase 0 — Decidir os nomes (não é clique, é decisão)

Nada aqui é reversível de graça, então decida antes de criar recurso.

| Papel | Sugestão | Consumido por |
|---|---|---|
| Domínio raiz | `<dominio>` | tudo |
| Painel + API (mesma origem) | `admin.<dominio>` | Worker Routes, Access, Pages |
| Bucket de mídia, **sem cookies** | `media.<dominio>` | `MEDIA_PUBLIC_BASE` |
| Frontend do aluno | `app.<dominio>` ou o raiz | `APP_BASE_URL` |
| Remetente | `nao-responda@<dominio>` | `EMAIL_FROM` |

- [ ] Nomes decididos e anotados.

> **`media.<dominio>` merece atenção extra.** A URL absoluta da imagem é
> **persistida dentro do HTML da questão** (`api/src/routes/admin/media.ts`
> grava `${MEDIA_PUBLIC_BASE}/media/<uuid>.<ext>` no enunciado). Trocar essa
> base depois exige reescrever linhas do banco. Não use o `*.r2.dev` de
> conveniência — escolha agora o hostname definitivo.
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
      `media.<dominio>`.
- [ ] Conferir que o domínio ficou ativo e que um objeto de teste é servido
      publicamente.
- [ ] `MEDIA_PUBLIC_BASE` = `https://media.<dominio>` — **sem barra final**.

> Preencher isto também conserta um teste: o e2e `editor.spec.ts:136` ("upload
> de imagem") falha hoje porque o `<img>` inserido recebe
> `src="https://REPLACE_ME_MEDIA_HOST/…"`, não carrega, fica com altura zero e
> o Playwright o considera invisível. O upload em si funciona.

---

## Fase 3 — Email Service → o gate do provisionamento

Esta é a fase que decide se comprador recebe email. Faça-a cedo: propagação de
DNS e verificação de domínio levam tempo, e é o risco nº 1 da seção 10 da spec.

- [ ] Dashboard → Email → **Email Sending** → onboarding do sending domain
      (`<dominio>`).
- [ ] Publicar os registros DNS pedidos. O SPF do return-path tem esta forma:
      `TXT cf-bounce.<dominio>  "v=spf1 include:_spf.mx.cloudflare.net ~all"`
      Somado ao DKIM que o dashboard gerar (seletor `cf-bounce`).
- [ ] Aguardar o domínio aparecer como **onboarded**. Antes disso, envio só
      para destinatários verificados na conta.
- [ ] `EMAIL_FROM` = `nao-responda@<dominio>`, dentro do domínio onboarded.

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

- [ ] Dashboard → Turnstile → novo widget para `admin.<dominio>` (e depois para
      o hostname do aluno, quando existir).
- [ ] **Site key** → vai para o *build* do Pages (fase 9), não para o Worker.
- [ ] **Secret key** → vira segredo do Worker (fase 6).

> Atenção ao acoplamento: `web/admin/src/app/login/page.tsx:11` lê
> `NEXT_PUBLIC_TURNSTILE_SITE_KEY` com fallback `""`. Se a variável faltar no
> build, **o build passa** e o login quebra em produção, sem erro em lugar
> nenhum.

---

## Fase 5 — Zero Trust Access → produz `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD`

- [ ] Zero Trust → Settings → **Team domain**: `<time>.cloudflareaccess.com`.
      Esse é o `ACCESS_TEAM_DOMAIN` (sem `https://` — o código já monta o
      issuer).
- [ ] Access → Applications → **Self-hosted**.
- [ ] Cobertura **mínima obrigatória**: `admin.<dominio>/admin/*` — é
      exatamente onde `requireAccess` roda (`api/src/app.ts:32`).
- [ ] Recomendado: cobrir o hostname inteiro e **excluir** `/auth/*` e
      `/webhooks/*`. Isso esconde também o HTML do painel; sem isso, as telas
      são públicas e só os dados ficam protegidos.
- [ ] `/webhooks/*` **precisa** ficar fora: a Hotmart não tem identidade no seu
      IdP. `/auth/*` também, ou o login do painel não completa.
- [ ] Política de acesso: Google ou GitHub, com MFA, restrita aos seus emails.
- [ ] Copiar a **Application Audience (AUD) tag** → `ACCESS_AUD`.

---

## Fase 6 — Preencher `wrangler.jsonc` e subir os segredos

Os sete placeholders e as três variáveis de desenvolvimento:

| Variável | Valor de produção | Vem da fase |
|---|---|---|
| `database_id` | id do D1 | 1 |
| `MEDIA_PUBLIC_BASE` | `https://media.<dominio>` | 2 |
| `EMAIL_FROM` | `nao-responda@<dominio>` | 3 |
| `ACCESS_TEAM_DOMAIN` | `<time>.cloudflareaccess.com` | 5 |
| `ACCESS_AUD` | tag AUD | 5 |
| `HOTMART_SUBSCRIPTION_UCODES` | ucodes, separados por vírgula | 11 |
| `HOTMART_CHECKOUT_URL` | link do checkout | — (ver nota) |
| `APP_BASE_URL` | `https://app.<dominio>` | 0 (ver nota) |
| `ADMIN_EMAILS` | **seu email** | agora |
| `HOTMART_API_BASE_URL` / `HOTMART_TOKEN_URL` | manter **sandbox** | 12 |

- [ ] `ADMIN_EMAILS` preenchido. Vazio, ninguém nunca vira admin — o papel só é
      concedido por essa allowlist, jamais pelo payload.
- [ ] `APP_BASE_URL` apontando para onde o aluno vai morar, ciente de que
      `/definir-senha` ainda não existe lá.
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
- [ ] `curl https://admin.<dominio>/health` → `{"ok":true}` (depois da fase 8).
- [ ] Cron `0 3 * * *` aparece no dashboard do Worker (vem do `wrangler.jsonc`).

---

## Fase 8 — Worker Routes → **três**, não duas

Uma Worker Route casa a URL e **não a reescreve**, então os padrões usam os
caminhos que o Worker já serve, sem prefixo:

| Padrão | Serve |
|---|---|
| `admin.<dominio>/admin/*` | Worker — conteúdo |
| `admin.<dominio>/auth/*` | Worker — login e sessão |
| `admin.<dominio>/webhooks/*` | Worker — **webhook da Hotmart** |
| `admin.<dominio>/*` | Pages — o painel |

- [ ] As três rotas do Worker criadas, apontando para `mais-aprovacao-api`.
- [ ] A terceira é a que falta na documentação atual. Sem ela, o
      `POST /webhooks/hotmart` cai no Pages e devolve 404 para toda compra.

---

## Fase 9 — Pages → o painel

O build é estático (`output: 'export'`) e a site key entra **no build**:

```bash
cd web
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key da fase 4> npm run build
npx wrangler pages deploy admin/out --project-name=mais-aprovacao-admin
```

- [ ] Projeto Pages criado e ligado a `admin.<dominio>`.
- [ ] Se usar build automático pelo Git, cadastrar
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY` nas variáveis de build do projeto.
- [ ] Abrir `https://admin.<dominio>/login` e confirmar que o widget do
      Turnstile **renderiza** (se a site key faltou, ele não aparece).
- [ ] O painel não pode ter página em `/admin` nem em `/auth` — as rotas do
      Worker capturam esses caminhos antes.

---

## Fase 10 — Rate Limiting Rules

Proteção de borda, configuração e não código (spec §5).

- [ ] Regra em `/auth/*` — força bruta de login e email-bombing na recuperação.
- [ ] Regra em `/webhooks/hotmart` — superfície pública hostil.

---

## Fase 11 — Hotmart (sandbox) e o primeiro admin

- [ ] Painel Hotmart → Ferramentas → **Webhook**: URL
      `https://admin.<dominio>/webhooks/hotmart`, versão **2.0.0**, eventos:
      `PURCHASE_APPROVED`, `PURCHASE_DELAYED`, `PURCHASE_CANCELED`,
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
  `/definir-senha`, que não existe: pegue o token na query string e chame
  `POST /auth/set-password` direto (curl), definindo a senha.
- **Inserção manual** no D1 remoto, via `npx wrangler d1 execute
  mais-aprovacao-db --remote --command "…"`, no mesmo formato que o
  `web/admin/e2e/seed.mjs` usa: hash `pbkdf2$sha256$100000$<salt>$<hash>`.

- [ ] Admin de produção criado e login em `https://admin.<dominio>/login`
      funcionando — passando **duas vezes** por identidade: Access, depois
      senha.

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
