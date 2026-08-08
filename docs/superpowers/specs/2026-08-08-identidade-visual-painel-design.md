# Identidade visual do painel — design

> Sub-projeto 2, passada de acerto visual. Alinha o painel administrativo ao
> `docs/demo.html`, que é a referência de identidade do produto, e conserta
> quatro defeitos encontrados na inspeção manual de 2026-08-07.
>
> Não altera a API. Nenhum pacote novo.

## 1. Objetivo

Seis itens levantados na inspeção manual:

| # | Item |
|---|---|
| 1 | Ícones de taxonomia do `demo.html` nas combos e nas abas de `/taxonomias` |
| 2 | Ícone de inserção nos botões "Adicionar" e "Nova questão" |
| 3 | Ações de linha viram ícone com o rótulo como tooltip |
| 4 | Salvar com pendência não indica quais campos estão errados |
| 5 | O botão "Editar" da lista tem altura e corpo de texto diferentes dos vizinhos |
| 6 | A coluna Nome não está centralizada verticalmente na linha |

## 2. Restrições que moldaram o design

**Não é possível colocar um SVG dentro de um `<select>`.** O
`SeletorTaxonomia` usa select nativo, e manter o nativo importa: navegação por
teclado e o seletor de roda do iOS. O ícone vai sobreposto ao controle, não
dentro dele (§5).

**Nenhum pacote de ícones.** A política do `~/.claude/CLAUDE.md` §5 exige
aprovação e cooldown de 14 dias para qualquer dependência nova. Os cinco
ícones de taxonomia já existem desenhados no `demo.html`; os de ação são
escritos no mesmo traço. Custo: zero pacotes, zero transitivas.

**Os e2e casam pelo nome acessível.** `getByRole("button", { name })` lê o
nome acessível, não o texto visível. Preservando o `aria-label` igual ao
rótulo de hoje, um botão que vira ícone continua sendo encontrado pelo mesmo
seletor.

## 3. `ui/src/Icone.tsx` — conjunto de ícones

Módulo único. Cada ícone é um componente sem estado que herda cor
(`stroke="currentColor"`) e tamanho de quem o usa. Traço do `demo.html`:
`viewBox="0 0 24 24"`, `fill="none"`, `stroke-width="2"`, pontas arredondadas.

| Nome | Desenho | Origem |
|---|---|---|
| `IconeAssunto` | documento | `demo.html:278` |
| `IconeBanca` | instituição de colunas | `demo.html:282` |
| `IconeAno` | calendário | `demo.html:286` |
| `IconeCargo` | maleta | `demo.html:290` |
| `IconeNivel` | barras crescentes | `demo.html:294` |
| `IconeSituacao` | alvo concêntrico | `demo.html:390` |
| `IconeTipo` | lista | novo |
| `IconeEditar` | lápis | novo |
| `IconeExcluir` | lixeira | novo |
| `IconePublicar` | olho | novo |
| `IconeDespublicar` | olho cortado | novo |
| `IconePreview` | monitor | novo |
| `IconeAdicionar` | `+` | novo |
| `IconeSalvar` | disquete | novo |
| `IconeCancelar` | `✕` | novo |

Duas escolhas de metáfora, decididas com o autor:

- **`+` sem círculo** para toda inserção. Num botão texto+ícone o círculo
  compete com a borda do próprio botão. O mesmo sinal serve "Adicionar",
  "Nova questão" e "Adicionar alternativa": inserção vira um símbolo só na
  interface inteira.
- **Olho / olho cortado** para publicar e despublicar. O que muda ao publicar
  é a questão ficar visível para o aluno, e visibilidade é a metáfora que o
  operador já tem. Uma seta seria ambígua com "Salvar".

## 4. `ui/src/Botao.tsx` — ganha `BotaoIcone`

`BotaoIcone` fica no mesmo arquivo que `Botao` e reusa o mapa de variantes.
Um arquivo, dois exports, nenhuma indireção nova.

```
BotaoIcone({ icone, rotulo, variante, href, ...resto })
```

- `title={rotulo}` — o tooltip.
- `aria-label={rotulo}` — o nome acessível; é o que leitor de tela e Playwright
  enxergam.
- `href` opcional: com ele renderiza `Link` do Next estilizado igual; sem ele,
  `button`.
- Quadrado fixo em `h-9 w-9` (36px), mesmas variantes `secundario` / `perigo`.

O tamanho é fixo de propósito: é o que impede o item 5 de voltar por outro
ponto de chamada. Consequência a registrar: o botão de remover alternativa cai
de 40px para 36px — segue centrado contra um input de 50px, então o
alinhamento não muda.

O `href` existe por causa do item 5 (§6).

## 5. Ícone dentro do controle

Novo `ui/src/Controle.tsx`: wrapper `relative`, ícone `absolute` à esquerda
com `pointer-events-none` e `text-roxo`, controle com `pl-11`. Visualmente
idêntico ao `.select` do demo; funcionalmente ainda um select nativo.

Recebe o ícone e devolve o controle envolvido. Consumidores:
`SeletorTaxonomia` (as quatro taxonomias), e os campos Situação, Tipo e Ano.

Cobertura decidida com o autor: **todo campo de escolha ganha ícone**,
inclusive Situação e Tipo, que não têm correspondente no demo. Um campo careca
no meio de quatro com ícone lê como defeito, não como intenção.

As abas de `/taxonomias` (`taxonomias/page.tsx:140-160`) recebem o mesmo ícone
da taxonomia correspondente, à esquerda do rótulo.

