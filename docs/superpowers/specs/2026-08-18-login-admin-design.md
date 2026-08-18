# Login do admin — design

> Separa a identidade administrativa da identidade do aluno. O admin deixa de
> ser uma linha de `users` com `role='admin'` e passa a ser a interseção de
> duas fontes que nenhum código de aplicação escreve: a allowlist
> `ADMIN_EMAILS` em `api/wrangler.jsonc` e uma senha criada por CLI.
>
> Fecha um furo agendado: hoje `/auth/set-password` está atrás do Cloudflare
> Access por acidente de roteamento, e o sub-projeto 4 desfaz esse acidente.
>
> Não altera o fluxo do aluno, exceto por remover `role` de `GET /auth/me`.
> Nenhum pacote novo.

## 1. O que motivou

Oito regras, dadas no brainstorm de 2026-08-18:

| # | Regra |
|---|---|
| 1 | O admin é cadastrado única e exclusivamente pela edição manual de `ADMIN_EMAILS` |
| 2 | Nenhum código concede acesso admin. Se algum concede, sai |
| 3 | Existe um CLI para criar a senha inicial |
| 4 | Admin não é usuário regular — os dois sistemas são separados |
| 5 | O admin tem tela e rota de login próprias |
| 6 | Troca de senha do admin só existe atrás do Access |
| 7 | Toda operação de admin usa o email do token do Access, e não aceita outro |
| 8 | Documentos e comentários de código passam a refletir isto |

A regra 4 foi **reescrita durante o brainstorm** e é a única que não vale como
foi enunciada. Ver §3.

## 2. O que está errado hoje

**Código concede admin.** `api/src/db/users.ts:53` grava
`role = adminEmails.includes(email) ? "admin" : "user"`. A allowlist é
consultada, mas quem escreve o papel é o webhook da Hotmart
(`webhooks/hotmart.ts:169`) e o cron de reconciliação
(`jobs/reconcile.ts:117`). Consequência documentada em
`runbook-deploy-producao.md:408` e `:748`: **o admin só nasce de uma compra**.

**Admin e aluno são a mesma entidade.** Mesma tabela `users`, mesma rota
`POST /auth/login`, mesmo cookie `session` com `Path=/`, mesmo
`POST /auth/recover` por email + CPF.

**O furo agendado.** Hoje `/auth/*` só existe em `admin.<domínio>`, hostname
que o Access cobre inteiro. `POST /auth/set-password` está protegido por
consequência da tabela de Worker Routes, não por decisão. Quando o
sub-projeto 4 subir `app.<domínio>/auth/*` — sem Access, como o webhook —, o
mesmo endpoint que define senha passa a estar exposto publicamente, e hoje ele
define a senha de qualquer conta, admin inclusive.

## 3. As decisões

**Admin é a interseção de duas fontes, nenhuma escrita por código.**

| Fonte | Onde mora | Quem escreve | O que prova |
|---|---|---|---|
| `ADMIN_EMAILS` | `api/wrangler.jsonc` | pessoa, à mão, + `npm run deploy` | que o email **pode** ser admin |
| tabela `admins` | D1 | o CLI, de um terminal com credencial da Cloudflare | que o email **tem senha** |

**A coluna `users.role` é dropada.** Some do banco a única coluna capaz de
conceder privilégio. Sem ela, `upsertUserFromPurchase` perde o parâmetro
`adminEmails` e nem o webhook nem o cron consultam a allowlist — a regra 2
deixa de depender de vigilância e passa a ser estrutural.

