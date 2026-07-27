/**
 * Fixtures derivados da documentação oficial (webhook 2.0.0), NÃO de tráfego
 * real. O runbook (Task 17) inclui capturar um evento do sandbox e conferir
 * estes formatos.
 */

interface PurchaseOverrides {
  id?: string;
  event?: string;
  ucode?: string;
  email?: string;
  name?: string | null;
  document?: string | null;
  subscriberCode?: string | null;
  dateNextCharge?: number | null;
  recurrenceNumber?: number;
  transaction?: string;
  planName?: string;
}

export function purchaseApproved(overrides: PurchaseOverrides = {}) {
  const {
    id = "evt-" + crypto.randomUUID(),
    event = "PURCHASE_APPROVED",
    ucode = "UCODE_ASSINATURA",
    email = "comprador@test.com",
    name = "Comprador Teste",
    document = "123.456.789-09",
    subscriberCode = "SUBCODE-1",
    dateNextCharge = Date.now() + 30 * 86400000,
    recurrenceNumber = 1,
    transaction = "HP17715690036014",
    planName = "Mensal",
  } = overrides;

  return {
    id,
    creation_date: Date.now(),
    event,
    version: "2.0.0",
    data: {
      product: { id: 1234567, ucode, name: "Mais Aprovação" },
      buyer: {
        email,
        ...(name === null ? {} : { name }),
        ...(document === null ? {} : { document, document_type: "CPF" }),
        checkout_phone: "5531999999999",
        address: { country: "Brasil", country_iso: "BR" },
      },
      purchase: {
        transaction,
        status: "APPROVED",
        approved_date: Date.now(),
        order_date: Date.now(),
        ...(dateNextCharge === null ? {} : { date_next_charge: dateNextCharge }),
        recurrence_number: recurrenceNumber,
        payment: { type: "PIX" },
        price: { value: 49.9, currency_value: "BRL" },
        offer: { code: "OFERTA1" },
      },
      ...(subscriberCode === null
        ? {}
        : {
            subscription: {
              status: "ACTIVE",
              plan: { id: 99, name: planName },
              subscriber: { code: subscriberCode },
            },
          }),
    },
  };
}

interface CancellationOverrides {
  id?: string;
  subscriberCode?: string;
  email?: string;
  dateNextCharge?: number | null;
}

export function subscriptionCancellation(
  overrides: CancellationOverrides = {},
) {
  const {
    id = "evt-" + crypto.randomUUID(),
    subscriberCode = "SUBCODE-1",
    email = "comprador@test.com",
    dateNextCharge = Date.now() + 15 * 86400000,
  } = overrides;

  return {
    id,
    creation_date: Date.now(),
    event: "SUBSCRIPTION_CANCELLATION",
    version: "2.0.0",
    data: {
      // ATENÇÃO: o payload de cancelamento NÃO traz product.ucode.
      product: { id: 1234567, name: "Mais Aprovação" },
      subscriber: { code: subscriberCode, name: "Comprador Teste", email },
      subscription: { id: 555, plan: { id: 99, name: "Mensal" } },
      cancellation_date: Date.now(),
      ...(dateNextCharge === null ? {} : { date_next_charge: dateNextCharge }),
    },
  };
}

export function postWebhook(
  app: {
    request: (
      path: string,
      init: RequestInit,
      env: any,
    ) => Response | Promise<Response>;
  },
  payload: unknown,
  env: unknown,
  hottok: string | null = "test-hottok",
): Promise<Response> {
  return Promise.resolve(
    app.request(
      "/webhooks/hotmart",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(hottok === null ? {} : { "x-hotmart-hottok": hottok }),
        },
        body: JSON.stringify(payload),
      },
      env,
    ),
  );
}
