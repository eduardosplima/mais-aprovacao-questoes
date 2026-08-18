# Safari, ano obrigatório no banco e mídia em desenvolvimento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a sobreposição de ícone e texto nos `<select>` do Safari, fechar a invariante do ano obrigatório no banco enquanto o acervo de produção está vazio, e fazer as imagens carregarem em desenvolvimento.

**Architecture:** Três correções independentes, atacadas nesta ordem por custo/benefício. A primeira é de apresentação e fica contida em `web/`. A segunda atravessa schema, migração, tipos e duas telas, e termina com uma aplicação irreversível no D1 de produção — por isso ela é partida em duas tasks, com um portão de revisão entre a parte reversível e a irreversível. A terceira acrescenta uma rota pública ao Worker que só é alcançável em desenvolvimento.

**Tech Stack:** Hono + Zod + Drizzle sobre D1 (`api/`), Next.js 16 com `output: 'export'` + Tailwind v4 (`web/`), Vitest com `@cloudflare/vitest-pool-workers` (`api/`), Playwright (`web/admin/e2e`).

**Spec:** `docs/proxima-fase-pendencias.md` — itens 1 (a parte da correção do Safari, não o WebKit), 2 e 3. As decisões tomadas na conversa de brainstorm de 2026-08-17, que refinam o que está lá, estão na seção *Contexto e decisões* abaixo. As duas leituras juntas são a spec deste plano.

## Global Constraints

- **Não instalar pacote npm novo.** Nenhuma task precisa. Trazer dependência — inclusive via `npx` de pacote que não está no `package.json` — exige autorização explícita do dono do projeto.
- **O WebKit está fora do escopo desta rodada.** O binário está instalado, mas o projeto `webkit` **não** deve ser acrescentado ao `playwright.config.ts`. As 35 falhas conhecidas continuam sem diagnóstico e viram trabalho próprio depois. Não mexer em `workers: 1` nem em `fullyParallel: false`.
- **O acervo de produção está vazio.** Confirmado pelo dono em 2026-08-17, e reconfirmado por consulta na Task 3. É o que torna a migração da Task 2 trivial.
- **A suíte do `api/` tem 329 testes e deve continuar inteiramente verde** ao fim de cada task.
- **Comandos:** `api/` → `npx vitest run` e `npx tsc --noEmit`. `web/` → `npm run typecheck` e `npm run test -w admin` (Playwright, chromium só).
- **Idioma:** código, comentários, mensagens de erro e commits em português, como todo o repositório.

## Contexto e decisões

Cinco decisões foram tomadas antes deste plano e não devem ser reabertas durante a execução:

1. **A seta do `<select>` vira uma prop `seta` no `Controle`**, e não um componente novo nem uma constante nova em `Campo.tsx`. É a mudança menor: o `Controle` também embrulha um `<input>` (o campo Ano), que não pode ganhar seta, então a decisão precisa ficar no ponto de uso.
2. **O teste da correção do Safari afirma a causa (`appearance: none`), não o sintoma (`padding-left: 44px`).** O sintoma só é observável no WebKit, que está fora do escopo. No chromium o `padding-left` é honrado com ou sem a correção, então afirmá-lo não seria regressão nenhuma. O comentário no teste precisa dizer isso, para ninguém superestimar a cobertura.
3. **A migração do `year` vai ao D1 de produção dentro desta rodada.** Adiar mantém o banco aceitando `NULL` que a aplicação nunca manda, e a janela em que isso é trivial fecha no primeiro cadastro real.
4. **A rota `GET /media/:key` é incondicional**, sem guarda por ambiente. Em produção nenhuma das três Worker Routes casa `/media/*`, e `workers_dev` e `preview_urls` estão ambos em `false`. Mesmo se fosse alcançável não exporia nada novo: o bucket já é lido publicamente por `media.maisaprovacao.com.br`.
5. **`MEDIA_PUBLIC_BASE` em desenvolvimento aponta para `http://localhost:8787`, sem rewrite no `next.config.ts`.** A origem única que aquele arquivo monta existe para o cookie de sessão viajar nas chamadas de API; mídia é o caso oposto — em produção ela mora num hostname sem cookies, de propósito. `<img>` não precisa de CORS para renderizar.

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `web/ui/src/Icone.tsx` | biblioteca de ícones de traço único; ganha `IconeSeta` | 1 |
| `web/ui/src/index.ts` | superfície pública do pacote `@mais/ui` | 1 |
| `web/ui/src/Controle.tsx` | sobreposição de ícone (e agora seta) em controles nativos | 1 |
| `web/admin/src/app/page.tsx` | listagem; `<select>` de situação e coluna Ano | 1, 2 |
| `web/admin/src/app/questoes/editar/page.tsx` | editor; `<select>` de tipo e carga do campo Ano | 1, 2 |
| `web/admin/src/componentes/SeletorTaxonomia.tsx` | `<select>` das quatro taxonomias | 1 |
| `web/admin/e2e/visual.spec.ts` | e2e de detalhes visuais | 1 |
| `api/src/db/schema.ts` | schema Drizzle; a coluna `year` | 2 |
| `api/migrations/0002_*.sql` | migração de reconstrução da tabela `questions` | 2 |
| `api/test/schema-conteudo.test.ts` | testes de restrição no nível do banco | 2 |
| `api/src/db/questions.ts` | tipos de leitura da camada de persistência | 2 |
| `web/admin/src/lib/api.ts` | tipos do cliente HTTP | 2 |
| `api/src/routes/media.ts` | **novo** — leitura pública do bucket, só alcançável em dev | 4 |
| `api/src/app.ts` | montagem das rotas | 4 |
| `api/test/media.test.ts` | **novo** — testes da rota de leitura | 4 |
| `api/README.md` | documentação das variáveis de desenvolvimento | 4 |
| `docs/proxima-fase-pendencias.md` | registro do que sobra depois desta rodada | 5 |