## 6. Item 5 — a causa é conflito de classes do Tailwind

`Botao` define `h-[46px]` e `text-[14.5px]` no BASE (`Botao.tsx:6`), e cinco
chamadas passam `className="h-9 px-3 text-[13px]"` para encolher. **Tailwind
não garante que o override vença**: quem ganha é a ordem de geração no CSS,
não a ordem na string de classes. O "Editar" divergiu porque é um `<Link>`
com o estilo copiado à mão (`page.tsx:177`), fora dessa disputa.

Os seis pontos e o destino de cada um:

| Ponto | Ação | Vira |
|---|---|---|
| `app/page.tsx:177` | Editar (Link à mão) | `BotaoIcone` com `href` |
| `app/page.tsx:183` | Publicar / Despublicar | `BotaoIcone` |
| `app/page.tsx:190` | Excluir | `BotaoIcone` |
| `app/taxonomias/page.tsx:114` | Renomear | `BotaoIcone` |
| `app/taxonomias/page.tsx:125` | Excluir | `BotaoIcone` |
| `componentes/ListaAlternativas.tsx:94` | Remover alternativa | `BotaoIcone` |

Como os seis viram `BotaoIcone`, **nenhum ponto de chamada sobra sobrescrevendo
o tamanho do `Botao`** — o conflito desaparece por remoção. Não se adiciona
prop de tamanho: ela não teria consumidor.

## 7. Item 3 — o que vira ícone e o que não vira

Decidido com o autor:

- **Ações de linha da tabela** → ícone puro com tooltip. É onde o ganho de
  espaço existe e onde a repetição torna o ícone legível.
- **Rodapé dos formulários** (Salvar, Publicar, Cancelar, Pré-visualizar) e
  botões de inserção → **texto + ícone**, no padrão do "Adicionar".

Alcance de "rodapé dos formulários": o editor de questão e o formulário de
adicionar termo. A tela de login (`app/login/page.tsx`) e os botões de
confirmação do `Modal` ficam **como estão** — são fluxos de uma decisão só,
onde o ícone não acrescenta leitura.

Os `aria-label` preservam exatamente os rótulos de hoje — `"Excluir"` na lista
de questões, `"Renomear Cespe"` / `"Excluir Cebraspe"` nas taxonomias — para
não quebrar os seletores dos e2e.

## 8. Item 4 — validação no cliente

A API responde apenas `{ error: "invalid_request" }`, sem indicar campo
(`api/src/routes/admin/questions.ts:182`). Decidido com o autor: a informação
por campo passa a existir **no cliente**, antes do envio. A API não muda.

Função `validar(estado)` no editor, devolvendo `Record<campo, string>`:

| Campo | Regra |
|---|---|
| Enunciado | não vazio |
| Assunto, Banca | obrigatórios |
| Ano | entre 1900 e 2200, quando preenchido |
| Alternativas | toda alternativa com texto; exatamente uma correta |
| Vídeo do gabarito | começa com `http://` ou `https://`, quando preenchido |

Três indicadores, porque o formulário é mais alto que a tela e um só não
alcança:

1. **Resumo no topo** com os campos em falta; cada item foca o campo ao clique.
2. **Borda vermelha e mensagem** sob o controle, pelo `erro` que o `Campo` já
   aceita (`Campo.tsx:29`). `Campo.tsx` passa a exportar `CONTROLE_INVALIDO`
   ao lado do `CONTROLE` existente — uma segunda string de classes que o ponto
   de chamada concatena quando o campo tem erro, no mesmo idioma do `CONTROLE`
   de hoje. Mais `aria-invalid` no controle.
3. **Rolagem até o primeiro erro** ao tentar salvar.

`ListaAlternativas` recebe uma prop `erros` para marcar a alternativa
específica.

A API continua sendo a autoridade: o que ela recusar e o cliente não previu
cai na mensagem genérica de hoje, inalterada. O custo assumido é regra
duplicada entre cliente e servidor, mitigado por o cliente cobrir só o
subconjunto que ele sabe apontar — não o schema inteiro.

## 9. Item 6

`Tabela.tsx:53` usa `align-top`. Passa a `align-middle`, valendo para as duas
tabelas. Uma linha.

## 10. Testes

**Existentes.** Os cinco specs em `web/admin/e2e/` casam por nome acessível.
Cada um é conferido de fato, não presumido — em especial
`lista.spec.ts:139`, que busca `name: "Excluir"` sem qualificador, e
`taxonomias.spec.ts:27/35`, que buscam `"Renomear Cespe"` e
`"Excluir Cebraspe"`.

**Novo.** Um spec do item 4: com Assunto vazio, tentar publicar → o resumo
aparece, o campo fica marcado e nenhuma requisição sai.

**Verificação.** `npm run typecheck` nos dois workspaces e `npm test` no
`web/` precisam passar. O `api/` não é tocado.

## 11. Fora de escopo

- O `Bot` duplicado entre `BarraFerramentas.tsx` e `UploadImagem.tsx`
  (registrado em `plans/2026-08-07-painel-follow-ups.md`). Ele tem semântica
  de alternância (`aria-pressed`) que o botão de ação não tem; fundir os dois
  agora seria abstrair por semelhança de aparência, não de função.
- `LETRAS` duplicado entre `Preview.tsx` e `ListaAlternativas.tsx`.
- Os demais itens do doc de follow-ups.
