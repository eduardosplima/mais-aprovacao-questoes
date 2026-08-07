# Painel administrativo — follow-ups conhecidos

> Itens levantados durante a execução de `2026-08-04-admin-painel.md` e na
> revisão final da branch `feat/admin-painel`, **triados como não-bloqueantes
> para o merge**. Nenhum é defeito no caminho feliz; todos são polimento,
> lacuna de cobertura ou dívida de empacotamento.
>
> Registrado aqui porque o ledger de execução vive em diretório git-ignored, e
> parte desta lista importa para os sub-projetos 3 e 4.

## Empacotamento do `web/ui` — importa para o sub-projeto 4

O design system é a entrega declarada deste sub-projeto ao frontend do aluno
(critério de pronto nº 5). Ele está arquiteturalmente isolado — nenhum arquivo
importa de `next`, de `@/` ou de `web/admin`, e o `typecheck` isolado prova
isso —, mas o empacotamento tem duas arestas:

| Item | Efeito se ignorado |
|---|---|
| O `@source "../../../ui/src"` do `globals.css` é a única via em que o `admin` alcança o `ui` por caminho de arquivo, e é obrigatória porque o Tailwind v4 não varre pacote irmão | Um consumidor que importe só `@mais/ui/tokens.css` recebe os tokens e **nenhuma classe de componente**. O `Botao` renderiza sem estilo, em silêncio, sem erro de build. Documentado no `web/README.md` |
| `Bot` (botão-ícone da barra de ferramentas) está duplicado entre `BarraFerramentas.tsx` e `UploadImagem.tsx` | Se botão-ícone pertence a algum lugar, é ao design system. Duplicação de ~8 classes |

## Acessibilidade

| Item | Efeito |
|---|---|
| A linha da `Tabela` responde só a mouse (`onClick` em `<tr>`/`<li>`, sem `tabIndex` nem `role`) | Mitigado: a coluna Ações agora tem "Editar", então o teclado tem caminho. A linha continua sendo atalho de mouse |
| Um 409 ao renomear taxonomia aparece como toast enquanto o modal segue aberto, em vez de inline no campo | O toast fica acima do overlay e é visível, mas é fácil de não notar. Junto disso: falta guarda de duplo clique no botão Salvar do modal |

## Qualidade de erro no editor

Toda rejeição do Zod colapsa em `invalid_request` → "Confira os campos — algum
valor está fora do formato esperado.", sem destacar campo nenhum. O caso
concreto: colar `youtube.com/watch?v=abc` sem esquema é recusado pelo servidor
(`isHttpUrl` exige http/https) e o operador recebe essa frase genérica
espalhada por quatro Cards.

Isso também enfraquece o teste que assere exatamente essa string: ele passaria
se a validação de `videoUrl` fosse removida e outro campo estivesse inválido.

Relacionado: o preview renderiza o link de vídeo sem checar o esquema, então
mostra como link funcional algo que o servidor recusará ao salvar.

E `SeletorTaxonomia` engole falha de carga (`.catch(() => setTermos([]))`) —
um select vazio sem explicação, seguido da mensagem genérica acima ao salvar.

## Tipos

`Usuario.role` e `Usuario.tier` são `string` no cliente, enquanto a API tem
união literal (`"admin" | "user"`, `"assinante" | "gratuito"`). O
`sessao.tsx` faz `u.role !== "admin"` — exatamente a comparação que uma união
protegeria de um typo.

## Cosmético

- O `next/image` avisa no console sobre proporção do logo, apesar do `w-auto`.
- O gap do cabeçalho no desktop caiu de 24px para 16px sem intenção, num fix
  de responsividade; um `md:gap-x-6` restaura.
- `LETRAS = "ABCDEFGHIJ"` duplicado entre `Preview.tsx` e
  `ListaAlternativas.tsx`. Não podem divergir (mesmo `MAX = 10`).
- O recuo de paginação dispara um GET a mais e um "Carregando…" piscando, só
  no caminho raro em que uma mutação encolhe o acervo abaixo da página atual.

## Fora do escopo deste plano, mas aberto no `api/`

A auditoria do `api/` reporta dois achados que **não** vieram deste trabalho e
que este plano não tocou:

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