---

### Task 1: A seta do `<select>` e o fim da aparência nativa

**Files:**
- Modify: `web/ui/src/Icone.tsx` (acrescentar `IconeSeta` ao fim da seção "taxonomias e campos de escolha", logo depois de `IconeTipo`)
- Modify: `web/ui/src/index.ts:14-31` (bloco de exports vindo de `./Icone`)
- Modify: `web/ui/src/Controle.tsx` (arquivo inteiro)
- Modify: `web/admin/src/app/page.tsx:244-247`
- Modify: `web/admin/src/app/questoes/editar/page.tsx:261-264`
- Modify: `web/admin/src/componentes/SeletorTaxonomia.tsx:63-66`
- Test: `web/admin/e2e/visual.spec.ts:19-37` (ajustar o teste existente) e um teste novo ao fim do arquivo

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `IconeSeta: ComponenteIcone` exportado por `@mais/ui`, e a prop `seta?: boolean` em `Controle`. Nenhuma task posterior depende disso.

**Por que a correção é esta.** O Safari descarta o `padding` declarado pelo autor enquanto `appearance: auto` valer num `<select>`. Confirmado no inspetor: `padding-left` computado em `0px` com `.pl-11` presente na cascata. O ícone fica em `left-3.5` e o texto começa na borda, em cima dele. `appearance-none` é a única correção que não é hack — e ela apaga a seta nativa junto, que é por isso que o projeto passa a desenhar a própria.

- [ ] **Step 1: Ajustar o teste existente que conta os `svg`**

Este passo vem antes do teste novo porque a mudança da Task 1 **quebra um teste que hoje está verde**, e é melhor ver a quebra prevista do que descobri-la.

Em `web/admin/e2e/visual.spec.ts`, no teste `"os campos de escolha e as abas exibem ícone sem afetar o nome acessível"`, substitua o bloco do comentário e a asserção de contagem (linhas 24-29):

```ts
  // O Controle envolve o select num div; o ícone semântico fica num <span>
  // irmão à esquerda e a seta noutro à direita, então os dois svg estão a
  // dois níveis do select — subir ao pai e descer é o caminho.
  //
  // São dois e não um porque `appearance-none` apaga a seta nativa: se
  // alguém aplicar a correção do Safari e esquecer a seta, esta contagem cai
  // para 1 e o campo fica sem indicar que é uma lista.
  const situacao = page.getByLabel("Situação");
  await expect(situacao).toBeVisible();
  await expect(situacao.locator("xpath=..").locator("svg")).toHaveCount(2);
```

- [ ] **Step 2: Escrever o teste novo, ao fim do `visual.spec.ts`**

```ts
test("o <select> abre mão da aparência nativa, e o <input> não ganha seta", async ({
  page,
}) => {
  await entrar(page);

  // Afirma a CAUSA, não o sintoma. O sintoma — o Safari descartar o
  // padding-left do autor enquanto `appearance: auto` valer — só é
  // observável no WebKit, que esta suíte ainda não roda (ver
  // docs/proxima-fase-pendencias.md, item 1). No chromium o padding é
  // honrado dos dois jeitos, então `padding-left: 44px` passaria mesmo sem a
  // correção e não serviria de regressão nenhuma.
  await expect(page.getByLabel("Situação")).toHaveCSS("appearance", "none");

  await page.goto("/questoes/editar");
  await expect(page.getByLabel("Tipo")).toHaveCSS("appearance", "none");
  await expect(page.getByLabel("Assunto")).toHaveCSS("appearance", "none");

  // O campo Ano é <input> dentro do mesmo Controle e NÃO leva seta: um campo
  // de texto com seta de lista mentiria sobre o que ele é. Um svg só — o
  // ícone de calendário.
  await expect(
    page.getByLabel("Ano").locator("xpath=..").locator("svg"),
  ).toHaveCount(1);
});
```

