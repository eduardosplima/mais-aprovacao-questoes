# Mais Aprovação — Painel administrativo

Frontend do sub-projeto 2: o painel onde a operação cadastra, edita e publica
questões. Dois workspaces npm:

- **`ui/`** — design system (tokens e componentes). Sem passo de build: é
  código-fonte, transpilado pelo Next de quem consome. É a entrega declarada
  deste sub-projeto para o sub-projeto 4 (frontend do aluno).
- **`admin/`** — o painel. Next.js App Router com `output: 'export'`.

A API vive em `../api` e já está pronta. Este pacote não a modifica.

**Atenção para quem for consumir `ui/` (o sub-projeto 4):** importar só
`@mais/ui/tokens.css` dá os tokens, mas **não** as classes dos componentes.
O Tailwind v4 gera CSS apenas para as classes que encontra varrendo os
arquivos declarados — ele não varre um pacote irmão sozinho. É por isso que
`web/admin/src/app/globals.css:6` declara `@source "../../../ui/src"`; sem
essa linha (ou equivalente), `Botao`, `Card` e os demais componentes
renderizam sem estilo nenhum, silenciosamente, sem erro de build. Qualquer
consumidor de `@mais/ui` precisa da mesma declaração `@source` apontando
para o `src` do pacote.

## Setup

```bash
cd web
npm ci
npx playwright install chromium webkit   # só na primeira vez
```

O login do painel não usa Turnstile — `.env.development.local` não precisa de
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Em `api/.dev.vars` (nunca commitado):

