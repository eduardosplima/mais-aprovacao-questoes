# Runbook — provisionamento e deploy de produção

> Passo a passo para configurar Cloudflare e Hotmart e publicar o que está
> construído: a **API** (fundação de autenticação + webhook + reconciliação +
> rotas do painel) e o **painel administrativo**.
>
> A ordem importa. Cada fase produz um valor que a fase seguinte consome — o
> `aud` do Access só existe depois da aplicação criada, o `database_id` só
> depois do D1, e a Hotmart só consegue entregar webhook depois do Worker
> publicado. Seguir de cima para baixo.
>
> Complementa o [`runbook-verificacao-hotmart.md`](runbook-verificacao-hotmart.md),
> que é a **fase 12** deste aqui.

## Estado da execução — 2026-08-17

| Fase | Estado |
|---|---|
| 0. Registros DNS | ✅ |
| 1. D1 | ✅ `database_id` em `wrangler.jsonc` |
| 2. R2 | ✅ `media.maisaprovacao.com.br` |
| 3. Email Service | ✅ onboarding de `app.maisaprovacao.com.br` |
| 4. Turnstile | ✅ |
| 5. Zero Trust Access | ✅ `holy-rain-d92c.cloudflareaccess.com` + AUD |
| 6. `wrangler.jsonc` e segredos | 🟡 tudo preenchido **menos** `HOTMART_SUBSCRIPTION_UCODES` |
| 7. Migrar e publicar o Worker | ✅ |
| 8. Worker Routes | ✅ as três, vindas do arquivo |
| 9. Pages | ✅ |
| 10. Rate Limiting Rule | ✅ uma regra, o que o plano Free permite |
| 11. Hotmart (sandbox) e primeiro admin | 🟡 admin criado; **ucode não coletado** |
| 12. Runbook de verificação | 🟡 seções 1 e 2 iniciadas, [detalhe lá](runbook-verificacao-hotmart.md) |
| 13. Virar para produção | ⬜ em aberto, por decisão |

**O único item que atravessa fases é o ucode.** Ele é pedido na fase 11,
mora no `wrangler.jsonc` da fase 6 e é o que bloqueia a seção 7 (reconciliação)
da fase 12. Enquanto for `REPLACE_WITH_REAL_UCODES`, o cron roda todo dia às
3h, percorre a listagem inteira e não casa com nada.

## Leia isto antes de começar

Três coisas que este runbook descobriu e que mudam o que dá para prometer ao
final dele:

1. **O link mágico aponta para uma página que não existe.**
   `api/src/lib/email.ts:48` monta `${APP_BASE_URL}/definir-senha?token=…`, e o
   painel só tem `/login`, `/`, `/questoes/editar` e `/taxonomias`. A tela
   `/definir-senha` é do frontend do aluno (sub-projeto 4), que ainda não foi
   construído. **Consequência:** um comprador real recebe o email e cai num
   404. O fluxo compra → acesso não fecha com o que existe hoje; o que fecha é
   compra → conta criada no banco → email enviado.
   O painel administrativo, esse sim, funciona ponta a ponta — ele não usa link
   mágico, entra com senha (ver fase 11).

2. **Enviar email para o comprador depende de onboarding do domínio.** A
   documentação da Cloudflare é explícita: *antes* de onboarding do sending
   domain, o Worker só envia para endereços **verificados na conta**; *depois*,
   para qualquer destinatário. Sem essa etapa concluída, o provisionamento
   funciona no banco e falha no email — silenciosamente, do ponto de vista do
   comprador.

3. **Falta uma Worker Route para o webhook.** O `web/README.md` descreve duas
   rotas (`/admin/*` e `/auth/*`), mas o Worker também serve `/webhooks/hotmart`.
   Sem rota para ele, o caminho cai no Pages e a Hotmart recebe **404 em todo
   evento de compra**. Está coberto na fase 8.

---

## Topologia — leia antes de criar qualquer coisa

O domínio é `maisaprovacao.com.br`. São **três** hostnames, e o backend não é
nenhum deles.

```
admin.maisaprovacao.com.br     ← Access cobre o hostname inteiro
  /admin/*     → Worker   (dados do painel)
  /auth/*      → Worker   (login do painel)
  /*           → Pages    (as telas do painel)

app.maisaprovacao.com.br       ← sem Access
  /webhooks/*  → Worker   (Hotmart)
  /auth/*      → Worker   (login do aluno)      [sub-projeto 4]
  /*           → Pages    (front do aluno)      [sub-projeto 4]

media.maisaprovacao.com.br     ← sem Access
  bucket R2 público, hostname sem cookies
```

**Não existe `api.maisaprovacao.com.br`, e isso é decisão de projeto, não
esquecimento.** O Worker é montado *por cima* dos hostnames de frontend,
dividido por caminho. O painel chama caminho relativo e a chamada é
literalmente same-origin — está documentado no próprio código
(`web/admin/src/lib/api.ts:1-7`).

Dar hostname próprio ao backend quebraria três coisas de uma vez:

| O que quebra | Por quê |
|---|---|
| Cookie de sessão | O cliente usa `credentials: "same-origin"`, que não manda cookie para outra origem |
| Ausência de CORS | Passaria a exigir preflight, `Allow-Origin` e `Allow-Credentials` — middleware que o projeto não tem, deliberadamente |
| Access | Sem cookie válido, a borda responde **redirect para o IdP**; um `fetch` cross-origin não consegue segui-lo e você recebe erro opaco, não um 401 legível |