- [ ] **Step 3: Rodar e ver os dois falharem, pelos motivos certos**

Run: `cd web && npm run test -w admin -- visual.spec.ts`

Expected: FAIL em dois testes.
- O do Step 1 falha com `Expected: 2, Received: 1` — ainda não há seta.
- O do Step 2 falha na primeira asserção de `appearance`. O valor recebido será `auto` ou `menulist`, conforme a versão do chromium; qualquer um dos dois confirma que a correção ainda não está aplicada. **Não ajuste o teste para casar com o valor recebido** — o que se afirma é `none`, e só a correção produz isso.
- A asserção do campo Ano já passa. É esperado: ela não é regressão desta mudança, é guarda contra aplicá-la demais.

- [ ] **Step 4: Acrescentar `IconeSeta`**

Em `web/ui/src/Icone.tsx`, logo depois da função `IconeTipo` e antes do comentário `// ---- ações ----`:

```tsx
/**
 * A seta do `<select>`. Existe porque `appearance-none` apaga a nativa, e
 * `appearance-none` existe porque o Safari descarta o padding do autor
 * enquanto a aparência nativa valer. Não é enfeite: sem ela o campo não se
 * anuncia como lista.
 */
export function IconeSeta(p: PropsIcone) {
  return (
    <Svg {...p}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  );
}
```

- [ ] **Step 5: Exportar `IconeSeta`**

Em `web/ui/src/index.ts`, acrescente `IconeSeta,` à lista de exports vinda de `./Icone`, logo depois de `IconeTipo,`:

```ts
export {
  IconeAssunto,
  IconeBanca,
  IconeAno,
  IconeCargo,
  IconeNivel,
  IconeSituacao,
  IconeTipo,
  IconeSeta,
  IconeEditar,
  IconeExcluir,
  IconePublicar,
  IconeDespublicar,
  IconePreview,
  IconeAdicionar,
  IconeSalvar,
  IconeCancelar,
  type ComponenteIcone,
} from "./Icone";
```

- [ ] **Step 6: Dar a prop `seta` ao `Controle`**

Substitua `web/ui/src/Controle.tsx` inteiro:

```tsx
import type { ReactNode } from "react";
import { IconeSeta } from "./Icone";

/**
 * Sobrepõe um ícone à esquerda de um controle nativo, e opcionalmente uma
 * seta à direita.
 *
 * Um <select> não aceita elemento filho além de <option>, então não há como
 * pôr o SVG dentro dele. Manter o select nativo importa — navegação por
 * teclado e o seletor de roda do iOS —, então o ícone fica posicionado por
 * cima, com pointer-events desligado para não roubar o clique que abre a
 * lista. O controle recebe pl-11 para abrir o espaço.
 *
 * `seta` só é ligada em <select>, e sempre junto de `appearance-none` e
 * `pr-11` no controle. As duas coisas andam juntas: `appearance-none` é o que
 * faz o Safari voltar a honrar o padding do autor, e apagar a seta nativa é o
 * preço dela. Um <input> nunca leva `seta` — ele não é uma lista.
 */
export function Controle({
  icone,
  seta = false,
  children,
}: {
  icone: ReactNode;
  seta?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-roxo pointer-events-none flex">
        {icone}
      </span>
      {children}
      {seta && (
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-txt-3 pointer-events-none flex">
          <IconeSeta />
        </span>
      )}
    </div>
  );
}
```

A seta usa `text-txt-3` e não `text-roxo` de propósito: ela é cromo do controle, não o ícone semântico do campo, e não deve competir com ele por atenção.

- [ ] **Step 7: Ligar a seta nos três `<select>`**

Em `web/admin/src/app/page.tsx`, o `<select>` de situação:

```tsx
            <Controle icone={<IconeSituacao />} seta>
              <select
                id="filtro-situacao"
                className={`${CONTROLE} appearance-none pl-11 pr-11`}
```

Em `web/admin/src/app/questoes/editar/page.tsx`, o `<select>` de tipo:

```tsx
                <Controle icone={<IconeTipo />} seta>
                  <select
                    id="tipo"
                    className={`${CONTROLE} appearance-none pl-11 pr-11`}
```

Em `web/admin/src/componentes/SeletorTaxonomia.tsx`, o `<select>` das taxonomias:

```tsx
      <Controle icone={<Icone />} seta>
        <select
          id={id}
          className={`${CONTROLE} appearance-none pl-11 pr-11 ${erro ? CONTROLE_INVALIDO : ""}`}
```

