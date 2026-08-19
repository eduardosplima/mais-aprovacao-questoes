# Ajustes do painel — spec

> Rodada pedida pelo dono em 2026-08-19, logo depois da publicação da
> separação do login do admin. Seis itens, dos quais um saiu no meio do
> desenho (ver §10). O que os une não é uma frente de produto: são duas
> **regras de design system** que passam a valer, três telas que precisam
> obedecê-las, e a limpeza do ledger de dívida do painel.
>
> A razão de isto ser spec, e não uma sequência de correções, está nas regras:
> elas valem para o `web/ui`, que é a entrega declarada ao **sub-projeto 4**.
> Regra combinada em conversa e não escrita vira dívida herdada — o frontend
> do aluno nasceria divergindo do painel sem ninguém perceber.

## §1 — Escopo

Entra:

| # | Item | Origem |
|---|---|---|
| 1 | Regra estética de campo obrigatório, escrita e aplicada | pedido 3 |
| 2 | Regra de botões (inline = ícone; demais = ícone + texto) | pedido 6 |
| 3 | Trocar senha vira modal, centralizado, com tip de divergência e sucesso no padrão | pedidos 5a, 5b, 5c |
| 4 | "Encerrar também a sessão do Access" → "Encerrar sessão do Cloudflare Access" | pedido 2 |
| 5 | Cabeçalho: "Trocar senha" e "Sair" no padrão de botão | pedido 6 |
| 6 | Dez itens do ledger de dívida do painel | pedido 1 |

Fica fora, por decisão explícita:

- **Empacotamento do `web/ui`** (as três arestas: o `@source` que falha calado,
  as classes duplicadas do botão-ícone, o `LETRAS` em dois arquivos). Continua
  marcado como pré-requisito do sub-projeto 4 em
  [`plans/2026-08-07-painel-follow-ups.md`](../plans/2026-08-07-painel-follow-ups.md).
- **`nanoid` 3.3.18** — bloqueado por data, sai do cooldown em 2026-08-21
  16:41 UTC. Não é decisão, é calendário.
- **Submit automático do Apple Passwords** — retirado do escopo pelo dono, que
  vai pesquisar e abrir sessão dedicada. O que a pesquisa desta sessão já
  levantou fica registrado no ledger para essa sessão não recomeçar do zero
  (§7, último item).

## §2 — Regra 1: campos obrigatórios

**A regra é replicar o que a tela de nova questão já faz.** Ela não é
invenção desta spec; é a promoção de um padrão que existe em um lugar só e
não estava escrito.

1. **Obrigatório não leva marca no rótulo.** É o default do painel. Marcar
   todo campo exigido num formulário em que quase tudo é exigido é ruído que
   deixa de ser lido na segunda tela.