**Regra do Access, que cai do mapa acima:** ele é por hostname, e só o
`admin.` precisa dele. Dentro do `admin.` entra tudo; `app.` e `media.` ficam
inteiramente de fora. Não há caminho a excluir, nem exceção a manter.

> **Por que o webhook mora em `app.` e não em `admin.`** — ele precisa ficar
> fora do Access (a Hotmart não tem identidade no seu IdP). Se morasse em
> `admin.`, seria preciso uma exceção por política de *Bypass*, e exceção é
> frágil no tempo: daqui a seis meses alguém aperta a política, cobre um
> caminho a mais sem perceber, e as compras passam a falhar em silêncio.
> Hostname que nunca teve Access não regride para esse estado.
>
> Se preferir não mexer no `app.` antes do sub-projeto 4, o apex
> `maisaprovacao.com.br/webhooks/*` serve igual. O que importa é ser um
> hostname sem Access.

---

## Fase 0 — Registros DNS

Nem todo hostname precisa de registro manual — e é justamente onde precisa que
está a armadilha.

| Hostname | Quem cria o registro | Criar à mão? |
|---|---|---|
| `admin.maisaprovacao.com.br` | Custom Domain do Pages, na fase 9 | **Sim, placeholder agora** |
| `app.maisaprovacao.com.br` | ninguém | **Sim, placeholder agora** |
| `media.maisaprovacao.com.br` | Custom Domain do R2, na fase 2 | Não |

**Por que criar placeholder para `admin.` se o Pages criaria depois.** Porque as
Worker Routes vêm **antes** (fase 8), e a documentação da Cloudflare é explícita:
*route* exige registro proxied **preexistente**, e a ausência dele é erro
crítico — a rota é aceita e as requisições nunca alcançam o Worker, sem
mensagem nenhuma. Criar o registro agora também destrava o teste do Access na
fase 5, com o painel ainda inexistente. Na fase 9 o Pages assume esse registro.

- [x] `admin` → `AAAA` para `100::`, **proxied** (nuvem laranja).
- [x] `app` → `AAAA` para `100::`, **proxied**.
- [x] `media` → **não criar**. A fase 2 cria junto com o Custom Domain do R2;
      criar antes só gera conflito.

> `100::` é o prefixo de descarte do IPv6 — o padrão documentado para "quero a
> borda no caminho, ainda não tenho origem". Enquanto for ele que estiver ali,
> qualquer requisição que passe pela borda e chegue à origem morre num 5xx
> (tipicamente 522 ou 523). Isso é esperado, e a fase 5 usa exatamente esse
> comportamento como sinal de sucesso.

> **`media.` merece atenção extra.** A URL absoluta da imagem é **persistida
> dentro do HTML da questão** (`api/src/routes/admin/media.ts` grava
> `${MEDIA_PUBLIC_BASE}/media/<uuid>.<ext>` no enunciado). Trocar essa base
> depois exige reescrever linhas do banco. Não use o `*.r2.dev` de
> conveniência.
>
> Por que sem cookies: um SVG malicioso servido do mesmo host da sessão
> executaria com o cookie do admin. Como o cookie é host-only (`Path=/`, sem
> atributo `Domain`), um subdomínio irmão já resolve.

---

## Fase 1 — D1 → produz `database_id`

```bash
cd api
npx wrangler d1 create mais-aprovacao-db
```

- [x] Copiar o `database_id` da saída para `api/wrangler.jsonc:9`, no lugar de
      `REPLACE_WITH_REAL_ID_BEFORE_DEPLOY`.

---

## Fase 2 — R2 → produz `MEDIA_PUBLIC_BASE`

```bash
npx wrangler r2 bucket create mais-aprovacao-media
```

- [x] Dashboard → R2 → `mais-aprovacao-media` → Settings → **Custom Domain** →
      `media.maisaprovacao.com.br`. **O registro DNS nasce daqui** — é por isso
      que a fase 0 manda não criá-lo à mão.
- [x] Conferir que o domínio ficou ativo e que um objeto de teste é servido
      publicamente.
- [x] `MEDIA_PUBLIC_BASE` = `https://media.maisaprovacao.com.br` — **sem barra
      final**.

