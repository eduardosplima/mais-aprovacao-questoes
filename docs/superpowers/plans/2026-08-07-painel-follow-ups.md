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
>
> **Reconferido em 2026-08-19, na rodada de ajustes. Três entradas não
> sobreviveram à leitura do código — é a terceira vez que esta lista drifta,
> e o padrão já é claro: entrada de ledger envelhece no diagnóstico antes de
> envelhecer no sintoma.**
>
> - **Tipos de `Usuario.role` e `Usuario.tier`: entrada morta.** Não existe
>   mais `Usuario` no `web/` — `grep -rn "Usuario\|\.role\|\.tier"
>   web/admin/src web/ui/src` não devolve nada. A separação do login apagou o
>   modelo de usuário do cliente: `useSessao` devolve `{ email }` e nada mais.
>   A entrada descrevia uma dívida que outra rodada quitou de passagem.
> - **O GET extra da paginação: diagnóstico errado em metade.** O segundo
>   `api.questoes` do recuo é **necessário** — sem ele não há linhas da página
>   corrigida para exibir, e a API não clampa o offset. Já o "Carregando…
>   piscando" não existe: `setCarregando(false)` mora só no `finally`
>   (`page.tsx:109`), então os dois fetches acontecem dentro de um único
>   estado de carregamento. Fechada como não é defeito.
> - **Linha da `Tabela` por teclado: fechada como não é defeito.** A coluna
>   Ações tem "Editar", que é âncora com `href` — focável e anunciada por
>   isso, não por ser botão —, e o teclado já chega à edição. Pôr `tabIndex`
>   na linha acrescentaria uma parada de tabulação por linha, até 50 numa
>   lista cheia, para chegar ao mesmo lugar. Seria acessibilidade pior com
>   aparência de melhor.

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

> **Dívida nova, aberta em 2026-08-19.** A prop `iconeConfirmar` do `Modal`
> (`ui/src/Modal.tsx`), que fechou a entrada "Ícone nos botões de diálogo e no
> login" acima, é **opcional**. Nada tipado ou testado impede um consumidor
> futuro do `web/ui` de omiti-la e quebrar a regra 2 do `web/README.md` em
> silêncio — a garantia hoje é só documental, no comentário do tipo. O que
> fecharia isto: tornar a prop obrigatória, ou um lint/teste que confira os
> call sites do `Modal`. Nenhuma das duas foi decidida nesta rodada; fica
> registrado para quando o sub-projeto 4 virar o segundo consumidor.

## Acessibilidade

| Item | Efeito |
|---|---|
| ~~A linha da `Tabela` responde só a mouse (`onClick` em `<tr>`/`<li>`, sem `tabIndex` nem `role`)~~ **Fechada em 2026-08-19 — não é defeito** | Ver a reconferência no topo do arquivo: a coluna Ações já tem "Editar", focável e anunciado; `tabIndex` na linha só acrescentaria paradas de tabulação redundantes |
| ~~Um 409 ao renomear taxonomia aparece como toast enquanto o modal segue aberto, em vez de inline no campo~~ **Resolvido em 2026-08-18** | O erro do servidor passou a cair no próprio campo do modal, junto com a validação de nome vazio que entrou na mesma rodada. Coberto por `taxonomias.spec.ts`. |
| ~~Falta guarda de duplo clique no botão Salvar do modal de renomear taxonomia~~ **Resolvido em 2026-08-19** | `Modal` (`web/ui`) ganhou a prop `carregando`, que desabilita o confirmar e troca o texto por "Aguarde…"; `taxonomias/page.tsx` passa `carregando={renomeando}` e `carregando={excluindo}` nos dois modais |
| ~~O erro de `excluir()` aparece em toast, enquanto o de `renomear()` cai inline no campo~~ **Resolvido em 2026-08-19** | O `Modal` ganhou a prop `erro`, e `excluir()` passou a usá-la. A regra que ficou: enquanto há diálogo aberto, o erro mora nele — no campo se houver campo culpado, no rodapé do diálogo se não houver. Excluir questão continua em toast e não é exceção: aquele fluxo fecha o diálogo antes de chamar a API |

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

