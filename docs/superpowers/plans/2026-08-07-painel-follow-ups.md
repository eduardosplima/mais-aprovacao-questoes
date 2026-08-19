# Painel administrativo — follow-ups conhecidos

> Itens levantados durante a execução de `2026-08-04-admin-painel.md` e na
> revisão final da branch `feat/admin-painel`, **triados como não-bloqueantes
> para o merge**. Nenhum é defeito no caminho feliz; todos são polimento,
> lacuna de cobertura ou dívida de empacotamento.
>
> Registrado aqui porque o ledger de execução vive em diretório git-ignored, e
> parte desta lista importa para os sub-projetos 3 e 4.
>
> **Reconferido contra o código em 2026-08-18.** Três entradas estavam
> desatualizadas — nenhuma tinha sido atualizada por quem as resolveu. Uma
> lista de follow-ups que não é reconferida vira passivo: ou se age sobre
> entrada morta, ou se para de confiar nela. As datas abaixo dizem o que
> mudou e quando.

## Empacotamento do `web/ui` — **pré-requisito do sub-projeto 4**

> **Promovido em 2026-08-18**, de polimento a pré-requisito. Estes três itens
> não custam nada enquanto existir um único consumidor do `web/ui`; **cada um
> vira defeito no dia em que existir o segundo**, que é exatamente o que o
> sub-projeto 4 é. Tratá-los no kickoff dele, não depois.

O design system é a entrega declarada deste sub-projeto ao frontend do aluno
(critério de pronto nº 5). Ele está arquiteturalmente isolado — nenhum arquivo
importa de `next`, de `@/` ou de `web/admin`, e o `typecheck` isolado prova
isso —, mas o empacotamento tem três arestas:

| Item | Efeito se ignorado |
|---|---|
| O `@source "../../../ui/src"` do `globals.css:6` é a única via em que o `admin` alcança o `ui` por caminho de arquivo, e é obrigatória porque o Tailwind v4 não varre pacote irmão | Um consumidor que importe só `@mais/ui/tokens.css` recebe os tokens e **nenhuma classe de componente**. O `Botao` renderiza sem estilo, em silêncio, sem erro de build. Documentado no `web/README.md`. É o pior dos três, porque falha calado |
| As classes do botão-ícone estão duplicadas entre `BarraFerramentas.tsx:26` e `UploadImagem.tsx:50` | Se botão-ícone pertence a algum lugar, é ao design system. Duplicação de ~8 classes |
| `LETRAS = "ABCDEFGHIJ"` em `Preview.tsx:8` e `ListaAlternativas.tsx:17` | Não podem divergir (mesmo `MAX = 10`). Veio de `Cosmético` em 2026-08-18: é fronteira de design system, não estética |

> **Correção do diagnóstico do botão-ícone, 2026-08-18.** A entrada dizia que a
> *função* `Bot` estava duplicada entre os dois arquivos. Não está mais:
> `UploadImagem.tsx:44` hoje tem um `<button>` inline. Mas as classes continuam
> idênticas — `h-9 min-w-9 px-2 rounded-lg text-[13px] font-bold`,
> `text-txt-2 hover:bg-roxo-bg/50`. **O sintoma mudou de forma e a causa ficou**,
> e a cópia anônima é mais difícil de achar que a duplicação nomeada era. Só a
> releitura do código pegou; a releitura da lista teria dado por resolvido.

## Acessibilidade

| Item | Efeito |
|---|---|
| A linha da `Tabela` responde só a mouse (`onClick` em `<tr>`/`<li>`, sem `tabIndex` nem `role`) | Mitigado: a coluna Ações agora tem "Editar", então o teclado tem caminho. A linha continua sendo atalho de mouse |
| ~~Um 409 ao renomear taxonomia aparece como toast enquanto o modal segue aberto, em vez de inline no campo~~ **Resolvido em 2026-08-18** | O erro do servidor passou a cair no próprio campo do modal, junto com a validação de nome vazio que entrou na mesma rodada. Coberto por `taxonomias.spec.ts`. **Continua aberto:** falta guarda de duplo clique no botão Salvar do modal |

