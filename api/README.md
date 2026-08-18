# Mais Aprovação — API (Fundação)

Backend em **Cloudflare Workers** (TypeScript + Hono) da plataforma Mais Aprovação
Questões. Este módulo é a **Fundação**: autenticação por senha + link mágico
(sem self-signup — a conta só nasce da compra na Hotmart), sessão JWT, webhook
de compra/cancelamento, reconciliação diária contra a API de dados da Hotmart
e base de dados (D1). Sem frontend.

## Stack

TypeScript · Hono · Drizzle ORM (D1/SQLite) · jose (JWT) · Zod · Wrangler ·
Vitest (`@cloudflare/vitest-pool-workers`).

## Setup local

```bash
cd api
npm install
```

> **Nota de ambiente (macOS + Homebrew libvips):** se `npm install` falhar no
> postinstall do `sharp` (dependência transitiva do Miniflare), rode uma vez com
> `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install` — isso força o binário pré-compilado
> do sharp em vez de compilar contra a libvips global do Homebrew. Não muda
> versões nem arquivos.

### Segredos (`.dev.vars`)

Crie `api/.dev.vars` (já no `.gitignore` — **nunca** commitar) com os seis
segredos abaixo, valores do **sandbox da Hotmart** onde aplicável, mais a
sobreposição não-secreta de `MEDIA_PUBLIC_BASE` (explicada logo depois):

```
JWT_SECRET=<segredo forte para assinar o cookie de sessão>
HOTMART_HOTTOK=<hottok do painel Hotmart → Ferramentas → Webhook, sandbox>
HOTMART_CLIENT_ID=<client_id da API de dados do sandbox>
HOTMART_CLIENT_SECRET=<client_secret da API de dados do sandbox>
DOCUMENT_HMAC_KEY=<segredo forte — pepper do HMAC de CPF e do email da tombstone>
TURNSTILE_SECRET_KEY=<secret key do Turnstile (par com a site key do frontend)>

# Não é segredo — sobrepõe para dev local o valor de produção que vem de
# wrangler.jsonc (ver explicação abaixo)
MEDIA_PUBLIC_BASE=http://localhost:8787
```

As demais variáveis, não-secretas, já vêm de `wrangler.jsonc` (bloco `vars`):
`HOTMART_SUBSCRIPTION_UCODES`, `HOTMART_API_BASE_URL`, `HOTMART_TOKEN_URL`,
`HOTMART_CHECKOUT_URL`, `APP_BASE_URL`, `EMAIL_FROM`, `ADMIN_EMAILS`,
`MEDIA_PUBLIC_BASE`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`. Ajuste os
placeholders (`REPLACE_ME`) ali antes de rodar contra o sandbox. Em produção,
os seis segredos vão via `wrangler secret put <NOME>`; as vars continuam em
`wrangler.jsonc`.

Das três últimas: `MEDIA_PUBLIC_BASE` é o hostname **sem cookies** que serve o
bucket R2 (um SVG malicioso não pode executar com a sessão do admin) — em
produção é o Custom Domain `media.maisaprovacao.com.br`, e **em
desenvolvimento você precisa sobrepô-lo** com `MEDIA_PUBLIC_BASE=http://localhost:8787`
no `.dev.vars`, ou as imagens que você subir localmente ganham URL de
produção, onde elas não existem, e não carregam. Quem as serve em 8787 é
`GET /media/:key` (`src/routes/media.ts`), que não é roteada na borda e por
isso não existe em produção. `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` são o
domínio do time no Zero Trust e a tag `aud` da aplicação Access, usados para
validar o JWT da borda.