> Preencher isto também conserta um teste: o e2e `editor.spec.ts:136` ("upload
> de imagem") falha hoje porque o `<img>` inserido recebe
> `src="https://REPLACE_ME_MEDIA_HOST/…"`, não carrega, fica com altura zero e
> o Playwright o considera invisível. O upload em si funciona.

---

## Fase 3 — Email Service → o gate do provisionamento

Esta é a fase que decide se comprador recebe email. Faça-a cedo: propagação de
DNS e verificação de domínio levam tempo, e é o risco nº 1 da seção 10 da spec.

O domínio onboardado é **`app.maisaprovacao.com.br`**, não o apex — é o hostname
de onde o aluno recebe email, e é o que precisa casar com `EMAIL_FROM`.

Os registros que o onboarding pede ficam todos em **subdomínios** do domínio
onboardado. Isso importa porque `app.` já carrega o placeholder da fase 0 e vira
Custom Domain do Pages no sub-projeto 4: nenhum destes é A/AAAA em `app.`, então
não há colisão em momento nenhum.

| Registro | Nome |
|---|---|
| `MX` ×3 (`route{1,2,3}.mx.cloudflare.net`) | `cf-bounce.app.maisaprovacao.com.br` |
| `TXT` SPF (`v=spf1 include:_spf.mx.cloudflare.net ~all`) | `cf-bounce.app.maisaprovacao.com.br` |
| `TXT` DKIM | `cf-bounce._domainkey.app.maisaprovacao.com.br` |
| `TXT` DMARC | `_dmarc.app.maisaprovacao.com.br` |

- [x] Dashboard → Email → **Email Sending** → onboarding de
      `app.maisaprovacao.com.br`.
- [x] Os quatro registros acima publicados. O dashboard os adiciona sozinho na
      zona; conferir que aparecem como **Locked**, que é o estado em que o Email
      Service gerencia o registro.
- [x] Aguardar o domínio aparecer como **onboarded**. Antes disso, envio só
      para destinatários verificados na conta.
- [x] `EMAIL_FROM` = `nao-responda@app.maisaprovacao.com.br`, dentro do domínio
      onboardado.

> **Onboardar o subdomínio autoriza só ele.** O apex `maisaprovacao.com.br` não
> passa a poder enviar, e não precisa — nada no código envia de lá. O
> alinhamento DMARC do `From:` vem do DKIM (`d=app.maisaprovacao.com.br`), e o
> SPF cobre o return-path em `cf-bounce.`, que é o envelope que o SPF de fato
> verifica.

**Dois detalhes do binding para conferir na hora**, porque o produto está em
beta e a documentação se move:

- O binding já está declarado em `wrangler.jsonc` como `send_email` com
  `name: "EMAIL"`, que é o formato correto. A documentação do Email Service
  menciona também um `"remote": true` no binding — conferir se é exigido na
  versão corrente e acrescentar se for.
- O código chama `env.EMAIL.send({ to, from, subject, html, text })`
  (`api/src/lib/email.ts`), que é a forma de objeto do Email Service. Existe
  também a forma antiga, `new EmailMessage(from, to, rawMime)` do Email
  Routing. Se o envio falhar com erro de tipo, é essa a divergência — e a
  correção é uma função de ~15 linhas, como a spec previu.

- [x] Teste de fumaça: enviar para um endereço **externo** (Gmail) e confirmar
      a chegada, inclusive spam.

---

## Fase 4 — Turnstile → produz duas chaves

- [x] Dashboard → Turnstile → novo widget para `admin.maisaprovacao.com.br`
      (e depois para `app.`, quando o frontend do aluno existir).
- [x] **Site key** → vai para o *build* do Pages (fase 9), não para o Worker.
- [x] **Secret key** → vira segredo do Worker (fase 6).

> Atenção ao acoplamento: `web/admin/src/app/login/page.tsx:11` lê
> `NEXT_PUBLIC_TURNSTILE_SITE_KEY` com fallback `""`. Se a variável faltar no
> build, **o build passa** e o login quebra em produção, sem erro em lugar
> nenhum.

---

## Fase 5 — Zero Trust Access → produz `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD`

O Access é a **camada 1 de duas**, e as duas são independentes de propósito: o
email do JWT do Access **não** identifica o usuário na aplicação. Se
identificasse, o Access viraria fonte de identidade e as camadas deixariam de
ser duas. É por isso que o admin autentica duas vezes.

Fail-closed em `api/src/middleware/access.ts`: sem o header
`Cf-Access-Jwt-Assertion`, `/admin/*` devolve 401 antes de qualquer consulta ao
banco. Access mal configurado **quebra** o painel — não o expõe.

- [x] Zero Trust → Settings → **Team domain**: `<seutime>.cloudflareaccess.com`.
      Esse é o `ACCESS_TEAM_DOMAIN`, **sem `https://` e sem barra final** — o
      código monta o issuer (`https://${ACCESS_TEAM_DOMAIN}`) e busca o JWKS em
      `${issuer}/cdn-cgi/access/certs`. Colar com o esquema junto produz
      `https://https://…`, e o `catch` devolve um 401 pelado, indistinguível de
      ataque.
- [x] Access → Applications → **Self-hosted**, cobrindo
      `admin.maisaprovacao.com.br` — o hostname **inteiro**, sem exceção de
      caminho.
- [x] Campo de **path vazio** — é o hostname inteiro.
- [x] Uma política (detalhada logo abaixo).
- [x] Copiar a **Application Audience (AUD) tag** → `ACCESS_AUD`. Criar ou
      editar política **não** muda o AUD.

**Uma aplicação só, um `aud` só.** O Worker valida contra exatamente um
`ACCESS_AUD`. Se um dia você criar uma segunda aplicação (staging, por
exemplo), ela terá AUD próprio e só um dos dois cabe na variável.

**Por que o hostname inteiro, e não só `/admin/*`.** O mínimo que o Worker
exige é que `/admin/*` esteja coberto, que é onde `requireAccess` roda
(`api/src/app.ts:32`). Mas cobrir só isso inverte a ordem da autenticação: as
telas ficariam públicas, você digitaria a senha primeiro e só quando o painel
fosse buscar dados o Access te redirecionaria para o IdP — redirect chegando no
meio de uma chamada `fetch`. Cobrindo o hostname inteiro, a ordem é a
projetada: IdP → painel → senha.

**Sobre `/auth/*` ficar dentro do Access.** Fica, e é o recomendado. Depois de
passar pelo Access o navegador carrega o cookie `CF_Authorization` daquele
hostname, e um `fetch("/auth/login")` same-origin o envia junto — o login
completa normalmente. O ganho é que o endpoint de login some da internet
aberta: só alcança quem já passou pelo seu IdP. O custo é que a Rate Limiting
Rule da fase 10 perde boa parte da utilidade **neste** hostname (ela continua
essencial no `app.`, onde o aluno entra sem Access).

- [x] `app.` e `media.` **não** têm aplicação Access. Não é esquecimento: o
      aluno e o bucket são públicos, e é o que mantém o webhook alcançável.

### A política

A aplicação define **o que** proteger; a política define **quem entra**. Sem
política nenhuma, ninguém entra — não existe "aberto por padrão".

Uma política é uma **ação** mais regras, e as regras têm três tipos com
significado booleano diferente:

| Tipo | Semântica | Papel |
|---|---|---|
| **Include** | **OU** — basta uma casar | Quem pode entrar. O único obrigatório |
| **Require** | **E** — todas precisam casar | Condição extra sobre quem passou no Include |
| **Exclude** | **NÃO** — nenhuma pode casar | Veto; ganha de tudo |

Cada regra é um par **seletor + valor**. Para uma operação de uma ou duas
pessoas, a política inteira é uma linha:

| Ação | Tipo | Seletor | Valor |
|---|---|---|---|
| **Allow** | **Include** | **Emails** | o seu email |

- [x] `Require` e `Exclude` vazios. Existem para cenários que este projeto não
      tem.
- [x] Nenhuma política de `Block` sobrando de tentativa anterior — `Block` e
      `Exclude` ganham de `Allow`.
- [x] **Session duration** num valor que você tolere reautenticar. 24h é
      confortável; sessão longa demais enfraquece a camada.

> **Use `Emails`, não `Emails ending in`.** O seletor de domínio casa com o
> email **da conta do IdP**. Se você entra com uma conta Google `@gmail.com`,
> uma regra `@maisaprovacao.com.br` não casa e você se tranca para fora.
> Listar emails exatos é mais apertado e não tem esse modo de falha.

Se a interface resistir, a política também sai pela API — imune a mudança de
tela. O `APP_UUID` está na URL da aplicação no dashboard:

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$APP_UUID/policies" \
  --header "Authorization: Bearer $CF_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Admins do painel",
    "decision": "allow",
    "include": [{ "email": { "email": "voce@exemplo.com" } }],
    "require": [],
    "exclude": [],
    "precedence": 1
  }'
