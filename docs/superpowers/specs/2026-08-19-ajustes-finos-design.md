# Ajustes finos do painel — spec

> Segunda rodada de 2026-08-19, pedida pelo dono logo depois da anterior
> ([`2026-08-19-ajustes-painel-design.md`](2026-08-19-ajustes-painel-design.md)).
> Não há frente de produto nova aqui: é a dívida que a rodada anterior deixou
> registrada, um bug de layout relatado pelo dono, um favicon que nunca
> existiu, e a verificação final que ficou por fazer.
>
> A razão de isto ser spec, e não uma sequência de correções, é a mesma da
> anterior e vale de novo: quatro dos itens mudam o `web/ui`, que é a entrega
> declarada ao **sub-projeto 4**. Uma prop nova no `Modal` combinada em
> conversa e não escrita é dívida que o frontend do aluno herda sem saber.

## §1 — Escopo

Entra:

| # | Item | Origem |
|---|---|---|
| 1 | Verificação final da rodada anterior, **antes de tudo** | pedido 2 |
| 2 | `Modal` ganha ícone nos dois botões, prop `erro`, e para de fechar no backdrop | ledger, "execução futura, decidida" + decisão desta spec |
| 3 | `Campo` ganha o estado `aviso` — vermelho, mas polido | ledger, "sobras do modal de trocar senha" |
| 4 | `IconeEntrar` no login, e o texto do Access por extenso | ledger + pedido 1 desta rodada |
| 5 | Seis sobras do `ModalTrocarSenha` | ledger |
| 6 | O botão "Adicionar" de taxonomias para de escorregar quando o erro aparece | pedido 4 |
| 7 | Favicon a partir da logo | pedido 3 |
| 8 | Quatro asserções fracas de e2e | ledger |

Fica fora, por decisão explícita do dono nesta rodada:

- **Empacotamento do `web/ui`** — as três arestas (o `@source` que falha
  calado, as classes duplicadas do botão-ícone, o `LETRAS` em dois arquivos).
  Continua marcado como pré-requisito do sub-projeto 4 em
  [`plans/2026-08-07-painel-follow-ups.md`](../plans/2026-08-07-painel-follow-ups.md).
- **Submit automático do Apple Passwords** — sessão dedicada, pesquisa já
  registrada no ledger.
- **`nanoid` 3.3.18** — não é decisão, é calendário: sai do cooldown em
  2026-08-21 16:41 UTC.

## §2 — A ordem: linha de base antes de qualquer mudança

**Decidido pelo dono, e corrige a ordem que eu havia proposto.** A verificação
que ficou pendente da rodada anterior roda **primeiro**, com a árvore no estado
em que está hoje (`a542f23`), antes de esta rodada tocar em um arquivo sequer.

O motivo é o ruído. Se as duas suítes rodarem só no fim, um teste vermelho não
distingue "dívida de ontem" de "regressão de hoje", e a distinção é impossível
de recuperar depois que os dois conjuntos de mudança se misturam. Rodando
antes, existe uma linha de base provada, e a verificação do fim mede **só** o
que esta rodada mexeu.

O que a linha de base inclui:

1. `cd web && npm test` — chromium e WebKit, a suíte inteira do painel.
2. `cd api && npm test` — **em sequência, nunca junto**: o `wrangler dev` que o
   Playwright sobe abre o mesmo SQLite do D1 local (`api/.wrangler/state`) que
   o vitest do `api/` usa, e a disputa derruba testes do painel com cara de
   defeito de produto.
3. Os sete critérios de pronto do §9 da spec anterior, conferidos um a um.
4. Os checkboxes do plano
   [`plans/2026-08-19-ajustes-painel.md`](../plans/2026-08-19-ajustes-painel.md)
   marcados com o resultado, e commitados. Hoje as dez tarefas estão entregues
   com todos os checkboxes vazios — um plano que não registra o que aconteceu
   vira o mesmo passivo que um ledger não reconferido.

**Se a linha de base sair vermelha, a execução para e o dono decide.** Corrigir
vermelho de ontem não entra nesta rodada por conta própria.

## §3 — O `Modal` do `web/ui`

Três mudanças. As duas primeiras são props com padrão que não altera nenhum
chamador existente; a terceira muda comportamento dos quatro.

