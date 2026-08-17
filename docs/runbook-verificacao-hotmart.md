# Runbook — verificação manual contra o sandbox da Hotmart

> A suíte automatizada usa fixtures **derivados da documentação**, não de
> tráfego real, e dois valores de configuração não puderam ser confirmados.
> Este roteiro é o que fecha essa lacuna. É a **fase 12** do
> [`runbook-deploy-producao.md`](runbook-deploy-producao.md) — rodar antes de
> considerar a Fundação pronta.

## Estado — 2026-08-17

| Seção | Estado |
|---|---|
| 1. Endpoint da API de dados | ✅ **fechada** — ver os achados abaixo |
| 2. Fixtures contra evento real | 🟡 payloads coletados, conferência pendente |
| 3–6. Fluxo ponta a ponta, recuperação, cancelamento, idempotência | ⬜ |
| 7. Reconciliação | 🔴 **bloqueada** — `HOTMART_SUBSCRIPTION_UCODES` ainda é placeholder |
| 8. Turnstile e segredos | ⬜ |
| 9. LGPD | ⬜ |

## Pré-requisitos

Todos vêm do runbook de deploy — não há nada para providenciar aqui:

| Item | Onde foi obtido |
|---|---|
| `hottok`, `client_id` / `client_secret`, `ucode` do produto | fase 11 |
| Domínio de envio onboardado (SPF/DKIM/DMARC) | fase 3 |
| Chaves Turnstile | fase 4 |
| Worker publicado e rotas ativas | fases 7 e 8 |

---

## 1. Endpoint da API de dados — ✅ fechada