```

### O método de login

A política diz *quais emails* entram. Ela não diz *como* a pessoa prova ser
aquele email — isso é o **login method**, e mora em outro lugar:
**Settings → Authentication**. É a causa mais provável de uma política correta
não funcionar.

- **Cloudflare (padrão).** Organizações novas do Zero Trust já vêm com o
  provedor da Cloudflare habilitado. Nesse caso a política funciona sem
  configurar mais nada.
- **One-time PIN.** Código de 6 dígitos por email, válido 10 minutos, uso
  único. **Não** vem habilitado automaticamente em organizações novas.
- **Google ou GitHub.** Precisa ser adicionado em Authentication **antes** de
  aparecer como opção, e exige criar credencial OAuth do lado do provedor.

> **Sobre "com MFA".** O Access **não implementa MFA** — ele delega ao IdP.
> "Com MFA" quer dizer entrar com uma conta que tem 2FA ligado. Existe o
> seletor `Login Method` numa regra de `Require`, mas ele restringe *qual
> provedor*, não *se houve segundo fator*; com um método só habilitado, não
> acrescenta nada.

### Duas identidades que não se misturam

O email da política do Access **não** é a conta do painel:

| | Prova o quê | De onde vem |
|---|---|---|
| **Access** | que você pode *alcançar* `admin.` | sua conta Google/GitHub |
| **Painel** | que você é *admin da aplicação* | email em `ADMIN_EMAILS`, com senha, nascido de uma compra |

Podem ser emails diferentes, e está certo. É o motivo de existirem duas
camadas: o Worker ignora o email do JWT do Access de propósito
(`api/src/middleware/access.ts`). Se o usasse, o Access viraria fonte de
identidade e a segunda camada perderia sentido.

### Testar agora, com o painel ainda inexistente

Com o placeholder da fase 0 no lugar, dá para validar o Access **antes** de
existir Pages ou Worker. Janela anônima → `https://admin.maisaprovacao.com.br`:

1. Aparece a **tela de login do Access**. Ela é servida inteiramente pela
   borda, antes de qualquer origem — só isso já prova que a aplicação está
   casando o hostname.
2. Você autentica com o email do Include.
3. Você toma um **erro de origem (522 ou 523)**. A borda tenta falar com
   `100::`, que é um buraco negro.

**Esse erro é o sinal de sucesso.** Chegar até ele significa que o Access
deixou passar e faltou apenas alguém do outro lado para atender — o que a fase
9 resolve.

| O que acontece | O que significa |
|---|---|
| Erro de DNS, site não encontrado | Registro não existe ou está sem proxy (nuvem cinza) |
| Vai direto ao 5xx, **sem** tela de login | A aplicação Access não está casando o hostname |
| Tela de login aparece, mas depois "forbidden" | O email autenticado não bate com o Include |