```
ACCESS_DEV_BYPASS=true
ACCESS_DEV_EMAIL=admin@dev.local
ADMIN_EMAILS=admin@dev.local
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

`ACCESS_DEV_EMAIL` e `ADMIN_EMAILS` precisam ser o mesmo email do `EMAIL` em
`web/admin/e2e/credenciais.mjs` — é ele que faz as vezes do que o Cloudflare
Access injetaria na borda. A `TURNSTILE_SECRET_KEY` acima é a chave de teste
publicada pela Cloudflare — sempre passa, e segue valendo para o login do
aluno. A de produção vem do dashboard.

## Rodar

```bash
cd api && npm run db:migrate:local && npm run dev   # Worker em :8787
cd web && npm run dev                               # painel em :3000
node web/admin/e2e/seed.mjs                         # admin de desenvolvimento
```

Entrar só com a senha `senha-de-desenvolvimento` — o email não é digitado,
vem do `ACCESS_DEV_EMAIL` de `api/.dev.vars` (ver "Setup").

## Testar

```bash
cd web && npm run typecheck   # os dois workspaces
cd web && npm test            # Playwright (sobe os dois servidores sozinho)
cd web && npm run audit       # OSV.dev contra a árvore instalada
```

A suíte roda em **chromium e WebKit** — o cliente trabalha em macOS, então o
Safari é navegador de primeira classe aqui, não cobertura extra.

Por causa do WebKit, o servidor que o Playwright sobe serve **https**, e só
ele: `npm run dev` continua em http. O motivo é o cookie de sessão, que é
`Secure` (`api/src/lib/cookies.ts`) — o WebKit descarta cookie `Secure` que
chegue por http, mesmo em `localhost`, ao contrário do Chromium. Servir a
suíte por TLS deixa o `secure: true` exercitado nos testes ser exatamente o de
produção, sem ramo de desenvolvimento no código de segurança.

O certificado é auto-assinado e gerado sob demanda por
`admin/e2e/certificado.mjs`, com o `openssl` que já existe no sistema — nada é
baixado, e `admin/e2e/certs/` não é versionado. Para apagá-lo e refazer, basta
remover o diretório.

## Um hostname para o painel, duas origens de conteúdo

O painel e a API dividem `admin.<domínio>`, e a divisão é por path. **Uma
Worker Route casa a URL mas não a reescreve** — por isso as routes usam os
caminhos que o Worker já serve, sem prefixo:

| Padrão | Serve |
|---|---|
| `admin.<domínio>/admin/*` | Worker — rotas do painel: conteúdo e login/sessão do admin (`/admin/auth/*`) |
| `admin.<domínio>/auth/*` | Worker — rotas de autenticação do **aluno** (login, recuperação); hoje só alcançáveis aqui, por acidente de roteamento que o sub-projeto 4 desfaz |
| `admin.<domínio>/*` | Pages — o painel |

Consequência que precisa ser respeitada: **o painel não pode ter página em
`/admin` nem em `/auth`**. As telas são `/login`, `/`, `/questoes/editar` e
`/taxonomias`.

Em desenvolvimento o `next dev` reproduz o mesmo recorte por proxy
(`next.config.ts` → `rewrites`), então o navegador vê uma origem só nos dois
ambientes e não existe CORS em lugar nenhum.

**O Worker não tem hostname próprio** — não existe `api.<domínio>`. Ele é
montado por cima dos hostnames de frontend, dividido por path, e é isso que
mantém toda chamada same-origin. O mesmo padrão vale para o sub-projeto 4: o
frontend do aluno recebe suas próprias Worker Routes em `app.<domínio>`, não
um backend separado.

### O webhook mora fora do `admin.`

Existe uma quarta Worker Route, em **outro hostname**:

| Padrão | Serve |
|---|---|
| `app.<domínio>/webhooks/*` | Worker — webhook da Hotmart |

A Hotmart precisa alcançar o webhook sem passar por identidade, e o Access é
por hostname: `admin.<domínio>` fica coberto **inteiro**, incluindo `/auth/*`,
enquanto `app.<domínio>` não tem Access nenhum. Manter o webhook lá evita
depender de uma exceção por política de *Bypass* dentro do `admin.` — exceção
que um aperto futuro da política desfaz sem avisar, derrubando o
provisionamento em silêncio.

Passo a passo de provisionamento, com os hostnames reais:
[`docs/runbook-deploy-producao.md`](../docs/runbook-deploy-producao.md).

## Segurança

Duas camadas independentes, nenhuma confiando na outra: Cloudflare Access na
borda (identidade + MFA no Google ou GitHub) e `requireSessaoAdmin`, que
confere a cada requisição o cookie `sessao_admin`, o email em `ADMIN_EMAILS`
e uma senha cadastrada na tabela `admins`. Passar pelo Access não cria sessão
no painel — o admin autentica duas vezes, e isso é deliberado.

O email é o mesmo nas duas camadas, por decisão: a sessão do painel só é
aceita se o email nela bater com o que o token do Access carrega
(`emailDoAccess`), então não é possível passar pelo Access como uma pessoa e
entrar no painel como outra.

Em desenvolvimento a camada 1 não existe (nada passa pela borda), e
`ACCESS_DEV_BYPASS=true` a pula explicitamente, usando `ACCESS_DEV_EMAIL`
como identidade. O login com senha continua valendo.

O HTML do editor é sanitizado **no servidor, na escrita**
(`api/src/lib/sanitizeHtml.ts`). O editor é uma sugestão para clientes
bem-comportados, não uma proteção.

## Cadeia de suprimentos

Política em `~/.claude/CLAUDE.md` §5: nenhum pacote novo sem aprovação
explícita, cooldown de 14 dias, `ignore-scripts=true`, `npm ci` sempre.

`web/package.json` carrega três `overrides` — `postcss`, `sharp` e `undici` —,
os mesmos de `api/package.json`, porque as mesmas vulnerabilidades chegam pelo
Next. O `undici` entrou em 2026-08-17; era transitiva do miniflare
(`@cloudflare/vitest-pool-workers → miniflare → undici`), e fechá-la exigia
justamente o override.

Contagem real desta árvore, medida em darwin-arm64 (entradas de lockfile entre
parênteses): 23 (52) com next+react, 48 (98) com Tailwind. A diferença entre os
dois números é binário pré-compilado por plataforma, que o npm registra para
todas e instala só na que casa.