O `<input>` do campo Ano (`editar/page.tsx:290-299`) **não muda**: nem `seta` no `Controle`, nem `appearance-none` na classe.

- [ ] **Step 8: Verificar que compila**

Run: `cd web && npm run typecheck`
Expected: sem erros, nos dois workspaces (`ui` e `admin`).

- [ ] **Step 9: Rodar a suíte e ver os dois testes passarem**

Run: `cd web && npm run test -w admin`
Expected: verde, a suíte inteira. Se `visual.spec.ts` ainda reclamar de contagem de `svg` em algum outro teste, é porque um `Controle` que você não previu ganhou seta — confira que só os três `<select>` receberam a prop.

- [ ] **Step 10: Conferir a olho, no Safari**

Este passo não é automatizável nesta rodada, e é o único que observa o bug de verdade.

Run: `cd web && npm run dev` (com o `wrangler dev` de pé no `api/`), e abra `http://localhost:3000` **no Safari**.
Expected: nos campos Situação, Tipo, Assunto, Banca, Cargo e Nível, o texto começa depois do ícone, sem sobreposição, e há uma seta à direita. No campo Ano, ícone à esquerda e nenhuma seta.

- [ ] **Step 11: Commit**

```bash
git add web/ui/src/Icone.tsx web/ui/src/index.ts web/ui/src/Controle.tsx \
  web/admin/src/app/page.tsx web/admin/src/app/questoes/editar/page.tsx \
  web/admin/src/componentes/SeletorTaxonomia.tsx web/admin/e2e/visual.spec.ts
git commit -m "fix(web): <select> abandona a aparência nativa e desenha a própria seta

O Safari descarta o padding declarado pelo autor enquanto \`appearance:
auto\` valer num <select>. O padding-left computava 0px com .pl-11 na
cascata, e o texto começava por cima do ícone. \`appearance-none\` é a
única correção que não é hack, e apagar a seta nativa é o preço dela —
daí o IconeSeta e a prop \`seta\` no Controle.

O teste afirma \`appearance: none\`, que é a causa, e não o padding, que
é o sintoma: o sintoma só aparece no WebKit, que a suíte ainda não roda.
No chromium o padding é honrado dos dois jeitos e afirmá-lo não seria
regressão nenhuma."
```

---

### Task 2: `questions.year` passa a `NOT NULL` (local)

**Files:**
- Modify: `api/src/db/schema.ts:125`
- Create: `api/migrations/0002_<nome-gerado>.sql` (o drizzle-kit escolhe o sufixo)
- Modify: `api/migrations/meta/_journal.json` e `api/migrations/meta/0002_snapshot.json` (gerados; não editar à mão)
- Modify: `api/src/db/questions.ts:35` e `:46`
- Modify: `web/admin/src/lib/api.ts:71` e `:91`
- Modify: `web/admin/src/app/page.tsx:156`
- Modify: `web/admin/src/app/questoes/editar/page.tsx:85`
- Test: `api/test/schema-conteudo.test.ts` (helper `question()` em `:22-39`, e um caso novo)

**Interfaces:**
- Consumes: nada da Task 1.
- Produces: a migração `0002`, que a Task 3 aplica no D1 remoto. **A Task 3 depende desta e não pode ser executada antes.**

**O que esta task NÃO toca.** O filtro `?year=` da listagem (`api/src/routes/admin/questions.ts:163-180`) e o `FiltrosQuestao.year?: string` (`web/admin/src/lib/api.ts:115`) **continuam opcionais**. São dois `year` com regras diferentes: um é o ano da questão, outro é um filtro de busca. Confundi-los quebra a listagem do painel.

- [ ] **Step 1: Escrever o teste que prova a restrição do banco**

Em `api/test/schema-conteudo.test.ts`, acrescente este caso dentro do `describe("schema de conteúdo", ...)`, depois do teste do CASCADE:

```ts
  it("questão sem ano é recusada pelo banco", async () => {
    const subject = await term("subject", "sem-ano-" + crypto.randomUUID());
    const banca = await term("banca", "sem-ano-" + crypto.randomUUID());
    const agora = Date.now();

    // SQL cru de propósito: o tipo do drizzle já proíbe omitir o ano depois
    // que a coluna virou notNull, então um insert pelo ORM provaria só o
    // TypeScript. O que interessa aqui é a outra camada — que o banco
    // recusa sozinho, mesmo que alguém escreva direto nele um dia.
    await expect(
      env.DB.prepare(
        "INSERT INTO questions (id, type, statement, subject_id, banca_id, status, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          "multiple_choice",
          "<p>enunciado</p>",
          subject,
          banca,
          "draft",
          agora,
          agora,
        )
        .run(),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run schema-conteudo`
Expected: FAIL no caso novo, com "promise resolved instead of rejecting" ou equivalente — hoje a coluna é `nullable` e o insert passa. Os outros três casos do arquivo continuam verdes.