---

## Fase 6 — Preencher `wrangler.jsonc` e subir os segredos

| Variável | Valor de produção | Vem da fase |
|---|---|---|
| `database_id` | id do D1 | 1 |
| `MEDIA_PUBLIC_BASE` | `https://media.maisaprovacao.com.br` | 2 |
| `EMAIL_FROM` | `nao-responda@app.maisaprovacao.com.br` | 3 |
| `ACCESS_TEAM_DOMAIN` | `<seutime>.cloudflareaccess.com` | 5 |
| `ACCESS_AUD` | tag AUD | 5 |
| `HOTMART_SUBSCRIPTION_UCODES` | ucodes, separados por vírgula | 11 |
| `HOTMART_CHECKOUT_URL` | link do checkout | — (ver nota) |
| `APP_BASE_URL` | `https://app.maisaprovacao.com.br` | topologia |
| `ADMIN_EMAILS` | **seu email** | agora |
| `HOTMART_API_BASE_URL` | manter **sandbox** | 12 |
| `HOTMART_TOKEN_URL` | `https://api-sec-vlc.hotmart.com/security/oauth/token` | 12 |

- [x] `ADMIN_EMAILS` preenchido. Vazio, ninguém nunca vira admin — o papel só é
      concedido por essa allowlist, jamais pelo payload.
- [x] `APP_BASE_URL` apontando para `app.`, ciente de que `/definir-senha`
      ainda não existe lá.
- [x] `HOTMART_API_BASE_URL` **continua em sandbox** até o runbook de
      verificação passar. Virar para produção é a fase 13.
- [ ] `HOTMART_SUBSCRIPTION_UCODES` — **o único que falta**. Ver fase 11.

> **`HOTMART_TOKEN_URL` não é um par com `HOTMART_API_BASE_URL`.** Parecia ser,
> e o valor inicial deste arquivo tratava os dois como se acompanhassem o
> ambiente. Não acompanham: a fase 12 confirmou que o host de autenticação é
> `api-sec-vlc.hotmart.com` e é **o mesmo em sandbox e em produção**. Só o host
> de dados troca. É por isso que ele já está no valor final e a fase 13 não o
> toca.

> `HOTMART_CHECKOUT_URL` é declarada em `config/env.ts:33` e **não é usada por
> nenhum código**. Preencher é inofensivo; é configuração morta, provavelmente
> destinada ao frontend do aluno.

Os seis segredos, um a um:

```bash
cd api
npx wrangler secret put JWT_SECRET             # segredo forte, aleatório
npx wrangler secret put DOCUMENT_HMAC_KEY      # pepper do HMAC de CPF
npx wrangler secret put TURNSTILE_SECRET_KEY   # fase 4
npx wrangler secret put HOTMART_HOTTOK         # fase 11
npx wrangler secret put HOTMART_CLIENT_ID      # fase 11
npx wrangler secret put HOTMART_CLIENT_SECRET  # fase 11
```

- [x] `npx wrangler secret list` mostra os seis.
- [x] Nenhum segredo aparece em `wrangler.jsonc`.
- [x] `ACCESS_DEV_BYPASS` **não** existe em produção (só em `.dev.vars`).

> **`DOCUMENT_HMAC_KEY` não pode mudar depois.** Ele é o pepper do HMAC de CPF;
> trocá-lo invalida todo `document_hash` já gravado e quebra a recuperação de
> acesso de quem já comprou. Gere uma vez, guarde fora da máquina.
>
> **`HOTMART_CLIENT_SECRET` tem poder destrutivo** (spec §5): quem o obtiver
> pode cancelar a base de assinantes. Se a Hotmart permitir credencial
> somente-leitura, use uma para o cron.

---

## Fase 7 — Migrar o banco e publicar o Worker

```bash
cd api
npx wrangler d1 migrations apply mais-aprovacao-db --remote   # note o --remote
npm run deploy
```

- [x] As **três** migrações aplicadas no D1 **remoto**. O `npm run
      db:migrate:local` existente é `--local` e não serve aqui; não há script
      para o remoto. A `0002` (2026-08-17) tornou `questions.year` NOT NULL —
      aplicada com o acervo ainda vazio, que era a única janela em que a
      reconstrução da tabela era trivial. Conferido depois com
      `pragma_table_info('questions')`: `notnull = 1`.
- [x] Cron `0 3 * * *` aparece no dashboard do Worker (vem do `wrangler.jsonc`).
- [x] O deploy imprime as **três rotas** da fase 8, e **não** uma URL
      `*.workers.dev`. As três estão declaradas em `wrangler.jsonc:routes`, então
      sobem com o deploy — a fase 8 só confere.
- [x] Verificação do deploy: `npx wrangler deployments list` mostra a versão nova
      no topo. Para ver o Worker efetivamente atendendo, `npx wrangler tail` numa
      aba e a fase 9 na outra.

> **Um Worker precisa de pelo menos um trigger, ou o deploy falha.** Sem
> `routes` e sem `workers.dev`, o `wrangler deploy` faz o upload, não tem onde
> pendurar o Worker e aborta com *"You can either deploy your worker to one or
> more routes… or register a workers.dev subdomain"*. As rotas em
> `wrangler.jsonc` resolvem isso — é por isso que elas não podem esperar a
> fase 8.