## Qualidade de erro no editor

> **Resolvido em 2026-08-08** pelo branch `feat/identidade-visual-painel`
> (spec `specs/2026-08-08-identidade-visual-painel-design.md`). O que era o
> problema central desta seção — toda rejeição do Zod colapsando em
> "Confira os campos", sem destacar campo nenhum — passou a ser validado no
> cliente antes do envio, com resumo no topo, borda vermelha por campo e
> rolagem. `videoUrl` reusa a lógica de `isHttpUrl` do servidor, e o teste
> fraco que assertava a frase genérica agora prova que nada foi enviado.
>
> A API continua sendo a autoridade: o que ela recusar e o cliente não previr
> segue caindo na mensagem genérica, que permanece.

> **Os dois itens de silêncio foram resolvidos em 2026-08-18.** Eram os únicos
> da lista que faziam o painel **mentir para o operador**, e os dois ficavam no
> editor, que é a razão de o painel existir. Cada um ganhou teste que falhou
> antes da correção.
>
> - **O preview não apresenta mais como link um vídeo que a API recusaria.**
>   `isHttpUrl` deixou de ser privado em `lib/validacao.ts` e passou a governar
>   o `Preview.tsx`: endereço que `validarQuestao` recusa aparece como texto,
>   não como `<a>`. O preview existe para responder "é isto que vai ser
>   publicado?"; um link funcional ali respondia errado.
>   Teste: `preview.spec.ts` → "o preview não apresenta como link um vídeo que
>   a API recusaria".
> - **`SeletorTaxonomia` avisa quando a carga falha.** O `.catch` que fazia
>   `setTermos([])` e mais nada agora acende `"Não foi possível carregar os
>   termos."`, com precedência sobre o erro de validação — com a lista vazia o
>   operador não consegue escolher nada, e "Escolha o assunto." o culparia por
>   algo que não é dele. Antes, falha de rede era indistinguível de taxonomia
>   sem termo cadastrado, e o operador concluía a segunda coisa.
>   Teste: `editor.spec.ts` → "select de taxonomia avisa quando a carga falha,
>   em vez de ficar vazio".

Continua aberto desta seção:

- O campo Enunciado exibe a mensagem de erro pelo `Campo`, mas **não** recebe
  borda vermelha: `CONTROLE_INVALIDO` se aplica a input e select, e o Enunciado
  é o wrapper do TipTap, que não usa `CONTROLE`. Mesma classe do defeito
  corrigido no `SeletorTaxonomia`, num componente que a correção não alcança.

## Tipos

`Usuario.role` e `Usuario.tier` são `string` no cliente, enquanto a API tem
união literal (`"admin" | "user"`, `"assinante" | "gratuito"`). O
`sessao.tsx:24` faz `u.role !== "admin"` — exatamente a comparação que uma
união protegeria de um typo.

**Nota de 2026-08-18, sobre a ênfase:** o raio é menor do que a entrada sugere.
Um typo ali faz a comparação **falhar fechada** (expulsa o admin de verdade, não
deixa entrar quem não é), e o próprio arquivo documenta em `sessao.tsx:8-9` que
aquilo não é controle de acesso — o controle real é o `role=admin` lido do D1
por `api/src/middleware/rbac.ts`. É dívida de tipos legítima, com custo de DX,
**não é furo de segurança**. Cabe junto do sub-projeto 4, que vai consumir o
mesmo cliente.

## Cosmético

- O `next/image` avisa no console sobre proporção do logo, apesar do `w-auto`.
- O gap do cabeçalho no desktop caiu de 24px para 16px sem intenção, num fix
  de responsividade; um `md:gap-x-6` restaura.
- O recuo de paginação dispara um GET a mais e um "Carregando…" piscando, só
  no caminho raro em que uma mutação encolhe o acervo abaixo da página atual.

## Fora do escopo deste plano, mas aberto no `api/`