**A regra 4 vale numa direção só.** O enunciado original ("se um email está
definido como admin, ele nunca poderá ser aluno") foi trocado no brainstorm
pela separação de sistemas:

```
elis.viana@… compra o produto

  users.email = elis.viana@…        admins.email = elis.viana@…
  senha A (link mágico / recover)   senha B (CLI / painel, atrás do Access)
  app.<domínio>                     admin.<domínio>

  └─ nunca dá painel                └─ nunca dá conteúdo de aluno
```

O webhook trata email de admin como qualquer comprador: cria a conta, a
assinatura, manda o link mágico. Nada disso alcança o painel, porque o painel
não olha para `users`. A separação é de sistema, não de endereço de email — e
é ela que torna seguro deixar a mesma pessoa existir nos dois lados. O
`POST /auth/recover` por email + CPF continua existindo só do lado do aluno e
não tem caminho nenhum até `admins`, o que satisfaz a regra 6 por construção.

**As rotas de admin ficam sob `/admin/*`.** A Worker Route
`admin.<domínio>/admin/*` já existe e o Access cobre o hostname inteiro. O
login do admin fica inalcançável de `app.<domínio>` por construção: não existe
Worker Route que o case lá. A alternativa — manter em `/auth/*` com um
subcaminho — dependeria de uma expressão de rota escrita com cuidado no dia em
que o sub-projeto 4 subir, e é a mesma classe de fragilidade que
`runbook-deploy-producao.md:122` já rejeitou para o webhook.

## 4. Modelo de dados

```sql
CREATE TABLE admins (
  email         TEXT PRIMARY KEY,   -- normalizado, minúsculo
  password_hash TEXT NOT NULL,      -- pbkdf2$sha256$100000$<salt>$<hash>
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

Sem `id`: a chave natural é o email, que é o que o token do Access carrega, e
um id sintético só criaria um segundo jeito de referir a mesma pessoa. Sem
`name`: a topbar passa a mostrar o email vindo do Access, o que deixa a regra 7
visível na tela. Sem `role`: a tabela inteira é o papel.

`users` perde a coluna `role`. `Entitlement` perde o campo `role`, e
`GET /auth/me` para de devolvê-lo — mudança de contrato que o sub-projeto 4
herda já correta.

Módulo novo `api/src/db/admins.ts`: `findAdmin(db, email)`,
`upsertAdmin(db, email, passwordHash)`, `deleteAdmin(db, email)`.

## 5. A invariante do email

**O email do admin nunca entra por corpo, query string ou header de
aplicação.** Existe uma função única que o extrai do JWT verificado do Access,
e toda feature presente ou futura passa por ela:

```ts
// api/src/middleware/access.ts
export function emailDoAccess(c): string
```

`requireAccess` continua verificando assinatura, `iss` e `aud` contra o JWKS
cacheado, e passa a gravar o email do payload numa variável de contexto que
`emailDoAccess` lê. Em desenvolvimento não há JWT, então `ACCESS_DEV_BYPASS=true`
faz a função devolver `ACCESS_DEV_EMAIL`, do `.dev.vars` — e **fail-closed**:
bypass ligado sem esse email devolve 401, em vez de cair numa string vazia que
casaria com uma allowlist vazia.

Isto inverte o comentário de `middleware/access.ts:9-13`, que hoje afirma o
oposto ("o email deste JWT NÃO identifica o usuário"). A afirmação fazia
sentido quando a identidade da aplicação era uma linha de `users` com senha
própria; com `admins` chaveada por email, manter as duas identidades soltas
significaria permitir que quem passou pelo Access como uma pessoa entrasse no
painel como outra. Continuam sendo dois fatores independentes — IdP com MFA e
senha —, agora amarrados ao mesmo email.

Um teste dedicado exercita a invariante: uma requisição que manda `email` no
corpo de qualquer rota de admin não muda o resultado.

## 6. Superfície da API

```
app.use("/admin/*", requireAccess)                    ← camada 1

GET  /admin/auth/contexto  → { email, ehAdmin, temSenha }    Access
POST /admin/auth/login     { senha }                         Access
POST /admin/auth/logout                                      Access
GET  /admin/auth/me        → { email }                       Access + sessão
POST /admin/auth/senha     { senhaAtual, nova }              Access + sessão

app.use("/admin/{taxonomy,questions,media}/*", requireSessaoAdmin)
```

`middleware/rbac.ts` é substituído por `middleware/adminSession.ts`, exportando
`requireSessaoAdmin`, que confere **cinco** coisas a cada requisição:

1. cookie `sessao_admin` presente;
2. JWT válido, com `typ: "admin"`;
3. `sub` igual a `emailDoAccess(c)`;
4. email ∈ `ADMIN_EMAILS`;
5. linha correspondente em `admins`.

Tirar um email de `ADMIN_EMAILS` e publicar, ou apagar a linha, derruba a
sessão viva na requisição seguinte — sem lista de revogação. É o mesmo
princípio de `loadEntitlement`, que já derivava o tier a cada request em vez de
carregá-lo no JWT.

`POST /admin/auth/login` recebe só a senha e roda as mesmas cinco checagens
de `requireSessaoAdmin`, menos as duas de sessão: email do Access ∈
`ADMIN_EMAILS`, linha em `admins`, senha confere. Só então emite o cookie.

Ele **não** tem hash descartável no caminho do erro,
diferente de `auth.ts:74`. Lá o `DUMMY_HASH` existe para o tempo de resposta
não virar oráculo de existência de conta; aqui quem chama já passou pelo IdP,
o email é o dele, e `/admin/auth/contexto` informa `temSenha` de propósito.
Não há o que enumerar. O comentário no código diz isso, para ninguém "consertar"
a ausência depois.

**Turnstile sai do login do admin.** O captcha barra bot anônimo, e nenhum bot
anônimo alcança um hostname que exige login no Google ou GitHub com MFA. É o
mesmo raciocínio que `runbook-deploy-producao.md:695` já usa para deixar
`admin.` fora da única regra de rate limiting do plano Free. O PBKDF2 de 100
mil iterações continua. O login do aluno mantém o Turnstile intacto.

**Senha mínima de 12 caracteres para admin**, contra os 8 do aluno
(`MIN_PASSWORD_LENGTH`, recomendação NIST). São três pessoas e a senha é
digitada raramente; exigir mais custa zero.

## 7. Sessão do painel

Cookie **`sessao_admin`** — nome próprio, não `session` —, `HttpOnly; Secure;
SameSite=Lax; Path=/`, validade **12 horas**. Os cookies já são host-only, então
`admin.` e `app.` nunca trocam cookie em produção; o nome distinto resolve o
caso de desenvolvimento, onde os dois frontends dividem `localhost`.

Payload `{ sub: <email>, typ: "admin", exp }`, assinado com o `JWT_SECRET`
existente. `signAdminSession` / `verifyAdminSession` entram em `lib/jwt.ts` ao
lado das funções do aluno. O `typ` é o que impede um token de sessão de aluno
de ser aceito no painel e vice-versa; um `ADMIN_JWT_SECRET` separado seria mais
um segredo para rotacionar sem ganho, já que a checagem `sub === emailDoAccess(c)`
barra o cenário sozinha.

Doze horas contra os sete dias do aluno: sessão de painel administrativo não
deveria sobreviver a um fim de semana, e o custo de reentrar é digitar a senha.

**`Sair` encerra só a sessão do painel.** A sessão do Access é outra coisa e
continua viva — a tela de login diz isso e oferece o link
`/cdn-cgi/access/logout` para quem quiser encerrar as duas. Encerrar as duas
automaticamente seria deslogar a pessoa do team domain inteiro a cada clique em
"Sair", o que é surpreendente demais para o comportamento padrão.

## 8. O CLI de senha

`api/scripts/senha-admin.mjs`, rodado como `npm run admin:senha -- <email>`,
com `--local` para o D1 de desenvolvimento e `--remover` para apagar a linha.
Node puro mais o `wrangler` que já está no projeto: **nenhum pacote novo**,
conforme `~/.claude/CLAUDE.md` §5.

```
1. Lê ADMIN_EMAILS de api/wrangler.jsonc e recusa email fora da lista
2. Pede a senha duas vezes, com eco desligado (node:readline)
3. Exige 12 caracteres
4. PBKDF2-SHA256, 100k iterações, mesmo formato de lib/password.ts
5. Escreve o SQL num arquivo temporário 0600 e chama
   npx wrangler d1 execute mais-aprovacao-db --remote --file <tmp>
6. Apaga o temporário num finally
```

O passo 5 usa `--file` em vez de `--command` porque `--command` deixaria o hash
visível em `ps` para qualquer processo da máquina e no histórico do shell.

O passo 1 é **conveniência, não fronteira** — a fronteira é `requireSessaoAdmin`
conferindo `ADMIN_EMAILS` a cada requisição. Por isso o script pode extrair a
lista com um regex na linha do `ADMIN_EMAILS` e recusar se não encontrar, sem
precisar de um parser de JSONC (que seria pacote novo).

O SQL é `INSERT … ON CONFLICT(email) DO UPDATE`, então o mesmo comando cria e
rotaciona.

## 9. A tela

`/login` deixa de ser um formulário fixo e passa a ter três estados, decididos
por `GET /admin/auth/contexto`:

| `ehAdmin` | `temSenha` | O que aparece |
|---|---|---|
| `false` | — | "Você entrou pelo Access como `X`, mas este email não é administrador." Sem campo de senha. |
| `true` | `false` | "Este email ainda não tem senha definida. Peça a criação pelo CLI." Sem campo de senha. |
| `true` | `true` | Email como texto, campo de senha, botão Entrar. |

A primeira linha substitui o `?motivo=forbidden` de hoje
(`login/page.tsx:33-38`), que mandava a pessoa de volta a um formulário limpo
para ser expulsa de novo. O parâmetro some.

A topbar mostra o email do token do Access e ganha **Trocar senha** — senha
atual, nova, confirmação —, exigindo a senha atual. Access, sessão e senha
atual são três provas; sem a terceira, uma sessão aberta numa máquina
destravada vira sequestro permanente da conta.

`useSessao` passa a chamar `/admin/auth/me`. O Turnstile sai do painel, junto
com `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e o `<Script>` da Cloudflare.

**Expiração do Access precisa de tratamento no cliente.** Quando a sessão do
Access expira com o painel aberto, as requisições recebem **302 para o IdP**,
não 401 — e um `fetch` cross-origin para o team domain morre como erro de rede,
sem status. `lib/api.ts` ganha um ponto único: falha de rede em `/admin/*`
vira `location.reload()`, que transforma o caso numa navegação de topo que o
Access consegue redirecionar.

## 10. Configuração do Cloudflare Access

Entregável de "pronto", não código. **Zero Trust → Access controls →
Applications →** aplicação de `admin.maisaprovacao.com.br` **→ Configure**:

| Campo | Valor | Por quê |
|---|---|---|
| **Session Duration** | 24 horas (padrão) | O Worker revalida o JWT a cada requisição; o que limita o estrago de um token roubado é a revalidação, não a validade. Com a sessão do painel em 12h, dá no máximo duas digitações de senha e uma ida ao IdP por dia. |
| **HTTP Only** | ON (padrão) | Nada lê o `CF_Authorization` por JavaScript — o Worker lê o header `Cf-Access-Jwt-Assertion`. |
| **SameSite Attribute** | Lax | `Strict` causa `ERR_TOO_MANY_REDIRECTS`, pela própria documentação. |
| **Eager redirect cookie** | ON (padrão) | Só afeta aplicação multi-domínio; aqui há um hostname só e a cadeia de redirects tem comprimento um. Não mexer. |
| **Enable Binding Cookie** | **ON** ← única mudança | Emite o `CF_Binding`, que amarra o `CF_Authorization` àquele navegador: cookie roubado não é reutilizável. As exceções documentadas — SSH/RDP, Zaraz, cliente WARP — não se aplicam. |

**401 Response for Service Auth policies**: irrelevante, não usamos service
tokens. **Global session duration** (Access settings): deixar como está, porque
a hierarquia é global > aplicação > política e mexer no global afetaria
qualquer aplicação futura.

Duas invariantes operacionais que entram no runbook:

> **A política do Access e o `ADMIN_EMAILS` são listas separadas e precisam ser
> mantidas em sincronia.** A política é o portão externo (quem alcança o
> hostname); o `ADMIN_EMAILS` é o interno (quem é admin). Email só na política
> vê a tela dizendo que não é administrador; email só no `ADMIN_EMAILS` não
> chega nem lá.

> **Não adicionar hostname a esta aplicação Access.** Ela cobre `admin.` e só.
> Incluir `app.` quebraria o webhook da Hotmart, que precisa ser alcançável sem
> identidade; incluir muitos faria a cadeia do *Eager redirect cookie* virar
> loop de login.

Nota de rodapé para o runbook, para ninguém confundir com cookie nosso ao ler
um `wrangler tail`: o Access também emite `CF_Session` (CSRF no team domain,
4h), `CF_AppSession` (CSRF por aplicação, 24h) e `CF_Device` (anti-abuso de
PIN e MFA, 30 dias).

Conferência depois de publicar: (1) janela anônima → autenticar no IdP → a tela
de login mostra o email certo; (2) uma identidade que está no Access mas fora
do `ADMIN_EMAILS` vê a mensagem de "não é administrador"; (3) apagar a linha de
`admins` derruba a sessão na requisição seguinte.

## 11. Migração e dados existentes

**Duas migrações, não uma.** A criação de `admins` é aditiva; o `DROP COLUMN`
de `users.role` é destrutivo, e o Worker que está em produção agora seleciona
essa coluna por nome (o Drizzle lista as colunas do schema, não usa `SELECT *`).
Dropá-la antes de publicar o Worker novo derrubaria o **login do aluno** pelos
minutos entre um passo e outro. Separadas, a janela deixa de existir:

| Migração | Conteúdo | Quando aplicar |
|---|---|---|
| `000X_admins` | `CREATE TABLE admins` | antes do deploy do Worker |
| `000Y_users_sem_role` | `ALTER TABLE users DROP COLUMN role` | depois, quando nenhum código a lê |

Ordem de publicação:

1. `npm run db:generate` gera as duas; aplicar **só a primeira** em produção
   com `npx wrangler d1 migrations apply mais-aprovacao-db --remote`. O
   `wrangler deploy` não aplica migração — é passo separado, como já registra
   `runbook-deploy-producao.md:504`;
2. `npm run deploy` do Worker (rotas, middleware, sem leitura de `role`);
3. `npm run admin:senha -- <email>` para cada um dos três emails — depende da
   tabela criada no passo 1;
4. deploy do Pages com o painel novo;
5. aplicar a segunda migração, que dropa a coluna já órfã;
6. ajustes do Access da §10 e a conferência da mesma seção.

Entre 2 e 4 o painel publicado chama rotas que deixaram de existir. A janela é
de minutos e o painel não tem usuário fora das três pessoas; inverter 2 e 4
seria o mesmo erro com mais tempo de exposição, porque o painel novo ficaria
falando com um Worker antigo.

A linha de produção de `dudu@zava.dev.br`, nascida da compra de teste no
sandbox, **fica** — pela regra 4 reescrita ela é uma conta de aluno legítima, e
o painel não olha mais para lá.

## 12. Testes

| Camada | O que entra |
|---|---|
| `api/test/admins.test.ts` | novo módulo de banco |
| `api/test/admin-auth.test.ts` | contexto nos três estados, login certo e errado, troca de senha, senha curta, senha atual errada |
| `api/test/admin-auth-invariante.test.ts` | email no corpo não muda resultado nenhum |
| `api/test/access.test.ts` | `emailDoAccess`; bypass sem `ACCESS_DEV_EMAIL` devolve 401 |
| `api/test/admin-guards.test.ts` | as cinco checagens de `requireSessaoAdmin`, uma a uma |
| `api/test/users.test.ts`, `webhook-purchase.test.ts`, `reconcile.test.ts` | poda de `role` |
| `web/admin/e2e/login.spec.ts` | reescrito para os três estados, sem campo de email |
| `web/admin/e2e/senha.spec.ts` | troca de senha |
| `web/admin/e2e/entrar.ts`, `seed.mjs`, `credenciais.mjs` | helper sem email; seed semeia `admins` |

`api/vitest.config.ts` e `.dev.vars` ganham `ACCESS_DEV_EMAIL`.

## 13. Documentação (regra 8)

**Vivos, precisam ficar corretos:**

| Arquivo | O que muda |
|---|---|
| `docs/especificacao-tecnica.md:318` | "nunca concede `role='admin'`" — não existe mais `role` |
| `docs/runbook-deploy-producao.md` | tabela `:408`, checklist `:455`, fase 11 inteira (`:733-765`), tabela de rotas `:554`, subseção nova do Access (§10), nota do rate limiting `:695` |
| `docs/runbook-verificacao-hotmart.md:266` | admin não nasce mais de compra |
| `api/README.md:48,69` | `ADMIN_EMAILS`, `ACCESS_DEV_EMAIL`, o script novo |
| `web/README.md` | Segurança, setup, saída do Turnstile do painel |
| `docs/proxima-fase-pendencias.md` | estado |

**Comentários de código que hoje afirmam o contrário do que será construído:**
`api/src/middleware/access.ts:9-13`, `api/src/app.ts:28-36`,
`api/src/db/users.ts:39`, `web/admin/src/lib/sessao.tsx:8`.

**Históricos, que não serão reescritos:** `docs/superpowers/plans/*` e as specs
anteriores. São registro do que foi decidido quando, e falsificá-los apaga o
rastro. `specs/2026-07-06-fundacao-auth-design.md` recebe um aviso de uma linha
no topo apontando para esta spec.

## 14. O que este design não faz

- **Não muda o login do aluno.** Turnstile, `/auth/recover` por email + CPF,
  cooldown, link mágico e cookie `session` de 7 dias ficam como estão. A única
  mudança visível é `role` sair de `GET /auth/me`.
- **Não cria gestão de admins pela interface.** Sem tela de convite, sem lista
  de administradores, sem papéis intermediários. Cadastro é editar
  `wrangler.jsonc` e rodar o CLI, como pede a regra 1.
- **Não cria recuperação de senha de admin por email.** Esquecer a senha se
  resolve por CLI, de um terminal com credencial da Cloudflare.
- **Não toca no webhook nem na reconciliação**, além de remover o parâmetro
  `adminEmails`, que deixa de existir.
- **Não gasta a regra de rate limiting no `admin.`**, pelo motivo já escrito no
  runbook.