Opcional e só de desenvolvimento: `ACCESS_DEV_BYPASS=true` em `.dev.vars` pula
a verificação do Cloudflare Access em `/admin/*` (ver seção "Painel
administrativo"). Nunca definir em produção.

`ADMIN_EMAILS` é uma lista separada por vírgula; e-mails nela recebem
`role=admin` na compra (webhook) ou na reconciliação — nunca a partir do
payload em si.

## Rodar

```bash
npm run db:migrate:local   # aplica migrações no D1 local
npm run dev                # sobe o Worker em http://localhost:8787
```

## Testes

```bash
npm test                   # Vitest (Miniflare + D1 local); rede mockada
```

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Liveness → `{ ok: true }` |
| POST | `/auth/login` | `{ email, password, turnstileToken }` → valida credenciais e seta cookie de sessão |
| POST | `/auth/set-password` | `{ token, password }` → consome o token do link mágico, define a senha e seta cookie de sessão |
| POST | `/auth/recover` | `{ email, document, turnstileToken }` → sempre `200 { ok: true }`; só envia o link de recuperação se email+CPF baterem |
| GET | `/auth/me` | Protegido. Retorna `{ id, email, name, role, tier }` |
| POST | `/auth/logout` | Limpa o cookie de sessão |
| POST | `/webhooks/hotmart` | Recebe eventos de compra/cancelamento da Hotmart (autenticado pelo header `x-hotmart-hottok`) |
| GET | `/admin/taxonomy?kind=` | Lista termos de uma taxonomia. `kind` é obrigatório (`subject`, `banca`, `cargo`, `level`); ausente ou desconhecido → 400 `invalid_kind` |
| POST | `/admin/taxonomy` | `{ kind, name }` → cria termo. 409 `duplicate` se já existir ativo no mesmo kind |
| PATCH | `/admin/taxonomy/:id` | `{ name }` → renomeia recalculando o slug. 409 `duplicate` se colidir com outro termo ativo do mesmo kind |
| DELETE | `/admin/taxonomy/:id` | Soft delete |
| GET | `/admin/questions` | Lista paginada com filtros (`subjectId`, `bancaId`, `cargoId`, `levelId`, `year`, `status`). Valor vazio (ou só espaço) em qualquer filtro é tratado como ausente. Só `status` e `year` são validados — não vazio e inválido → 400 `invalid_status`/`invalid_year`; os ids de taxonomia passam crus, e um id inexistente devolve lista vazia, não 400. `limit`/`offset` inválidos caem no default |
| POST | `/admin/questions` | Cria a questão inteira; `status` opcional (`draft` por default) publica no mesmo envio. 422 com código quando viola invariante |
| GET | `/admin/questions/:id` | Questão com alternativas e gabarito |
| PATCH | `/admin/questions/:id` | Edita — publicada ou não, o id nunca muda |
| POST | `/admin/questions/:id/publish` · `/unpublish` | Alterna o `status` |
| DELETE | `/admin/questions/:id` | Soft delete |
| POST | `/admin/media` | `multipart/form-data` com `file` → `{ url }` no R2 |
| GET | `/media/:key` | Só em desenvolvimento. Lê o objeto do R2 sem autenticação; nenhuma Worker Route casa `/media/*`, então em produção a rota não existe. Ver `src/routes/media.ts` e a Fase 8 de `docs/runbook-deploy-producao.md` |

### Códigos de erro

| Código | Status | Quando |
|---|---|---|
| `invalid_request` | 400 | Corpo da requisição malformado ou fora do schema Zod |
| `invalid_kind` | 400 | `kind` de taxonomia ausente ou desconhecido (query) |
| `invalid_status` | 400 | `status` de filtro não vazio e diferente de `draft`/`published` (query) |
| `invalid_year` | 400 | `year` de filtro não vazio e fora de `[1900, 2200]`, ou não numérico (query) |
| `duplicate` | 409 | Nome de taxonomia já ativo no mesmo `kind` (criação ou rename) |
| `not_found` | 404 | Id inexistente (questão ou termo de taxonomia) |
| `exactly_one_correct` | 422 | Questão sem exatamente uma alternativa marcada correta |
| `true_false_needs_two` | 422 | Questão `true_false` sem exatamente duas alternativas |
| `needs_two_alternatives` | 422 | Questão `multiple_choice` com menos de duas alternativas |
| `invalid_subject` / `invalid_banca` / `invalid_cargo` / `invalid_level` | 422 | FK de taxonomia inexistente, soft-deletada ou de `kind` errado |

Parâmetro de query inválido tem um código por campo (`invalid_kind`,
`invalid_status`, `invalid_year`); corpo de requisição inválido sempre cai no
único `invalid_request` — a distinção deixa o tratamento de erro de
formulário do painel resolvido de um jeito só.

Sessão: JWT (HS256) em cookie `HttpOnly; Secure; SameSite=Lax; Path=/`. A
identidade vai no `sub`; `role`/`tier` são relidos do D1 a cada request —
`tier` é derivado só de `subscriptions.access_until > now`, nunca do JWT.

Não há cadastro público: a conta só nasce pela compra na Hotmart (webhook) ou
pela reconciliação diária quando o webhook se perde; o primeiro acesso e a
recuperação de senha acontecem exclusivamente pelo link mágico enviado por
email.

## Webhook e reconciliação

`POST /webhooks/hotmart` (`src/webhooks/hotmart.ts`) processa `PURCHASE_APPROVED`,
`PURCHASE_DELAYED`, `PURCHASE_CANCELED`/`PURCHASE_EXPIRED`,
`PURCHASE_REFUNDED`/`PURCHASE_CHARGEBACK`/`PURCHASE_PROTEST` e
`SUBSCRIPTION_CANCELLATION`; é idempotente por `id` do evento (reenvios com o
mesmo `id` devolvem `{ ok: true, duplicate: true }` sem reprocessar).

O cron `0 3 * * *` (`wrangler.jsonc` → `triggers.crons`) roda `reconcile()`
(`src/jobs/reconcile.ts`), que compara o D1 com a API de dados da Hotmart:
cria assinaturas cujo webhook se perdeu e corrige/revoga acesso divergente.
Regra dura: ausência na listagem da API **nunca** revoga — só status/data
explícitos revogam.

## Bindings e triggers (`wrangler.jsonc`)

- `DB` — D1 (`mais-aprovacao-db`), migrações em `migrations/`.
- `EMAIL` — `send_email`, usado para o link mágico (primeiro acesso e recuperação).
- `MEDIA` — R2, bucket das imagens de questão. Gravado por `POST /admin/media`
  e lido em desenvolvimento por `GET /media/:key`. A chave é plana
  (`media/{uuid}.{ext}`): questão não sofre hard delete, então prefixo por
  questão não serviria para apagar nada.
- `triggers.crons` — `0 3 * * *`, dispara a reconciliação diária.

## Camada de dados (`src/db/`)

Módulos de acesso a dados sem rotas HTTP próprias, consumidos pelas rotas do
painel administrativo. `taxonomy.ts` cobre assunto/banca/cargo/nível (CRUD com
soft delete); `questions.ts` cobre questões, alternativas e gabarito, com as
invariantes que o SQLite não impõe (uma alternativa correta, contagem por
tipo, FK de taxonomia no `kind` certo) validadas antes de qualquer escrita.

Escritas que tocam várias linhas relacionadas (ex.: substituir as alternativas
de uma questão) usam `db.batch()` em vez de `.run()` sequenciais — o D1
executa o array inteiro numa transação implícita, então uma falha no meio não
deixa a tabela num estado parcial. Convenção adotada a partir da Task 4;
módulos futuros (tentativas, comentários, anotações) devem seguir o mesmo
padrão.

### Migrações que reconstroem tabela — leia antes de gerar uma

O SQLite não faz `ALTER COLUMN`, então qualquer mudança de tipo, de
nulabilidade ou de constraint faz o `drizzle-kit generate` emitir uma
**reconstrução de tabela**: cria `__new_<tabela>`, copia, `DROP TABLE`,
renomeia, recria os índices. Duas armadilhas, nesta ordem:

1. **O `PRAGMA foreign_keys=OFF` / `=ON` que o drizzle-kit gera, o D1 recusa.**
   Troque o `=OFF` por `PRAGMA defer_foreign_keys = true;` e apague o `=ON`.
   Sem isso o `wrangler d1 migrations apply` falha. Ver
   `migrations/0002_special_vertigo.sql`, que já está no formato correto.

2. **`defer_foreign_keys` não é equivalente ao que você tirou.** Ele adia a
   *verificação* de constraint até o commit; ele **não** suprime as *ações*
   `ON DELETE CASCADE`. E o `DROP TABLE` do SQLite faz um `DELETE` implícito
   quando FK está ligada. Como `alternatives` e `explanations` referenciam
   `questions` com `ON DELETE cascade`, reconstruir `questions` **com linhas
   dentro** apagaria as alternativas e os gabaritos delas, enquanto as questões
   sobrevivem na tabela nova — perda silenciosa, e migração no D1 é de mão
   única. O `foreign_keys=OFF` original é justamente o que impediria isso; o
   substituto exigido pelo D1 não impede.

Consequência prática: **confira a contagem no remoto imediatamente antes de
aplicar**, não no dia anterior.

```bash
npx wrangler d1 execute mais-aprovacao-db --remote \
  --command "SELECT COUNT(*) FROM <tabela>"
```

Se não voltar zero, pare: a reconstrução deixa de ser trivial e precisa de um
plano de backfill que preserve as filhas. A `0002` foi aplicada em 2026-08-17
com `questions`, `alternatives` e `explanations` todas em zero, que era a
janela em que isso era seguro sem cerimônia.

## Painel administrativo

`/admin/*` tem **duas camadas independentes**, e nenhuma confia na outra:

1. **Cloudflare Access** na borda — identidade e MFA no IdP (Google/GitHub).
   O Worker valida o header `Cf-Access-Jwt-Assertion` contra o JWKS público do
   time (`src/middleware/access.ts`).
2. **Sessão + RBAC** — `requireSession` e `requireAdmin`, lendo `role` do D1.

O email do JWT do Access **não** identifica o usuário na aplicação: por isso
são duas camadas e não uma. Consequência prática: o admin autentica duas vezes.

Em desenvolvimento nada passa pela borda da Cloudflare, então o header não
existe. `ACCESS_DEV_BYPASS=true` em `.dev.vars` pula a camada 1 — e **só** a
string exata `true` pula. A variável nunca vai para produção; o login com senha
e o `role=admin` continuam valendo em dev.

Conteúdo HTML (enunciado, alternativas, gabarito) é sanitizado **na escrita**
por `src/lib/sanitizeHtml.ts`, com `HTMLRewriter` nativo. Allowlist de tags e
atributos mais validação do esquema das URLs — permitir o atributo `href` não
diz nada sobre o valor dele, e `javascript:` passaria sem essa checagem.

Questões e taxonomias usam **soft delete**. O filtro de `deleted_at` vive
exclusivamente em `src/db/questions.ts` e `src/db/taxonomy.ts`; nenhuma rota
monta query direto.

## Verificação manual

A suíte automatizada usa fixtures derivados da documentação da Hotmart, não de
tráfego real. Antes de considerar a Fundação pronta, rodar
[`docs/runbook-verificacao-hotmart.md`](../docs/runbook-verificacao-hotmart.md)
contra o sandbox.

Dois valores estão marcados como **não confirmados** e são o primeiro item do
runbook: o caminho da API de dados (`src/lib/hotmartApi.ts`) e o
`HOTMART_TOKEN_URL` (`wrangler.jsonc`).