> **Os dois achados de dependência fecharam em 2026-08-17**, numa rodada de
> cooldown que não lia este arquivo — por isso a entrada ficou dez dias
> descrevendo um estado que já não existia.
>
> - **`hono` → 4.12.34 aplicado.** E eram **quatro** advisories, não a de CORS
>   sozinha: três foram publicadas em 2026-08-07, depois que este documento foi
>   escrito. A mais grave (`GHSA-f23p-vx2j-j53r`, `memo()` vazando SSR entre
>   requisições) também não se aplicava — nenhum dos quatro módulos vulneráveis
>   é importado em `api/src/`.
> - **`undici` → 7.29.0 aplicado** nos dois workspaces, via `overrides`. A
>   "decisão de manutenção à parte" foi tomada: forçar o override.
>
> **Resta um, que esta lista nunca teve:** `nanoid` 3.3.18, nos dois
> workspaces. Sai do cooldown em **2026-08-21 16:41 UTC**. Depois disso o audit
> dos dois fica limpo pela primeira vez.

O texto original, pelo registro do que se sabia em 2026-08-07:

- **`hono@4.12.28`** — `GHSA-8j4g-w8fx-2239`, ReDoS no middleware de CORS.
  É dependência de **runtime** do Worker, ao contrário de todos os achados que
  a spec catalogou. Mas este projeto não usa esse middleware — a arquitetura é
  same-origin justamente para não precisar dele —, então a exposição prática é
  zero. A correção `4.12.34` é de 2026-08-03 e só completa o cooldown de 14
  dias em **2026-08-17**.
- **`undici@7.28.0`** — cinco advisories, devDependency transitiva
  (`@cloudflare/vitest-pool-workers → miniflare → undici`). A correção
  `7.29.0` já passou no cooldown; forçar override numa transitiva do miniflare
  é decisão de manutenção à parte.

Também levantado: a tabela "Códigos de erro" do `api/README.md` lista 11
códigos, mas a API emite pelo menos 7 outros (`invalid_credentials`,
`captcha_failed`, `missing_file`, `too_large`, `unsupported_type`,
`unauthorized`, `forbidden`).

## Escopo declarado como fora, não esquecido

- **Busca por texto** na lista de questões: `GET /admin/questions` não tem
  parâmetro de busca. Exigiria rota nova na API.
- **Modo escuro**: nenhum critério de pronto o pede; os tokens em custom
  properties deixam a porta aberta.

## Sobras da separação do login do admin — 2026-08-19

Três itens que a revisão final do branch `login-admin` levantou e que foram
parqueados de propósito, para não abrir uma segunda onda de correção. Nenhum
é defeito de comportamento; os três são baratos.

- **Dois casos e2e afirmam com `toContainText` onde `toBeVisible` seria mais
  estrito** — `web/admin/e2e/login.spec.ts`, nos casos que interceptam
  `/admin/auth/contexto` (o email fora da allowlist e o contexto que falha).
  `toContainText` passa num elemento presente porém oculto. Os dois estão
  renderizados hoje, então é rigor de asserção, não falso verde.
- **Três referências a "cinco checagens" sobreviveram, e agora são seis** —
  `docs/superpowers/specs/2026-08-18-login-admin-design.md:196` e `:429`, e o
  comentário de `web/admin/src/lib/sessao.tsx:9`. A sexta é a que compara o
  `iat` do token com o `updated_at` da credencial. Quem contar cinco e
  procurar a sexta no código vai achá-la — o custo é a confusão, não um erro.
- **O CLI carimba `updated_at` com o relógio da máquina de quem roda, e o
  `iat` vem do relógio do Worker** — `api/scripts/senha-admin.mjs`. Se o
  laptop estiver adiantado em N segundos, por N segundos depois do
  `npm run admin:senha` uma sessão recém-criada falha a sexta checagem e
  devolve 401, bem no passo do runbook que manda rodar o CLI e depois entrar.
  Com NTP normal isso é sub-segundo. A correção é uma linha de
  troubleshooting no runbook, não código.