2. **Opcional leva `dica="Opcional"`**, que o `Campo` já renderiza **abaixo**
   do controle, em `text-txt-3`. Precedente vivo:
   `questoes/editar/page.tsx:324` ("Gabarito comentado") e `:335` ("Vídeo do
   gabarito").
3. **Campo vazio nunca aciona a validação nativa do navegador.** O formulário
   leva `noValidate`, a conferência é do cliente, e o erro aparece como borda
   vermelha (`CONTROLE_INVALIDO`) mais mensagem no próprio `Campo`.
4. **O atributo `required` sai; `aria-required` fica.** O que se descarta é a
   UI do navegador — aquele balão cinza "Fill out this field", em inglês, com
   tipografia de sistema, que aparece fora do fluxo da tela e some sozinho. O
   que se preserva é a informação para leitor de tela, que é legítima e não
   tem nada a ver com a aparência.
5. **O resumo de erros no topo** (o bloco "Corrija N ponto(s) para salvar")
   **é do editor de questões, e continua só lá.** Ele existe porque aquele
   formulário tem mais campo do que cabe na tela, e um erro pode estar fora do
   viewport. Em formulário de um a três campos ele repete ao lado o que já
   está embaixo do campo.

> **Por que a regra 4 importa mais do que parece.** O balão nativo é o único
> texto do painel que o projeto não controla: não passa por tradução, não usa
> a tipografia do design system, não respeita o `role="alert"` que o resto da
> tela usa, e no Safari desaparece em poucos segundos. Um operador que não
> estava olhando para o campo naquele instante não fica sabendo por que o
> envio não aconteceu — foi exatamente o sintoma que o dono relatou.

### Onde a regra 1 se aplica nesta rodada

| Tela | Hoje | Depois |
|---|---|---|
| Login (`login/page.tsx`) | `required` no campo Senha | `noValidate` no form; vazio → "Informe a senha." no `Campo`, com borda |
| Trocar senha (vira modal, §4) | `required` nos três campos | idem, mensagem por campo |
| Editor de questões | já obedece | inalterado, exceto o Enunciado (§7) |

## §3 — Regra 2: botões

Duas formas, e a escolha entre elas não é estética — é o espaço disponível:

1. **Ação inline em linha de tabela → `BotaoIcone`.** Só o ícone, com `rotulo`
   virando `title` (a dica visível) e `aria-label` (o nome acessível). É o que
   `page.tsx:189-200` já faz com publicar/despublicar e excluir.
2. **Toda outra ação → `Botao` com ícone + texto.** É o que a barra de ações
   do editor (`questoes/editar/page.tsx:359-387`) e o "Nova questão"
   (`page.tsx:214-217`) já fazem.

O motivo de a tabela ser exceção: cada linha repete os mesmos botões, e texto
repetido N vezes vira parede. Fora da tabela, o botão aparece uma vez — e uma
ação que aparece uma vez precisa se explicar sem hover, porque `title` não
existe em toque e não é descoberto por quem não passa o mouse.

**Onde o ícone fica, na forma 2:** à esquerda do texto, sempre — **exceto em
ação direcional, onde ele vai do lado para onde aponta.** "Próxima" leva a
seta à direita; "Anterior", à esquerda.

A exceção não é gosto. Nos outros botões o ícone é um *rótulo* — diz que tipo
de ação é aquela (disquete = salvar, olho = publicar) — e rótulo antecede o
que nomeia. Numa ação direcional o ícone é um *vetor*: ele não diz o que a
ação é, diz para onde ela vai. Pôr a seta de "Próxima" à esquerda a faria
apontar para fora do próprio botão, contra o sentido da leitura e contra o
sentido do movimento. É a mesma razão pela qual "voltar" fica à esquerda em
toda barra de navegação do mundo.

### Consequência que esta spec assume

**A paginação da lista de questões passa a ter ícone.** Os botões "Anterior" e
"Próxima" (`page.tsx:280-296`) são `Botao` sem ícone e, pela regra 2, ficariam
fora do padrão no dia seguinte ao de ela ser escrita. Recebem uma seta cada,
pela cláusula de posição acima: `<IconeAnterior />Anterior` e
`Próxima<IconeProxima />`.

A alternativa — declarar paginação uma exceção inteira à regra 2, por ser
navegação e não ação — foi considerada e recusada: a exceção que se justifica
é a da *posição* do ícone, não a da presença dele. Nenhuma mudança no `Botao`
é necessária; ele já é `inline-flex` com `gap-2`, então a ordem dos filhos
decide o lado.

Ícones novos no `web/ui`, no mesmo traço dos existentes (contorno 2px, viewBox
24, sem preenchimento): `IconeChave` (trocar senha), `IconeSair`,
`IconeAnterior` e `IconeProxima`.

## §4 — Trocar senha vira modal

Hoje é a rota `/senha`, uma página dentro do `Layout`, com `Card` alinhado à
esquerda e o sucesso escrito como um parágrafo que fica na tela até a próxima
navegação.

Passa a ser um modal aberto pelo cabeçalho. Isso resolve os três pedidos de
uma vez, e dois deles deixam de existir em vez de serem implementados:

- **5a (centralizar)** — modal nasce centralizado; não há o que fazer.
- **5c (voltar para a tela anterior)** — não há para onde voltar, porque não
  se saiu de lugar nenhum. A tela por baixo continua exatamente como estava.
- **5b (tip de divergência)** — implementado, ver abaixo.

A rota `/senha` deixa de existir. Quem tiver o endereço salvo passa a receber
404; são três pessoas no time e o caminho novo está no cabeçalho de toda tela.

### O `Modal` do `web/ui` ganha duas props

```ts
carregando?: boolean;    // confirmar vira "Aguarde…" e desabilita
idFormulario?: string;   // confirmar vira type="submit" form={id}
```

- **`carregando`** existe porque hoje o `Modal` não tem estado de envio: quem
  clica duas vezes em Salvar dispara duas requisições. O `Botao` já sabe fazer
  isso (`carregando` desabilita e troca o texto); o `Modal` só não estava
  repassando.
- **`idFormulario`** existe porque os campos de um modal hoje vivem numa
  `<div>`, e **Enter não envia**. Com ele, os `children` podem ser um `<form
  id="...">` de verdade e o botão de confirmar vira o `submit` desse
  formulário. Enter passa a enviar, que é o que qualquer pessoa espera de um
  formulário de senha — e é o que gerenciador de senha espera também.

Nenhuma das duas muda o comportamento de quem não as passa — mas **a prop
sozinha não conserta nada**, porque quem decide passá-la é o chamador. O item
de duplo clique do ledger é do **modal de renomear taxonomia**, e
`renomear()` (`taxonomias/page.tsx:104-127`) não tem estado de envio algum:
dois cliques em Salvar são duas chamadas a `api.renomearTermo`. Então esta
rodada **também liga o `carregando` lá**, com um estado novo, e no modal de
excluir pelo mesmo motivo. É a diferença entre oferecer a guarda e usá-la.

Já o `idFormulario` fica só no modal de senha: o de renomear tem um campo, e
Enter nele é conveniência que ninguém reclamou. Adotar depois é uma linha.

### O componente

`web/admin/src/componentes/ModalTrocarSenha.tsx`, cliente, montado pelo
`Layout` (é de lá que o botão abre).

Três campos, todos obrigatórios pela regra do §2: Senha atual
(`autocomplete="current-password"`), Nova senha e Confirme a nova senha
(ambos `new-password`).

**O tip de divergência (5b) é ao vivo.** Com os dois campos preenchidos e
diferentes, a mensagem aparece embaixo do campo de confirmação enquanto se
digita — não espera o envio. A conferência no envio **continua existindo**:
ela é a que garante que duas senhas diferentes nunca saem para a rede, e o
comentário que já está em `senha/page.tsx:30` explica por quê. O tip é
conveniência; a guarda é a do envio.

**Erro do servidor cai no campo que o causou**, seguindo o precedente do 409
de taxonomia (`taxonomias/page.tsx:246-262`):

| Código | Campo |
|---|---|
| `senha_atual_incorreta` | Senha atual |
| `weak_password` | Nova senha |
| qualquer outro | linha de erro do modal, via `mensagemDe` |

**Sucesso é o toast que o resto do painel já usa** (`useToast`, provido em
`app/layout.tsx`): "Senha trocada." O modal fecha. Nada navega.

## §5 — Login

Duas mudanças, ambas pequenas:

1. O texto do rodapé passa de "Encerrar também a sessão do Access" para
   **"Encerrar sessão do Cloudflare Access"**. O "também" existia para marcar
   que sair do painel não sai do Access; essa explicação continua no
   comentário do código, que é onde ela ajuda quem mantém — na tela, ela pedia
   do operador um contexto que ele não tem.
2. O campo Senha adota a regra do §2.

## §6 — Cabeçalho

`Layout.tsx` hoje tem "Trocar senha" como `<Link>` de texto puro e "Sair" como
`Botao` sem ícone — os dois únicos controles do painel fora do padrão do §3.

- **Trocar senha** vira `Botao variante="secundario"` com `IconeChave`, e
  abre o modal do §4 em vez de navegar.
- **Sair** ganha `IconeSair`.
- O `md:gap-x-6` do ledger entra aqui, restaurando os 24px que um fix de
  responsividade derrubou para 16px sem intenção.

Cuidado de layout que a mudança introduz: dois botões com texto ocupam mais
espaço que um link e um botão. O cabeçalho já usa `flex-wrap` justamente para
não depender de uma soma de larguras caber num viewport específico, e o
comentário em `Layout.tsx:45-52` explica a construção. A verificação em 375px
de largura é critério de pronto (§9), não observação.

## §7 — O ledger: os dez itens

Da lista de
[`plans/2026-08-07-painel-follow-ups.md`](../plans/2026-08-07-painel-follow-ups.md),
reconferida contra o código.

**Sobras da separação do login (3):**

1. `web/admin/e2e/login.spec.ts` — dois casos usam `toContainText` onde
   `toBeVisible` é mais estrito. `toContainText` passa em elemento presente
   porém oculto.
2. Três lugares dizem "cinco checagens" e hoje são seis
   (`specs/2026-08-18-login-admin-design.md:196` e `:429`,
   `web/admin/src/lib/sessao.tsx:9`). A sexta compara o `iat` do token com o
   `updated_at` da credencial.
3. Linha de troubleshooting no runbook: o CLI carimba `updated_at` com o
   relógio da máquina de quem roda, o `iat` vem do relógio do Worker. Laptop
   adiantado em N segundos ⇒ por N segundos uma sessão recém-criada leva 401.

**Encostam nesta rodada (3):**

4. **Enunciado sem borda vermelha.** `CONTROLE_INVALIDO` se aplica a input e
   select; o Enunciado é o wrapper do TipTap, que não usa `CONTROLE`. A
   correção é uma prop `invalido` no `Editor`, aplicada ao wrapper de
   `Editor.tsx:81`. É a mesma classe de defeito que o §2 corrige nas outras
   telas, num componente que a regra sozinha não alcança.
5. **Duplo clique no Salvar do modal de renomear taxonomia** — a prop
   `carregando` do §4 mais o estado de envio em `taxonomias/page.tsx`, que
   hoje não existe. Vale também para o modal de excluir.
6. **`md:gap-x-6` do cabeçalho** — resolvido no §6.

**Independentes (4):**

7. `Usuario.role` e `Usuario.tier` são `string` no cliente, enquanto a API tem
   união literal. Vira união. Não é furo de segurança — o controle real é o
   `requireSessaoAdmin` no Worker, e um typo ali falha fechada —, é dívida de
   tipos com custo de DX, e o sub-projeto 4 vai consumir o mesmo cliente.
8. Aviso do `next/image` no console sobre proporção do logo, apesar do
   `w-auto`.
9. O recuo de paginação dispara um GET a mais e um "Carregando…" piscando, no
   caminho em que uma mutação encolhe o acervo abaixo da página atual.
10. `api/README.md` lista 11 códigos de erro; a API emite pelo menos 7 outros
    (`invalid_credentials`, `captcha_failed`, `missing_file`, `too_large`,
    `unsupported_type`, `unauthorized`, `forbidden`).

**Reclassificado, não implementado:**

- **Linha da `Tabela` alcançável por teclado.** Foi escolhido para esta
  rodada, e a releitura do código mudou a recomendação: **fechar como não é
  defeito**, em vez de implementar. A coluna Ações tem "Editar", que é um
  botão real, focável e anunciado — o teclado já tem caminho até a edição. Pôr
  `tabIndex` na linha acrescentaria **uma parada de tabulação por linha**, ou
  seja, até 50 paradas extras numa lista cheia, para chegar ao mesmo lugar que
  o botão já alcança. Seria acessibilidade pior, com aparência de melhor. Fica
  registrado no ledger como decidido, não como pendente.

**Registro novo, para a sessão dedicada:**

- **Auto-submit do Apple Passwords.** O que esta sessão apurou, para não ser
  reapurado: o comportamento existe desde o Safari 12.1 e é decisão do Safari,
  não do site; a Apple **não o documenta em lugar nenhum**; a documentação de
  Password AutoFill promete, para formulário partido em páginas, "tap and
  fill" — preencher, não enviar; o caminho de MFA é outro
  (`autocomplete="one-time-code"`), com auto-submit amplamente relatado, o que
  significa que existe pelo menos um caminho em que o Safari envia sem usuário
  nem senha na tela. As alavancas plausíveis e não testadas são: campo
  `autocomplete="username"` somente-leitura com o email do Access, `action` e
  `method` no `<form>` (hoje não há nenhum dos dois), e conferir se o
  preenchimento do Safari chega ao estado do React — este último é risco, não
  correção: se o auto-submit passar a funcionar e o `onChange` não disparar, o
  formulário envia senha vazia e a tela acusa "senha inválida" para uma senha
  correta.

## §8 — Testes

A suíte do painel é Playwright, e roda em chromium e WebKit. **As duas suítes
do repositório não rodam juntas** — o `wrangler dev` que o Playwright sobe
abre o mesmo SQLite do D1 local que o vitest do `api/` usa, e a disputa
derruba testes do painel com cara de defeito de produto. Em sequência.

| Arquivo | Mudança |
|---|---|
| `e2e/senha.spec.ts` | Reescrito para o modal: abre pelo cabeçalho, sem `page.goto("/senha")`. Os quatro casos atuais (senha atual errada, confirmação divergente, senha curta, troca bem-sucedida) continuam existindo, com as asserções apontando para o campo em vez do alerta genérico onde a regra do §4 mudou o destino |
| `e2e/senha.spec.ts` | **Caso novo:** o tip de divergência aparece enquanto digita, antes de qualquer clique em salvar |
| `e2e/login.spec.ts` | **Caso novo:** enviar com senha vazia mostra a mensagem do painel, e nenhuma requisição sai. `toContainText` → `toBeVisible` nos dois casos do ledger |
| `e2e/visual.spec.ts` | Passa a afirmar o sintoma (`padding-left` efetivo) em vez da causa (`appearance: none`). O WebKit na suíte é o que torna isso possível |

O caso novo de login vale por dois: ele é a prova de que o balão nativo saiu.
Com `required` no lugar, o navegador cancela o envio em silêncio e a mensagem
do painel nunca aparece — o teste falha antes da correção e passa depois, que
é a forma de saber que a regra do §2 está de fato valendo.

## §9 — Critérios de pronto

1. As duas regras (§2 e §3) estão escritas no `web/README.md`, que é o que o
   sub-projeto 4 vai ler.
2. Login e trocar senha não acionam validação nativa em nenhum campo, em
   chromium e WebKit.
3. Trocar senha abre e fecha como modal; sucesso é toast; a tela por baixo não
   muda.
4. Cabeçalho e paginação seguem a regra §3; conferido em 375px de largura.
5. Suíte e2e verde nos dois navegadores, com os casos novos.
6. `npm run typecheck` limpo nos dois workspaces do `web/`, incluindo o
   isolado do `web/ui`.
7. Os dez itens do §7 fechados ou, no caso da `Tabela`, registrados como
   decididos.

## §10 — Decisões, e o que foi recusado

- **Trocar senha como modal, não como página centralizada com modal de
  sucesso.** As duas alternativas exigiam uma variante de `Modal` com um botão
  só e, na versão com "voltar para a tela anterior", guardar de onde a pessoa
  veio — `router.back()` erra quando ela chegou pela URL. O modal apaga os dois
  problemas em vez de resolvê-los.
- **Marcar o obrigatório com asterisco, ou marcar o opcional no rótulo.**
  Recusados em favor de replicar o editor, que põe "Opcional" **abaixo** do
  campo. Decisão do dono.
- **Paginação como exceção inteira à regra dos botões.** Recusado. O que se
  aceitou, por pedido do dono na revisão do desenho, foi a exceção de
  **posição**: em ação direcional o ícone fica do lado para onde aponta. Virou
  cláusula da regra 2, e não caso particular da paginação, para valer no
  próximo par direcional que aparecer. Ver §3.
- **`tabIndex` na linha da tabela.** Recusado; ver §7.
- **Item 4 do pedido (auto-submit do Apple Passwords).** Retirado do escopo
  pelo dono depois da pesquisa, para sessão dedicada. O apurado fica no §7.