### Ícone nos dois botões

Fecha a entrada "execução futura, decidida" do ledger, que existe porque a
regra 2 do `web/README.md` ("toda ação fora de linha de tabela é `Botao` com
ícone + texto, sem exceção") nasceu com três contraexemplos dentro do próprio
`web/ui`.

- **O `Cancelar` recebe `IconeCancelar` fixo, dentro do próprio `Modal`.**
  Cancelar é sempre a mesma ação; deixar o chamador escolher seria oferecer uma
  decisão que não existe.
- **O confirmar recebe `iconeConfirmar?: ReactNode`, do chamador.** `Excluir` e
  `Salvar` não são a mesma ação e não podem levar o mesmo ícone.

Os quatro chamadores:

| Chamador | `iconeConfirmar` |
|---|---|
| `app/page.tsx:304` — excluir questão | `<IconeExcluir />` |
| `app/taxonomias/page.tsx:244` — renomear termo | `<IconeSalvar />` |
| `app/taxonomias/page.tsx:274` — excluir termo | `<IconeExcluir />` |
| `componentes/ModalTrocarSenha.tsx:101` — trocar senha | `<IconeSalvar />` |

A prop é opcional, e não obrigatória, por uma razão prática: `Modal` mora no
`web/ui` e um consumidor futuro pode ter um diálogo cuja confirmação não tem
ícone óbvio. A regra do README continua sendo a autoridade; o tipo não é o
lugar de forçá-la.

### A prop `erro`

`erro?: string`, renderizado dentro do diálogo, entre o `children` e a linha de
botões, com `role="alert"` e o mesmo estilo que o `ModalTrocarSenha` já usa
hoje no seu `<p>` improvisado (`text-[13.5px] font-semibold text-erro`).

Aqui `role="alert"` é o certo, e não contradiz o §4: este erro é resposta a uma
ação que a pessoa acabou de disparar e que **falhou** — interromper para dizer
isso é exatamente o caso de uso do papel. O que o §4 corrige é outro: um aviso
de conveniência que ninguém pediu, disparado no meio da digitação.

**A regra que passa a valer:** enquanto houver diálogo aberto, o erro aparece
dentro dele — no campo, se existir campo responsável; no rodapé do diálogo, se
não existir. Toast enquanto há modal na frente é mensagem na borda da tela para
alguém que está olhando para o centro.

Consequências, chamador por chamador:

- **Excluir termo** (`taxonomias/page.tsx`) sai do toast e passa a usar `erro`.
  O modal já fica aberto no caminho de falha — `aExcluir` só zera no sucesso —,
  então hoje a mensagem aparece exatamente onde o operador não está olhando.
- **Trocar senha** troca o `<p>` próprio pela prop. Some marcação duplicada
  fora do design system.
- **Renomear termo** não muda: o 409 tem campo responsável e continua inline no
  campo, que é o lado forte da regra.
- **Excluir questão** (`app/page.tsx:137`) **não muda, e não é exceção.**
  Aquele fluxo fecha o modal *antes* de chamar a API (`setAExcluir(null)` na
  linha 140, otimista), então quando o erro chega não há diálogo na frente e o
  toast é o único lugar que sobra. A regra é ancorada no estado do diálogo, não
  no nome da ação.

### O backdrop para de fechar

**Decisão do dono, e vale para os quatro modais:** clique no fundo escuro não
fecha mais nada. Escape e o botão `Cancelar` continuam fechando.

O que motivou foi o `ModalTrocarSenha` — um clique por engano descarta três
senhas digitadas, sem aviso e sem desfazer —, mas a regra ficou única em vez de
condicional por escolha explícita: uma prop `fecharNoBackdrop` obrigaria cada
consumidor futuro do `web/ui` a descobrir que ela existe e decidir certo. Uma
regra que não precisa ser lembrada é mais barata que uma prop bem documentada.

Custo aceito: o diálogo de excluir perde uma saída conveniente e inofensiva.
Escape continua ali, e é o contrato que leitor de tela anuncia.

**O que isto não fecha, e fica registrado:** Escape continua descartando as
três senhas digitadas, sem confirmação. A decisão fecha o clique por engano —
que é acidente — e deixa em pé o descarte deliberado, que é intenção. A
entrada do ledger é fechada com essa ressalva escrita, não como se o problema
inteiro tivesse sumido.

Implicação de código: com o `onClick={aoCancelar}` fora do fundo, o
`onClick={(e) => e.stopPropagation()}` do diálogo interno fica órfão e sai
junto — ele existia só para impedir que o clique dentro do diálogo subisse até
o fundo.

## §4 — O `Campo` ganha `aviso`

Um terceiro estado, **visualmente idêntico ao `erro`** (`text-[12.5px]
font-semibold text-erro`) e diferente só na etiqueta ARIA: `role="status"`, que
é polido — entra na fila do leitor de tela em vez de interromper o que está
sendo falado.

Precedência entre os três: `erro` vence `aviso`, que vence `dica`.

**O problema que isto resolve, e por que a primeira proposta era errada.** O tip
ao vivo de divergência de senha entra hoje pelo `erro` do `Campo`, que é
`role="alert"` — implicitamente `aria-live="assertive"`. E o gatilho é ruim:
`divergem` compara as strings inteiras, então quem digita a confirmação
**corretamente** dispara a divergência no primeiro caractere e continua
"divergente" até a última letra. Para quem usa leitor de tela, o painel
interrompe a leitura para afirmar "A confirmação não confere." sobre uma senha
que está sendo digitada certa, num campo mascarado onde não há como conferir
que a afirmação é falsa.

A primeira saída que propus era mandar o tip pelo `dica`, que é cinza
`text-txt-3`. O dono barrou, e com razão: isso paga acessibilidade com
visibilidade, e a visibilidade é a razão de o tip existir (§4 da spec anterior
— os dois campos são `type=password`, ninguém confere a olho). Trocar vermelho
por cinza num aviso que precisa ser notado enquanto se digita é regressão
disfarçada de correção.

**Ressalva honesta, para não ser lembrada como mais forte do que é:** isto é
raciocínio a partir da especificação ARIA e de como o React monta o nó — não
medição com leitor de tela real. O comportamento exato de anúncio na inserção
varia entre VoiceOver, NVDA e JAWS.

**O que deliberadamente não muda:** o `aria-invalid` do campo de confirmação
continua sendo aplicado nos dois casos (tip ao vivo e erro de envio), e o
`CONTROLE_INVALIDO` também. A correção mira a interrupção, não o estado do
campo — o campo de fato não confere enquanto o tip está na tela.

## §5 — Login

Duas coisas pequenas, nenhuma delas comportamento.

- **`IconeEntrar`**, novo em `web/ui/src/Icone.tsx` e exportado pelo
  `index.ts`, usado no botão `Entrar`. É o terceiro e último contraexemplo da
  regra 2 do README; com ele o parágrafo que avisa "não copie o `Modal` como
  exemplo" sai do `web/README.md`, junto com a entrada do ledger.
- **"Você entrou pelo Access como"** (`login/page.tsx:84`) vira **"Você entrou
  pelo Cloudflare Access como"**. Dez linhas abaixo, na mesma tela, o rodapé já
  diz "Encerrar sessão do Cloudflare Access" (`:142`) — e existe teste
  chamando esse rodapé de "por extenso" (`login.spec.ts:142`). Duas formas do
  mesmo nome próprio na mesma tela, sendo que uma delas é o produto que
  autentica a pessoa.

Nenhum teste quebra com a troca: o caso que exercita aquela linha
(`login.spec.ts:25`) procura o email por `getByText(EMAIL)`, e o email está
dentro do `<strong>`, fora do texto que muda. A frase nova ganha asserção
própria — a irmã de baixo tem, e a diferença não se justifica.

## §6 — As sobras do `ModalTrocarSenha`

Seis itens do ledger. Nenhum é regressão; todos são dívida conhecida.

| # | Sintoma | Correção |
|---|---|---|
| 1 | Cancelar com a requisição em voo deixa o erro da resposta guardado para a próxima abertura (as senhas são limpas; a mensagem sobra) | `fechar()` marca a requisição em voo como descartada por `useRef`; o `catch` volta cedo quando a marca está posta |
| 2 | `erros.geral` nunca é limpo ao digitar, ao contrário dos erros de campo — falha de rede fica na tela enquanto a pessoa reescreve tudo | passa a limpar em qualquer `onChange`, junto com o erro do próprio campo. Vira a prop `erro` do `Modal` (§3) |
| 3 | Com "Nova senha" vazia e "Confirme" preenchida, aparece "A confirmação não confere." quando o problema é o campo de cima | divergência só é acusada quando os dois têm conteúdo; com a nova vazia, o erro que aparece é o dela |
| 4 | Clique no backdrop descarta três senhas digitadas | resolvido no `Modal` (§3), sem código aqui |
| 5 | O tip de divergência entra pelo `Campo` como `role="alert"` | passa a entrar como `aviso` (§4). Vermelho intacto |
| 6 | `onChange` de "Nova senha" limpa `erros.nova` incondicionalmente, apagando o `weak_password` do servidor no primeiro caractere | o erro de origem servidor sobrevive à digitação e só sai no envio seguinte; o de validação local continua limpando ao digitar |

Sobre o #6: a mensagem apagada é "A senha precisa ter pelo menos 12
caracteres." (`lib/erros.ts:27`) — ela enuncia a regra que a pessoa precisa
cumprir, e some justamente quando ela começa a tentar cumpri-la.

Falta também cobertura e2e de duas coisas que o modal já faz certo e ninguém
prova: reabrir o modal mostra os campos limpos, e os três campos têm
`aria-required`.

## §7 — O botão "Adicionar" de taxonomias

**Sintoma, relatado pelo dono:** ao clicar em Adicionar e a mensagem de erro
aparecer, o botão deixa de ficar alinhado com o input e desce, alinhando-se
com a mensagem.

**Causa.** O form é `flex flex-col sm:flex-row gap-3 sm:items-end`
(`taxonomias/page.tsx:204`) e o botão é irmão do **bloco inteiro** do campo, não
do input. `items-end` alinha pela base desse bloco. Quando o `<p>` de erro
aparece dentro do `Campo`, o bloco cresce cerca de 26px para baixo (o `gap-2`
do `Campo` mais a linha de texto) e leva o botão junto.

**Correção escolhida:** o botão passa a ser irmão do input, dentro do `Campo`.

```
Nome                                   ← rótulo, acima da linha
[ input flex-1 ] [+ Adicionar]         ← a linha: input e botão
Este termo já existe.                  ← erro, abaixo dos dois
```

O `Campo` continua dono do rótulo e da mensagem; o que muda é que seus
`children` passam a ser uma linha com dois elementos em vez de um. O botão não
tem mais como escorregar, porque o erro não é irmão dele — é tio.

Detalhes que a implementação precisa respeitar: `sm:items-center` na linha (o
input tem 50px de altura e o botão 46px, então centralizar é o que parece
alinhado); `shrink-0` no botão; o empilhamento em coluna abaixo de `sm`
continua igual ao de hoje.

Nada disso toca o `web/ui`. A alternativa considerada — tirar o erro de dentro
do `Campo` e renderizá-lo abaixo do form — foi recusada por duplicar a marcação
de erro fora do design system.

## §8 — Favicon

O painel nunca teve um. A logo (`web/admin/public/logo.png`, 1983×793) é um
wordmark 2,5:1: espremida num quadrado de 32px vira borrão. O que vira ícone é
o **símbolo** à esquerda — o "Q" com o "+" recortado.

- **Recorte:** a região quadrada do símbolo, com respiro, sobre o mesmo fundo
  quase-branco do próprio arquivo. Escolha do dono entre três (as outras eram
  fundo transparente e símbolo branco sobre quadrado roxo): é a que mais se
  parece com a marca que já está no ar, e não inventa desenho novo.
- **Saída:** `web/admin/src/app/icon.png`, 256×256. É a convenção do App
  Router — o Next injeta o `<link rel="icon">` sozinho, e o `output: 'export'`
  copia o arquivo. **Nenhuma linha no `layout.tsx`.**
- **Ferramenta:** o ImageMagick que já está na máquina
  (`/opt/homebrew/bin/magick`) ou o `sips` do macOS. Nada é baixado, nada é
  instalado — a regra §5 do `~/.claude/CLAUDE.md` vale aqui como em qualquer
  outro lugar.
- O `logo.png` original fica **intocado**, e as duas telas que o usam também.

A caixa exata do recorte é medida na implementação, não chutada aqui.

## §9 — As quatro asserções fracas

- **Três em `login.spec.ts`** (por volta das linhas 20, 38 e 114) usam
  `toContainText`/`toHaveText` isoladas, que passam num elemento presente porém
  oculto. Ganham `toBeVisible` encadeado antes — o mesmo padrão que os outros
  dois casos do arquivo já adotaram na rodada anterior.
- **O teste do cabeçalho** (`visual.spec.ts:103`) conta `svg` e prova
  presença, não a ordem "ícone antes do texto": passaria com o ícone do lado
  errado. Passa a provar posição comparando contra o **texto**, como o teste da
  paginação faz (`visual.spec.ts:175-187`), e não elemento com elemento.

## §10 — Testes

A suíte e2e do painel é a única do `web/`, e continua sendo onde tudo isto se
prova. Cada item entra com teste que falha antes da correção:

| O quê | Como se prova |
|---|---|
| Ícone nos botões do `Modal` | um `svg` dentro de `Cancelar` e um dentro do confirmar, nos quatro diálogos |
| `erro` no `Modal` | forçar 409 no excluir termo e afirmar que a mensagem está **dentro** do `role="dialog"`, não em toast |
| Backdrop não fecha | clicar no fundo e afirmar que o diálogo continua aberto; depois Escape e afirmar que fechou |
| `aviso` no `Campo` | o `<p>` do tip de divergência tem `role="status"`, e não `alert` |
| Texto do Access | a frase por extenso, visível |
| `IconeEntrar` | um `svg` dentro do botão `Entrar` |
| Sobras 1, 2, 3 e 6 do modal de senha | um caso cada, todos e2e |
| Reabrir o modal limpo, e `aria-required` | dois casos |
| Alinhamento do Adicionar | comparar as caixas do input e do botão **depois** do erro aparecer: hoje o botão desce ~26px |
| Favicon | conferido na saída do build (`out/`), não em Playwright |

Os dois navegadores, sempre. Um caso que passa só em chromium não está pronto.

## §11 — Critérios de pronto

1. A linha de base do §2 rodou **antes** da primeira mudança, com resultado
   registrado, e os checkboxes do plano anterior estão marcados.
2. Nenhum toast aparece enquanto há diálogo aberto na frente.
3. Os quatro modais têm ícone nos dois botões e não fecham no backdrop.
4. O tip de divergência continua vermelho e passou a ser polido.
5. O botão "Adicionar" fica alinhado com o input com e sem erro na tela,
   em chromium e WebKit.
6. O favicon aparece na aba, e o `layout.tsx` não foi tocado.
7. Suíte e2e verde nos dois navegadores; suíte do `api/` verde, rodada em
   sequência; `npm run typecheck` limpo nos dois workspaces do `web/`.
8. As entradas correspondentes do ledger
   ([`plans/2026-08-07-painel-follow-ups.md`](../plans/2026-08-07-painel-follow-ups.md))
   estão fechadas com data, e o `web/README.md` não avisa mais para não copiar
   o `Modal`.

## §12 — Decisões, e o que foi recusado

- **Ordem invertida a pedido do dono** — verificação da rodada anterior antes
  de tudo, e não no fim junto com a desta. Ver §2.
- **Tip de divergência: recusada a versão cinza.** O dono barrou a proposta de
  mandar o tip pelo `dica`; sobrou a versão estreita (vermelho intacto,
  `role="status"`). Ver §4, que registra por que a primeira proposta era um mau
  negócio.
- **Recusada a prop `fecharNoBackdrop`.** Regra única para os quatro modais em
  vez de opção por chamador — ver §3.
- **Recusado tirar o erro de dentro do `Campo`** para consertar o alinhamento —
  ver §7.
- **Excluir questão continua em toast, e isso não é exceção à regra** — o
  diálogo já está fechado quando o erro chega. Ver §3.
- **Favicon: recusados fundo transparente e quadrado roxo.** O primeiro perde
  contraste em aba escura; o segundo é desenho novo, não recorte da marca —
  exigiria refazer à mão o recorte interno do "Q".