> **Não existe smoke test por `curl` aqui, e a razão é dupla.** `/health`
> (`api/src/app.ts:18`) é código nosso, público no nível do Hono — mas (1) não
> há Worker Route que case `/health`, então em `admin.` ele cai no Pages e em
> `app.` bate no `100::`; e (2) o Access cobre `admin.` inteiro, então o `curl`
> receberia o redirect do IdP antes de qualquer coisa. Em produção `/health` é
> inalcançável de fora **por construção**. Ele existe para o readiness probe do
> Playwright em dev (`web/admin/e2e/playwright.config.ts:25`) — não apague.
> Se um dia quiser uptime check externo, a solução é uma quarta rota,
> `app.maisaprovacao.com.br/health`, e não uma exceção no Access.

---

## Fase 8 — Worker Routes → conferir as três

**As rotas moram em `api/wrangler.jsonc`, não no dashboard.** A documentação de
deprecações do Wrangler é categórica: *rotas definidas no dashboard não são
somadas às definidas no Wrangler; se as duas existem, só valem as do arquivo*.
Criar rota pela tela com `routes` presente no arquivo é trabalho que o próximo
`npm run deploy` desfaz.

Uma Worker Route casa a URL e **não a reescreve**, então os padrões usam os
caminhos que o Worker já serve, sem prefixo:

| Padrão | Serve |
|---|---|
| `admin.maisaprovacao.com.br/admin/*` | Worker — conteúdo do painel |
| `admin.maisaprovacao.com.br/auth/*` | Worker — login do painel |
| `app.maisaprovacao.com.br/webhooks/*` | Worker — **webhook da Hotmart** |
| `admin.maisaprovacao.com.br/*` | Pages — o painel (Custom Domain, fase 9 — **não** é Worker Route) |

- [x] As três rotas aparecem em Workers → `mais-aprovacao-api` → Settings →
      Domains & Routes, e **nenhuma outra**. Se sobrou alguma de tentativa
      manual, apagar lá — o arquivo é a fonte da verdade.
- [x] **Os registros DNS da fase 0 precisam já existir.** Route exige registro
      proxied preexistente; sem ele a rota é aceita e as requisições nunca
      alcançam o Worker, silenciosamente. Como as rotas sobem no deploy, isso
      virou pré-requisito da **fase 7**.
- [x] A do webhook é a que falta na documentação do `web/README.md`. Sem ela, o
      `POST /webhooks/hotmart` devolve 404 para toda compra.
- [x] Nenhuma URL `*.workers.dev` listada. `workers_dev: false` e
      `preview_urls: false` estão no `wrangler.jsonc` — os dois são necessários,
      porque Preview URLs são hostnames `workers.dev` por versão e dariam um
      caminho para `/admin/*` **sem passar pelo Access**. Desligar só pelo
      dashboard não resolve: o próximo `wrangler deploy` religa.
- [x] Confirmar que o painel **não** tem página em `/admin` nem em `/auth` — as
      rotas do Worker capturam esses caminhos antes do Pages.

> **Nenhuma rota nova pode casar `/media/*`, incluindo as do sub-projeto 4.**
> `GET /media/:key` (`api/src/routes/media.ts`) existe no Hono só para o
> desenvolvimento local — a segurança dela depende inteiramente de nenhuma
> Worker Route alcançá-la em produção, e hoje nenhuma alcança porque nenhuma
> das três casa esse caminho. O risco concreto é o sub-projeto 4: se a rota
> dele em `app.maisaprovacao.com.br` vier ampla (`/*`) em vez de restrita a
> `/auth/*` e `/webhooks/*`, `/media/*` passa a responder também nesse
> hostname — que carrega o cookie de sessão do aluno — e anula em silêncio o
> motivo de `MEDIA_PUBLIC_BASE` apontar para `media.maisaprovacao.com.br`,
> hostname sem cookies. Novas rotas continuam path-scoped, nunca um `/*`.

---

## Fase 9 — Pages → o painel

O build é estático (`output: 'export'`) e a site key entra **no build**:

```bash
cd web
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key da fase 4> npm run build
npx wrangler pages deploy admin/out --project-name=mais-aprovacao-admin
```

- [x] Projeto Pages criado e ligado a `admin.maisaprovacao.com.br`. Ao
      confirmar o Custom Domain, o Pages **assume o registro placeholder** da
      fase 0 — o `100::` some e o 5xx da fase 5 vira o painel de verdade.
- [x] Se usar build automático pelo Git, cadastrar
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY` nas variáveis de build do projeto.
- [x] Abrir `https://admin.maisaprovacao.com.br/login` — passando primeiro pelo
      IdP — e confirmar que o widget do Turnstile **renderiza** (se a site key
      faltou, ele não aparece).

---

## Fase 10 — Rate Limiting Rules

Proteção de borda, configuração e não código (spec §5). **Não vai no
`wrangler.jsonc`** — rate limiting é regra de **zona**, não do Worker, e nenhum
`npm run deploy` a toca ou a apaga.

**Onde:** Dashboard → zona `maisaprovacao.com.br` → **Security → Security
rules** → **Create rule** → **Rate limiting rule**.

### O que o plano Free permite

A zona é Free, e isso não é detalhe de rodapé: quase todo campo da tela já vem
decidido.