- [ ] **Step 3: Tornar a coluna obrigatória no schema**

Em `api/src/db/schema.ts:125`, substitua:

```ts
    year: integer("year").notNull(),
```

- [ ] **Step 4: Gerar a migração**

Run: `cd api && npm run db:generate`
Expected: um arquivo novo `api/migrations/0002_<algo>.sql`, mais as entradas correspondentes em `migrations/meta/`.

- [ ] **Step 5: Ler o SQL gerado, e corrigir o pragma**

**Não pule este passo.** Abra o `0002_*.sql`. O SQLite não faz `ALTER COLUMN`, então o drizzle-kit gera reconstrução de tabela — cria `__new_questions`, copia, dropa a antiga, renomeia, e recria os índices. Numa tabela vazia isso é seguro.

O problema é o cerco: o drizzle gera `PRAGMA foreign_keys=OFF;` antes e `PRAGMA foreign_keys=ON;` depois. **O D1 não aceita esse pragma.** Troque as duas linhas pela forma que o D1 documenta:

```sql
PRAGMA defer_foreign_keys = true;
```

no lugar do `=OFF`, e **remova** a linha do `=ON` (o `defer_foreign_keys` já se encerra sozinho ao fim da transação).

Confira também, antes de seguir:
- A `CREATE TABLE __new_questions` tem `year integer NOT NULL` e mantém as demais colunas, chaves estrangeiras e defaults idênticos aos da tabela atual — compare com `api/migrations/0001_optimal_jane_foster.sql`.
- Os três índices (`questions_subject_idx`, `questions_banca_idx`, `questions_status_idx`) são recriados ao fim.

Se o `INSERT ... SELECT` de cópia estiver lá, deixe: em tabela vazia ele não copia nada e não custa nada.

- [ ] **Step 6: Dar um ano ao helper de fixture**

A coluna virou obrigatória, então o helper `question()` de `api/test/schema-conteudo.test.ts:22-39` — que hoje não passa `year` nenhum — para de compilar. Acrescente o campo ao `.values({...})`, logo depois de `bancaId`:

```ts
      year: 2023,
```

- [ ] **Step 7: Rodar a suíte do `api/` inteira**

Run: `cd api && npx vitest run`
Expected: 330 testes verdes (os 329 de antes, mais o caso novo). A suíte aplica as migrações de verdade via `readD1Migrations` (`vitest.config.ts:4`), então este passo é também a verificação de que o pragma corrigido no Step 5 é aceitável — se não fosse, a suíte quebraria na aplicação da migração, antes de qualquer teste rodar.

- [ ] **Step 8: Estreitar os tipos de leitura**

Em `api/src/db/questions.ts`, dois campos passam de `number | null` para `number`:

- `:35`, dentro de `QuestionDetail`: `year: number;`
- `:46`, dentro de `QuestionListRow`: `year: number;`

Em `web/admin/src/lib/api.ts`, os dois espelhos:

- `:71`, dentro de `LinhaQuestao`: `year: number;`
- `:91`, dentro de `Questao`: `year: number;`

`EntradaQuestao.year` (`api.ts:105`) e `QuestionInput.year` (`questions.ts:22`) já são `number` e não mudam. `FiltrosQuestao.year?: string` (`api.ts:115`) **não muda** — é o filtro.

- [ ] **Step 9: Simplificar os dois consumidores do nulo**

Em `web/admin/src/app/page.tsx:156`, a coluna Ano da tabela perde o fallback que já não pode acontecer:

```tsx
    { titulo: "Ano", celula: (l) => l.year },
```

Em `web/admin/src/app/questoes/editar/page.tsx:85`, a carga do campo perde o ternário:

```ts
        setAno(String(q.year));
```

- [ ] **Step 10: Verificar os dois lados**

Run: `cd api && npx tsc --noEmit`
Expected: sem erros.

Run: `cd web && npm run typecheck`
Expected: sem erros. Se algum consumidor de `year` que este plano não previu tratava o nulo, ele aparece aqui — simplifique-o do mesmo jeito, sem inventar comportamento novo.

- [ ] **Step 11: Aplicar no D1 local**

A suíte do `api/` aplica migrações no próprio banco em memória, mas o D1 local que o `wrangler dev` usa (e portanto o e2e) é outro e ainda está com o schema antigo.

Run: `cd api && npm run db:migrate:local`
Expected: a migração `0002` aplicada. Se o `wrangler dev` estiver de pé, **derrube e suba de novo** antes do próximo passo.

- [ ] **Step 12: Rodar a suíte e2e**

Run: `cd web && npm run test -w admin`
Expected: verde. `seed.mjs` só apaga questões, nunca insere, e o editor já manda `year` desde a rodada anterior — nada no e2e depende da coluna ser nullable.