Era **a lacuna conhecida**: host, caminho e o `HOTMART_TOKEN_URL` estavam
inferidos. Confirmados em 2026-08-17, contra a
[documentação de Obter Assinaturas](https://developers.hotmart.com/docs/pt-BR/v1/subscription/get-subscribers/)
e contra uma chamada real no sandbox.

```bash
# obter token — o host NÃO é o do sandbox
curl -s -X POST "https://api-sec-vlc.hotmart.com/security/oauth/token" \
  -H "Authorization: Basic $(printf '%s:%s' "$CLIENT_ID" "$CLIENT_SECRET" | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"

# listar assinaturas
curl -s "https://sandbox.hotmart.com/payments/api/v1/subscriptions" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | head -c 2000
```

- [x] **Token obtido.** `HOTMART_TOKEN_URL` =
      `https://api-sec-vlc.hotmart.com/security/oauth/token`. **É o mesmo em
      sandbox e em produção** — o host de autenticação não acompanha o
      ambiente. Já corrigido em `wrangler.jsonc`.
- [x] **Listagem retorna itens.** O caminho
      `/payments/api/v1/subscriptions` estava certo, e o host de dados esse sim
      é o do ambiente (`https://sandbox.hotmart.com`).
- [x] **`product.ucode` vem na resposta.** Era o risco nº 1 desta seção: sem
      ele, o filtro do cron não funcionaria e seria preciso passar a filtrar por
      `product_id`, com uma variável nova. Não é preciso.
- [x] Envelope confirmado: array em **`items`**, paginação em **`page_info`**.

### O que a chamada real derrubou

**Havia um parâmetro inválido na query, e ele falhava em silêncio.**
`listSubscriptions` mandava `start_date`, que **não existe** nesta API. O nome
correto é `accession_date`. Parâmetro desconhecido não gera erro — é
descartado —, então a proteção que aquele código existia para dar nunca esteve
ligada: a listagem voltava sempre com o default de *hoje − 30 dias*.

O que isso custava, exatamente: assinatura mais velha que 30 dias sumia da
listagem, e o cron a contava em `missingInApi`. **Ninguém perdeu acesso por
causa disso** — a regra dura de `reconcile.ts` é que ausência na listagem nunca
revoga, e foi ela que segurou. O furo real era o outro: um webhook de compra
perdido há mais de 30 dias jamais seria remendado pelo cron, que é a única
rede automática para "aluno pagou e não existe no sistema".

Corrigido em `api/src/lib/hotmartApi.ts`, com um teste que trava o parâmetro
antigo fora da query.

### Campo a campo, contra o payload confirmado

Nada mais a mudar — o mapeamento de `RawSubscription` está correto:

| O que o código lê | No payload | |
|---|---|---|
| `subscriber_code` | `"AAAAA010"` | ✅ |
| `status` | `"ACTIVE"` | ✅ |
| `date_next_charge` | `1592255854000` | ✅ ms desde a epoch, como esperado |
| `plan.name` | `"Plan 4"` | ✅ |
| `product.ucode` | `"7c4fbe1a-…"` | ✅ |
| `subscriber.email` / `.name` | presentes | ✅ |

Dois detalhes que não quebram nada mas vale ter registrado:

- A documentação tipa `subscriber_code` como **integer**; o valor real é
  string (`"AAAAA010"`). O código já o trata como string e a coluna do D1 é
  `TEXT`. A documentação é que está errada.
- O payload traz `subscription_id`, `accession_date`, `request_date`,
  `price`, `trial`, `transaction`, `plan.recurrency_period` e
  `plan.max_charge_cycles`, que o código ignora deliberadamente. Campo extra
  não é problema — `RawSubscription` só declara o que lê.

### Os status possíveis, e por que isso fecha

A documentação enumera oito: `ACTIVE`, `INACTIVE`, `DELAYED`,
`CANCELLED_BY_CUSTOMER`, `CANCELLED_BY_SELLER`, `CANCELLED_BY_ADMIN`,
`STARTED`, `OVERDUE`.

`ACTIVE_STATUSES` em `reconcile.ts:37` é `{ACTIVE, STARTED, DELAYED, OVERDUE}`.
O complemento é exatamente `INACTIVE` mais os três `CANCELLED_*` — **a
cobertura é total, sem status órfão**. Isso só importa quando
`date_next_charge` não vem, porque a data é que manda; mas nesse caso a decisão
agora está provada exaustiva.

### Paginação — ✅ formato confirmado, ⬜ terminação a observar

```json
"page_info": {
  "results_per_page": 10,
  "total_results": 18,
  "next_page_token": "eyJyb3dzIjoxMCwicGFnZSI6Mn0="
}
```

O código lê só `page_info.next_page_token` e para quando ele não vem
(`do…while` em `hotmartApi.ts`). A documentação é explícita: *"quando
requisitamos a última página, no atributo `page_info` não virá o
`next_page_token`"*. Formato e contrato batem.

Falta um detalhe, e ele é o que decide entre funcionar e travar num laço
infinito. A chamada foi feita sem filtros e devolveu a **primeira** de duas
páginas (10 de 18):

- [ ] Repetir a chamada com `page_token` = o token acima e confirmar que a
      segunda página **não** traz `next_page_token`:

```bash
curl -s "https://sandbox.hotmart.com/payments/api/v1/subscriptions?page_token=eyJyb3dzIjoxMCwicGFnZSI6Mn0=" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | grep -o 'next_page_token' || echo "AUSENTE — correto"
```

- [ ] Observar o `results_per_page` quando `max_results=50` é enviado. O
      endpoint tem um máximo próprio não documentado; se ele for menor que 50, o
      retorno vem capado. Isso só gera mais páginas — o laço trata —, mas
      convém saber o número.

---

## 2. Conferir os fixtures contra um evento real

> Divergência aqui é o risco mais provável do plano: os 325 testes podem estar
> verdes contra um payload que a Hotmart não envia.

Os payloads de todos os eventos já foram coletados. A conferência é feita
**um evento por vez**, comparando com `api/test/fixtures/hotmart.ts`:

- [x] Webhook do sandbox apontado para um coletor e payloads salvos.
- [ ] `PURCHASE_APPROVED` — `data.product.ucode`, `data.buyer.email` / `.name` /
      `.document`, `data.purchase.transaction` / `.date_next_charge` /
      `.recurrence_number`, `data.subscription.subscriber.code` / `.plan.name` /
      `.status`.
- [ ] `PURCHASE_DELAYED`
- [ ] `PURCHASE_CANCELED`
- [ ] `PURCHASE_EXPIRED`
- [ ] `PURCHASE_REFUNDED`
- [ ] `PURCHASE_CHARGEBACK`
- [ ] `PURCHASE_PROTEST`
- [ ] `SUBSCRIPTION_CANCELLATION` — inclusive confirmar que ele **não** traz
      `product.ucode` (é a premissa da seção 5).
- [ ] Ajustar os fixtures onde divergirem e rodar `npm test`.

---

## Rodada de testes — como repetir do zero

As seções 3 a 6 criam registros reais no D1 de produção. Uma segunda tentativa
**não** repete o comportamento da primeira se o banco não voltar ao estado
inicial, e cada tabela tem uma razão diferente para isso:

| Tabela | Se ficar suja |
|---|---|
| `webhook_events` | reenviar o mesmo evento devolve `duplicate: true` e **nada acontece** — `claimEvent` corta antes de qualquer efeito |
| `auth_tokens` | `hasPendingToken` suprime o segundo email; o link mágico não é reenviado |
| `subscriptions` | a compra cai no caminho de *correção*, não no de *provisionamento* |
| `deleted_accounts` | se você testou exclusão, o cron pula o email para sempre |
| `users` | `upsertUserFromPurchase` atualiza em vez de criar; `password_hash` já preenchido pula o fluxo de primeiro acesso |

### O reset

Escrito num arquivo temporário fora do repositório, de propósito: um script que
apaga tabelas de produção não deve ficar versionado ao lado do código, onde um
dia alguém o executa sem ler.

```bash
cd api
cat > /tmp/reset-rodada.sql <<'SQL'
DELETE FROM auth_tokens;
DELETE FROM subscriptions;
DELETE FROM webhook_events;
DELETE FROM deleted_accounts;
DELETE FROM users WHERE role <> 'admin';
SQL

npx wrangler d1 execute mais-aprovacao-db --remote --file=/tmp/reset-rodada.sql
```

O `--remote` pede confirmação interativa antes de tocar o banco de produção.
**Leia o nome do banco na pergunta antes de confirmar** — é a única barreira
entre uma rodada de teste e o D1 errado.

**Por que `role <> 'admin'` e não `DELETE FROM users`.** O admin de produção é
o problema do ovo e da galinha da fase 11 — não existe cadastro de admin, ele
só nasce de uma compra com email em `ADMIN_EMAILS`. Apagá-lo custa refazer
aquela fase inteira. As outras quatro tabelas podem ir por completo: `role`
vem de `users`, não de `subscriptions` (`loadEntitlement` em `db/users.ts:105`),
então o admin sobrevive ao reset com o login intacto — perde só o `tier`, que
volta a `gratuito`.

**Por que a ordem importa.** `auth_tokens` e `subscriptions` têm FK para
`users` com `ON DELETE cascade`, então a ordem inversa também funcionaria; a
ordem acima é a que não depende de o `PRAGMA foreign_keys` estar ligado no D1.

**O que o reset deliberadamente não toca.** `questions`, `alternatives`,
`explanations` e `taxonomy_terms` — o acervo. Ele não participa do fluxo de
compra, e `questions.created_by` referencia `users` com `ON DELETE set null`:
apagar o admin errado apagaria a autoria do acervo, em silêncio.

### Conferir que voltou ao zero

```bash
npx wrangler d1 execute mais-aprovacao-db --remote --command \
  "SELECT 'users' t, count(*) n FROM users
   UNION ALL SELECT 'subscriptions', count(*) FROM subscriptions
   UNION ALL SELECT 'auth_tokens', count(*) FROM auth_tokens
   UNION ALL SELECT 'webhook_events', count(*) FROM webhook_events
   UNION ALL SELECT 'deleted_accounts', count(*) FROM deleted_accounts"
```

- [ ] `users` = 1 (só o admin), todo o resto = 0.

### O ciclo de uma rodada

1. Reset (acima).
2. Compra de teste no sandbox → seções 3 a 6.
3. Reconciliação → seção 7 (tem reset próprio, local).
4. Anotar divergências. Reset de novo antes da próxima tentativa.

> **Não existe reset para a Hotmart.** Cada rodada consome uma compra de teste
> no sandbox e deixa a assinatura anterior lá. Isso é esperado; o que importa é
> que o `subscriber_code` muda a cada compra, então rodadas antigas não colidem
> com a nova. As assinaturas velhas do sandbox continuarão aparecendo na
> listagem da seção 7 — e é justamente por isso que o filtro por
> `HOTMART_SUBSCRIPTION_UCODES` precisa estar correto.

---

## 3. Fluxo ponta a ponta

- [ ] Apontar o webhook do sandbox para o Worker publicado.
- [ ] Compra de teste → `PURCHASE_APPROVED` chega e responde 200.
- [ ] `users` tem o aluno, com `document_hash` preenchido e `password_hash` nulo.
- [ ] `subscriptions` tem a linha com `access_until` = `date_next_charge`.
- [ ] **O email chegou** (checar também spam).
- [ ] Abrir o link → **cai em 404**, porque `/definir-senha` é do sub-projeto 4.
      Pegar o `token` da query string e chamar `POST /auth/set-password` direto.
- [ ] `POST /auth/set-password` → responde 200 e seta cookie.
- [ ] `GET /auth/me` → `tier: "assinante"`.
- [ ] Reusar o mesmo token → 400.
- [ ] `POST /auth/login` com a senha → 200.
- [ ] `POST /auth/login` com senha errada → 401 `invalid_credentials`.
- [ ] `POST /auth/login` com email inexistente → **resposta idêntica**.

## 4. Recuperação

- [ ] `POST /auth/recover` com email e CPF corretos → 200, email chega.
- [ ] Repetir em menos de 5 min → 200, **sem segundo email**.
- [ ] CPF errado → 200, sem email.
- [ ] Email inexistente → 200, sem email.

## 5. Cancelamento

- [ ] Cancelar a assinatura no painel do sandbox.
- [ ] `SUBSCRIPTION_CANCELLATION` chega e responde 200.
- [ ] `access_until` = `date_next_charge` do payload (**não** a data de hoje).
- [ ] `GET /auth/me` ainda diz `assinante` (o ciclo pago não acabou).
- [ ] Confirmar que o payload realmente **não traz** `product.ucode`.

## 6. Idempotência

- [ ] Reenviar o mesmo evento (mesmo `id`) → 200 com `duplicate: true`.
- [ ] Nenhuma linha duplicada em `subscriptions`; nenhum segundo email.

## 7. Reconciliação

> 🔴 **Bloqueada.** `HOTMART_SUBSCRIPTION_UCODES` ainda está em
> `REPLACE_WITH_REAL_UCODES`. O filtro de `reconcile.ts:69` descarta toda
> assinatura cujo `product.ucode` não esteja na lista, então hoje o cron roda,
> percorre a listagem inteira e não casa com nada — todos os testes abaixo
> passariam por engano, com zero em todos os contadores. Pegar o ucode do
> produto no painel da Hotmart antes de começar esta seção.

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

- [ ] `HOTMART_SUBSCRIPTION_UCODES` preenchido com o ucode real.
- [ ] Apagar manualmente uma linha de `subscriptions` cujo assinante está ativo
      no sandbox.
- [ ] Rodar o cron → a linha é recriada e o link mágico é enviado.
- [ ] Rodar de novo → nenhum email novo (guarda de token pendente).
- [ ] Criar no D1 uma assinatura com código inexistente na Hotmart → rodar o
      cron → **ela continua intocada** (`missingInApi` > 0, `revoked` = 0).
- [ ] **Novo, por causa do `accession_date`:** confirmar que uma assinatura com
      `accession_date` anterior a 30 dias atrás aparece na listagem. É o que a
      correção desta rodada comprou, e o único jeito de provar que ela pegou.

## 8. Turnstile

- [ ] `POST /auth/login` sem `turnstileToken` → 403.
- [ ] Com as chaves de teste "sempre falha" da Cloudflare → 403.

> Os segredos já foram conferidos na fase 6 do runbook de deploy
> (`wrangler secret list` com os seis, nenhum em `wrangler.jsonc`). Não repetir
> aqui.

## 9. LGPD

- [ ] Nos logs do Worker, **nenhum CPF, endereço ou telefone**.
- [ ] `SELECT * FROM users` não tem documento legível.
- [ ] `webhook_events` não guarda payload.

---

## Pendências que este runbook pode gerar

| Se acontecer | Ação |
|---|---|
| ~~Caminho da API diferente~~ | ✅ confirmado — `/payments/api/v1/subscriptions` |
| ~~`product.ucode` ausente na listagem~~ | ✅ vem no payload; filtro por ucode viável |
| Segunda página ainda traz `next_page_token` | laço infinito em `listSubscriptions` — passa a exigir guarda por `total_results` |
| Fixtures divergentes | corrigir `test/fixtures/hotmart.ts` |
| Email não chega | conferir SPF/DKIM e a cota diária (conta nova tem limite conservador) |
| `send_email` incompatível com o vitest-pool-workers | contorno documentado em `vitest.config.ts` |