| Campo | Free | O que existe acima |
|---|---|---|
| Regras na zona | **1** | Pro 2 · Business 5 · Enterprise 100 |
| Período de contagem | **10 s**, fixo | Pro até 1 min · Business até 10 min |
| Duração da mitigação | **10 s**, fixo | Pro até 1 h · Business até 1 dia |
| Característica de contagem | **IP**, só | Business +NAT · Enterprise path, header, JA4… |
| Counting expression (contar só 401/403) | **não** | Business+ |
| Resposta customizada do bloqueio | **não** — 429 HTML da Cloudflare | Pro+ |

Consequência direta: **as duas regras que esta fase pedia não cabem.** É uma só,
e ela bloqueia por 10 segundos. Isso é quebra-molas, não muro — o valor está em
tornar caro o loop trivial, não em deter alguém determinado.

### A regra

O alvo hoje é um só, e não é o que a versão anterior desta fase sugeria:
**`app.maisaprovacao.com.br/auth/*` ainda não existe.** As Worker Routes são
três (`api/wrangler.jsonc`), e nenhuma casa `/auth/*` no `app.` — o login do
aluno é sub-projeto 4. A única superfície pública que hoje alcança o Worker é o
webhook.

Ainda assim, escreva a expressão **já cobrindo os dois caminhos**: cobrir um
caminho inexistente custa zero (nada casa, nada é contado) e evita ter que
voltar aqui quando o front do aluno subir.

| Campo da tela | Valor |
|---|---|
| **Rule name** | `borda-app-publico` |
| **If incoming requests match** | *Edit expression* → a expressão abaixo |
| **With the same characteristics** | **IP** (único no Free) |
| **When rate exceeds** | **20** requests / **10** seconds |
| **Then take action** | **Block** |
| **Duration** | 10 seconds (fixo no Free) |

```
(http.host eq "app.maisaprovacao.com.br" and
 (starts_with(http.request.uri.path, "/auth/") or
  http.request.uri.path eq "/webhooks/hotmart"))
```

- [x] Regra criada e **Deploy** — não *Save as Draft*.
- [x] `admin.` deliberadamente fora da expressão (ver adiante).

**De onde vem o 20.** O teto precisa ficar acima do pico legítimo e abaixo de
qualquer coisa que mereça o nome de força bruta. O pico legítimo é o front do
aluno: navegação chamando `GET /auth/me` algumas vezes em sequência. O ataque é
`POST /auth/login`, e cada tentativa já custa Turnstile server-side
(`api/src/routes/auth.ts:64`) mais PBKDF2 de 100 mil iterações — que roda
**mesmo com email inexistente**, de propósito (`auth.ts:74`). A 20 por 10 s o
atacante fica em 2 tentativas/s por IP; com o PBKDF2 no caminho, isso não é uma
taxa de enumeração, é uma fila.

Para o webhook o número é folgado por outro motivo: uma operação deste tamanho
não recebe 20 eventos de compra em 10 segundos nem no melhor dia. Se receber, o
que chega é lote de retentativa — e o handler é idempotente por `claimEvent`
antes de qualquer efeito (`api/src/webhooks/hotmart.ts`), então um 429 no meio
do lote não perde compra: a Hotmart retenta e o evento repetido é deduplicado.

> **O contador é por data center, não global.** Todo rate limiting rule carrega
> `cf.colo.id` como característica implícita. "20 por 10 s" é o teto **em cada
> colo**; um atacante distribuído multiplica isso pelo número de PoPs que
> alcança. É mais uma razão para não confundir esta regra com a defesa — a
> defesa é o Turnstile, o PBKDF2 e o cooldown de recuperação
> (`auth.ts:162`).

> **O bloqueio devolve a página 429 da Cloudflare, em HTML.** No Free não há
> resposta customizada. Para a Hotmart isso é uma falha de entrega como outra
> qualquer e ela retenta; para um `fetch` do front do aluno, é uma resposta que
> não é JSON — o cliente cai no `catch`. Aceitável a 20/10 s, mas é o motivo de
> não apertar esse número.

### Por que `admin.` fica fora

Duas coisas já estão na frente: o Access exige identidade do IdP antes de
qualquer requisição alcançar a origem, e o `/auth/login` do painel tem o mesmo
Turnstile + PBKDF2 do aluno. Com **uma** regra disponível, gastá-la no hostname
que exige login no IdP para ser sequer alcançado seria gastar a única bala no
alvo mais protegido.

### Como conferir que a regra está viva

O webhook devolve 401 antes de tocar o banco quando o hottok não bate
(`hotmart.ts:86`), então dá para exercitar a regra sem efeito colateral nenhum:

```bash
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code} " \
    -X POST https://app.maisaprovacao.com.br/webhooks/hotmart \
    -H 'x-hotmart-hottok: invalido' -d '{}'
done; echo
```

- [x] A saída começa em `401` e vira `429` por volta da 20ª — se ficar tudo
      `401`, a expressão não está casando.
- [x] O bloqueio some sozinho em ~10 s.
- [x] Security → **Events**, filtrando por serviço `ratelimit`, mostra os
      eventos bloqueados.

### O que muda quando o sub-projeto 4 subir

`app./auth/*` passa a ser a superfície nº 1 — força bruta de login e
email-bombing em `/auth/recover` — e você continuará com **uma** regra para dois
alvos com perfis de tráfego diferentes. A expressão acima já cobre os dois, com
o custo de um teto único. Quando esse teto único incomodar, o degrau é o plano
Pro: duas regras, período até 1 min e bloqueio até 1 h, que é o que transforma
o quebra-molas em contenção de verdade.