- [ ] **Step 13: Commit**

```bash
git add api/src/db/schema.ts api/migrations api/test/schema-conteudo.test.ts \
  api/src/db/questions.ts web/admin/src/lib/api.ts \
  web/admin/src/app/page.tsx web/admin/src/app/questoes/editar/page.tsx
git commit -m "feat(api): ano da questão passa a NOT NULL no banco

A rodada anterior tornou o ano obrigatório no schema Zod de escrita e no
QuestionInput, mas deixou a coluna nullable — a invariante vivia numa
camada só, e todo consumidor tratava um nulo que já não podia acontecer.

O SQLite não faz ALTER COLUMN, então a migração reconstrói a tabela. O
PRAGMA foreign_keys que o drizzle-kit gera foi trocado por
defer_foreign_keys, que é o que o D1 aceita.

QuestionDetail.year e QuestionListRow.year (e os espelhos no cliente)
passam a number, e os dois consumidores do nulo simplificam junto. O
filtro ?year= da listagem continua opcional e não foi tocado."
```

---

### Task 3: Aplicar a migração no D1 de produção

**Files:** nenhum. Esta task não escreve código — ela executa uma operação irreversível.

**Interfaces:**
- Consumes: a migração `0002` criada na Task 2.
- Produces: nada em código.

**Por que é task separada.** Migração no D1 é de mão única. Tudo até aqui é revertível com `git revert`; isto não é. A separação existe para que haja um portão de revisão entre as duas coisas, e para que ninguém aplique no remoto uma migração cuja suíte ainda não rodou.

- [ ] **Step 1: Confirmar que a janela ainda está aberta**

Run:
```bash
cd api && npx wrangler d1 execute mais-aprovacao-db --remote \
  --command "SELECT COUNT(*) AS total FROM questions"
```
Expected: `total` igual a **0**.

**Se voltar diferente de zero, PARE.** Não aplique nada e reporte ao dono. Existe questão cadastrada em produção, a janela fechou, e a migração deixa de ser trivial: passa a exigir backfill das linhas com `year` nulo antes de a coluna poder recusar nulo, e isso é decisão de conteúdo que ninguém tomou.

- [ ] **Step 2: Ver o que será aplicado, antes de aplicar**

Run: `cd api && npx wrangler d1 migrations list mais-aprovacao-db --remote`
Expected: `0002_*` listada como pendente, e **só ela**. Se aparecer mais alguma pendente, pare e reporte — significa que o remoto está atrás do repositório por algum motivo que este plano não previu.

- [ ] **Step 3: Aplicar**

Run: `cd api && npx wrangler d1 migrations apply mais-aprovacao-db --remote`
Expected: aplicada sem erro. Se o wrangler recusar algum `PRAGMA`, a correção do Step 5 da Task 2 não foi suficiente — **não improvise no remoto**: volte, ajuste o arquivo de migração, rode a suíte do `api/` de novo, e só então repita este passo.

- [ ] **Step 4: Confirmar que o banco remoto recusa nulo**

Run:
```bash
cd api && npx wrangler d1 execute mais-aprovacao-db --remote \
  --command "SELECT name, \"notnull\" FROM pragma_table_info('questions') WHERE name = 'year'"
```
Expected: `notnull` igual a **1**.

- [ ] **Step 5: Registrar no runbook**

Migração de mão única sem registro é dívida: quem for depurar schema daqui a seis meses precisa saber quando a coluna mudou. O lugar é a Fase 7, que é onde o runbook trata das migrações remotas.

Em `docs/runbook-deploy-producao.md`, na "Fase 7 — Migrar o banco e publicar o Worker", substitua o primeiro item da lista (`- [x] As duas migrações aplicadas...`, linha 488):

```markdown
- [x] As **três** migrações aplicadas no D1 **remoto**. O `npm run
      db:migrate:local` existente é `--local` e não serve aqui; não há script
      para o remoto. A `0002` (2026-08-17) tornou `questions.year` NOT NULL —
      aplicada com o acervo ainda vazio, que era a única janela em que a
      reconstrução da tabela era trivial. Conferido depois com
      `pragma_table_info('questions')`: `notnull = 1`.
```

- [ ] **Step 6: Commit**

```bash
git add docs/runbook-deploy-producao.md
git commit -m "docs: registra a aplicação da migração 0002 no D1 de produção

Coluna questions.year passou a NOT NULL no remoto. Conferido antes que o
acervo estava vazio (COUNT = 0) e depois que a restrição pegou
(pragma_table_info: notnull = 1)."
```

---

### Task 4: `GET /media/:key` para as imagens carregarem em desenvolvimento