> **Resolvido em 2026-08-19.** O `Editor` ganhou a prop `invalido`, aplicada
> ao wrapper do TipTap em `Editor.tsx:81` — a mesma classe do defeito que já
> tinha sido corrigido no `SeletorTaxonomia`, agora alcançando o componente
> que ficava de fora.
>
> A asserção do teste (`e2e/validacao.spec.ts:205`) prova **"a cor mudou"**
> (`not.toHaveCSS("border-top-color", antes)`), não "a cor ficou vermelha" —
> troca consciente para eliminar uma corrida com `transition-colors` (ler
> `getComputedStyle` cedo demais pegaria o quadro inicial da transição, não o
> destino). Não deve ser lembrada como garantia mais forte do que é.
>
> - ~~O campo Enunciado exibe a mensagem de erro pelo `Campo`, mas **não**
>   recebe borda vermelha: `CONTROLE_INVALIDO` se aplica a input e select, e o
>   Enunciado é o wrapper do TipTap, que não usa `CONTROLE`.~~

## Tipos

> **Entrada morta em 2026-08-19** — ver a reconferência no topo do arquivo. A
> separação do login do admin apagou `Usuario` do cliente; `useSessao` hoje
> devolve só `{ email }`.

~~`Usuario.role` e `Usuario.tier` são `string` no cliente, enquanto a API tem
união literal (`"admin" | "user"`, `"assinante" | "gratuito"`). O
`sessao.tsx:24` faz `u.role !== "admin"` — exatamente a comparação que uma
união protegeria de um typo.~~

**Nota de 2026-08-18, sobre a ênfase (histórico):** o raio era menor do que a
entrada sugeria. Um typo ali fazia a comparação **falhar fechada** (expulsa o
admin de verdade, não deixa entrar quem não é), e o próprio arquivo
documentava que aquilo não era controle de acesso — o controle real era o
`role=admin` lido do D1 por `api/src/middleware/rbac.ts`. Registro mantido
pelo histórico; o `rbac.ts` e o `role` que ele lia também não existem mais.

## Cosmético

- ~~O `next/image` avisa no console sobre proporção do logo, apesar do
  `w-auto`.~~ **Resolvido em 2026-08-19** — o `<Image>` do logo passou a
  declarar `width`/`height` na proporção real do arquivo (2,5006), em
  `Layout.tsx` e `login/page.tsx`.
- ~~O gap do cabeçalho no desktop caiu de 24px para 16px sem intenção, num fix
  de responsividade; um `md:gap-x-6` restaura.~~ **Resolvido em 2026-08-19** —
  `Layout.tsx:57` já tem `md:gap-x-6`.
- ~~O recuo de paginação dispara um GET a mais e um "Carregando…" piscando, só
  no caminho raro em que uma mutação encolhe o acervo abaixo da página
  atual.~~ **Fechada em 2026-08-19 — diagnóstico errado em metade.** Ver a
  reconferência no topo do arquivo: o GET extra é necessário, e o
  "Carregando…" piscando nunca existiu.
- ~~O botão "Adicionar" de taxonomias descia junto com a mensagem de erro do
  campo Nome — **28,75px**, medido em chromium e WebKit, não os "cerca de
  26px" estimados sem medição.~~ **Resolvido em 2026-08-19** — o botão
  passou a ser irmão do input, dentro do `Campo`, e não mais do bloco inteiro
  do campo: o `<p>` de erro cresce abaixo dos dois e não tem como empurrar um
  sem empurrar o outro.

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

~~Também levantado: a tabela "Códigos de erro" do `api/README.md` lista 11
códigos, mas a API emite pelo menos 7 outros (`invalid_credentials`,
`captcha_failed`, `missing_file`, `too_large`, `unsupported_type`,
`unauthorized`, `forbidden`).~~ **Resolvido em 2026-08-19** — a tabela ganhou
as nove linhas que faltavam (os sete acima mais `senha_atual_incorreta` e
`weak_password`, que a separação do login trouxe), cada status e descrição
conferidos contra `api/src`.

## Escopo declarado como fora, não esquecido

- **Busca por texto** na lista de questões: `GET /admin/questions` não tem
  parâmetro de busca. Exigiria rota nova na API.
- **Modo escuro**: nenhum critério de pronto o pede; os tokens em custom
  properties deixam a porta aberta.

## Sobras da separação do login do admin — 2026-08-19