---

## Fase 11 — Hotmart (sandbox) e o primeiro admin

- [x] Painel Hotmart → Ferramentas → **Webhook**: URL
      `https://app.maisaprovacao.com.br/webhooks/hotmart`, versão **2.0.0**,
      eventos: `PURCHASE_APPROVED`, `PURCHASE_DELAYED`, `PURCHASE_CANCELED`,
      `PURCHASE_EXPIRED`, `PURCHASE_REFUNDED`, `PURCHASE_CHARGEBACK`,
      `PURCHASE_PROTEST`, `SUBSCRIPTION_CANCELLATION`.
- [x] Copiar o **hottok** → segredo `HOTMART_HOTTOK`.
- [x] Ferramentas → Credenciais → `client_id` / `client_secret` da API de
      dados, com leitura de assinaturas **e** cancelamento.
- [x] **Exigir CPF no checkout.** Sem isso a recuperação de acesso recai só no
      email, e a validação por documento deixa de existir.
- [ ] Anotar os **ucodes** dos produtos de assinatura →
      `HOTMART_SUBSCRIPTION_UCODES`.

**O primeiro admin — problema do ovo e da galinha.** `role=admin` só é
concedido em dois lugares (`webhooks/hotmart.ts:169` e `jobs/reconcile.ts:117`),
os dois exigindo uma compra cujo email esteja em `ADMIN_EMAILS`. Não existe
cadastro de admin. Duas saídas:

- **Compra de teste no sandbox** com o email que está em `ADMIN_EMAILS` — cria
  a conta com `role=admin` e envia o link mágico. Mas o link cai em
  `app.maisaprovacao.com.br/definir-senha`, que não existe: pegue o token na
  query string e chame `POST /auth/set-password` direto (curl), definindo a
  senha.
- **Inserção manual** no D1 remoto, via `npx wrangler d1 execute
  mais-aprovacao-db --remote --command "…"`, no mesmo formato que o
  `web/admin/e2e/seed.mjs` usa: hash `pbkdf2$sha256$100000$<salt>$<hash>`.

- [x] Admin de produção criado e login em
      `https://admin.maisaprovacao.com.br/login` funcionando — passando **duas
      vezes** por identidade: Access, depois senha.

---

## Fase 12 — Rodar o runbook de verificação

- [x] Seção 1 — endpoint da API de dados. **Fechada.**
- [ ] Seção 2 — fixtures contra evento real. Payloads coletados, conferência
      em andamento.
- [ ] Seções 3 a 6 e 8 a 9, contra o **sandbox**.
- [ ] Seção 7 — reconciliação. **Bloqueada pelo ucode da fase 11.**

Ele existia porque dois valores continuavam **inferidos, não confirmados**: o
caminho `/payments/api/v1/subscriptions` (`api/src/lib/hotmartApi.ts`) e o
`HOTMART_TOKEN_URL`. Os dois já foram confirmados contra o sandbox — e a
conferência achou um terceiro problema que ninguém procurava: a listagem
mandava um parâmetro `start_date` que a API não conhece, corrigido para
`accession_date`. **O que sobra da razão de existir desta fase são os
fixtures**, que vieram da documentação e não de tráfego real: os 325 testes
podem estar verdes contra um payload que a Hotmart não envia.

---

## Fase 13 — Virar para produção

Só depois da fase 12 passar inteira.

- [ ] `HOTMART_API_BASE_URL` → host de produção. **Só ele** —
      `HOTMART_TOKEN_URL` já está no valor final e é o mesmo nos dois
      ambientes (ver a nota na fase 6).
- [ ] `HOTMART_HOTTOK`, `HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET` →
      credenciais de produção.
- [ ] `HOTMART_SUBSCRIPTION_UCODES` → ucodes de produção.
- [ ] Webhook de produção apontando para o Worker.
- [ ] Chaves do Turnstile de produção (as de teste sempre passam).
- [ ] `npm run deploy` e conferir o deploy pela fase 7 (`deployments list` +
      `wrangler tail` — não há smoke test por `curl`).
- [ ] Conferir a seção 9 do runbook (LGPD) nos logs reais: nenhum CPF,
      endereço ou telefone.
- [ ] **Limpar o D1 dos registros de teste do sandbox** antes de abrir para
      compradores reais — o procedimento está em *Rodada de testes* no
      [runbook de verificação](runbook-verificacao-hotmart.md). Assinante de
      sandbox que fica no banco vira acesso concedido de graça em produção.

---

## Pendências que este runbook não resolve

| Item | Onde |
|---|---|
| `/definir-senha` não existe — link mágico cai em 404 | sub-projeto 4 |
| Sem script para migração remota nem para deploy do Pages | `package.json` |
| Sem CI — nada roda a suíte antes de publicar | — |
| `hono@4.12.28` marcado — **cooldown vencido em 2026-08-17, já dá para subir** | `api/package.json` |
| `nanoid` marcado nos dois workspaces, 3.3.18 em 2026-08-21 | `api/`, `web/` |
| e2e do upload depende de `MEDIA_PUBLIC_BASE` real | `editor.spec.ts:136` |
| `HOTMART_SUBSCRIPTION_UCODES` ainda é placeholder | `api/wrangler.jsonc` |