**Files:**
- Create: `api/src/routes/media.ts`
- Create: `api/test/media.test.ts`
- Modify: `api/src/app.ts:18-22` (montagem, acima do bloco `app.use("/admin/*", ...)`)
- Modify: `api/.dev.vars` (não versionado)
- Modify: `api/README.md:49-52`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces: `export const media: Hono<{ Bindings: Env }>` em `api/src/routes/media.ts`, montado em `/media`.

**O diagnóstico.** `api/src/routes/admin/media.ts` tem só `POST`. Nenhuma rota serve `/media/*`. Em produção quem serve é o Custom Domain do R2, e isso está certo. Mas `MEDIA_PUBLIC_BASE` (`api/wrangler.jsonc`) aponta para o domínio de produção **também em desenvolvimento**: o objeto vai para o R2 local, o enunciado recebe `https://media.maisaprovacao.com.br/media/<uuid>.png`, e o navegador busca esse uuid no R2 de produção, onde ele não existe. A imagem não carrega para ninguém. O `editor.spec.ts` ("upload de imagem") é instável por causa disso — afirma `toBeVisible()` num `<img>` quebrado, que tem altura zero e passa ou falha conforme o layout lhe dê caixa.

- [ ] **Step 1: Escrever os testes**

Crie `api/test/media.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "../src/app";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("GET /media/:key", () => {
  it("devolve os bytes e o content-type gravados no upload", async () => {
    const chave = `${crypto.randomUUID()}.png`;
    await env.MEDIA.put(`media/${chave}`, PNG, {
      httpMetadata: { contentType: "image/png" },
    });

    const res = await app.request(`/media/${chave}`, {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("404 para chave que não existe", async () => {
    const res = await app.request(`/media/${crypto.randomUUID()}.png`, {}, env);
    expect(res.status).toBe(404);
  });

  it("responde sem o JWT do Cloudflare Access", async () => {
    // Este é o teste que sustenta a premissa da rota inteira: ela é
    // inalcançável em produção porque nenhuma das três Worker Routes casa
    // /media/*, e isso só continua verdade enquanto o prefixo for /media/ e
    // ela ficar fora do app.use("/admin/*", ...). Se alguém mover a rota
    // para dentro de /admin ou empurrá-la para baixo do middleware, o
    // requireAccess responde 401 aqui e este caso quebra.
    //
    // Note que o app real é usado de propósito, e não uma mini-app montada
    // à mão como em admin-media.test.ts — montar à mão contornaria
    // justamente o middleware que se quer provar ausente.
    const chave = `${crypto.randomUUID()}.png`;
    await env.MEDIA.put(`media/${chave}`, PNG, {
      httpMetadata: { contentType: "image/png" },
    });

    const res = await app.request(`/media/${chave}`, {}, env);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx vitest run media.test`
Expected: FAIL nos três casos — os dois primeiros e o terceiro recebem 404, porque a rota não existe e o Hono cai no not-found padrão. O segundo caso "passa" por coincidência (404 é o esperado dele); isso é aceitável, ele é a guarda de ausência e só ganha sentido depois que os outros dois passarem.

- [ ] **Step 3: Criar a rota**