Três itens que a revisão final do branch `login-admin` levantou e que foram
parqueados de propósito, para não abrir uma segunda onda de correção. Nenhum
é defeito de comportamento; os três são baratos.

**As três fecharam nesta mesma rodada, 2026-08-19.**

- ~~**Dois casos e2e afirmam com `toContainText` onde `toBeVisible` seria mais
  estrito** — `web/admin/e2e/login.spec.ts`, nos casos que interceptam
  `/admin/auth/contexto` (o email fora da allowlist e o contexto que falha).
  `toContainText` passa num elemento presente porém oculto. Os dois estão
  renderizados hoje, então é rigor de asserção, não falso verde.~~
  **Resolvido** — os dois casos (`login.spec.ts:83-84` e `:102-103`) agora
  encadeiam `toBeVisible` antes do `toContainText`.
- ~~**Três referências a "cinco checagens" sobreviveram, e agora são seis** —
  `docs/superpowers/specs/2026-08-18-login-admin-design.md:196` e `:429`, e o
  comentário de `web/admin/src/lib/sessao.tsx:9`. A sexta é a que compara o
  `iat` do token com o `updated_at` da credencial. Quem contar cinco e
  procurar a sexta no código vai achá-la — o custo é a confusão, não um
  erro.~~ **Resolvido** — as três agora dizem "seis checagens" e citam a
  sexta.
- ~~**O CLI carimba `updated_at` com o relógio da máquina de quem roda, e o
  `iat` vem do relógio do Worker** — `api/scripts/senha-admin.mjs`. Se o
  laptop estiver adiantado em N segundos, por N segundos depois do
  `npm run admin:senha` uma sessão recém-criada falha a sexta checagem e
  devolve 401, bem no passo do runbook que manda rodar o CLI e depois entrar.
  Com NTP normal isso é sub-segundo. A correção é uma linha de
  troubleshooting no runbook, não código.~~ **Resolvido** — a nota de
  troubleshooting entrou em `docs/runbook-deploy-producao.md`, depois do
  passo 9 de "Publicar a separação do login do admin".

~~Ainda restam, do e2e do login: três outras asserções de
`web/admin/e2e/login.spec.ts` (por volta das linhas 20, 38 e 114) usam
`toContainText`/`toHaveText` isoladas~~ — **resolvidas em 2026-08-19**, as
três ganharam `toBeVisible` encadeado.

## Sobras do modal de trocar senha — 2026-08-19

Levantadas na revisão desta rodada e deixadas de fora de propósito — nenhuma
é regressão, todas são dívida conhecida no `ModalTrocarSenha`
(`web/admin/src/componentes/`).

- ~~Cancelar com a requisição em voo deixa o erro da resposta guardado para a
  próxima abertura. As senhas **são** limpas; o que sobra é a mensagem de
  erro.~~ **Resolvido em 2026-08-19** — o contador `idRequisicao` invalida a
  resposta atrasada, e `fechar()` zera `erros` no mesmo passo que zera os
  campos.
- ~~`erros.geral` nunca é limpo ao digitar, ao contrário dos erros de
  campo~~ **Resolvido em 2026-08-19** — os três `onChange` chamam
  `limparGeral()`.
- ~~Com "Nova senha" vazia e "Confirme" preenchida, aparece "A confirmação não
  confere." quando o problema real é o campo de cima estar vazio.~~
  **Resolvido em 2026-08-19** — a validação local só aponta divergência
  quando "Nova senha" não está vazia.
- ~~O clique no backdrop descarta três senhas digitadas sem confirmação~~
  **Resolvido em 2026-08-19** — o fundo deixou de fechar os quatro diálogos.
  **Continua aberto:** o Escape faz o mesmo descarte, e continua fazendo. A
  decisão fechou o acidente e deixou em pé a intenção — quem for reabrir isto
  precisa decidir se um diálogo com conteúdo digitado deve confirmar antes de
  descartar.
- ~~O tip de divergência entra pelo `Campo`, que renderiza `role="alert"` —
  alerta assertivo para um aviso de conveniência.~~ **Resolvido em
  2026-08-19** — o `Campo` ganhou a prop `aviso`, com `role="status"`; o tip
  de divergência passou a usá-la.
