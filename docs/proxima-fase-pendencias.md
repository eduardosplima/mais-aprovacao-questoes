# Próxima fase — três pendências

> Escrito em 2026-08-17, ao fim da rodada de ajustes pós-runbook
> ([plano](superpowers/plans/2026-08-17-ajustes-pos-runbook.md)). Cada item aqui
> é **autocontido**: traz o diagnóstico já feito, o que foi descartado e por quê,
> e o que falta decidir. A intenção é que este documento baste, sem precisar
> reconstruir o raciocínio.

As três são independentes entre si e podem ser atacadas em qualquer ordem. Se
for para escolher, a ordem por relação custo/benefício é **3 → 2 → 1**: a
migração do `year` tem janela que fecha, o `/media/` conserta algo que hoje
atrapalha o desenvolvimento diário, e o WebKit é o mais caro dos três.

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

Duas amostras foram lidas antes de o catálogo detalhado se perder:

- `login.spec.ts` — o teste expira esperando um elemento de pós-login, com a
  página ainda mostrando o formulário de login.
- `visual.spec.ts:77` — falha **depois** do login ter funcionado, num
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

### O que fica bloqueado por isto

A **Task 3** do plano — a correção da sobreposição de ícone e texto nos
`<select>` do Safari. O diagnóstico dela já está fechado e não depende do
WebKit:

> O Safari descarta o `padding` declarado pelo autor enquanto `appearance: auto`
> valer num `<select>`. Confirmado no inspetor: `padding-left` computado em
> `0px` com `.pl-11` presente na cascata. O ícone fica em `left-3.5` e o texto
> começa na borda, em cima dele.

A correção é `appearance-none` mais uma seta desenhada pelo projeto (a nativa
some junto). Os passos completos estão nas Tasks 2 e 3 do plano. O que o WebKit
mudaria é só a **qualidade do teste**: com ele, o teste afirma o sintoma
(`padding-left` = `44px`); sem ele, afirma a causa (`appearance: none`), que é
cobertura mais fraca mas não inútil.

**Decisão possível:** entregar a Task 3 com o teste de causa e deixar o WebKit
para depois. Isso destrava a correção do Safari sem depender de resolver as 35
falhas.

---

## 2. Imagens não carregam em desenvolvimento

**Não é um problema de teste.** O teste só foi o que revelou.

### O diagnóstico

`api/src/routes/admin/media.ts` tem **só `POST`**. Não existe nenhuma rota que
sirva `/media/*`. Em produção quem serve é o Custom Domain do R2
(`media.maisaprovacao.com.br`), e isso está correto — é o hostname sem cookies
que a spec exige.

Mas `MEDIA_PUBLIC_BASE` (`api/wrangler.jsonc`) aponta para esse domínio de
produção **também em desenvolvimento**. Então, ao subir uma imagem localmente:

1. O objeto vai para o R2 **local** (emulado pelo `wrangler dev`).
2. O enunciado recebe `https://media.maisaprovacao.com.br/media/<uuid>.png`.
3. O navegador busca esse `uuid` no R2 **de produção**, onde ele não existe.
4. A imagem não carrega. Para ninguém, não só para o teste.

O sintoma no e2e é `editor.spec.ts` ("upload de imagem") instável: ele afirma
`toBeVisible()` num `<img>` que nunca carrega, e um `<img>` quebrado tem altura
zero. Ele passa ou falha conforme o layout lhe dê caixa.

### Por que subir um asset público não resolve

O nome do arquivo é `crypto.randomUUID()` a cada upload
(`api/src/routes/admin/media.ts`). Um asset fixo pré-carregado nunca casaria com
o nome gerado na execução.

### A saída recomendada

Uma rota `GET /media/:key` no Worker, lendo do binding `MEDIA`, mais
`MEDIA_PUBLIC_BASE=http://localhost:8787` no `.dev.vars`.

**Em produção ela fica inalcançável por construção**: nenhuma das três Worker
Routes (`admin./admin/*`, `admin./auth/*`, `app./webhooks/*`) casa `/media/*`.
É exatamente o mesmo arranjo que o `/health` já usa — existe no Hono, não é
roteado na borda. Não abre superfície nova, e conserta o desenvolvimento local
de quebra.

**Alternativa barata:** trocar a asserção do e2e de `toBeVisible()` para o
`src` do `<img>`. Custa menos, mas o teste deixa de provar que a imagem carrega
— que é o que ele existe para provar.

---

## 3. `questions.year` — a janela que fecha

**A obrigatoriedade do ano hoje vive numa camada só.**

A rodada de 2026-08-17 tornou o ano obrigatório no schema Zod de escrita
(`api/src/routes/admin/questions.ts`) e no tipo `QuestionInput`
(`api/src/db/questions.ts`). **A coluna do banco continua `nullable`** — nenhuma
migração de schema foi criada.

Isso foi decisão consciente, mas com uma justificativa frouxa: confundiu-se
*migração de dados* (preencher linhas existentes — de fato desnecessária, o
acervo está vazio) com *migração de schema* (tornar a coluna `NOT NULL`), que é
outra coisa e não foi feita.

### O que custa deixar como está

- A invariante tem uma camada só. O banco aceitaria um `NULL` que a aplicação
  nunca manda.
- `QuestionDetail.year` continua `number | null`, então todo consumidor precisa
  tratar um nulo que já não pode acontecer.

### Por que agora e não depois

**O acervo de produção está vazio.** É a única janela em que essa migração é
trivial. Depois do primeiro cadastro real, ela passa a exigir backfill e
verificação.

### O que a torna não-trivial mesmo assim

O SQLite não faz `ALTER COLUMN`. O `drizzle-kit` gera reconstrução de tabela:
cria a nova, copia, dropa a antiga, renomeia. E `questions` é referenciada por
`alternatives` e `explanations` com `ON DELETE cascade`, além de referenciar
`taxonomy_terms` e `users`. Numa tabela vazia é seguro, mas o SQL gerado merece
leitura antes de aplicar, e migração no D1 é de mão única.

### Escopo sugerido

1. `year` passa a `.notNull()` em `api/src/db/schema.ts`.
2. `npm run db:generate` e **ler o SQL gerado** antes de qualquer coisa.
3. `QuestionDetail.year` passa de `number | null` para `number`, e os
   consumidores que tratavam o nulo simplificam junto.
4. Aplicar no D1 local, rodar a suíte, e só então aplicar no remoto com
   `--remote`.

> **Atenção:** o filtro `?year=` da listagem
> (`api/src/routes/admin/questions.ts`) **continua opcional** e não deve ser
> tocado. São dois `year` com regras diferentes, e confundi-los quebraria a
> listagem do painel.

---

## O que NÃO está pendente

Para não reabrir por engano o que já foi decidido:

| Item | Situação |
|---|---|
| Email do admin vindo do Access | Adiado deliberadamente para conversa própria. Mexe no modelo de duas identidades e no `/auth/login`, que o sub-projeto 4 vai herdar |
| Dark theme | Decidido não fazer. O Turnstile foi fixado em `light` por causa disso |
| Vídeo sem gabarito bloqueando o salvamento | Comportamento novo e aprovado. Se incomodar, são ~4 linhas em `web/admin/src/lib/validacao.ts` |
| Rótulos `DISPUTE`/`PROTEST` e `CANCELED`/`EXPIRED` | Divergências de auditoria achadas na conferência dos payloads da Hotmart. Não afetam acesso; ficaram para uma rodada futura |
