# Mais Aprovação — Painel administrativo

Frontend do sub-projeto 2: o painel onde a operação cadastra, edita e publica
questões. Dois workspaces npm:

- **`ui/`** — design system (tokens e componentes). Sem passo de build: é
  código-fonte, transpilado pelo Next de quem consome. É a entrega declarada
  deste sub-projeto para o sub-projeto 4 (frontend do aluno).
- **`admin/`** — o painel. Next.js App Router com `output: 'export'`.

A API vive em `../api` e já está pronta. Este pacote não a modifica.

## Setup

```bash
cd web
npm ci
npx playwright install chromium   # só na primeira vez
```

Criar `web/admin/.env.development.local`:

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

E em `api/.dev.vars` (nunca commitado):

```
ACCESS_DEV_BYPASS=true
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

As duas chaves acima são as de teste publicadas pela Cloudflare — sempre
passam. As de produção vêm do dashboard.

## Rodar

```bash
cd api && npm run db:migrate:local && npm run dev   # Worker em :8787
cd web && npm run dev                               # painel em :3000
node web/admin/e2e/seed.mjs                         # admin de desenvolvimento
```

Entrar com `admin@dev.local` / `senha-de-desenvolvimento`.

## Testar

```bash
cd web && npm run typecheck   # os dois workspaces
cd web && npm test            # Playwright (sobe os dois servidores sozinho)
cd web && npm run audit       # OSV.dev contra a árvore instalada
```

## Um hostname, duas origens de conteúdo

O painel e a API dividem `admin.<domínio>`, e a divisão é por path. **Uma
Worker Route casa a URL mas não a reescreve** — por isso as routes usam os
caminhos que o Worker já serve, sem prefixo:

| Padrão | Serve |
|---|---|
| `admin.<domínio>/admin/*` | Worker — rotas de conteúdo |
| `admin.<domínio>/auth/*` | Worker — login e sessão |
| `admin.<domínio>/*` | Pages — o painel |

Consequência que precisa ser respeitada: **o painel não pode ter página em
`/admin` nem em `/auth`**. As telas são `/login`, `/`, `/questoes/editar` e
`/taxonomias`.

Em desenvolvimento o `next dev` reproduz o mesmo recorte por proxy
(`next.config.ts` → `rewrites`), então o navegador vê uma origem só nos dois
ambientes e não existe CORS em lugar nenhum.

O hostname público continua servindo `/auth/*` e `/webhooks/hotmart` **fora do
Access** — a Hotmart precisa alcançar o webhook sem passar por identidade.

## Segurança

Duas camadas independentes, nenhuma confiando na outra: Cloudflare Access na
borda (identidade + MFA no Google ou GitHub) e `role=admin` lido do D1 pelo
Worker. Passar pelo Access não cria sessão no app — o admin autentica duas
vezes, e isso é deliberado.

Em desenvolvimento a camada 1 não existe (nada passa pela borda), e
`ACCESS_DEV_BYPASS=true` a pula explicitamente. O login com senha e o
`role=admin` continuam valendo.

O HTML do editor é sanitizado **no servidor, na escrita**
(`api/src/lib/sanitizeHtml.ts`). O editor é uma sugestão para clientes
bem-comportados, não uma proteção.

## Cadeia de suprimentos

Política em `~/.claude/CLAUDE.md` §5: nenhum pacote novo sem aprovação
explícita, cooldown de 14 dias, `ignore-scripts=true`, `npm ci` sempre.

`web/package.json` carrega dois `overrides` — `postcss` e `sharp` —, os mesmos
de `api/package.json`, porque as mesmas vulnerabilidades chegam pelo Next.

Contagem real desta árvore, medida em darwin-arm64 (entradas de lockfile entre
parênteses): 23 (52) com next+react, 48 (98) com Tailwind. A diferença entre os
dois números é binário pré-compilado por plataforma, que o npm registra para
todas e instala só na que casa.