- ~~O `onChange` de "Nova senha" limpa `erros.nova` incondicionalmente,
  apagando também a mensagem de `weak_password` vinda do servidor no primeiro
  caractere digitado.~~ **Resolvido em 2026-08-19** — a marca
  `novaDoServidor` impede a limpeza automática quando o erro veio do
  servidor.
- ~~Falta cobertura e2e de que reabrir o modal mostra os campos limpos, e de
  `aria-required`.~~ **Resolvido em 2026-08-19** — `senha.spec.ts` ganhou os
  dois casos.

## Sobras de rigor de teste — 2026-08-19

- ~~O teste do cabeçalho conta `svg` e prova presença, não a ordem "ícone
  antes do texto"~~ **Resolvido em 2026-08-19** — passou a comparar contra o
  nó de texto, como o da paginação já fazia.

## ~~Ícone nos botões de diálogo e no login~~ — **resolvido em 2026-08-19**

> O `Modal` ganhou `IconeCancelar` fixo no cancelar e a prop `iconeConfirmar`
> para o confirmar; o login ganhou `IconeEntrar`. O aviso do `web/README.md`
> para não copiar o `Modal` como exemplo saiu junto — a regra 2 não tem mais
> contraexemplo dentro do `web/ui`.

> Decidido pelo dono em **2026-08-19**, ao fechar a rodada de ajustes. Vai
> ser disparado em sessão própria — está aqui para não se perder, não para
> ser feito de passagem.

A regra 2 do `web/README.md` diz que toda ação fora de linha de tabela é
`Botao` com ícone + texto, **sem exceção**. Três botões ainda não cumprem:

| Onde | Botão |
|---|---|
| `web/ui/src/Modal.tsx` | o `Cancelar`, presente nos três diálogos do painel |
| `web/ui/src/Modal.tsx` | o confirmar (`Salvar` / `Excluir` / o rótulo que o chamador passar) |
| `web/admin/src/app/login/page.tsx` | o `Entrar` |

**O que fazer:** dar ao `Modal` um slot de ícone para cada um dos dois botões
— o de confirmar precisa aceitar o ícone que o chamador escolher, porque
`Excluir` e `Salvar` não são a mesma ação —, e criar um `IconeEntrar` para o
login. Os ícones de cancelar e salvar já existem (`IconeCancelar`,
`IconeSalvar`, `IconeExcluir`).

**Por que não foi feito na rodada de ajustes.** A revisão final ofereceu duas
saídas: qualificar a regra com uma cláusula de exceção, ou dar o slot ao
`Modal`. Eu (Claude) escolhi a cláusula para não parar a rodada, e o dono
recusou: a cláusula legitimava como desenho o que é dívida. A cláusula foi
removida do `README` na mesma decisão, e o texto de lá passou a dizer que os
três botões são o contraexemplo da regra — inclusive avisando quem for
consumir o `web/ui` para não copiar o `Modal` como exemplo.

**Prioridade:** antes de o sub-projeto 4 começar a consumir o `web/ui`. O
risco não é estético — é que o frontend do aluno copie o `Modal` e nasça
divergindo da regra que herdou por escrito.

## Auto-submit do Apple Passwords — para a sessão dedicada

Registrado em `docs/superpowers/specs/2026-08-19-ajustes-painel-design.md`
§7, copiado aqui para a sessão dedicada não recomeçar do zero.

> **Auto-submit do Apple Passwords.** O que esta sessão apurou, para não ser
> reapurado: o comportamento existe desde o Safari 12.1 e é decisão do
> Safari, não do site; a Apple **não o documenta em lugar nenhum**; a
> documentação de Password AutoFill promete, para formulário partido em
> páginas, "tap and fill" — preencher, não enviar; o caminho de MFA é outro
> (`autocomplete="one-time-code"`), com auto-submit amplamente relatado, o
> que significa que existe pelo menos um caminho em que o Safari envia sem
> usuário nem senha na tela. As alavancas plausíveis e não testadas são:
> campo `autocomplete="username"` somente-leitura com o email do Access,
> `action` e `method` no `<form>` (hoje não há nenhum dos dois), e conferir
> se o preenchimento do Safari chega ao estado do React — este último é
> risco, não correção: se o auto-submit passar a funcionar e o `onChange`
> não disparar, o formulário envia senha vazia e a tela acusa "senha
> inválida" para uma senha correta.