Crie `api/src/routes/media.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../config/env";

export const media = new Hono<{ Bindings: Env }>();

/**
 * Leitura pública do bucket, e ela só existe para o desenvolvimento local.
 *
 * Em produção quem serve as imagens é o Custom Domain do R2
 * (media.maisaprovacao.com.br) — um hostname sem cookies, que é o que a spec
 * exige para um SVG malicioso não poder executar com a sessão do admin. Esta
 * rota nunca é alcançada lá: nenhuma das três Worker Routes de
 * `wrangler.jsonc` casa /media/*, e workers_dev e preview_urls estão ambos em
 * false. É o mesmo arranjo do /health — existe no Hono, não é roteada na
 * borda.
 *
 * Fica fora do app.use("/admin/*") de propósito: um <img> não manda o JWT do
 * Access, e o conteúdo aqui é o mesmo que o bucket já serve publicamente em
 * produção. `test/media.test.ts` afirma essa ausência.
 *
 * A chave gravada no upload é `media/<uuid>.<ext>` (routes/admin/media.ts) e
 * a URL persistida repete esse segmento, então ele é reconstruído aqui.
 * Travessia de caminho não se aplica: o `:key` do Hono casa um segmento só,
 * então `/` não passa, e chave de R2 é string plana, sem semântica de
 * diretório.
 */
media.get("/:key", async (c) => {
  const obj = await c.env.MEDIA.get(`media/${c.req.param("key")}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    },
  });
});
```

- [ ] **Step 4: Montar a rota**

Em `api/src/app.ts`, acrescente o import junto dos outros:

```ts
import { media } from "./routes/media";
```

e a montagem logo depois da linha do `/webhooks`, **antes** do bloco `app.use("/admin/*", ...)`:

```ts
// Só alcançável em desenvolvimento: nenhuma Worker Route casa /media/*.
// Ver o comentário em routes/media.ts.
app.route("/media", media);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd api && npx vitest run media.test`
Expected: os três casos verdes.

- [ ] **Step 6: Rodar a suíte inteira do `api/`**

Run: `cd api && npx vitest run && npx tsc --noEmit`
Expected: 333 testes verdes (330 depois da Task 2, mais os três novos) e nenhum erro de tipo.

- [ ] **Step 7: Apontar a base pública para o Worker local**

Acrescente ao `api/.dev.vars` (arquivo não versionado, já no `.gitignore`):

```
MEDIA_PUBLIC_BASE=http://localhost:8787
```

Sobrepõe o valor de `wrangler.jsonc`, que é o domínio de produção. Sem isso a rota nova existe mas ninguém a chama — o enunciado continua recebendo uma URL de produção.

- [ ] **Step 8: Documentar a variável**

Em `api/README.md`, na seção "Segredos (`.dev.vars`)", substitua o parágrafo que começa com "Das três últimas:" (linhas 49-52):

```markdown
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
```

- [ ] **Step 9: Rodar o e2e com o servidor reiniciado**

**Derrube o `wrangler dev` antes.** O `.dev.vars` só é lido na subida, e o `reuseExistingServer` do Playwright reaproveitaria um servidor com a variável antiga — o teste passaria ou falharia pelo motivo errado.

Run: `cd web && npm run test -w admin`
Expected: verde, e em particular `editor.spec.ts` → "upload de imagem: insere a tag `<img>` no enunciado" passando de forma estável. O `toBeVisible()` da linha 170 **não muda**: agora a imagem carrega de verdade, o `<img>` ganha altura, e a asserção passa a provar aquilo para que existe.

- [ ] **Step 10: Commit**

```bash
git add api/src/routes/media.ts api/src/app.ts api/test/media.test.ts api/README.md
git commit -m "feat(api): serve /media/:key para as imagens carregarem em dev

MEDIA_PUBLIC_BASE apontava para o domínio de produção também em
desenvolvimento: o objeto ia para o R2 local, o enunciado recebia uma URL
de produção, e o navegador buscava lá um uuid que não existe. A imagem
não carregava para ninguém — o e2e instável do upload era só o sintoma.

A rota é incondicional e fica inalcançável em produção por construção:
nenhuma das três Worker Routes casa /media/*, e workers_dev e
preview_urls estão em false. Mesmo alcançável não exporia nada novo, já
que o bucket é lido publicamente pelo Custom Domain.

O terceiro teste afirma que ela responde sem o JWT do Access — é o que
quebra se alguém mover a rota para dentro de /admin e desfizer a
premissa."
```

---

### Task 5: Atualizar o registro das pendências

**Files:**
- Modify: `docs/proxima-fase-pendencias.md`

**Interfaces:**
- Consumes: o resultado das Tasks 1 a 4.
- Produces: nada.

**Por que existe.** O documento é o que sobrevive à conversa. Deixá-lo descrevendo como pendente algo que acabou de ser entregue faz a próxima sessão reconstruir raciocínio já resolvido — que é exatamente o que ele existe para evitar.

- [ ] **Step 1: Reescrever o documento**

Reduza `docs/proxima-fase-pendencias.md` ao que de fato sobrou:

**Remova os itens 2 e 3 inteiros** — foram entregues. **Mantenha intactos**, dentro do item 1, o catálogo das 35 falhas, as duas amostras lidas, a seção "Como refazer" e a tabela das saídas descartadas: nada disso foi invalidado. **Mantenha a tabela "O que NÃO está pendente"** como está — nenhum dos quatro itens dela foi tocado.

Troque o título e o parágrafo de ordem (linhas 1-12) por:

```markdown
# Próxima fase — o WebKit

> Escrito em 2026-08-17 e revisado ao fim da rodada
> ([plano](superpowers/plans/2026-08-17-safari-ano-midia.md)), que entregou os
> outros dois itens e a correção do Safari. Sobrou um. Ele é **autocontido**:
> traz o diagnóstico já feito, o que foi descartado e por quê, e o que falta
> decidir. A intenção é que este documento baste, sem precisar reconstruir o
> raciocínio.
```

Troque a seção "O que fica bloqueado por isto" inteira (linhas 76-95 do documento atual) por:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/proxima-fase-pendencias.md
git commit -m "docs: só o WebKit continua pendente

Os itens 2 (/media/ em dev) e 3 (year NOT NULL) foram entregues. A
correção do Safari saiu junto, então o WebKit deixa de ser bloqueio e
passa a ser só melhoria de cobertura: com ele o teste afirma o sintoma
em vez da causa."
```
