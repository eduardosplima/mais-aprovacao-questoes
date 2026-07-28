# Runbook — verificação manual contra o sandbox da Hotmart

> A suíte automatizada usa fixtures **derivados da documentação**, não de
> tráfego real, e dois valores de configuração não puderam ser confirmados.
> Este roteiro é o que fecha essa lacuna. Rodar antes de considerar a Fundação
> pronta.

## Pré-requisitos

| Item | Onde obter |
|---|---|
| Conta sandbox Hotmart com produto de assinatura | painel Hotmart |
| `hottok` | painel → Ferramentas → Webhook |
| `client_id` / `client_secret` (API de dados) | painel → Ferramentas → Credenciais |
| `ucode` do produto | painel do produto |
| Domínio de envio verificado (SPF/DKIM) | dashboard Cloudflare → Email |
| Chaves Turnstile | dashboard Cloudflare → Turnstile |

## 1. Confirmar o endpoint da API de dados

**Esta é a lacuna conhecida.** O host e o caminho em `HOTMART_API_BASE_URL` /
`HOTMART_TOKEN_URL` e a rota `/payments/api/v1/subscriptions` em
`src/lib/hotmartApi.ts` foram inferidos, não confirmados.

```bash
# obter token
curl -s -X POST "$HOTMART_TOKEN_URL" \
  -H "Authorization: Basic $(printf '%s:%s' "$CLIENT_ID" "$CLIENT_SECRET" | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"

# listar assinaturas
curl -s "https://sandbox.hotmart.com/payments/api/v1/subscriptions?max_results=50&start_date=1577836800000" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | head -c 2000
```

- [ ] Token obtido. Se o `HOTMART_TOKEN_URL` estiver errado, corrigir em `wrangler.jsonc`.
- [ ] Listagem retorna itens. Se o caminho estiver errado, corrigir em `src/lib/hotmartApi.ts` e ajustar `test/hotmartApi.test.ts`.
- [ ] Conferir que o item traz `subscriber.email`, `subscriber_code`, `status`, `product.ucode` e `date_next_charge`. **Se `product.ucode` não vier, o filtro do cron não funciona** — nesse caso passar a filtrar por `product_id` e adicionar a variável correspondente.
- [ ] Conferir o formato da paginação (`page_info.next_page_token`).

## 2. Conferir os fixtures contra um evento real

- [ ] Apontar o webhook do sandbox para um coletor (`webhook.site` ou similar).
- [ ] Fazer uma compra de teste no sandbox.
- [ ] Salvar o JSON recebido.
- [ ] Comparar campo a campo com `api/test/fixtures/hotmart.ts`:
  - `data.product.ucode`
  - `data.buyer.email` / `.name` / `.document`
  - `data.purchase.transaction` / `.date_next_charge` / `.recurrence_number`
  - `data.subscription.subscriber.code` / `.plan.name` / `.status`
- [ ] Ajustar os fixtures onde divergirem e rodar `npm test`.

> Divergência aqui é o risco mais provável do plano: os testes podem estar
> verdes contra um payload que a Hotmart não envia.

## 3. Fluxo ponta a ponta

- [ ] Apontar o webhook do sandbox para o Worker publicado.
- [ ] Compra de teste → `PURCHASE_APPROVED` chega e responde 200.
- [ ] `users` tem o aluno, com `document_hash` preenchido e `password_hash` nulo.
- [ ] `subscriptions` tem a linha com `access_until` = `date_next_charge`.
- [ ] **O email chegou** (checar também spam).
- [ ] Abrir o link → `POST /auth/set-password` → responde 200 e seta cookie.
- [ ] `GET /auth/me` → `tier: "assinante"`.
- [ ] Reusar o mesmo link → 400.
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

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

- [ ] Apagar manualmente uma linha de `subscriptions` cujo assinante está ativo no sandbox.
- [ ] Rodar o cron → a linha é recriada e o link mágico é enviado.
- [ ] Rodar de novo → nenhum email novo (guarda de token pendente).
- [ ] Criar no D1 uma assinatura com código inexistente na Hotmart → rodar o cron → **ela continua intocada** (`missingInApi` > 0, `revoked` = 0).

## 8. Turnstile e segredos

- [ ] `POST /auth/login` sem `turnstileToken` → 403.
- [ ] Com as chaves de teste "sempre falha" da Cloudflare → 403.
- [ ] `wrangler secret list` mostra os seis segredos.
- [ ] Nenhum segredo aparece em `wrangler.jsonc`.

## 9. LGPD

- [ ] Nos logs do Worker, **nenhum CPF, endereço ou telefone**.
- [ ] `SELECT * FROM users` não tem documento legível.
- [ ] `webhook_events` não guarda payload.

## Pendências que este runbook pode gerar

| Se acontecer | Ação |
|---|---|
| Caminho da API diferente | corrigir `src/lib/hotmartApi.ts` + teste |
| `product.ucode` ausente na listagem | passar a filtrar por `product_id`, nova variável |
| Fixtures divergentes | corrigir `test/fixtures/hotmart.ts` |
| Email não chega | conferir SPF/DKIM e a cota diária (conta nova tem limite conservador) |
| `send_email` incompatível com o vitest-pool-workers | contorno documentado em `vitest.config.ts` |
