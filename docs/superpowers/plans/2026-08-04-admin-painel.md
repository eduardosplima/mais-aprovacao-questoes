# Admin & Conteúdo — Painel administrativo (plano de implementação)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O primeiro frontend do repositório — quatro telas (login, lista de questões, editor, taxonomias) sobre um design system separado, servido do mesmo hostname que a API já mergeada, atrás do Cloudflare Access.

**Architecture:** Dois workspaces npm novos em `web/`: `ui` (tokens e componentes, source-only, entrega declarada para o sub-projeto 4) e `admin` (o painel, Next.js App Router com `output: 'export'` — SPA estática no Pages, sem SSR e sem o adaptador OpenNext). O painel conversa com o Worker existente por caminhos **same-origin**: em produção duas Worker Routes capturam `/admin/*` e `/auth/*` no hostname do painel; em desenvolvimento os mesmos dois caminhos são reescritos pelo `next dev` para o `wrangler dev`. Nenhuma linha da API muda.

**Tech Stack:** Next.js 16 (App Router, export estático) · React 19 · Tailwind CSS v4 · TipTap 3 · Playwright · TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-02-admin-conteudo-design.md`

**Este plano é 2 de 2.** O plano 1 (`2026-08-02-admin-api.md`) está concluído e mergeado em `master`; toda a API que este painel consome já existe e está testada.

---

## Correções à spec fixadas neste plano

Três afirmações da spec não sobreviveram à verificação. As decisões abaixo foram tomadas com o autor em 2026-08-04 e **substituem** o que está escrito lá. A spec ainda não foi corrigida — ver "Pendência de documentação" no fim deste plano.

### 1. O prefixo `/api` da §2 não funciona (e some)

A §2 desenha `admin.<domínio>/api/*` → Worker. Uma Worker Route **casa** a URL mas **não a reescreve**: o Worker receberia `url.pathname === "/api/admin/questions"`, e `api/src/app.ts:18-35` monta `/health`, `/auth`, `/webhooks` e `/admin`, nenhum com prefixo. Toda chamada do painel cairia no 404 do Hono.

**Decisão:** duas Worker Routes, sem prefixo nenhum:

```
admin.<domínio>/admin/*   → Worker  (as rotas de conteúdo)
admin.<domínio>/auth/*    → Worker  (login e sessão)
admin.<domínio>/*         → Pages   (o painel; tudo que não casou acima)
```

Custo aceito, e é a única restrição real: **o painel não pode ter página própria em `/admin` nem em `/auth`** nesse hostname. As quatro telas são `/login`, `/`, `/questoes/editar` e `/taxonomias` — nenhuma colide. Repare na sutileza que faz funcionar: a *tela* de login é `/login` (Pages) e o *endpoint* é `/auth/login` (Worker).

Ganho: `api/` não reabre, e não existe um "a URL não é o que ela diz" para lembrar em toda sessão de debug futura.

### 2. "Tailwind v4 = 1 pacote" (§4) está errado

`tailwindcss` sozinho é mesmo 1 pacote — e não compila nada. Quem compila é `@tailwindcss/postcss`, que arrasta `@tailwindcss/oxide` e `lightningcss`, dois toolchains Rust. Medido em 2026-08-04 com `npm install --package-lock-only`:

| Conjunto | Entradas no lockfile | Instalados em darwin-arm64 |
|---|---|---|
| `next` + `react` + `react-dom` | 52 | **23** |
| \+ `tailwindcss` + `@tailwindcss/postcss` | 98 | **48** |

O custo real do Tailwind é **+25 pacotes**, não +1. A diferença entre as duas colunas é quase toda binário pré-compilado por plataforma (`@tailwindcss/oxide-*`, `lightningcss-*`, `@img/sharp-*`), que o npm registra no lockfile para todas as plataformas e instala só na que casa.

**Decisão: mantém Tailwind v4**, com o número corrigido. A escolha continua defensável — o que muda é a justificativa. Consequência operacional a esperar: com `ignore-scripts=true` global, os pacotes nativos podem exigir `npm rebuild <pkg>` explícito (Task 1, Step 6).

### 3. "TipTap mínimo = 33" (§4) não digita

`@tiptap/core` + `@tiptap/pm` + `@tiptap/react` são de fato 33 pacotes, e não incluem **uma única extensão de edição**: sem `document`, `paragraph` e `text` o editor não aceita um caractere. Medido com as extensões que a §2 e a §4 descrevem (negrito, itálico, sublinhado, títulos, listas, link, imagem, tabela, histórico): **47 pacotes**. O `starter-kit` dá 59.

**Decisão: TipTap com as 15 extensões nomeadas na Task 6**, 47 pacotes. Doze a mais que o número escrito na spec, doze a menos que o starter-kit.

---

## Global Constraints

- **Nenhum pacote npm além dos aprovados aqui.** A lista fechada, com versão exata e data de publicação verificada contra o cooldown de 14 dias (`~/.claude/CLAUDE.md` §5), está na Task 1. Se algum passo parecer exigir outro pacote — biblioteca de estado, de data, de máscara, de formulário, de ícone — **pare e pergunte**. Ícones são SVG inline copiado do `docs/demo.html`.
- **Cooldown de 14 dias, referência 2026-08-04.** Nenhuma versão publicada depois de **2026-07-21** entra. Isso reprova `next@16.2.12+`, `@tiptap/*@3.29.x`, `@playwright/test@1.62.x` e `postcss@8.5.22+`. Antes de instalar, reconfirme com `npm view <pkg> time --json`: se a execução deste plano começar dias depois, versões mais novas podem ter passado a valer, e a data de hoje é o que decide.
- **`npm ci`, nunca `npm install`** — salvo nos três pontos em que a intenção *é* mudar dependências, e só neles: Task 1 (criar o lockfile), Task 3 (Playwright) e Task 6 (TipTap). Qualquer outro `npm install` neste plano é erro.
- **Nenhuma mudança em `api/src/`.** A API está mergeada e é consumida como está. A única exceção autorizada é `api/scripts/audit-osv.mjs` (Task 1, Step 5), que é ferramenta e não superfície da API.
- **Sem SSR, sem Server Actions, sem Route Handlers.** `output: 'export'` é configuração de projeto, não de rota: basta uma rota exigir servidor para o adaptador `@opennextjs/cloudflare` (+405 pacotes) voltar. Todo componente que busca dados é `"use client"`.
- **Sem rota dinâmica de segmento.** `/questoes/[id]` exigiria `generateStaticParams` com os ids conhecidos no build, o que é impossível para um acervo vivo. O editor é uma página estática com o id em query param: `/questoes/editar?id=<uuid>`.
- **Comentários, textos de interface e mensagens de erro em português**, como todo o código existente.
- **Conteúdo de linha em teste sempre com escopo na `<table>`:** `page.locator("table").getByText(…)`. A `Tabela` do design system renderiza **cada linha duas vezes** — a versão desktop em `<table>` e a mobile em `<ul>`, alternadas só por CSS —, então as duas estão sempre no DOM e um `getByText` solto viola o strict mode do Playwright. Vale também para os botões de ação da linha. Descoberto na Task 4, e repetido na Task 5.
- **`getByText` e `getByLabel` casam por substring, sem diferenciar maiúscula — e isso morde três vezes neste projeto.** `getByLabel("Nome")` casa o `aria-label="Renomear Cespe"` ("Re**nome**ar"); `getByText("Certo")` casa o `<option>"Certo/errado"` do select de Tipo, **mesmo com o select fechado**. A regra geral: quando o alvo for uma palavra curta que possa aparecer dentro de outra string da página, ou use `{ exact: true }`, ou — melhor — mire no papel acessível do elemento (`getByRole("radio", { name: … })`), que testa a semântica em vez da marcação de apresentação. Descoberto nas Tasks 5 e 7.
- **Alerta em teste sempre com escopo no `<main>`:** `page.locator("main").getByRole("alert")`, nunca `page.getByRole("alert")` sozinho. O App Router monta um `AppRouterAnnouncer` com `role="alert"` no `document.body`, dentro de um shadow root aberto que o Playwright atravessa por padrão (`next/dist/client/components/app-router-announcer.js:25`). Sem o escopo, todo `getByRole("alert")` casa dois elementos e nenhuma asserção de contagem funciona. Descoberto na Task 3.
- **Nunca logar conteúdo de questão nem dado pessoal.** Mesma regra da Fundação.
- **Tema claro apenas.** O `docs/demo.html` é claro, e nenhum dos cinco critérios de pronto pede alternância de tema. Os tokens ficam em custom properties, então um bloco `@media (prefers-color-scheme: dark)` é adição futura barata — mas não entra agora (YAGNI).
- Rodar `npm run typecheck` (nos dois workspaces) antes de cada commit.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `web/package.json` *(criar)* | Raiz dos workspaces `ui` e `admin`; `overrides` de supply chain; scripts agregadores |
| `web/.gitignore` *(criar)* | `node_modules`, `.next`, `out`, `test-results` |
| `web/README.md` *(criar)* | Setup, rodar, testar, e o mapeamento de rotas Pages × Worker |
| `web/ui/package.json` *(criar)* | `@mais/ui`, source-only (sem build), consumido via `transpilePackages` |
| `web/ui/tsconfig.json` *(criar)* | Typecheck isolado — é o que torna o critério de pronto nº 5 verificável |
| `web/ui/src/tokens.css` *(criar)* | `@theme` do Tailwind v4 com os tokens transcritos do `docs/demo.html` |
| `web/ui/src/index.ts` *(criar)* | Barrel de exportação do design system |
| `web/ui/src/Botao.tsx` *(criar)* | Botão: variantes `primario`, `secundario`, `perigo`; estado carregando |
| `web/ui/src/Campo.tsx` *(criar)* | Label + controle + mensagem de erro. Envolve `input`, `select` e `textarea` |
| `web/ui/src/Card.tsx` *(criar)* | Superfície branca com borda, raio e sombra dos tokens |
| `web/ui/src/Badge.tsx` *(criar)* | Etiqueta de situação (`rascunho` / `publicada`) e de tipo de questão |
| `web/ui/src/Tabela.tsx` *(criar)* | Tabela responsiva: vira lista de cartões abaixo de 760px |
| `web/ui/src/Modal.tsx` *(criar)* | Diálogo de confirmação para ação destrutiva |
| `web/ui/src/Toast.tsx` *(criar)* | Aviso transitório + `ProvedorToast` / `useToast` |
| `web/admin/package.json` *(criar)* | O painel |
| `web/admin/next.config.ts` *(criar)* | `output: 'export'` em produção; rewrites de `/admin/*` e `/auth/*` em dev |
| `web/admin/public/_headers` *(criar)* | `X-Robots-Tag: noindex, nofollow` |
| `web/admin/public/robots.txt` *(criar)* | `Disallow: /` |
| `web/admin/public/logo.png` *(criar)* | Cópia de `docs/logo.png` |
| `web/admin/src/app/layout.tsx` *(criar)* | Fontes, metadata `robots`, `ProvedorToast`, importa os tokens |
| `web/admin/src/app/globals.css` *(criar)* | Importa `@mais/ui/tokens.css` e declara `@source` do painel |
| `web/admin/src/app/login/page.tsx` *(criar)* | Tela 1 — login + Turnstile |
| `web/admin/src/app/page.tsx` *(criar)* | Tela 2 — lista de questões |
| `web/admin/src/app/questoes/editar/page.tsx` *(criar)* | Tela 3 — editor de questão |
| `web/admin/src/app/taxonomias/page.tsx` *(criar)* | Tela 4 — CRUD das quatro taxonomias |
| `web/admin/src/lib/api.ts` *(criar)* | Cliente HTTP tipado; espelha os tipos da API; traduz erro em `ApiError` |
| `web/admin/src/lib/erros.ts` *(criar)* | Mapa código da API → frase em português |
| `web/admin/src/lib/sessao.tsx` *(criar)* | `useSessao()` — guarda de rota no cliente contra `GET /auth/me` |
| `web/admin/src/componentes/Layout.tsx` *(criar)* | Topbar, navegação, sair |
| `web/admin/src/componentes/Editor.tsx` *(criar)* | TipTap: configuração das extensões e ponte com o formulário |
| `web/admin/src/componentes/BarraFerramentas.tsx` *(criar)* | Botões do editor (negrito, títulos, lista, link, tabela, imagem) |
| `web/admin/src/componentes/UploadImagem.tsx` *(criar)* | `POST /admin/media` → insere `<img>` no editor |
| `web/admin/src/componentes/ListaAlternativas.tsx` *(criar)* | Alternativas: variável em múltipla escolha, fixa em certo/errado |
| `web/admin/src/componentes/SeletorTaxonomia.tsx` *(criar)* | Select alimentado por `GET /admin/taxonomy?kind=` |
| `web/admin/src/componentes/Preview.tsx` *(criar)* | Renderiza a questão como o aluno verá |
| `web/admin/e2e/playwright.config.ts` *(criar)* | Sobe `wrangler dev` e `next dev` e roda os specs |
| `web/admin/e2e/credenciais.mjs` *(criar)* | Email e senha do admin de desenvolvimento — só constantes, sem efeito colateral |
| `web/admin/e2e/entrar.ts` *(criar)* | Helper de login pela tela, pré-condição compartilhada pelos specs |
| `web/admin/e2e/seed.mjs` *(criar)* | Cria o admin de desenvolvimento no D1 local |
| `web/admin/e2e/login.spec.ts` *(criar)* | e2e: login e guarda de rota |
| `web/admin/e2e/caminho-critico.spec.ts` *(criar)* | e2e: login → criar → publicar → aparece na lista |
| `api/scripts/audit-osv.mjs` *(modificar)* | Aceita um diretório opcional em `argv[2]`, para auditar também `web/` |
| `api/package.json` *(modificar, Task 10)* | Override de `postcss` sobe para 8.5.23 |

---

## Task 1: Workspace `web/`, Next.js e cadeia de suprimentos

**Files:**
- Create: `web/package.json`, `web/.gitignore`
- Create: `web/ui/package.json`, `web/ui/tsconfig.json`, `web/ui/src/index.ts`
- Create: `web/admin/package.json`, `web/admin/next.config.ts`, `web/admin/tsconfig.json`, `web/admin/src/app/layout.tsx`, `web/admin/src/app/page.tsx`, `web/admin/src/app/globals.css`
- Modify: `api/scripts/audit-osv.mjs`

**Interfaces:**
- Produces: os scripts `npm run typecheck`, `npm run build` e `npm run audit` na raiz de `web/`; o alias de workspace `@mais/ui`.

**Pacotes aprovados nesta task** — aprovação explícita do autor em 2026-08-04, com as datas conferidas contra o cooldown de 14 dias:

| Pacote | Versão | Publicada em | Idade em 04/08 |
|---|---|---|---|
| `next` | 16.2.11 | 2026-07-21 | 14 dias ✓ |
| `react` | 19.2.8 | 2026-07-21 | 14 dias ✓ |
| `react-dom` | 19.2.8 | 2026-07-21 | 14 dias ✓ |
| `tailwindcss` | 4.3.3 | 2026-07-16 | 19 dias ✓ |
| `@tailwindcss/postcss` | 4.3.3 | 2026-07-16 | 19 dias ✓ |
| `typescript` | 5.9.3 | (já em `api/`) | ✓ |
| `@types/react` | 19.2.17 | 2026-06-05 | 60 dias ✓ |
| `@types/react-dom` | 19.2.3 | 2025-11-12 | ✓ |
| `@types/node` | 26.1.1 | 2026-07-08 | 27 dias ✓ |

Os três `@types` mais novos (`19.2.18`, `19.2.4`, `26.1.2`) são todos de 27–30/07 e reprovam no cooldown — daí as versões acima não serem as últimas.

`@tiptap/*` (Task 6) e `@playwright/test` (Task 3) são aprovados nas suas tasks, com as mesmas datas conferidas.

- [ ] **Step 1: Criar a raiz dos workspaces**

Criar `web/package.json`:

```json
{
  "name": "mais-aprovacao-web",
  "private": true,
  "type": "module",
  "workspaces": ["ui", "admin"],
  "scripts": {
    "dev": "npm run dev -w admin",
    "build": "npm run build -w admin",
    "typecheck": "npm run typecheck -w ui && npm run typecheck -w admin",
    "test": "npm run test -w admin",
    "audit": "node ../api/scripts/audit-osv.mjs ./node_modules"
  },
  "overrides": {
    "postcss": "8.5.21",
    "sharp": "0.35.3"
  }
}
```

Os dois `overrides` repetem os de `api/package.json` porque as mesmas vulnerabilidades chegam por outro caminho: o `next@16.2.11` fixa `postcss` em **8.4.31** num `node_modules` aninhado e declara `sharp@^0.34.5` como dependência opcional — as duas versões vulneráveis que a §4 da spec já tinha catalogado.

**Por que 8.5.21 e não 8.5.23.** A correção do `GHSA-fxqj-rqcc-2cmp` (path traversal no auto-load de source map, *incomplete fix* do `GHSA-6g55-p6wh-862q`) está na **8.5.23**, publicada em 2026-07-24 — 11 dias em 04/08, reprovada no cooldown até **2026-08-07**. A 8.5.21 (2026-07-21) é a mais nova que passa hoje, e continua exposta ao achado. Isso é conhecido, está registrado, e a **Task 10 fecha** a partir de 07/08, nos dois workspaces de uma vez. Se você estiver executando este plano em 2026-08-07 ou depois, pule direto para o valor da Task 10 e marque-a como resolvida aqui.

Criar `web/.gitignore`:

```
node_modules
.next
out
test-results
playwright-report
```

- [ ] **Step 2: Criar os dois pacotes**

Criar `web/ui/package.json`:

```json
{
  "name": "@mais/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./src/tokens.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^19",
    "react-dom": "^19"
  }
}
```

Sem passo de build de propósito: o `ui` é código-fonte, compilado pelo Next do consumidor via `transpilePackages`. O que o critério de pronto nº 5 exige é que ele **typechecke isolado** — se `tsc --noEmit` passa dentro de `web/ui`, nada ali depende do painel, e o sub-projeto 4 pode consumi-lo.

Criar `web/ui/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src"]
}
```

`"types": []` é deliberado: sem ele o `tsc` puxaria os `@types/node` hasteados pelo workspace e o `ui` poderia passar a depender de APIs de Node sem ninguém notar. O design system só pode falar DOM.

Criar `web/ui/src/index.ts` com um export provisório (os componentes chegam na Task 2):

```ts
export const VERSAO_DESIGN_SYSTEM = "0.0.0";
```

Criar `web/admin/package.json`:

```json
{
  "name": "@mais/admin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mais/ui": "*",
    "next": "16.2.11",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "tailwindcss": "4.3.3",
    "typescript": "5.9.3",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@types/node": "26.1.1"
  }
}
```

- [ ] **Step 3: Configurar o Next**

Criar `web/admin/next.config.ts`:

```ts
import type { NextConfig } from "next";

const producao = process.env.NODE_ENV === "production";

/**
 * Um hostname só para painel e API (spec §2), por duas vias diferentes:
 *
 * - Em produção, duas Worker Routes capturam `/admin/*` e `/auth/*` em
 *   `admin.<domínio>`; o Pages serve o resto. O painel chama caminho relativo
 *   e a chamada é literalmente same-origin — sem CORS e com o cookie do Access
 *   viajando junto.
 * - Em desenvolvimento nada passa pela borda da Cloudflare, então o `next dev`
 *   faz o mesmo recorte por proxy, para o `wrangler dev` em 8787. O cookie de
 *   sessão volta pelo proxy e o navegador o atribui a localhost:3000 — de novo
 *   same-origin, e o `credentials: "same-origin"` do cliente de API funciona
 *   igual nos dois ambientes.
 *
 * `output: 'export'` fica fora de dev porque desabilitaria justamente esses
 * rewrites. No build de produção ele volta, e é ele que mantém o adaptador
 * @opennextjs/cloudflare (+405 pacotes) fora do repositório.
 */
const nextConfig: NextConfig = {
  output: producao ? "export" : undefined,
  // Sem servidor não há otimizador de imagem; sem isto o `next build` falha.
  images: { unoptimized: true },
  transpilePackages: ["@mais/ui"],
  async rewrites() {
    if (producao) return [];
    const worker = "http://127.0.0.1:8787";
    return {
      // `beforeFiles` corre antes do roteamento de páginas — sem isso o App
      // Router tentaria resolver /admin/* como rota do painel e devolveria 404.
      beforeFiles: [
        { source: "/admin/:path*", destination: `${worker}/admin/:path*` },
        { source: "/auth/:path*", destination: `${worker}/auth/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
```

Criar `web/admin/postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

Criar `web/admin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowJs": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "skipLibCheck": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "out", "e2e"]
}
```

`e2e` fica fora do `include` porque o Playwright traz os próprios tipos e roda com o `tsconfig` dele (Task 3).

- [ ] **Step 4: Conferir o cooldown e instalar**

Rodar, de dentro de `web/`:

```bash
cd web
for p in next react react-dom tailwindcss @tailwindcss/postcss @types/react @types/react-dom @types/node; do
  echo "=== $p ==="
  npm view "$p" time --json | jq -r 'to_entries | map(select(.key|test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))) | .[-4:][] | "\(.key)  \(.value)"'
done
```

Expected: confirma as datas da tabela desta task. Se a execução deste plano acontecer dias depois de 2026-08-04, versões mais novas podem ter passado a valer — a regra é a idade na data de hoje, não o número escrito aqui. Ajuste as versões fixadas no Step 2 antes de instalar.

Depois:

```bash
cd web && npm install
```

Este é o único `npm install` do plano — a intenção *é* criar o lockfile. Daqui em diante, `npm ci`.

- [ ] **Step 5: Ensinar o auditor a olhar outra árvore**

O auditor hoje aponta para um caminho fixo (`api/scripts/audit-osv.mjs:14`):

```js
const ROOT = new URL("../node_modules", import.meta.url).pathname;
```

Substituir por:

```js
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * Sem argumento, audita a árvore do próprio `api/` — o comportamento que este
 * script sempre teve. Com argumento, audita a árvore apontada, que é como o
 * workspace `web/` reusa este mesmo auditor em vez de manter uma cópia
 * divergente. Aceita tanto o diretório do pacote quanto o `node_modules` dele.
 */
function raizDe(arg) {
  if (!arg) return new URL("../node_modules", import.meta.url).pathname;
  const abs = resolve(arg);
  return basename(abs) === "node_modules" ? abs : join(abs, "node_modules");
}

const ROOT = raizDe(process.argv[2]);
```

Ajustar o import de `node:path` na linha 12 para incluir `basename` e `resolve`, e atualizar o comentário de uso no cabeçalho (linha 10) para:

```
 * Uso: node scripts/audit-osv.mjs [diretório]   (exit 1 se houver vulnerabilidade)
```

- [ ] **Step 6: Verificar que os binários nativos funcionam sob `ignore-scripts`**

O `tailwindcss` v4 **não tem CLI** — ela mudou para o pacote `@tailwindcss/cli`, que não está aprovado e não é necessário, porque o painel consome o Tailwind via `@tailwindcss/postcss`. Então a verificação carrega os dois módulos nativos direto:

```bash
cd web && node -e "require('@tailwindcss/oxide'); require('lightningcss'); console.log('bindings nativos ok')"
```

Expected: `bindings nativos ok`. Se falhar com erro de módulo nativo (`@tailwindcss/oxide` ou `lightningcss`), rodar **por pacote**, nunca globalmente:

```bash
npm rebuild @tailwindcss/oxide
npm rebuild lightningcss
```

Nunca `--ignore-scripts=false` num install inteiro, e nunca desligar o `ignore-scripts` no `~/.npmrc`.

- [ ] **Step 7: Esqueleto que renderiza**

Criar `web/admin/src/app/globals.css`:

```css
@import "@mais/ui/tokens.css";

/* O Tailwind v4 descobre as classes varrendo os fontes. O painel é varrido
   por padrão; `web/ui` precisa ser declarado, senão as classes usadas só lá
   dentro somem do CSS gerado. */
@source "../../../ui/src";
```

Criar `web/ui/src/tokens.css` com os tokens transcritos de `docs/demo.html` (linhas 12-32) — este arquivo é o núcleo do que a spec entrega ao sub-projeto 4:

```css
@import "tailwindcss";

@theme {
  --color-roxo: #6d28d9;
  --color-roxo-2: #7c3aed;
  --color-roxo-bg: #f1ecfd;
  --color-roxo-bg-2: #ede7fb;
  --color-pagina: #f7f6fb;
  --color-card: #ffffff;
  --color-borda: #ececf2;
  --color-borda-2: #e4e2ec;
  --color-borda-3: #cfc7e6;
  --color-txt: #221d3a;
  --color-txt-2: #6b6780;
  --color-txt-3: #9b97a8;
  --color-erro: #e5484d;
  --color-erro-bg: #fdecec;
  --color-ok: #16a34a;
  --color-ok-bg: #e9f7ee;

  --radius-card: 18px;
  --radius-row: 14px;
  --radius-btn: 12px;

  --shadow-card: 0 1px 2px rgb(34 29 58 / 0.04), 0 8px 24px rgb(34 29 58 / 0.05);
  --shadow-card-2: 0 1px 3px rgb(34 29 58 / 0.06), 0 12px 32px rgb(34 29 58 / 0.08);
  --shadow-btn: 0 6px 16px rgb(109 40 217 / 0.28);

  --font-sans: var(--fonte-inter), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-display: var(--fonte-poppins), sans-serif;
}

@layer base {
  body {
    background: var(--color-pagina);
    color: var(--color-txt);
    font-family: var(--font-sans);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  /* Do demo.html: foco visível em tudo, e respeito a quem pediu menos movimento. */
  :focus-visible {
    outline: 3px solid #c4b5fd;
    outline-offset: 2px;
    border-radius: 8px;
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition: none !important;
      animation: none !important;
    }
  }
}
```

Copiar o logo:

```bash
cp docs/logo.png web/admin/public/logo.png
```

Criar `web/admin/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

// next/font baixa e auto-hospeda no build: nenhuma requisição a servidor de
// fonte em runtime, e nenhum pacote npm novo (vem dentro do próprio next).
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--fonte-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--fonte-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Painel — Mais Aprovação Questões",
  // Defesa em profundidade: o Access já devolve a tela do IdP ao crawler.
  // A camada robusta é o X-Robots-Tag em public/_headers; esta é a segunda.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

Criar `web/admin/src/app/page.tsx` provisório (a lista chega na Task 4):

```tsx
export default function Pagina() {
  return <main className="p-8 font-display text-2xl">Painel</main>;
}
```

- [ ] **Step 8: Verificar**

```bash
cd web && npm run typecheck && npm run build && npm run audit
```

Expected:
- `typecheck` limpo nos dois workspaces.
- `build` gera `web/admin/out/index.html`.
- `audit` reporta **exatamente um** achado: `postcss@8.5.21`, `GHSA-fxqj-rqcc-2cmp`. É o achado conhecido do Step 1, com correção agendada na Task 10. Qualquer achado além desse **para a task** — investigue antes de seguir.

Conferir também que o export não regrediu para SSR:

```bash
test -f web/admin/out/index.html && echo "export ok"
grep -r "opennextjs" web/package-lock.json && echo "ADAPTADOR ENTROU — PARE" || echo "sem adaptador"
```

- [ ] **Step 9: Commit**

```bash
git add web api/scripts/audit-osv.mjs
git commit -m "feat(web): workspace do painel com Next, Tailwind e tokens do design system"
```

---

## Task 2: Design system em `web/ui`

**Files:**
- Create: `web/ui/src/Botao.tsx`, `Campo.tsx`, `Card.tsx`, `Badge.tsx`, `Tabela.tsx`, `Modal.tsx`, `Toast.tsx`
- Modify: `web/ui/src/index.ts`

**Interfaces:**
- Consumes: `web/ui/src/tokens.css` (Task 1).
- Produces, todos exportados de `@mais/ui`:
  - `Botao({ variante?: "primario" | "secundario" | "perigo", carregando?: boolean, ...ButtonHTMLAttributes })`
  - `Campo({ rotulo: string, erro?: string, dica?: string, children: ReactNode, htmlFor?: string })`
  - `Card({ children, className? })`
  - `Badge({ tom: "neutro" | "roxo" | "ok" | "erro", children })`
  - `Tabela<T>({ colunas: Coluna<T>[], linhas: T[], chave: (l: T) => string, aoClicar?: (l: T) => void, vazio?: string })` e `type Coluna<T> = { titulo: string; celula: (l: T) => ReactNode; principal?: boolean }`
  - `Modal({ aberto: boolean, titulo: string, children, aoConfirmar: () => void, aoCancelar: () => void, rotuloConfirmar?: string, perigo?: boolean })`
  - `ProvedorToast({ children })` e `useToast(): (texto: string, tom?: "ok" | "erro") => void`

**Regra de dependência que torna o critério nº 5 verificável:** nenhum arquivo de `web/ui` pode importar de `next`, de `@/…` ou de qualquer coisa dentro de `web/admin`. Só `react` e os próprios irmãos. É isso que `npm run typecheck -w ui` (com `"types": []`) prova.

- [ ] **Step 1: `Botao`**

Criar `web/ui/src/Botao.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";

export type VarianteBotao = "primario" | "secundario" | "perigo";

const BASE =
  "inline-flex items-center justify-center gap-2 h-[46px] px-5 rounded-btn " +
  "font-bold text-[14.5px] transition-[background,transform,box-shadow] " +
  "disabled:opacity-55 disabled:cursor-not-allowed disabled:shadow-none " +
  "active:translate-y-px";

const VARIANTE: Record<VarianteBotao, string> = {
  primario: "bg-roxo text-white shadow-btn hover:bg-roxo-2",
  secundario: "bg-card text-txt border border-borda-2 hover:border-borda-3 hover:bg-roxo-bg/40",
  perigo: "bg-erro text-white hover:brightness-95",
};

export function Botao({
  variante = "primario",
  carregando = false,
  className = "",
  children,
  disabled,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBotao;
  carregando?: boolean;
}) {
  return (
    <button
      {...resto}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={`${BASE} ${VARIANTE[variante]} ${className}`}
    >
      {carregando ? "Aguarde…" : children}
    </button>
  );
}
```

- [ ] **Step 2: `Campo`, `Card` e `Badge`**

Criar `web/ui/src/Campo.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * Só o rótulo, a mensagem de erro e o espaçamento. O controle vem por
 * `children` de propósito: input, select e textarea têm APIs diferentes
 * demais para caberem numa prop `tipo` sem virar um componente que faz três
 * coisas.
 */
export function Campo({
  rotulo,
  erro,
  dica,
  htmlFor,
  children,
}: {
  rotulo: string;
  erro?: string;
  dica?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-bold text-txt">
        {rotulo}
      </label>
      {children}
      {dica && !erro && <p className="text-[12.5px] text-txt-3">{dica}</p>}
      {erro && (
        <p role="alert" className="text-[12.5px] font-semibold text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}

/** Estilo compartilhado por input, select e textarea. */
export const CONTROLE =
  "w-full h-[50px] px-3.5 rounded-btn border border-borda-2 bg-white " +
  "text-[14.5px] text-txt outline-none transition-colors " +
  "hover:border-borda-3 focus:border-roxo";
```

Criar `web/ui/src/Card.tsx`:

```tsx
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card border border-borda rounded-card shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
```

Criar `web/ui/src/Badge.tsx`:

```tsx
import type { ReactNode } from "react";

const TOM = {
  neutro: "bg-[#f1f1f4] text-txt-2",
  roxo: "bg-roxo-bg text-roxo",
  ok: "bg-ok-bg text-ok",
  erro: "bg-erro-bg text-erro",
} as const;

export function Badge({
  tom = "neutro",
  children,
}: {
  tom?: keyof typeof TOM;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block px-3 py-1.5 rounded-[9px] text-[13px] font-bold whitespace-nowrap ${TOM[tom]}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 3: `Tabela` responsiva**

Criar `web/ui/src/Tabela.tsx`. O critério de pronto nº 4 pede que as telas respondam bem em mobile; uma `<table>` com cinco colunas não responde — abaixo de 760px cada linha vira um cartão empilhado, com o rótulo da coluna ao lado do valor:

```tsx
import type { ReactNode } from "react";

export type Coluna<T> = {
  titulo: string;
  celula: (linha: T) => ReactNode;
  /** A coluna que identifica a linha; no mobile vira o título do cartão. */
  principal?: boolean;
};

export function Tabela<T>({
  colunas,
  linhas,
  chave,
  aoClicar,
  vazio = "Nada por aqui ainda.",
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  chave: (linha: T) => string;
  aoClicar?: (linha: T) => void;
  vazio?: string;
}) {
  if (linhas.length === 0) {
    return <p className="p-8 text-center text-txt-2">{vazio}</p>;
  }

  return (
    <>
      {/* Desktop */}
      <table className="hidden md:table w-full border-collapse">
        <thead>
          <tr className="border-b border-borda">
            {colunas.map((c) => (
              <th
                key={c.titulo}
                className="text-left px-5 py-3 text-[13px] font-bold text-txt-2"
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr
              key={chave(linha)}
              onClick={aoClicar ? () => aoClicar(linha) : undefined}
              className={`border-b border-borda last:border-0 ${
                aoClicar ? "cursor-pointer hover:bg-roxo-bg/40" : ""
              }`}
            >
              {colunas.map((c) => (
                <td key={c.titulo} className="px-5 py-4 text-[14.5px] align-top">
                  {c.celula(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile */}
      <ul className="md:hidden divide-y divide-borda">
        {linhas.map((linha) => (
          <li
            key={chave(linha)}
            onClick={aoClicar ? () => aoClicar(linha) : undefined}
            className={`p-4 flex flex-col gap-2 ${aoClicar ? "cursor-pointer" : ""}`}
          >
            {colunas.map((c) =>
              c.principal ? (
                <div key={c.titulo} className="text-[15px] font-semibold">
                  {c.celula(linha)}
                </div>
              ) : (
                <div key={c.titulo} className="flex gap-2 text-[13.5px]">
                  <span className="text-txt-3 shrink-0">{c.titulo}:</span>
                  <span>{c.celula(linha)}</span>
                </div>
              ),
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
```

- [ ] **Step 4: `Modal` e `Toast`**

Criar `web/ui/src/Modal.tsx`:

```tsx
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Botao } from "./Botao";

export function Modal({
  aberto,
  titulo,
  children,
  aoConfirmar,
  aoCancelar,
  rotuloConfirmar = "Confirmar",
  perigo = false,
}: {
  aberto: boolean;
  titulo: string;
  children?: ReactNode;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  rotuloConfirmar?: string;
  perigo?: boolean;
}) {
  const dialogoRef = useRef<HTMLDivElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);
  // Guarda a versão mais recente de aoCancelar sem entrar nas deps do efeito
  // abaixo — assim ele não refaz o setup (e rouba o foco de novo) só porque
  // o chamador passou uma nova função inline num re-render.
  const aoCancelarRef = useRef(aoCancelar);
  aoCancelarRef.current = aoCancelar;

  useEffect(() => {
    if (!aberto) return;

    focoAnteriorRef.current = document.activeElement as HTMLElement | null;
    // `children` é renderizado antes da linha de botões, isso manda o foco
    // pro campo de formulário quando há um (ex.: o diálogo de renomear) e,
    // na ausência de um (children é só texto, ex.: o diálogo de excluir),
    // cai no Cancelar — o primeiro botão e a opção segura e não destrutiva.
    dialogoRef.current
      ?.querySelector<HTMLElement>("input, select, textarea, button, [href]")
      ?.focus();

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoCancelarRef.current();
    }
    document.addEventListener("keydown", aoTeclar);

    return () => {
      document.removeEventListener("keydown", aoTeclar);
      focoAnteriorRef.current?.focus();
    };
  }, [aberto]);

  if (!aberto) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={aoCancelar}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-card rounded-card shadow-card-2 p-6 flex flex-col gap-4"
      >
        <h2 className="font-display text-lg font-bold">{titulo}</h2>
        {children && <div className="text-[14.5px] text-txt-2">{children}</div>}
        <div className="flex gap-3 justify-end">
          <Botao variante="secundario" onClick={aoCancelar}>
            Cancelar
          </Botao>
          <Botao variante={perigo ? "perigo" : "primario"} onClick={aoConfirmar}>
            {rotuloConfirmar}
          </Botao>
        </div>
      </div>
    </div>
  );
}
```

Criar `web/ui/src/Toast.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Tom = "ok" | "erro";
type Avisar = (texto: string, tom?: Tom) => void;

const Ctx = createContext<Avisar | null>(null);

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<{ texto: string; tom: Tom } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback<Avisar>((texto, tom = "ok") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAviso({ texto, tom });
    timerRef.current = setTimeout(() => setAviso(null), 4000);
  }, []);

  // Limpa o timer pendente se o provedor desmontar antes dos 4s — evita
  // chamar setAviso depois que o componente já saiu de cena.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const valor = useMemo(() => avisar, [avisar]);

  return (
    <Ctx.Provider value={valor}>
      {children}
      {aviso && (
        <div
          role="status"
          className={`fixed left-1/2 bottom-6 -translate-x-1/2 z-50 px-5 py-3 rounded-btn text-white text-sm font-semibold shadow-card-2 ${
            aviso.tom === "erro" ? "bg-erro" : "bg-txt"
          }`}
        >
          {aviso.texto}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useToast(): Avisar {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast fora do ProvedorToast");
  return ctx;
}
```

`Toast.tsx` e `Modal.tsx` são os dois únicos arquivos de `web/ui` com `"use client"`, e o motivo é o mesmo: ambos têm estado e hooks. A diretiva **não** cria dependência de Next — é entendida por qualquer bundler com suporte a RSC, e o `tsc` do Step 6 a ignora, então a regra de isolamento continua valendo.

Dois detalhes do `Modal` que não são decoração. O `aoCancelarRef` mantém a versão mais recente do callback fora das dependências do efeito: sem ele, um chamador que passe uma função inline faria o efeito refazer o setup a cada re-render, roubando o foco de volta para o botão Cancelar enquanto a pessoa digita. E os hooks ficam todos **acima** do `if (!aberto) return null` — invertida, essa ordem viola as regras dos hooks.

- [ ] **Step 5: Exportar tudo**

Substituir `web/ui/src/index.ts`:

```ts
export { Botao, type VarianteBotao } from "./Botao";
export { Campo, CONTROLE } from "./Campo";
export { Card } from "./Card";
export { Badge } from "./Badge";
export { Tabela, type Coluna } from "./Tabela";
export { Modal } from "./Modal";
export { ProvedorToast, useToast } from "./Toast";
```

- [ ] **Step 6: Verificar o isolamento (critério de pronto nº 5)**

```bash
cd web && npm run typecheck -w ui
```

Expected: PASS, sem nenhum erro.

E provar que o isolamento é real, não acidental:

```bash
grep -rE "from \"(next|@/|\.\./\.\./admin)" web/ui/src && echo "ACOPLOU AO PAINEL — PARE" || echo "ui isolado"
```

Expected: `ui isolado`.

- [ ] **Step 7: Ligar o provedor no layout**

Modificar `web/admin/src/app/layout.tsx`, envolvendo `{children}`:

```tsx
import { ProvedorToast } from "@mais/ui";
// …
      <body>
        <ProvedorToast>{children}</ProvedorToast>
      </body>
```

- [ ] **Step 8: Verificar e commitar**

```bash
cd web && npm run typecheck && npm run build
```

Expected: os dois limpos.

```bash
git add web
git commit -m "feat(ui): design system com os tokens e componentes do demo.html"
```

---

## Task 3: Harness de e2e, cliente de API e tela de login

**Files:**
- Create: `web/admin/e2e/playwright.config.ts`, `web/admin/e2e/credenciais.mjs`, `web/admin/e2e/entrar.ts`, `web/admin/e2e/seed.mjs`, `web/admin/e2e/tsconfig.json`, `web/admin/e2e/login.spec.ts`
- Create: `web/admin/src/lib/api.ts`, `web/admin/src/lib/erros.ts`, `web/admin/src/lib/sessao.tsx`
- Create: `web/admin/src/app/login/page.tsx`
- Create: `web/admin/src/componentes/Layout.tsx`
- Modify: `web/admin/package.json`, `web/package.json`, `api/.dev.vars` (local, não versionado)

**Interfaces:**
- Consumes: `Botao`, `Campo`, `CONTROLE`, `Card`, `useToast` de `@mais/ui` (Task 2).
- Produces:
  - `api` (objeto) e `ApiError` de `@/lib/api`
  - `mensagemDe(erro: unknown): string` de `@/lib/erros`
  - `useSessao(): { carregando: boolean; usuario: Usuario | null }` de `@/lib/sessao`
  - `entrar(page: Page): Promise<void>` de `e2e/entrar.ts`, usado como pré-condição pelos specs das Tasks 4, 5, 7, 8 e 9
  - `Layout({ children })` de `@/componentes/Layout`

**Pacote aprovado nesta task:** `@playwright/test@1.61.1`, publicado 2026-06-23 (42 dias em 04/08 ✓). São 4 pacotes npm. A 1.62.0 é de 2026-07-24 e só passa no cooldown em 07/08.

**O download dos browsers é o item que exige atenção.** Com `ignore-scripts=true` global, o postinstall que baixa o Chromium **não roda** — o que é o comportamento certo. O download vira um passo explícito e único (Step 2), restrito ao Chromium: é o mesmo motor do Chrome e do Edge, que é onde a operação vai usar o painel, e evita arrastar Firefox e WebKit.

- [ ] **Step 1: Instalar o Playwright**

```bash
cd web && npm install --save-dev --save-exact -w admin @playwright/test@1.61.1
```

Conferir antes:

```bash
npm view @playwright/test time --json | jq -r '."1.61.1"'
```

Expected: `2026-06-23T…` — mais de 14 dias.

- [ ] **Step 2: Baixar só o Chromium**

```bash
cd web && npx playwright install chromium
```

Expected: baixa o Chromium para `~/Library/Caches/ms-playwright`. Não passar `--with-deps` (é `apt` em Linux, e não se aplica aqui).

- [ ] **Step 3: Preparar o ambiente local da API**

Em `api/.dev.vars` (arquivo local, já no `.gitignore` — **nunca commitar**; **acrescentar, não sobrescrever**, porque ele pode já ter os segredos do sandbox da Hotmart), garantir:

```
ACCESS_DEV_BYPASS=true
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
JWT_SECRET=<qualquer segredo forte — só desenvolvimento>
```

**O `JWT_SECRET` não é opcional e é fácil de esquecer.** Sem ele o `signSession` estoura (`DataError: Imported HMAC key length (0)`) e o login responde 500. A suíte de testes do Worker **não** pega isso, porque o `@cloudflare/vitest-pool-workers` injeta o valor como binding do Miniflare — o `wrangler dev`, não. Os outros três segredos que o `api/README.md` lista (`HOTMART_*`, `DOCUMENT_HMAC_KEY`) não são exercitados por este e2e, mas não custa tê-los.

`ACCESS_DEV_BYPASS=true` pula a camada 1 (o JWT do Access), que não existe fora da borda da Cloudflare — é exatamente o que `api/src/middleware/access.ts:45` prevê. As camadas 2 e 3 (sessão + `role=admin`) continuam valendo, então o e2e ainda exerce o login de verdade.

`1x0000000000000000000000000000000AA` é a *secret key* de teste publicada pela Cloudflare, que faz o `siteverify` responder sucesso para qualquer token. É o par da site key `1x00000000000000000000AA` do Step 6. Sem isso, `verifyTurnstile` (`api/src/lib/turnstile.ts:17`) recusaria o token vazio e o login responderia 403.

Criar `web/admin/.env.development.local` (adicionar ao `.gitignore` do `web/` se ainda não estiver coberto):

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

- [ ] **Step 4: Semente do admin de desenvolvimento**

Não existe cadastro público — a conta nasce da compra na Hotmart. Para o e2e, ela nasce daqui.

**Dois arquivos, e a separação é o ponto.** Os specs precisam do email e da senha, mas importar `seed.mjs` para pegá-los **executaria o seed inteiro** — cada spec limparia o banco no momento em que o Playwright o carregasse, derrubando o que o spec anterior acabou de criar. Constantes ficam num módulo sem efeito colateral; o seed importa dele.

Criar `web/admin/e2e/credenciais.mjs`:

```js
/**
 * Só constantes. Este módulo é importado pelos specs, então ele não pode ter
 * efeito colateral nenhum — é por isso que ele não é o `seed.mjs`.
 */
export const EMAIL = "admin@dev.local";
export const SENHA = "senha-de-desenvolvimento";
```

Criar `web/admin/e2e/seed.mjs`:

```js
/**
 * Cria (ou recria) o admin de desenvolvimento no D1 local. Roda uma vez por
 * suíte, pelo script `npm test` — nunca por import de spec.
 *
 * O hash PBKDF2 é recalculado aqui em vez de importado de
 * `api/src/lib/password.ts`: aquele arquivo é TypeScript de Worker e este é um
 * script Node solto. A duplicação é de 12 linhas e é **auto-verificável** — se
 * o formato divergir do que `verifyPassword` espera, o primeiro teste de login
 * falha imediatamente, que é o teste logo ao lado.
 */
import { execFileSync } from "node:child_process";
import { EMAIL, SENHA } from "./credenciais.mjs";

const ITERACOES = 100_000;

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function hashSenha(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERACOES, hash: "SHA-256" },
    chave,
    256,
  );
  return `pbkdf2$sha256$${ITERACOES}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

function d1(sql) {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "mais-aprovacao-db", "--local", "--command", sql],
    { cwd: new URL("../../../api", import.meta.url).pathname, stdio: "inherit" },
  );
}

const hash = await hashSenha(SENHA);
const agora = Date.now();

// Limpa o acervo entre execuções para que o e2e do caminho crítico não conte
// questões deixadas pela rodada anterior.
d1("delete from alternatives");
d1("delete from explanations");
d1("delete from questions");
d1("delete from taxonomy_terms");
d1(`delete from users where email = '${EMAIL}'`);
d1(
  `insert into users (id, email, name, role, password_hash, created_at, updated_at)
   values ('dev-admin', '${EMAIL}', 'Admin Dev', 'admin', '${hash}', ${agora}, ${agora})`,
);

console.log(`admin de desenvolvimento pronto: ${EMAIL}`);
```

Antes de rodar o seed pela primeira vez, aplicar as migrações no D1 local:

```bash
cd api && npm run db:migrate:local
```

Criar `web/admin/e2e/entrar.ts` — o login pela tela, que quase todo spec precisa fazer antes de chegar no que ele realmente testa:

```ts
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
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
}
```

O Playwright só coleta `*.spec.ts` (`testMatch` padrão), então `entrar.ts` e `credenciais.mjs` convivem no `testDir` sem virarem suítes vazias.

- [ ] **Step 5: Configurar o Playwright**

Criar `web/admin/e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

/**
 * Dois servidores, porque o painel só é o painel com a API atrás: o
 * `wrangler dev` serve o Worker em 8787 e o `next dev` serve as telas em 3000,
 * reescrevendo /admin/* e /auth/* para o Worker (ver next.config.ts). Do ponto
 * de vista do navegador tudo é localhost:3000 — a mesma origem única que a
 * produção tem, que é o que faz este e2e testar o arranjo real e não um
 * arranjo de mentira com CORS.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false, // um D1 local, um acervo: paralelismo aqui é corrida
  workers: 1,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev",
      cwd: "../../../api",
      url: "http://127.0.0.1:8787/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "npm run dev",
      cwd: "..",
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
```

Criar `web/admin/e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowJs": true
  },
  "include": ["."]
}
```

Modificar `web/admin/package.json` → `scripts`, acrescentando:

```json
    "seed": "node e2e/seed.mjs",
    "test": "npm run seed && playwright test -c e2e/playwright.config.ts"
```

- [ ] **Step 6: Escrever o teste que falha**

Criar `web/admin/e2e/login.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";

test("sem sessão, qualquer tela redireciona para o login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("credencial errada mostra a mensagem genérica e não entra", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(/email ou senha inválidos/i);
  await expect(page).toHaveURL(/\/login/);
});

test("credencial correta entra e a topbar mostra quem está logado", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByText("Admin Dev")).toBeVisible();
});

test("sair limpa a sessão e volta ao login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `cd web/admin && npm test`
Expected: FAIL — não existe `/login`; o Next devolve 404 e os seletores não encontram nada.

- [ ] **Step 8: Cliente de API**

Criar `web/admin/src/lib/api.ts`:

```ts
/**
 * Cliente do Worker.
 *
 * Caminho relativo sempre: em produção o Pages e o Worker dividem
 * `admin.<domínio>` por Worker Route, e em dev o `next dev` reescreve os
 * mesmos dois prefixos. Nos dois casos a chamada é same-origin — por isso
 * `credentials: "same-origin"` basta, e nenhum código de CORS existe aqui.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
  ) {
    super(codigo);
    this.name = "ApiError";
  }
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const res = await fetch(caminho, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : init?.body
          ? { "content-type": "application/json" }
          : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(res.status, corpo?.error ?? "erro_desconhecido");
  }
  return (await res.json()) as T;
}

const json = (dados: unknown) => JSON.stringify(dados);

// ---- tipos, espelhando api/src/db/questions.ts e api/src/db/taxonomy.ts ----

export type TipoQuestao = "multiple_choice" | "true_false";
export type SituacaoQuestao = "draft" | "published";
export type TipoTermo = "subject" | "banca" | "cargo" | "level";

export interface Usuario {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tier: string;
}

export interface Termo {
  id: string;
  kind: TipoTermo;
  name: string;
  slug: string;
}

export interface LinhaQuestao {
  id: string;
  statement: string;
  type: TipoQuestao;
  status: SituacaoQuestao;
  year: number | null;
  subjectName: string | null;
  bancaName: string | null;
}

export interface Alternativa {
  id?: string;
  position?: number;
  body: string;
  isCorrect: boolean;
}

export interface Questao {
  id: string;
  type: TipoQuestao;
  statement: string;
  subjectId: string;
  bancaId: string;
  cargoId: string | null;
  levelId: string | null;
  year: number | null;
  status: SituacaoQuestao;
  alternatives: Required<Alternativa>[];
  explanation: { body: string; videoUrl: string | null } | null;
}

/** O corpo que POST e PATCH aceitam. `status` só existe no POST. */
export interface EntradaQuestao {
  type: TipoQuestao;
  statement: string;
  subjectId: string;
  bancaId: string;
  cargoId?: string | null;
  levelId?: string | null;
  year?: number | null;
  alternatives: { body: string; isCorrect: boolean }[];
  explanation: { body: string; videoUrl?: string | null };
}

export interface FiltrosQuestao {
  subjectId?: string;
  bancaId?: string;
  cargoId?: string;
  levelId?: string;
  year?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

function queryDe(filtros: FiltrosQuestao): string {
  const p = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    // Filtro vazio é "sem filtro" — a API normaliza string vazia para ausente
    // (api/src/routes/admin/questions.ts:129), mas não mandar é mais honesto.
    if (valor !== undefined && valor !== null && String(valor) !== "") {
      p.set(chave, String(valor));
    }
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  // ---- sessão ----
  me: () => chamar<Usuario>("/auth/me"),
  entrar: (email: string, senha: string, turnstileToken?: string) =>
    chamar<{ ok: true }>("/auth/login", {
      method: "POST",
      body: json({ email, password: senha, turnstileToken }),
    }),
  sair: () => chamar<{ ok: true }>("/auth/logout", { method: "POST" }),

  // ---- taxonomias ----
  termos: (kind: TipoTermo) =>
    chamar<{ terms: Termo[] }>(`/admin/taxonomy?kind=${kind}`).then(
      (r) => r.terms,
    ),
  criarTermo: (kind: TipoTermo, name: string) =>
    chamar<{ term: Termo }>("/admin/taxonomy", {
      method: "POST",
      body: json({ kind, name }),
    }).then((r) => r.term),
  renomearTermo: (id: string, name: string) =>
    chamar<{ term: Termo }>(`/admin/taxonomy/${id}`, {
      method: "PATCH",
      body: json({ name }),
    }).then((r) => r.term),
  excluirTermo: (id: string) =>
    chamar<{ ok: true }>(`/admin/taxonomy/${id}`, { method: "DELETE" }),

  // ---- questões ----
  questoes: (filtros: FiltrosQuestao = {}) =>
    chamar<{ rows: LinhaQuestao[]; total: number }>(
      `/admin/questions${queryDe(filtros)}`,
    ),
  questao: (id: string) =>
    chamar<{ question: Questao }>(`/admin/questions/${id}`).then(
      (r) => r.question,
    ),
  criarQuestao: (entrada: EntradaQuestao, status: SituacaoQuestao) =>
    chamar<{ id: string }>("/admin/questions", {
      method: "POST",
      body: json({ ...entrada, status }),
    }),
  salvarQuestao: (id: string, entrada: EntradaQuestao) =>
    chamar<{ ok: true }>(`/admin/questions/${id}`, {
      method: "PATCH",
      body: json(entrada),
    }),
  publicar: (id: string) =>
    chamar<{ ok: true }>(`/admin/questions/${id}/publish`, { method: "POST" }),
  despublicar: (id: string) =>
    chamar<{ ok: true }>(`/admin/questions/${id}/unpublish`, {
      method: "POST",
    }),
  excluirQuestao: (id: string) =>
    chamar<{ ok: true }>(`/admin/questions/${id}`, { method: "DELETE" }),

  // ---- mídia ----
  enviarImagem: (arquivo: File) => {
    const form = new FormData();
    form.set("file", arquivo);
    return chamar<{ url: string }>("/admin/media", {
      method: "POST",
      body: form,
    }).then((r) => r.url);
  },
};
```

- [ ] **Step 9: Tradução dos códigos de erro**

Criar `web/admin/src/lib/erros.ts`. Os códigos vêm da tabela do `api/README.md`; o `invalid_request` é único de propósito na API, e é aqui que ele vira frase:

```ts
import { ApiError } from "./api";

const MENSAGEM: Record<string, string> = {
  // corpo e query
  invalid_request: "Confira os campos — algum valor está fora do formato esperado.",
  invalid_kind: "Tipo de taxonomia desconhecido.",
  invalid_status: "Filtro de situação inválido.",
  invalid_year: "Ano inválido. Use um valor entre 1900 e 2200.",
  // conflito e ausência
  duplicate: "Já existe um termo ativo com esse nome.",
  not_found: "Registro não encontrado. Ele pode ter sido excluído por outra pessoa.",
  // invariantes de questão
  exactly_one_correct: "Marque exatamente uma alternativa como correta.",
  true_false_needs_two: "Questão de certo/errado precisa de exatamente duas alternativas.",
  needs_two_alternatives: "Múltipla escolha precisa de pelo menos duas alternativas.",
  invalid_subject: "Assunto inválido ou excluído. Escolha outro.",
  invalid_banca: "Banca inválida ou excluída. Escolha outra.",
  invalid_cargo: "Cargo inválido ou excluído. Escolha outro.",
  invalid_level: "Nível inválido ou excluído. Escolha outro.",
  // mídia
  missing_file: "Selecione um arquivo.",
  too_large: "Imagem acima de 2 MB. Reduza antes de enviar.",
  unsupported_type: "Formato não suportado. Use PNG, JPEG, WebP ou GIF.",
  // sessão
  invalid_credentials: "Email ou senha inválidos.",
  captcha_failed: "Não conseguimos confirmar que você não é um robô. Recarregue a página.",
  unauthorized: "Sua sessão expirou. Entre novamente.",
  forbidden: "Sua conta não tem permissão de administrador.",
};

export function mensagemDe(erro: unknown): string {
  if (erro instanceof ApiError) {
    return MENSAGEM[erro.codigo] ?? `Erro inesperado (${erro.codigo}).`;
  }
  // Falha de rede: o fetch rejeita sem status nem corpo.
  return "Não foi possível falar com o servidor. Verifique a conexão.";
}
```

- [ ] **Step 10: Guarda de sessão**

Criar `web/admin/src/lib/sessao.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Usuario } from "./api";

/**
 * Guarda de rota do lado do cliente. Não é controle de acesso — o controle é
 * o `role=admin` lido do D1 pelo Worker (api/src/middleware/rbac.ts) e o
 * Cloudflare Access na borda. Isto aqui só evita mostrar uma tela vazia a
 * quem não tem sessão, e é por isso que pode viver no navegador sem risco.
 */
export function useSessao(): { carregando: boolean; usuario: Usuario | null } {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let vivo = true;
    api
      .me()
      .then((u) => {
        if (!vivo) return;
        if (u.role !== "admin") {
          router.replace("/login?motivo=forbidden");
          return;
        }
        setUsuario(u);
      })
      .catch((erro) => {
        if (!vivo) return;
        if (erro instanceof ApiError && (erro.status === 401 || erro.status === 403)) {
          router.replace("/login");
          return;
        }
        // Falha de rede não desloga: manter o usuário na tela e deixar a
        // próxima ação mostrar o erro é melhor que expulsar por um blip.
        setUsuario(null);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [router]);

  return { carregando, usuario };
}
```

- [ ] **Step 11: Layout com topbar**

Criar `web/admin/src/componentes/Layout.tsx`:

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Botao } from "@mais/ui";
import { api } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

const NAV = [
  { href: "/", rotulo: "Questões" },
  { href: "/taxonomias", rotulo: "Taxonomias" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { carregando, usuario } = useSessao();
  const caminho = usePathname();
  const router = useRouter();

  if (carregando) {
    return <main className="p-8 text-txt-2">Carregando…</main>;
  }
  if (!usuario) return null; // useSessao já redirecionou

  async function sair() {
    await api.sair().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <>
      <header className="bg-card border-b border-borda">
        <div className="max-w-[1320px] mx-auto px-4 md:px-6 flex items-center gap-4 md:gap-6 h-[68px] md:h-[84px]">
          <Link href="/" className="shrink-0">
            <Image
              src="/logo.png"
              alt="Mais Aprovação Questões"
              width={180}
              height={68}
              className="h-10 md:h-[68px] w-auto"
              priority
            />
          </Link>
          <nav className="flex items-center gap-5 md:gap-8">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-[15px] font-semibold ${
                  caminho === item.href ? "text-roxo" : "text-txt-2"
                }`}
              >
                {item.rotulo}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-[15px] font-semibold">
              {usuario.name ?? usuario.email}
            </span>
            <Botao variante="secundario" onClick={sair}>
              Sair
            </Botao>
          </div>
        </div>
      </header>
      <main className="max-w-[1320px] mx-auto px-4 md:px-6 py-6">{children}</main>
    </>
  );
}
```

- [ ] **Step 12: Tela de login**

Criar `web/admin/src/app/login/page.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Botao, Campo, Card, CONTROLE } from "@mais/ui";
import { api } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => string;
    };
  }
}

export default function PaginaLogin() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [token, setToken] = useState("");
  const widget = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // O widget é montado à mão porque o script do Turnstile é carregado de
  // forma assíncrona pelo <Script>: o auto-render pode correr antes do React
  // ter posto a div no DOM.
  useEffect(() => {
    const timer = setInterval(() => {
      if (window.turnstile && widget.current && !widget.current.dataset.pronto) {
        widget.current.dataset.pronto = "1";
        window.turnstile.render(widget.current, {
          sitekey: SITE_KEY,
          callback: setToken,
        });
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.entrar(email, senha, token);
      router.replace("/");
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <main className="min-h-dvh flex items-center justify-center p-4">
        <Card className="w-full max-w-[420px] p-7 flex flex-col gap-5">
          <Image
            src="/logo.png"
            alt="Mais Aprovação Questões"
            width={200}
            height={76}
            className="h-14 w-auto self-center"
            priority
          />
          <h1 className="font-display text-xl font-bold text-center">
            Painel administrativo
          </h1>

          <form onSubmit={enviar} className="flex flex-col gap-4">
            <Campo rotulo="Email" htmlFor="email">
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                className={CONTROLE}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Senha" htmlFor="senha">
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                className={CONTROLE}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Campo>

            <div ref={widget} />

            {erro && (
              <p role="alert" className="text-[13.5px] font-semibold text-erro">
                {erro}
              </p>
            )}

            {/* Sem token o Worker responde `captcha_failed` antes mesmo de
                olhar a credencial, então enviar cedo só produz um erro que
                confunde. O widget de teste leva ~3s para resolver. */}
            {!token && (
              <p className="text-[12.5px] text-txt-3">
                Aguardando a verificação de segurança…
              </p>
            )}

            <Botao type="submit" carregando={enviando} disabled={!token}>
              Entrar
            </Botao>
          </form>
        </Card>
      </main>
    </>
  );
}
```

- [ ] **Step 13: Ligar a guarda na página inicial**

Substituir `web/admin/src/app/page.tsx`:

```tsx
"use client";

import { Layout } from "@/componentes/Layout";

export default function Pagina() {
  return (
    <Layout>
      <h1 className="font-display text-2xl font-bold">Questões</h1>
    </Layout>
  );
}
```

- [ ] **Step 14: Rodar os testes e confirmar que passam**

Run: `cd web/admin && npm test`
Expected: PASS nos quatro testes de `login.spec.ts`.

Se o teste de credencial correta falhar com 403, o `TURNSTILE_SECRET_KEY` de teste não está em `api/.dev.vars` (Step 3). Se falhar com 401 no `/auth/me` logo depois de um login bem-sucedido, o cookie não sobreviveu ao proxy — confira que o `next.config.ts` está reescrevendo `/auth/*` e que o navegador está em `localhost`, não em `127.0.0.1` (são hosts diferentes para cookie).

- [ ] **Step 15: Commit**

```bash
git add web
git commit -m "feat(admin): login, cliente de API e guarda de sessão, com e2e"
```

---

## Task 4: Tela de lista de questões

**Files:**
- Modify: `web/admin/src/app/page.tsx`
- Create: `web/admin/src/componentes/SeletorTaxonomia.tsx`
- Create: `web/admin/e2e/lista.spec.ts`

**Interfaces:**
- Consumes: `api`, `mensagemDe`, `Layout`, `Tabela`, `Coluna`, `Badge`, `Botao`, `Card`, `Modal`, `useToast`.
- Produces: `SeletorTaxonomia({ kind, valor, aoMudar, rotulo?, obrigatorio?, erro? })` de `@/componentes/SeletorTaxonomia`.

**Regra de filtro herdada da API, e o que ela obriga na tela:** filtro inválido responde 400 com código por campo, paginação inválida cai no default (`api/README.md`, "Códigos de erro"). Os `<select>` só emitem valores válidos, então o 400 de filtro não deve acontecer na prática — mas se acontecer, a lista mostra a mensagem em vez de exibir o acervo inteiro fingindo estar filtrada. É exatamente o cenário que motivou a regra.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/admin/e2e/lista.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";

test("acervo vazio explica o que fazer", async ({ page }) => {
  await entrar(page);
  await expect(page.getByText(/nenhuma questão/i)).toBeVisible();
});

test("o filtro de situação vai para a query e volta ao ser limpo", async ({
  page,
}) => {
  await entrar(page);

  const chamadas: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/admin/questions")) chamadas.push(r.url());
  });

  await page.getByLabel("Situação").selectOption("published");
  await expect
    .poll(() => chamadas.some((u) => u.includes("status=published")))
    .toBe(true);

  await page.getByLabel("Situação").selectOption("");
  await expect
    .poll(() => chamadas.at(-1)?.includes("status=") === false)
    .toBe(true);
});

test("o botão Nova questão leva ao editor vazio", async ({ page }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Nova questão" }).click();
  await expect(page).toHaveURL(/\/questoes\/editar$/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web/admin && npx playwright test -c e2e/playwright.config.ts e2e/lista.spec.ts`
Expected: FAIL — não existe o texto de acervo vazio, nem o campo "Situação", nem o link "Nova questão".

- [ ] **Step 3: Seletor de taxonomia**

Criar `web/admin/src/componentes/SeletorTaxonomia.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Campo, CONTROLE } from "@mais/ui";
import { api, type TipoTermo, type Termo } from "@/lib/api";

const ROTULO: Record<TipoTermo, string> = {
  subject: "Assunto",
  banca: "Banca",
  cargo: "Cargo",
  level: "Nível",
};

export function SeletorTaxonomia({
  kind,
  valor,
  aoMudar,
  rotulo,
  obrigatorio = false,
  erro,
}: {
  kind: TipoTermo;
  valor: string;
  aoMudar: (id: string) => void;
  rotulo?: string;
  obrigatorio?: boolean;
  erro?: string;
}) {
  const [termos, setTermos] = useState<Termo[]>([]);

  useEffect(() => {
    let vivo = true;
    api
      .termos(kind)
      .then((t) => vivo && setTermos(t))
      .catch(() => vivo && setTermos([]));
    return () => {
      vivo = false;
    };
  }, [kind]);

  const id = `taxonomia-${kind}`;
  return (
    <Campo rotulo={rotulo ?? ROTULO[kind]} htmlFor={id} erro={erro}>
      <select
        id={id}
        className={CONTROLE}
        value={valor}
        required={obrigatorio}
        onChange={(e) => aoMudar(e.target.value)}
      >
        {/* Valor vazio = sem filtro. A API normaliza string vazia para
            ausente, mas o cliente nem chega a mandar (lib/api.ts). */}
        <option value="">{obrigatorio ? "Selecione…" : "Todos"}</option>
        {termos.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </Campo>
  );
}
```

**Nota sobre termo excluído numa questão antiga.** A API filtra soft-deletados na listagem de termos, então uma questão que aponta para uma banca excluída abre o editor com o select sem opção correspondente. Isso é tratado na Task 7, Step 6 — aqui, na tela de lista, o nome vem resolvido pela própria API (`subjectName`, `bancaName`) e o problema não existe.

- [ ] **Step 4: A tela**

Substituir `web/admin/src/app/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Botao,
  Campo,
  Card,
  CONTROLE,
  Modal,
  Tabela,
  useToast,
  type Coluna,
} from "@mais/ui";
import { Layout } from "@/componentes/Layout";
import { SeletorTaxonomia } from "@/componentes/SeletorTaxonomia";
import { api, type FiltrosQuestao, type LinhaQuestao } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const POR_PAGINA = 50;

/** Enunciado é HTML sanitizado; na tabela queremos texto curto e sem tags. */
function resumo(html: string): string {
  // DOMParser não executa script nem busca recurso, e decodifica entidades —
  // o que o regex anterior errava em dois pontos: `&amp;` aparecia cru na
  // tela, e um `>` dentro de um atributo (ex.: alt="x > y") cortava a tag no
  // lugar errado e deixava sobra de marcação colada no texto.
  const texto = (
    new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  return texto.length > 120 ? `${texto.slice(0, 120)}…` : texto;
}

export default function PaginaLista() {
  const [filtros, setFiltros] = useState<FiltrosQuestao>({});
  const [pagina, setPagina] = useState(0);
  const [linhas, setLinhas] = useState<LinhaQuestao[]>([]);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aExcluir, setAExcluir] = useState<LinhaQuestao | null>(null);
  const avisar = useToast();
  const router = useRouter();
  // Descarta respostas fora de ordem: se o pedido do filtro A responder
  // depois do B, o resultado de A não pode sobrescrever a tela que já
  // corresponde ao que os <select> mostram.
  const idRequisicao = useRef(0);

  const carregar = useCallback(async () => {
    const id = ++idRequisicao.current;
    setCarregando(true);
    setErro(null);
    try {
      let paginaAlvo = pagina;
      let dados = await api.questoes({
        ...filtros,
        limit: POR_PAGINA,
        offset: paginaAlvo * POR_PAGINA,
      });
      if (id !== idRequisicao.current) return;

      // Uma exclusão pode encolher o total abaixo da página em que o
      // operador está; a API não clampa o offset (devolve `rows: []`), então
      // sem isso a tela mostraria "nenhuma questão" com registros vivos
      // escondidos atrás dela, e sem paginação visível para voltar. Recua
      // para a última página válida e refaz a busca — não zera para 0 cego,
      // porque quem excluiu um item na página 3 de 10 quer continuar na 3.
      const ultimaPaginaValida = Math.max(
        0,
        Math.ceil(dados.total / POR_PAGINA) - 1,
      );
      if (paginaAlvo > ultimaPaginaValida) {
        paginaAlvo = ultimaPaginaValida;
        dados = await api.questoes({
          ...filtros,
          limit: POR_PAGINA,
          offset: paginaAlvo * POR_PAGINA,
        });
        if (id !== idRequisicao.current) return;
      }

      setLinhas(dados.rows);
      setTotal(dados.total);
      if (paginaAlvo !== pagina) setPagina(paginaAlvo);
    } catch (falha) {
      if (id !== idRequisicao.current) return;
      // Filtro inválido responde 400 com código por campo. Mostrar o erro em
      // vez de cair para "sem filtro" é o ponto da regra: uma lista completa
      // exibida como se estivesse filtrada mente sobre o acervo.
      setErro(mensagemDe(falha));
      setLinhas([]);
      setTotal(0);
    } finally {
      if (id === idRequisicao.current) setCarregando(false);
    }
  }, [filtros, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function mudarFiltro(campo: keyof FiltrosQuestao, valor: string) {
    setPagina(0);
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }

  async function alternarSituacao(linha: LinhaQuestao) {
    try {
      if (linha.status === "published") {
        await api.despublicar(linha.id);
        avisar("Questão despublicada.");
      } else {
        await api.publicar(linha.id);
        avisar("Questão publicada.");
      }
      await carregar();
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    }
  }

  async function excluir() {
    if (!aExcluir) return;
    const alvo = aExcluir;
    setAExcluir(null);
    try {
      await api.excluirQuestao(alvo.id);
      avisar("Questão excluída.");
      await carregar();
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    }
  }

  const colunas: Coluna<LinhaQuestao>[] = [
    {
      titulo: "Enunciado",
      principal: true,
      celula: (l) => <span className="font-medium">{resumo(l.statement)}</span>,
    },
    { titulo: "Assunto", celula: (l) => l.subjectName ?? "—" },
    { titulo: "Banca", celula: (l) => l.bancaName ?? "—" },
    { titulo: "Ano", celula: (l) => l.year ?? "—" },
    {
      titulo: "Tipo",
      celula: (l) => (
        <Badge tom="neutro">
          {l.type === "true_false" ? "Certo/errado" : "Múltipla escolha"}
        </Badge>
      ),
    },
    {
      titulo: "Situação",
      celula: (l) => (
        <Badge tom={l.status === "published" ? "ok" : "neutro"}>
          {l.status === "published" ? "Publicada" : "Rascunho"}
        </Badge>
      ),
    },
    {
      titulo: "Ações",
      celula: (l) => (
        <div
          className="flex gap-2 flex-wrap"
          onClick={(e) => e.stopPropagation()}
        >
          <Botao
            variante="secundario"
            className="h-9 px-3 text-[13px]"
            onClick={() => void alternarSituacao(l)}
          >
            {l.status === "published" ? "Despublicar" : "Publicar"}
          </Botao>
          <Botao
            variante="perigo"
            className="h-9 px-3 text-[13px]"
            onClick={() => setAExcluir(l)}
          >
            Excluir
          </Botao>
        </div>
      ),
    },
  ];

  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <Layout>
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <h1 className="font-display text-2xl font-bold">Questões</h1>
        <Link href="/questoes/editar">
          <Botao>Nova questão</Botao>
        </Link>
      </div>

      <Card className="p-4 md:p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <SeletorTaxonomia
            kind="subject"
            valor={filtros.subjectId ?? ""}
            aoMudar={(v) => mudarFiltro("subjectId", v)}
          />
          <SeletorTaxonomia
            kind="banca"
            valor={filtros.bancaId ?? ""}
            aoMudar={(v) => mudarFiltro("bancaId", v)}
          />
          <SeletorTaxonomia
            kind="cargo"
            valor={filtros.cargoId ?? ""}
            aoMudar={(v) => mudarFiltro("cargoId", v)}
          />
          <SeletorTaxonomia
            kind="level"
            valor={filtros.levelId ?? ""}
            aoMudar={(v) => mudarFiltro("levelId", v)}
          />
          <Campo rotulo="Situação" htmlFor="filtro-situacao">
            <select
              id="filtro-situacao"
              className={CONTROLE}
              value={filtros.status ?? ""}
              onChange={(e) => mudarFiltro("status", e.target.value)}
            >
              <option value="">Todas</option>
              <option value="draft">Rascunho</option>
              <option value="published">Publicada</option>
            </select>
          </Campo>
        </div>
      </Card>

      <Card>
        {carregando && <p className="p-8 text-center text-txt-2">Carregando…</p>}
        {!carregando && erro && (
          <p role="alert" className="p-8 text-center font-semibold text-erro">
            {erro}
          </p>
        )}
        {!carregando && !erro && (
          <Tabela
            colunas={colunas}
            linhas={linhas}
            chave={(l) => l.id}
            aoClicar={(l) => router.push(`/questoes/editar?id=${l.id}`)}
            vazio="Nenhuma questão encontrada. Use “Nova questão” para cadastrar a primeira."
          />
        )}
      </Card>

      {total > POR_PAGINA && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <Botao
            variante="secundario"
            disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </Botao>
          <span className="text-[14.5px] font-semibold text-txt-2">
            {pagina + 1} de {ultimaPagina + 1} · {total} questões
          </span>
          <Botao
            variante="secundario"
            disabled={pagina >= ultimaPagina}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </Botao>
        </div>
      )}

      <Modal
        aberto={aExcluir !== null}
        titulo="Excluir questão?"
        perigo
        rotuloConfirmar="Excluir"
        aoConfirmar={() => void excluir()}
        aoCancelar={() => setAExcluir(null)}
      >
        A questão sai da lista, mas o registro é preservado — tentativas e
        comentários de alunos continuarão apontando para ela.
      </Modal>
    </Layout>
  );
}
```

**Sobre a busca por texto.** A spec §"Escopo" lista "busca por texto" nesta tela, mas `GET /admin/questions` não aceita parâmetro de busca (`api/src/routes/admin/questions.ts:142-177` e `api/src/db/questions.ts:300`) — a API mergeada tem filtros por taxonomia, ano e situação, e mais nada. **Busca por texto fica fora deste plano** e está registrada como lacuna no fim do documento: implementá-la exige uma rota nova na API, o que este plano não faz por decisão. Os filtros por taxonomia cobrem o caso de uso principal da operação.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd web/admin && npm test`
Expected: PASS em `login.spec.ts` e `lista.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(admin): lista de questões com filtros, paginação e ações inline"
```

---

## Task 5: Tela de taxonomias

**Files:**
- Create: `web/admin/src/app/taxonomias/page.tsx`
- Create: `web/admin/e2e/taxonomias.spec.ts`

**Interfaces:**
- Consumes: `api.termos`, `api.criarTermo`, `api.renomearTermo`, `api.excluirTermo`; `Tabela`, `Botao`, `Campo`, `CONTROLE`, `Card`, `Modal`, `useToast`, `Layout`.

Uma tela para as quatro taxonomias, com abas — é o reflexo direto da decisão de uma tabela para as quatro (spec §1). Quatro telas iguais seriam quatro vezes o mesmo código.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/admin/e2e/taxonomias.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";

test("cria, renomeia e exclui um termo", async ({ page }) => {
  await entrar(page);
  await page.getByRole("link", { name: "Taxonomias" }).click();

  await page.getByLabel("Nome", { exact: true }).fill("Cespe");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Cespe")).toBeVisible();

  await page.locator("table").getByRole("button", { name: "Renomear Cespe" }).click();
  await page.getByLabel("Novo nome").fill("Cebraspe");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("table").getByText("Cebraspe")).toBeVisible();

  await page.locator("table").getByRole("button", { name: "Excluir Cebraspe" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(page.locator("table").getByText("Cebraspe")).toHaveCount(0);
});

test("nome repetido no mesmo tipo mostra o 409 traduzido", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("FGV");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("FGV")).toBeVisible();

  await page.getByLabel("Nome", { exact: true }).fill("FGV");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(/já existe um termo ativo/i);
});

test("o mesmo nome em tipos diferentes é permitido", async ({ page }) => {
  await entrar(page);
  await page.goto("/taxonomias");

  await page.getByLabel("Nome", { exact: true }).fill("Analista");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Analista")).toBeVisible();

  await page.getByRole("tab", { name: "Cargo" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Analista");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Analista")).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
```

O primeiro teste começa na aba padrão, que é **Banca** (a mais usada no cadastro). O terceiro depende disso: "Analista" entra primeiro como banca e depois como cargo, provando que o `UNIQUE(kind, slug)` é por tipo.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web/admin && npx playwright test -c e2e/playwright.config.ts e2e/taxonomias.spec.ts`
Expected: FAIL — a rota `/taxonomias` não existe.

- [ ] **Step 3: Implementar a tela**

Criar `web/admin/src/app/taxonomias/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Botao,
  Campo,
  Card,
  CONTROLE,
  Modal,
  Tabela,
  useToast,
  type Coluna,
} from "@mais/ui";
import { Layout } from "@/componentes/Layout";
import { api, type Termo, type TipoTermo } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

// Banca primeiro: é a taxonomia que a operação mais cadastra.
const ABAS: { kind: TipoTermo; rotulo: string }[] = [
  { kind: "banca", rotulo: "Banca" },
  { kind: "subject", rotulo: "Assunto" },
  { kind: "cargo", rotulo: "Cargo" },
  { kind: "level", rotulo: "Nível" },
];

export default function PaginaTaxonomias() {
  const [aba, setAba] = useState<TipoTermo>("banca");
  const [termos, setTermos] = useState<Termo[]>([]);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aRenomear, setARenomear] = useState<Termo | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [aExcluir, setAExcluir] = useState<Termo | null>(null);
  const avisar = useToast();

  const carregar = useCallback(async () => {
    try {
      setTermos(await api.termos(aba));
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
      setTermos([]);
    }
  }, [aba, avisar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function adicionar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await api.criarTermo(aba, nome);
      setNome("");
      avisar("Termo criado.");
      await carregar();
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function renomear() {
    if (!aRenomear) return;
    const alvo = aRenomear;
    try {
      await api.renomearTermo(alvo.id, novoNome);
      setARenomear(null);
      avisar("Termo renomeado.");
      await carregar();
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    }
  }

  async function excluir() {
    if (!aExcluir) return;
    const alvo = aExcluir;
    setAExcluir(null);
    try {
      await api.excluirTermo(alvo.id);
      avisar("Termo excluído.");
      await carregar();
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    }
  }

  const colunas: Coluna<Termo>[] = [
    { titulo: "Nome", principal: true, celula: (t) => t.name },
    {
      titulo: "Ações",
      celula: (t) => (
        <div className="flex gap-2">
          <Botao
            variante="secundario"
            className="h-9 px-3 text-[13px]"
            aria-label={`Renomear ${t.name}`}
            onClick={() => {
              setARenomear(t);
              setNovoNome(t.name);
            }}
          >
            Renomear
          </Botao>
          <Botao
            variante="perigo"
            className="h-9 px-3 text-[13px]"
            aria-label={`Excluir ${t.name}`}
            onClick={() => setAExcluir(t)}
          >
            Excluir
          </Botao>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <h1 className="font-display text-2xl font-bold mb-5">Taxonomias</h1>

      <div role="tablist" className="flex gap-2 mb-5 flex-wrap">
        {ABAS.map((item) => (
          <button
            key={item.kind}
            role="tab"
            aria-selected={aba === item.kind}
            onClick={() => {
              setAba(item.kind);
              setErro(null);
              setNome("");
            }}
            className={`px-4 h-11 rounded-btn border text-[14.5px] font-semibold transition-colors ${
              aba === item.kind
                ? "border-roxo bg-roxo-bg text-roxo"
                : "border-borda-2 bg-card text-txt hover:border-borda-3"
            }`}
          >
            {item.rotulo}
          </button>
        ))}
      </div>

      <Card className="p-4 md:p-5 mb-5">
        <form onSubmit={adicionar} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <Campo rotulo="Nome" htmlFor="novo-termo" erro={erro ?? undefined}>
              <input
                id="novo-termo"
                className={CONTROLE}
                value={nome}
                required
                maxLength={120}
                onChange={(e) => setNome(e.target.value)}
              />
            </Campo>
          </div>
          <Botao type="submit" carregando={salvando}>
            Adicionar
          </Botao>
        </form>
      </Card>

      <Card>
        <Tabela
          colunas={colunas}
          linhas={termos}
          chave={(t) => t.id}
          vazio="Nenhum termo cadastrado neste tipo."
        />
      </Card>

      <Modal
        aberto={aRenomear !== null}
        titulo="Renomear termo"
        rotuloConfirmar="Salvar"
        aoConfirmar={() => void renomear()}
        aoCancelar={() => setARenomear(null)}
      >
        <Campo rotulo="Novo nome" htmlFor="novo-nome">
          <input
            id="novo-nome"
            className={CONTROLE}
            value={novoNome}
            maxLength={120}
            onChange={(e) => setNovoNome(e.target.value)}
          />
        </Campo>
      </Modal>

      <Modal
        aberto={aExcluir !== null}
        titulo="Excluir termo?"
        perigo
        rotuloConfirmar="Excluir"
        aoConfirmar={() => void excluir()}
        aoCancelar={() => setAExcluir(null)}
      >
        O termo some das listas de escolha, mas as questões já cadastradas
        continuam exibindo o nome dele.
      </Modal>
    </Layout>
  );
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd web/admin && npm test`
Expected: PASS nos três arquivos de spec.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(admin): CRUD das quatro taxonomias em abas"
```

---

## Task 6: Editor rich-text e upload de imagem

**Files:**
- Create: `web/admin/src/componentes/Editor.tsx`, `web/admin/src/componentes/BarraFerramentas.tsx`, `web/admin/src/componentes/UploadImagem.tsx`
- Modify: `web/admin/package.json`, `web/admin/src/app/globals.css`

**Interfaces:**
- Produces:
  - `Editor({ valor: string, aoMudar: (html: string) => void, rotulo: string, comTabela?: boolean })` de `@/componentes/Editor`
  - `UploadImagem({ aoEnviar: (url: string) => void })` de `@/componentes/UploadImagem`

**Pacotes aprovados nesta task** — TipTap 3.28.0, publicado 2026-07-15. A linha 3.29.x é de 24/07 em diante e reprova no cooldown. **47 pacotes no total**, contra os 33 escritos na spec (ver "Correções à spec", item 3):

```
@tiptap/core @tiptap/pm @tiptap/react
@tiptap/extension-document @tiptap/extension-paragraph @tiptap/extension-text
@tiptap/extension-bold @tiptap/extension-italic @tiptap/extension-underline
@tiptap/extension-heading @tiptap/extension-list @tiptap/extension-link
@tiptap/extension-image @tiptap/extension-table @tiptap/extension-history
@tiptap/extension-bubble-menu @tiptap/extension-floating-menu
```

**Por que os dois últimos aparecem sem serem usados.** O `@tiptap/react` declara `bubble-menu` e `floating-menu` como `optionalDependencies` com faixa `^3.28.0` — não fixa. Sem listá-los, o npm resolve a faixa para o mais novo, que é da linha 3.29.x proibida, e aí o `ERESOLVE` trava a instalação inteira contra o peer de `@tiptap/core@3.28.0`.

Este erro esteve na primeira versão deste plano: a medição de 47 pacotes foi feita listando só quinze, e o `npm install --package-lock-only` resolveu esses dois em **3.29.2** sem reclamar — ou seja, o número aprovado escondia duas violações de cooldown. Fixá-los explicitamente resolve tudo em 3.28.0 e mantém o total em 47: mesma superfície, zero violação. Descoberto na execução da Task 6.

**Nunca** contornar isso com `--legacy-peer-deps` (é o que traz o 3.29.2 em silêncio) nem com `--omit=optional` (desligaria dependências opcionais da árvore inteira, incluindo os binários por plataforma do Tailwind e do Next).

- [ ] **Step 1: Conferir o cooldown e instalar**

```bash
cd web
npm view @tiptap/core time --json | jq -r '."3.28.0"'
```

Expected: `2026-07-15T…`.

```bash
npm install --save-exact -w admin \
  @tiptap/core@3.28.0 @tiptap/pm@3.28.0 @tiptap/react@3.28.0 \
  @tiptap/extension-document@3.28.0 @tiptap/extension-paragraph@3.28.0 \
  @tiptap/extension-text@3.28.0 @tiptap/extension-bold@3.28.0 \
  @tiptap/extension-italic@3.28.0 @tiptap/extension-underline@3.28.0 \
  @tiptap/extension-heading@3.28.0 @tiptap/extension-list@3.28.0 \
  @tiptap/extension-link@3.28.0 @tiptap/extension-image@3.28.0 \
  @tiptap/extension-table@3.28.0 @tiptap/extension-history@3.28.0 \
  @tiptap/extension-bubble-menu@3.28.0 @tiptap/extension-floating-menu@3.28.0
```

Conferir que nenhum `@tiptap/*` escapou para a linha proibida:

```bash
jq -r '.packages | to_entries[] | select(.key|test("@tiptap")) | "\(.key) \(.value.version)"' package-lock.json | sort -u
```

Expected: uma única versão, `3.28.0`, em todas as linhas.

Conferir o custo real e que nada além do previsto entrou:

```bash
npm run audit
```

Expected: só o achado conhecido do `postcss@8.5.21`.

- [ ] **Step 2: O editor**

Criar `web/admin/src/componentes/Editor.tsx`:

```tsx
"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Heading from "@tiptap/extension-heading";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import History from "@tiptap/extension-history";
import { useEffect } from "react";
import { BarraFerramentas } from "./BarraFerramentas";

/**
 * O HTML que sai daqui é uma **sugestão**, não uma garantia. A sanitização
 * acontece no servidor, na escrita (api/src/lib/sanitizeHtml.ts, com
 * HTMLRewriter). Este editor existe para a operação escrever bem, não para
 * proteger nada — a allowlist abaixo casa com a do servidor só para evitar que
 * o operador digite algo que some ao salvar.
 */
export function Editor({
  valor,
  aoMudar,
  rotulo,
  comTabela = false,
  minAltura = 180,
}: {
  valor: string;
  aoMudar: (html: string) => void;
  rotulo: string;
  comTabela?: boolean;
  minAltura?: number;
}) {
  const editor = useEditor({
    // Sem SSR: o Next não renderiza nada disto no servidor porque o app é
    // export estático, mas o TipTap avisa se não for explícito.
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      Heading.configure({ levels: [2, 3] }),
      BulletList,
      OrderedList,
      ListItem,
      Link.configure({ openOnClick: false, autolink: false }),
      Image,
      History,
      ...(comTabela
        ? [Table.configure({ resizable: false }), TableRow, TableCell, TableHeader]
        : []),
    ],
    content: valor,
    onUpdate: ({ editor: e }) => aoMudar(e.getHTML()),
    editorProps: {
      attributes: {
        class: "prosa outline-none px-4 py-3",
        style: `min-height:${minAltura}px`,
        "aria-label": rotulo,
      },
    },
  });

  // Carregar uma questão existente troca o `valor` por fora; sem isto o editor
  // continuaria mostrando o conteúdo anterior.
  useEffect(() => {
    if (editor && valor !== editor.getHTML()) {
      editor.commands.setContent(valor, { emitUpdate: false });
    }
  }, [valor, editor]);

  return (
    <div className="border border-borda-2 rounded-btn bg-white overflow-hidden focus-within:border-roxo transition-colors">
      <BarraFerramentas editor={editor} comTabela={comTabela} />
      <EditorContent editor={editor} />
    </div>
  );
}
```

- [ ] **Step 3: A barra de ferramentas**

Criar `web/admin/src/componentes/BarraFerramentas.tsx`:

```tsx
"use client";

import type { Editor as EditorTipTap } from "@tiptap/react";
import { UploadImagem } from "./UploadImagem";

function Bot({
  ativo,
  aoClicar,
  titulo,
  children,
}: {
  ativo?: boolean;
  aoClicar: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      onClick={aoClicar}
      className={`h-9 min-w-9 px-2 rounded-lg text-[13px] font-bold transition-colors ${
        ativo ? "bg-roxo-bg text-roxo" : "text-txt-2 hover:bg-roxo-bg/50"
      }`}
    >
      {children}
    </button>
  );
}

export function BarraFerramentas({
  editor,
  comTabela,
}: {
  editor: EditorTipTap | null;
  comTabela: boolean;
}) {
  if (!editor) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-borda bg-pagina">
      <Bot
        titulo="Negrito"
        ativo={editor.isActive("bold")}
        aoClicar={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>N</strong>
      </Bot>
      <Bot
        titulo="Itálico"
        ativo={editor.isActive("italic")}
        aoClicar={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </Bot>
      <Bot
        titulo="Sublinhado"
        ativo={editor.isActive("underline")}
        aoClicar={() => editor.chain().focus().toggleUnderline().run()}
      >
        <u>S</u>
      </Bot>

      <span className="w-px h-5 bg-borda-2 mx-1" />

      <Bot
        titulo="Título"
        ativo={editor.isActive("heading", { level: 2 })}
        aoClicar={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </Bot>
      <Bot
        titulo="Subtítulo"
        ativo={editor.isActive("heading", { level: 3 })}
        aoClicar={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </Bot>
      <Bot
        titulo="Lista"
        ativo={editor.isActive("bulletList")}
        aoClicar={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </Bot>
      <Bot
        titulo="Lista numerada"
        ativo={editor.isActive("orderedList")}
        aoClicar={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </Bot>

      <span className="w-px h-5 bg-borda-2 mx-1" />

      <Bot
        titulo="Link"
        ativo={editor.isActive("link")}
        aoClicar={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const url = window.prompt("Endereço do link (http ou https)");
          if (!url) return;
          // O servidor descarta href com esquema fora da allowlist; barrar aqui
          // evita o link sumir em silêncio depois de salvar.
          if (!/^https?:\/\//i.test(url)) {
            window.alert("Use um endereço começando com http:// ou https://");
            return;
          }
          editor.chain().focus().setLink({ href: url }).run();
        }}
      >
        🔗
      </Bot>

      <UploadImagem
        aoEnviar={(url) => editor.chain().focus().setImage({ src: url }).run()}
      />

      {comTabela && (
        <>
          <span className="w-px h-5 bg-borda-2 mx-1" />
          <Bot
            titulo="Inserir tabela"
            aoClicar={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            ▦
          </Bot>
          <Bot
            titulo="Adicionar linha"
            aoClicar={() => editor.chain().focus().addRowAfter().run()}
          >
            +L
          </Bot>
          <Bot
            titulo="Adicionar coluna"
            aoClicar={() => editor.chain().focus().addColumnAfter().run()}
          >
            +C
          </Bot>
          <Bot
            titulo="Remover tabela"
            aoClicar={() => editor.chain().focus().deleteTable().run()}
          >
            ▦✕
          </Bot>
        </>
      )}

      <span className="ml-auto flex gap-1">
        <Bot titulo="Desfazer" aoClicar={() => editor.chain().focus().undo().run()}>
          ↶
        </Bot>
        <Bot titulo="Refazer" aoClicar={() => editor.chain().focus().redo().run()}>
          ↷
        </Bot>
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Upload**

Criar `web/admin/src/componentes/UploadImagem.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useToast } from "@mais/ui";
import { api } from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

// Espelha api/src/routes/admin/media.ts:7 e lib/magicBytes.ts:9. O servidor
// verifica pelos magic bytes e é ele quem decide — isto aqui é só para não
// gastar upload de 5 MB antes de tomar 413.
const MAX_BYTES = 2 * 1024 * 1024;
const ACEITOS = "image/png,image/jpeg,image/webp,image/gif";

export function UploadImagem({ aoEnviar }: { aoEnviar: (url: string) => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const avisar = useToast();

  async function escolher(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    // Limpa já: escolher o mesmo arquivo duas vezes seguidas não dispara
    // change se o valor continuar lá.
    evento.target.value = "";
    if (!arquivo) return;

    if (arquivo.size > MAX_BYTES) {
      avisar("Imagem acima de 2 MB. Reduza antes de enviar.", "erro");
      return;
    }

    setEnviando(true);
    try {
      aoEnviar(await api.enviarImagem(arquivo));
      avisar("Imagem enviada.");
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        title="Inserir imagem"
        aria-label="Inserir imagem"
        disabled={enviando}
        onClick={() => entrada.current?.click()}
        className="h-9 min-w-9 px-2 rounded-lg text-[13px] font-bold text-txt-2 hover:bg-roxo-bg/50 disabled:opacity-50"
      >
        {enviando ? "…" : "🖼"}
      </button>
      <input
        ref={entrada}
        type="file"
        accept={ACEITOS}
        hidden
        onChange={(e) => void escolher(e)}
      />
    </>
  );
}
```

**SVG fica de fora** e isso é deliberado: `detectImageType` (`api/src/lib/magicBytes.ts`) não o reconhece, porque é o único formato de imagem que executa script. O `accept` acima só repete a regra do servidor.

- [ ] **Step 5: Estilo do conteúdo rico**

Acrescentar ao fim de `web/admin/src/app/globals.css`:

```css
/* Aparência do HTML produzido pelo editor — usada tanto dentro do TipTap
   quanto no preview, para que o que se digita seja o que se vê. */
@layer components {
  .prosa {
    font-size: 15.5px;
    color: var(--color-txt);
    line-height: 1.6;
  }
  .prosa p { margin: 0 0 0.75em; }
  .prosa p:last-child { margin-bottom: 0; }
  .prosa h2 { font-size: 1.25em; font-weight: 700; margin: 1em 0 0.5em; }
  .prosa h3 { font-size: 1.1em; font-weight: 700; margin: 1em 0 0.5em; }
  .prosa ul, .prosa ol { margin: 0 0 0.75em 1.35em; }
  .prosa ul { list-style: disc; }
  .prosa ol { list-style: decimal; }
  .prosa a { color: var(--color-roxo); text-decoration: underline; }
  .prosa img { max-width: 100%; height: auto; border-radius: 10px; margin: 0.5em 0; }
  .prosa table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
    font-size: 0.95em;
  }
  .prosa th, .prosa td {
    border: 1px solid var(--color-borda-2);
    padding: 8px 10px;
    text-align: left;
  }
  .prosa th { background: var(--color-pagina); font-weight: 700; }
}
```

- [ ] **Step 6: Verificar**

```bash
cd web && npm run typecheck && npm run build
```

Expected: os dois limpos. O editor ainda não tem tela que o use — a Task 7 o monta, e é lá que ele é exercido pelo e2e.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(admin): editor TipTap com tabela, link e upload de imagem"
```

---

## Task 7: Tela do editor de questão

**Files:**
- Create: `web/admin/src/app/questoes/editar/page.tsx`
- Create: `web/admin/src/componentes/ListaAlternativas.tsx`
- Create: `web/admin/e2e/editor.spec.ts`

**Interfaces:**
- Consumes: `Editor`, `SeletorTaxonomia`, `api`, `mensagemDe`, `Layout`, e os primitivos de `@mais/ui`.
- Produces: `ListaAlternativas({ tipo, alternativas, aoMudar })` de `@/componentes/ListaAlternativas`, com `type AlternativaForm = { body: string; isCorrect: boolean }`.

**Três regras da API que a tela precisa respeitar, e o motivo de cada uma:**

1. **`status` só existe no POST.** `createSchema` estende o schema base só na criação (`api/src/routes/admin/questions.ts:82-84`); o PATCH usa o base, que estruturalmente não carrega o campo. Então: criar oferece "Salvar rascunho" e "Publicar" (é o cadastro em um step da §2); editar salva sem tocar em `status`, e a mudança de situação é `/publish` ou `/unpublish` — a mesma chamada que a lista usa.
2. **`true_false` tem exatamente duas alternativas, com corpo fixo.** "Certo" e "Errado" são criadas pelo editor e não são editáveis (spec §1).
3. **`multiple_choice` tem número variável**, mínimo dois, máximo dez (`alternativeSchema` com `.min(1).max(10)` no array e a invariante `needs_two_alternatives` no `db/`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/admin/e2e/editor.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { entrar } from "./entrar";

async function criarTaxonomias(page: Page) {
  await page.goto("/taxonomias");
  for (const [aba, nome] of [
    ["Banca", "Cespe"],
    ["Assunto", "Direito Administrativo"],
  ] as const) {
    await page.getByRole("tab", { name: aba }).click();
    await page.getByLabel("Nome", { exact: true }).fill(nome);
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.locator("table").getByText(nome)).toBeVisible();
  }
}

test("múltipla escolha: adicionar e remover alternativas", async ({ page }) => {
  await entrar(page);
  await criarTaxonomias(page);
  await page.goto("/questoes/editar");

  // Começa com quatro — o mínimo confortável, não o mínimo permitido.
  await expect(page.getByRole("textbox", { name: /alternativa/i })).toHaveCount(4);

  await page.getByRole("button", { name: "Adicionar alternativa" }).click();
  await expect(page.getByRole("textbox", { name: /alternativa/i })).toHaveCount(5);

  await page.getByRole("button", { name: "Remover alternativa E" }).click();
  await expect(page.getByRole("textbox", { name: /alternativa/i })).toHaveCount(4);
});

test("certo/errado troca para duas alternativas fixas", async ({ page }) => {
  await entrar(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Tipo").selectOption("true_false");
  // Pelo nome acessível do radio, não pelo texto: `getByText("Certo")`
  // casaria também o <option>"Certo/errado" do select de Tipo, mesmo com o
  // select fechado.
  await expect(
    page.getByRole("radio", { name: "Certo é a resposta" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Errado é a resposta" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Adicionar alternativa" }),
  ).toHaveCount(0);
});

test("sem alternativa correta, a API recusa e a tela explica", async ({
  page,
}) => {
  await entrar(page);
  await criarTaxonomias(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Enunciado").fill("Qual das alternativas está correta?");
  await page.getByLabel("Assunto").selectOption({ label: "Direito Administrativo" });
  await page.getByLabel("Banca").selectOption({ label: "Cespe" });
  await page.getByLabel("Gabarito comentado").fill("Porque sim.");
  for (const letra of ["A", "B", "C", "D"]) {
    await page.getByRole("textbox", { name: `Alternativa ${letra}` }).fill(letra);
  }
  // Nenhuma marcada como correta.
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /marque exatamente uma alternativa/i,
  );
});

test("vídeo com mailto: é recusado", async ({ page }) => {
  await entrar(page);
  await criarTaxonomias(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Enunciado").fill("Enunciado de teste.");
  await page.getByLabel("Assunto").selectOption({ label: "Direito Administrativo" });
  await page.getByLabel("Banca").selectOption({ label: "Cespe" });
  await page.getByLabel("Gabarito comentado").fill("Explicação.");
  await page.getByLabel("Vídeo do gabarito").fill("mailto:alguem@exemplo.com");
  for (const letra of ["A", "B", "C", "D"]) {
    await page.getByRole("textbox", { name: `Alternativa ${letra}` }).fill(letra);
  }
  await page.getByRole("radio", { name: "Alternativa A é a correta" }).check();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();

  await expect(page.locator("main").getByRole("alert")).toHaveText(/confira os campos/i);
});
```

Os campos "Enunciado" e "Gabarito comentado" são editores TipTap, e `fill()` funciona neles porque o ProseMirror expõe um `contenteditable` com `aria-label` — que é o `editorProps.attributes` configurado na Task 6, Step 2.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web/admin && npx playwright test -c e2e/playwright.config.ts e2e/editor.spec.ts`
Expected: FAIL — a rota `/questoes/editar` não existe.

- [ ] **Step 3: Lista de alternativas**

Criar `web/admin/src/componentes/ListaAlternativas.tsx`:

```tsx
"use client";

import { Botao, Campo, CONTROLE } from "@mais/ui";
import type { TipoQuestao } from "@/lib/api";

export type AlternativaForm = { body: string; isCorrect: boolean };

const LETRAS = "ABCDEFGHIJ";
const MAX = 10;

/** As duas de certo/errado, com corpo fixo (spec §1). */
export const ALTERNATIVAS_VF: AlternativaForm[] = [
  { body: "Certo", isCorrect: true },
  { body: "Errado", isCorrect: false },
];

export function ListaAlternativas({
  tipo,
  alternativas,
  aoMudar,
}: {
  tipo: TipoQuestao;
  alternativas: AlternativaForm[];
  aoMudar: (novas: AlternativaForm[]) => void;
}) {
  function marcarCorreta(indice: number) {
    aoMudar(
      alternativas.map((alt, i) => ({ ...alt, isCorrect: i === indice })),
    );
  }

  if (tipo === "true_false") {
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13px] font-bold text-txt mb-2">
          Gabarito
        </legend>
        {alternativas.map((alt, i) => (
          <label
            key={alt.body}
            className={`flex items-center gap-3 p-4 rounded-row border cursor-pointer transition-colors ${
              alt.isCorrect
                ? "bg-roxo-bg border-[#d6c9f7]"
                : "bg-white border-borda hover:border-borda-3"
            }`}
          >
            <input
              type="radio"
              name="correta"
              checked={alt.isCorrect}
              onChange={() => marcarCorreta(i)}
              aria-label={`${alt.body} é a resposta`}
            />
            <span className="font-semibold">{alt.body}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-[13px] font-bold text-txt mb-2">
        Alternativas
      </legend>

      {alternativas.map((alt, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-10 h-10 shrink-0 rounded-full bg-[#f1f1f4] text-txt-2 font-bold flex items-center justify-center">
            {LETRAS[i]}
          </span>
          <input
            className={CONTROLE}
            aria-label={`Alternativa ${LETRAS[i]}`}
            value={alt.body}
            onChange={(e) =>
              aoMudar(
                alternativas.map((a, j) =>
                  j === i ? { ...a, body: e.target.value } : a,
                ),
              )
            }
          />
          <input
            type="radio"
            name="correta"
            className="w-5 h-5 shrink-0"
            checked={alt.isCorrect}
            onChange={() => marcarCorreta(i)}
            aria-label={`Alternativa ${LETRAS[i]} é a correta`}
          />
          <Botao
            variante="secundario"
            className="h-10 w-10 px-0 shrink-0"
            aria-label={`Remover alternativa ${LETRAS[i]}`}
            disabled={alternativas.length <= 2}
            onClick={() => aoMudar(alternativas.filter((_, j) => j !== i))}
          >
            ✕
          </Botao>
        </div>
      ))}

      {alternativas.length < MAX && (
        <div>
          <Botao
            variante="secundario"
            onClick={() =>
              aoMudar([...alternativas, { body: "", isCorrect: false }])
            }
          >
            Adicionar alternativa
          </Botao>
        </div>
      )}
    </fieldset>
  );
}
```

O botão de remover fica desabilitado em duas alternativas: é a invariante `needs_two_alternatives`, aplicada na interface para que o operador não descubra o limite só ao salvar.

- [ ] **Step 4: A tela**

Criar `web/admin/src/app/questoes/editar/page.tsx`:

```tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Badge,
  Botao,
  Campo,
  Card,
  CONTROLE,
  useToast,
} from "@mais/ui";
import { Layout } from "@/componentes/Layout";
import { Editor } from "@/componentes/Editor";
import { SeletorTaxonomia } from "@/componentes/SeletorTaxonomia";
import {
  ALTERNATIVAS_VF,
  ListaAlternativas,
  type AlternativaForm,
} from "@/componentes/ListaAlternativas";
import { Preview } from "@/componentes/Preview";
import {
  api,
  type EntradaQuestao,
  type SituacaoQuestao,
  type TipoQuestao,
} from "@/lib/api";
import { mensagemDe } from "@/lib/erros";

const VAZIAS: AlternativaForm[] = [
  { body: "", isCorrect: false },
  { body: "", isCorrect: false },
  { body: "", isCorrect: false },
  { body: "", isCorrect: false },
];

function Formulario() {
  const parametros = useSearchParams();
  const id = parametros.get("id");
  const router = useRouter();
  const avisar = useToast();

  const [tipo, setTipo] = useState<TipoQuestao>("multiple_choice");
  const [enunciado, setEnunciado] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [bancaId, setBancaId] = useState("");
  const [cargoId, setCargoId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [ano, setAno] = useState("");
  const [alternativas, setAlternativas] = useState<AlternativaForm[]>(VAZIAS);
  const [gabarito, setGabarito] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [situacao, setSituacao] = useState<SituacaoQuestao | null>(null);

  const [carregando, setCarregando] = useState(id !== null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [vendoPreview, setVendoPreview] = useState(false);

  useEffect(() => {
    if (!id) return;
    let vivo = true;
    api
      .questao(id)
      .then((q) => {
        if (!vivo) return;
        setTipo(q.type);
        setEnunciado(q.statement);
        setSubjectId(q.subjectId);
        setBancaId(q.bancaId);
        setCargoId(q.cargoId ?? "");
        setLevelId(q.levelId ?? "");
        setAno(q.year ? String(q.year) : "");
        setAlternativas(
          q.alternatives.map((a) => ({ body: a.body, isCorrect: a.isCorrect })),
        );
        setGabarito(q.explanation?.body ?? "");
        setVideoUrl(q.explanation?.videoUrl ?? "");
        setSituacao(q.status);
      })
      .catch((falha) => vivo && setErro(mensagemDe(falha)))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [id]);

  function trocarTipo(novo: TipoQuestao) {
    setTipo(novo);
    // Trocar o tipo troca o conjunto de alternativas: certo/errado tem duas
    // fixas, múltipla escolha volta a quatro vazias.
    setAlternativas(novo === "true_false" ? [...ALTERNATIVAS_VF] : [...VAZIAS]);
  }

  function montarEntrada(): EntradaQuestao {
    return {
      type: tipo,
      statement: enunciado,
      subjectId,
      bancaId,
      cargoId: cargoId || null,
      levelId: levelId || null,
      year: ano ? Number(ano) : null,
      alternatives: alternativas.map((a) => ({
        body: a.body,
        isCorrect: a.isCorrect,
      })),
      explanation: { body: gabarito, videoUrl: videoUrl || null },
    };
  }

  async function salvar(status: SituacaoQuestao) {
    setErro(null);
    setSalvando(true);
    try {
      if (id) {
        // PATCH não carrega status de propósito (api/src/routes/admin/
        // questions.ts:73-84). Situação muda pelos botões de publicar.
        await api.salvarQuestao(id, montarEntrada());
        avisar("Questão salva.");
      } else {
        await api.criarQuestao(montarEntrada(), status);
        avisar(status === "published" ? "Questão publicada." : "Rascunho salvo.");
        router.push("/");
      }
    } catch (falha) {
      setErro(mensagemDe(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function alternarSituacao() {
    if (!id || !situacao) return;
    try {
      if (situacao === "published") {
        await api.despublicar(id);
        setSituacao("draft");
        avisar("Questão despublicada.");
      } else {
        await api.publicar(id);
        setSituacao("published");
        avisar("Questão publicada.");
      }
    } catch (falha) {
      avisar(mensagemDe(falha), "erro");
    }
  }

  if (carregando) {
    return <p className="text-txt-2">Carregando…</p>;
  }

  return (
    <div className="flex flex-col gap-5 max-w-[900px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-display text-2xl font-bold">
          {id ? "Editar questão" : "Nova questão"}
        </h1>
        <div className="flex items-center gap-3">
          {situacao && (
            <Badge tom={situacao === "published" ? "ok" : "neutro"}>
              {situacao === "published" ? "Publicada" : "Rascunho"}
            </Badge>
          )}
          <Botao
            variante="secundario"
            onClick={() => setVendoPreview((v) => !v)}
          >
            {vendoPreview ? "Voltar a editar" : "Pré-visualizar"}
          </Botao>
        </div>
      </div>

      {vendoPreview ? (
        <Preview
          tipo={tipo}
          enunciado={enunciado}
          alternativas={alternativas}
          gabarito={gabarito}
          videoUrl={videoUrl || null}
        />
      ) : (
        <>
          <Card className="p-5 flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              <Campo rotulo="Tipo" htmlFor="tipo">
                <select
                  id="tipo"
                  className={CONTROLE}
                  value={tipo}
                  onChange={(e) => trocarTipo(e.target.value as TipoQuestao)}
                >
                  <option value="multiple_choice">Múltipla escolha</option>
                  <option value="true_false">Certo/errado</option>
                </select>
              </Campo>
              <SeletorTaxonomia
                kind="subject"
                valor={subjectId}
                aoMudar={setSubjectId}
                obrigatorio
              />
              <SeletorTaxonomia
                kind="banca"
                valor={bancaId}
                aoMudar={setBancaId}
                obrigatorio
              />
              <SeletorTaxonomia kind="cargo" valor={cargoId} aoMudar={setCargoId} />
              <SeletorTaxonomia kind="level" valor={levelId} aoMudar={setLevelId} />
              <Campo rotulo="Ano" htmlFor="ano" dica="Opcional">
                <input
                  id="ano"
                  className={CONTROLE}
                  inputMode="numeric"
                  value={ano}
                  onChange={(e) => setAno(e.target.value.replace(/\D/g, ""))}
                />
              </Campo>
            </div>

            <Campo rotulo="Enunciado">
              <Editor
                valor={enunciado}
                aoMudar={setEnunciado}
                rotulo="Enunciado"
                comTabela
                minAltura={200}
              />
            </Campo>
          </Card>

          <Card className="p-5">
            <ListaAlternativas
              tipo={tipo}
              alternativas={alternativas}
              aoMudar={setAlternativas}
            />
          </Card>

          <Card className="p-5 flex flex-col gap-5">
            <Campo rotulo="Gabarito comentado">
              <Editor
                valor={gabarito}
                aoMudar={setGabarito}
                rotulo="Gabarito comentado"
                minAltura={160}
              />
            </Campo>
            <Campo
              rotulo="Vídeo do gabarito"
              htmlFor="video"
              dica="Opcional. Endereço http ou https."
            >
              <input
                id="video"
                className={CONTROLE}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </Campo>
          </Card>
        </>
      )}

      {erro && (
        <p role="alert" className="font-semibold text-erro">
          {erro}
        </p>
      )}

      <div className="flex gap-3 flex-wrap">
        {id ? (
          <>
            <Botao carregando={salvando} onClick={() => void salvar("draft")}>
              Salvar
            </Botao>
            <Botao variante="secundario" onClick={() => void alternarSituacao()}>
              {situacao === "published" ? "Despublicar" : "Publicar"}
            </Botao>
          </>
        ) : (
          <>
            <Botao
              variante="secundario"
              carregando={salvando}
              onClick={() => void salvar("draft")}
            >
              Salvar rascunho
            </Botao>
            <Botao carregando={salvando} onClick={() => void salvar("published")}>
              Publicar
            </Botao>
          </>
        )}
        <Botao variante="secundario" onClick={() => router.push("/")}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

export default function PaginaEditor() {
  // useSearchParams exige Suspense no App Router.
  return (
    <Layout>
      <Suspense fallback={<p className="text-txt-2">Carregando…</p>}>
        <Formulario />
      </Suspense>
    </Layout>
  );
}
```

- [ ] **Step 5: `Preview` provisório para destravar o typecheck**

A Task 8 implementa o preview de verdade. Para esta task compilar, criar `web/admin/src/componentes/Preview.tsx` com a assinatura final e um corpo mínimo:

```tsx
"use client";

import type { AlternativaForm } from "./ListaAlternativas";
import type { TipoQuestao } from "@/lib/api";

export function Preview(_props: {
  tipo: TipoQuestao;
  enunciado: string;
  alternativas: AlternativaForm[];
  gabarito: string;
  videoUrl: string | null;
}) {
  return <p className="text-txt-2">Pré-visualização em construção.</p>;
}
```

- [ ] **Step 6: Termo excluído numa questão antiga**

Uma questão pode apontar para uma banca soft-deletada; `GET /admin/taxonomy` não a devolve, então o `<select>` ficaria sem a opção e mostraria o primeiro item, trocando a taxonomia da questão em silêncio ao salvar. Modificar `web/admin/src/componentes/SeletorTaxonomia.tsx`, dentro do `<select>`, logo após o `<option value="">`:

```tsx
        {/* A questão pode apontar para um termo já excluído: a API o mantém
            na questão (updateQuestion só revalida a FK que mudou) mas não o
            devolve na lista de escolha. Sem esta opção fantasma, o select
            cairia no primeiro item e trocaria a taxonomia sem ninguém pedir. */}
        {valor !== "" && !termos.some((t) => t.id === valor) && (
          <option value={valor}>(termo excluído — mantido)</option>
        )}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `cd web/admin && npm test`
Expected: PASS em todos os specs, incluindo os quatro de `editor.spec.ts` — 16 no total (4 login + 5 lista + 3 taxonomias + 4 editor).

- [ ] **Step 8: Commit**

```bash
git add web
git commit -m "feat(admin): editor de questão com alternativas, gabarito e publicação"
```

---

## Task 8: Pré-visualização da questão

**Files:**
- Modify: `web/admin/src/componentes/Preview.tsx`
- Create: `web/admin/e2e/preview.spec.ts`

**Interfaces:**
- Consumes: `AlternativaForm`, `TipoQuestao`.

O preview mostra a questão como o aluno a verá — layout do `docs/demo.html`. É o item que a §8 da spec nomeia como **primeiro corte se o escopo apertar**; ele vem depois de tudo que não é cortável por isso.

**Sobre o `dangerouslySetInnerHTML`:** o HTML aqui não passou pelo servidor ainda — é o que o TipTap acabou de produzir no navegador de quem está digitando. Renderizá-lo dá ao autor a chance de executar script no próprio navegador dele, com a própria sessão dele, com conteúdo que ele mesmo escreveu. Não há elevação de privilégio nem outro usuário envolvido. O que protege o aluno é a sanitização na escrita (`api/src/lib/sanitizeHtml.ts`), que roda antes de qualquer coisa chegar ao banco.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/admin/e2e/preview.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { entrar } from "./entrar";

test("o preview mostra enunciado, letras e a alternativa correta", async ({
  page,
}) => {
  await entrar(page);
  await page.goto("/questoes/editar");

  await page.getByLabel("Enunciado").fill("Qual é a capital do Brasil?");
  await page.getByRole("textbox", { name: "Alternativa A" }).fill("São Paulo");
  await page.getByRole("textbox", { name: "Alternativa B" }).fill("Brasília");
  await page.getByRole("textbox", { name: "Alternativa C" }).fill("Rio de Janeiro");
  await page.getByRole("textbox", { name: "Alternativa D" }).fill("Salvador");
  await page.getByRole("radio", { name: "Alternativa B é a correta" }).check();
  await page.getByLabel("Gabarito comentado").fill("Brasília desde 1960.");

  await page.getByRole("button", { name: "Pré-visualizar" }).click();

  await expect(page.getByText("Qual é a capital do Brasil?")).toBeVisible();
  await expect(page.getByText("Brasília desde 1960.")).toBeVisible();
  // A correta é destacada, e só ela.
  await expect(page.getByTestId("alternativa-correta")).toHaveCount(1);
  await expect(page.getByTestId("alternativa-correta")).toContainText("Brasília");

  await page.getByRole("button", { name: "Voltar a editar" }).click();
  await expect(page.getByRole("textbox", { name: "Alternativa A" })).toBeVisible();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web/admin && npx playwright test -c e2e/playwright.config.ts e2e/preview.spec.ts`
Expected: FAIL — o preview provisório da Task 7 só imprime "Pré-visualização em construção".

- [ ] **Step 3: Implementar**

Substituir `web/admin/src/componentes/Preview.tsx`:

```tsx
"use client";

import { Card } from "@mais/ui";
import type { AlternativaForm } from "./ListaAlternativas";
import type { TipoQuestao } from "@/lib/api";

const LETRAS = "ABCDEFGHIJ";

/**
 * A questão como o aluno a verá — o layout vem de `docs/demo.html`, e é por
 * isso que os estilos aqui saem dos mesmos tokens que o sub-projeto 4 vai
 * consumir. A diferença é que aqui o gabarito já aparece aberto: quem está
 * conferindo é quem cadastrou.
 */
export function Preview({
  tipo,
  enunciado,
  alternativas,
  gabarito,
  videoUrl,
}: {
  tipo: TipoQuestao;
  enunciado: string;
  alternativas: AlternativaForm[];
  gabarito: string;
  videoUrl: string | null;
}) {
  return (
    <Card className="p-6 md:p-7 flex flex-col gap-6">
      <div
        className="prosa text-[17px] font-bold"
        dangerouslySetInnerHTML={{ __html: enunciado }}
      />

      <div className="flex flex-col gap-3">
        {alternativas.map((alt, i) => (
          <div
            key={i}
            data-testid={alt.isCorrect ? "alternativa-correta" : "alternativa"}
            className={`flex items-center gap-4 p-4 rounded-row border ${
              alt.isCorrect
                ? "bg-ok-bg border-[#bfe7cc]"
                : "bg-white border-borda"
            }`}
          >
            <span
              className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-bold ${
                alt.isCorrect ? "bg-ok text-white" : "bg-[#f1f1f4] text-txt-2"
              }`}
            >
              {tipo === "true_false" ? (alt.body === "Certo" ? "C" : "E") : LETRAS[i]}
            </span>
            <span className="text-[15.5px]">{alt.body || "—"}</span>
          </div>
        ))}
      </div>

      <div className="rounded-row border border-borda bg-[#fcfbff] p-5">
        <h4 className="text-[13px] font-bold uppercase tracking-wide text-roxo mb-3">
          Gabarito comentado
        </h4>
        {videoUrl && (
          <p className="mb-3 text-[14px]">
            Vídeo:{" "}
            <a
              href={videoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-roxo underline"
            >
              {videoUrl}
            </a>
          </p>
        )}
        <div className="prosa" dangerouslySetInnerHTML={{ __html: gabarito }} />
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd web/admin && npm test`
Expected: PASS em todos os specs.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(admin): pré-visualização da questão no layout do aluno"
```

---

## Task 9: Caminho crítico, indexadores e documentação

**Files:**
- Create: `web/admin/e2e/caminho-critico.spec.ts`
- Create: `web/admin/public/_headers`, `web/admin/public/robots.txt`
- Create: `web/README.md`

**Interfaces:**
- Consumes: tudo das tasks anteriores.

- [ ] **Step 1: O e2e do caminho crítico**

Criar `web/admin/e2e/caminho-critico.spec.ts` — é o teste que a §5 da spec nomeia:

```ts
import { test, expect } from "@playwright/test";
import { EMAIL, SENHA } from "./credenciais.mjs";
import { entrar } from "./entrar";

test("login → cadastrar → publicar → aparece na lista", async ({ page }) => {
  // 1. Login
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://localhost:3000/");

  // 2. Taxonomias mínimas
  await page.getByRole("link", { name: "Taxonomias" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Cebraspe");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Cebraspe")).toBeVisible();

  await page.getByRole("tab", { name: "Assunto" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Português");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator("table").getByText("Português")).toBeVisible();

  // 3. Cadastrar e publicar num envio só (o "cadastro em um step" da §2)
  await page.getByRole("link", { name: "Questões" }).click();
  await page.getByRole("link", { name: "Nova questão" }).click();

  await page.getByLabel("Enunciado").fill("Assinale a alternativa correta.");
  await page.getByLabel("Assunto").selectOption({ label: "Português" });
  await page.getByLabel("Banca").selectOption({ label: "Cebraspe" });
  await page.getByLabel("Ano").fill("2026");
  await page.getByRole("textbox", { name: "Alternativa A" }).fill("Primeira");
  await page.getByRole("textbox", { name: "Alternativa B" }).fill("Segunda");
  await page.getByRole("textbox", { name: "Alternativa C" }).fill("Terceira");
  await page.getByRole("textbox", { name: "Alternativa D" }).fill("Quarta");
  await page.getByRole("radio", { name: "Alternativa C é a correta" }).check();
  await page.getByLabel("Gabarito comentado").fill("A terceira está certa.");
  await page.getByRole("button", { name: "Publicar" }).click();

  // 4. Aparece na lista, já publicada
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.locator("table").getByText("Assinale a alternativa correta.")).toBeVisible();
  await expect(page.locator("table").getByText("Publicada")).toBeVisible();

  // 5. E o filtro de publicadas a encontra
  await page.getByLabel("Situação").selectOption("published");
  await expect(page.locator("table").getByText("Assinale a alternativa correta.")).toBeVisible();

  // 6. Reabrir preserva tudo — o id não muda ao editar (spec §1)
  await page.locator("table").getByText("Assinale a alternativa correta.").click();
  await expect(page).toHaveURL(/\/questoes\/editar\?id=/);
  await expect(page.getByRole("textbox", { name: "Alternativa C" })).toHaveValue(
    "Terceira",
  );
  await expect(page.locator("table").getByText("Publicada")).toBeVisible();
});

test("responde em viewport de celular", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await entrar(page);

  // Sem rolagem horizontal: é o sintoma mais comum de layout que não responde.
  const estouro = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(estouro).toBe(false);

  // A tabela virou lista de cartões.
  await expect(page.locator("table")).toBeHidden();
});
```

- [ ] **Step 2: Rodar e confirmar que falha ou passa**

Run: `cd web/admin && npx playwright test -c e2e/playwright.config.ts e2e/caminho-critico.spec.ts`
Expected: o primeiro teste deve PASSAR (as tasks anteriores construíram tudo que ele exercita). O segundo pode falhar por estouro horizontal — se falhar, é bug real de responsividade: corrija o componente culpado (provavelmente uma largura fixa) e rode de novo. Não relaxe o teste.

- [ ] **Step 3: Bloquear indexadores**

Criar `web/admin/public/_headers`:

```
/*
  X-Robots-Tag: noindex, nofollow
```

É a camada mais robusta das três da §3: vale para qualquer resposta, inclusive as que não são HTML e portanto não carregam meta tag.

Criar `web/admin/public/robots.txt`:

```
User-agent: *
Disallow: /
```

Inofensivo aqui porque o painel vive em hostname próprio: `Disallow: /` não revela estrutura nenhuma. Num `/admin` do site do aluno, este arquivo estaria anunciando a existência do painel — motivo adicional para o hostname separado.

A terceira camada (`robots: { index: false }` no metadata) já entrou na Task 1, Step 7.

- [ ] **Step 4: README do `web/`**

Criar `web/README.md`:

````markdown
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
````

- [ ] **Step 5: Verificação completa**

```bash
cd web && npm run typecheck && npm run build && npm test && npm run audit
cd ../api && npm test
```

Expected:
- `typecheck` limpo.
- `build` gera `web/admin/out/`, incluindo `_headers` e `robots.txt` copiados de `public/`.
- `npm test` do `web`: todos os specs verdes.
- `npm test` do `api`: continua verde (nada em `api/src` foi tocado).
- `npm run audit`: só o achado conhecido do `postcss@8.5.21`.

Conferir que os arquivos de indexação chegaram ao export:

```bash
test -f web/admin/out/_headers && test -f web/admin/out/robots.txt && echo "indexadores bloqueados"
```

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(admin): e2e do caminho crítico, bloqueio de indexadores e README"
```

---

## Task 10: Fechar o achado do postcss (a partir de 2026-08-07)

**Files:**
- Modify: `web/package.json`, `api/package.json`

**Esta task tem data.** A correção do `GHSA-fxqj-rqcc-2cmp` está na `postcss@8.5.23`, publicada em 2026-07-24, que completa os 14 dias de cooldown em **2026-08-07**. Antes disso, subir o override viola a política — e a política existe justamente para casos assim.

O achado atinge os **dois** workspaces pelo mesmo motivo por caminhos diferentes: em `api/` via `vitest → vite → postcss`; em `web/` via `next`, que fixa `postcss@8.5.21` (por override) sobre um `8.4.31` aninhado. Fechar de uma vez mantém os dois alinhados e resolve a pendência que `api/` já arrastava desde 2026-08-03.

- [ ] **Step 1: Conferir a idade por hora, não por data**

O cooldown é de 14 dias, não de "a data virou". A `8.5.23` foi publicada em 2026-07-24 **17:05 UTC**: em 2026-08-07 pela manhã ela ainda tinha 13d18h e **reprovava**. Conferir com precisão, não a olho:

```bash
python3 - <<'EOF'
from datetime import datetime, timedelta, timezone
import json, urllib.request
tempos = json.load(urllib.request.urlopen("https://registry.npmjs.org/postcss"))["time"]
agora = datetime.now(timezone.utc)
for v, iso in sorted(tempos.items()):
    if not v[0].isdigit():
        continue
    pub = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    idade = agora - pub
    if idade.days >= 14 and v >= "8.5.23":
        print(f"{v:10} {idade.days}d {idade.seconds//3600}h  PASSA")
EOF
```

Expected: imprime pelo menos a `8.5.23`. **Escolha a maior versão listada** — é a mais nova que corrige o `GHSA-fxqj-rqcc-2cmp` e passa no cooldown.

Se a saída vier vazia, **pare**: nenhuma versão corrigida completou 14 dias ainda. Esta task fica pendente e o achado conhecido do audit continua sendo o estado esperado, não regressão.

- [ ] **Step 2: Subir os dois overrides**

Modificar `web/package.json` → `overrides` → `postcss`, de `"8.5.21"` para a versão escolhida (`"8.5.23"` ou mais nova que passe).

Modificar `api/package.json` → `overrides` → `postcss`, de `"8.5.20"` para o mesmo valor.

- [ ] **Step 3: Reinstalar e auditar**

```bash
cd api && npm install --package-lock-only && npm ci && node scripts/audit-osv.mjs
cd ../web && npm install --package-lock-only && npm ci && npm run audit
```

Expected: **nenhum achado** nos dois. É o critério de pronto nº 3 da spec, agora inteiro.

- [ ] **Step 4: Rodar as duas suítes**

```bash
cd api && npm test && npm run typecheck
cd ../web && npm test && npm run typecheck
```

Expected: verde nos dois pacotes — o outro metade do critério nº 3.

- [ ] **Step 5: Commit**

```bash
git add api/package.json api/package-lock.json web/package.json web/package-lock.json
git commit -m "chore: sobe postcss para 8.5.23 nos dois workspaces, fechando o GHSA-fxqj-rqcc-2cmp"
```

---

## Dependências operacionais que este plano não resolve

Não são código e bloqueiam o deploy, não a implementação. Repetem a §6 da spec, com o que mudou:

| Dependência | Bloqueia |
|---|---|
| Aplicação **Cloudflare Access** em `admin.<domínio>`, IdP Google ou GitHub, **método OTP bloqueado na política** | todo o acesso ao painel em produção (critério de pronto nº 2) |
| Tag **`aud`** da aplicação e **team domain** → `ACCESS_AUD` e `ACCESS_TEAM_DOMAIN` no `wrangler.jsonc` | validação do JWT do Access |
| **Bucket R2** e hostname público **sem cookies** para servi-lo → `MEDIA_PUBLIC_BASE` | upload de imagens em produção |
| **Duas Worker Routes** — `admin.<domínio>/admin/*` e `admin.<domínio>/auth/*` — mais o custom domain do Pages no mesmo hostname | painel e API na mesma origem (ver "Correções à spec", item 1) |
| Chaves do **Turnstile** de produção (site key → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` no build do Pages; secret → `wrangler secret put TURNSTILE_SECRET_KEY`) | login em produção |
| Confirmar o **limite de seats** do plano grátis do Zero Trust | dimensionamento de custo |

Herdada e ainda aberta do sub-projeto 1: rodar `docs/runbook-verificacao-hotmart.md` contra o sandbox.

**Verificação manual que nenhum teste alcança:** que a política do Access não permite *One-time PIN*. Se permitir, o 2FA evapora sem erro visível — é o primeiro risco da §8 da spec, e continua sendo inspeção no dashboard.

## Fora de escopo, declarado

- **Busca por texto na lista de questões.** A spec a lista no escopo das telas, mas `GET /admin/questions` não tem parâmetro de busca — a API mergeada filtra por taxonomia, ano e situação. Implementá-la exige rota nova na API, o que este plano não faz. Os quatro filtros de taxonomia cobrem o uso principal.
- **Modo escuro.** Nenhum critério de pronto o pede; os tokens em custom properties deixam a porta aberta.
- **Testes de componente isolados.** A cobertura do frontend é o e2e do caminho crítico mais os specs por tela, rodando contra o Worker de verdade. A §5 da spec já chama isto de "ponto fraco honesto" e a decisão foi mantê-la.

## Pendência de documentação

A spec `2026-08-02-admin-conteudo-design.md` continua afirmando três coisas que este plano corrigiu: o prefixo `/api` na §2, "Tailwind v4 = 1 pacote" na §4 e "TipTap mínimo = 33" na §4. O sub-projeto 4 vai ler aquele documento. Corrigir as três seções é uma edição pequena e vale a pena — mas é mudança num documento aprovado, então fica como pergunta ao autor, não como task.
