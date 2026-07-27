import { describe, it, expect } from "vitest";
import { sendMagicLink } from "../src/lib/email";
import { fakeEmailSender, envWith } from "./helpers";

describe("sendMagicLink", () => {
  it("monta o link com APP_BASE_URL e o token", async () => {
    const { sent, sender } = fakeEmailSender();
    await sendMagicLink(envWith({ EMAIL: sender }), {
      to: "aluno@test.com",
      name: "Aluno",
      token: "TOKEN-ABC",
      kind: "first_access",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(
      "https://app.test/definir-senha?token=TOKEN-ABC",
    );
    expect(sent[0].text).toContain(
      "https://app.test/definir-senha?token=TOKEN-ABC",
    );
  });

  it("usa EMAIL_FROM e o destinatário informado", async () => {
    const { sent, sender } = fakeEmailSender();
    await sendMagicLink(envWith({ EMAIL: sender }), {
      to: "aluno@test.com",
      name: null,
      token: "T",
      kind: "first_access",
    });

    expect(sent[0].to).toBe("aluno@test.com");
    expect(sent[0].from).toBe("nao-responda@app.test");
  });

  it("assunto difere entre primeiro acesso e recuperação", async () => {
    const { sent, sender } = fakeEmailSender();
    const e = envWith({ EMAIL: sender });

    await sendMagicLink(e, {
      to: "a@test.com",
      name: null,
      token: "T1",
      kind: "first_access",
    });
    await sendMagicLink(e, {
      to: "a@test.com",
      name: null,
      token: "T2",
      kind: "recovery",
    });

    expect(sent[0].subject).not.toBe(sent[1].subject);
    expect(sent[0].subject.toLowerCase()).toContain("acesso");
    expect(sent[1].subject.toLowerCase()).toContain("recupera");
  });

  it("saúda pelo nome quando existe e usa fallback quando não", async () => {
    const { sent, sender } = fakeEmailSender();
    const e = envWith({ EMAIL: sender });

    await sendMagicLink(e, {
      to: "a@test.com",
      name: "Maria",
      token: "T",
      kind: "first_access",
    });
    await sendMagicLink(e, {
      to: "b@test.com",
      name: null,
      token: "T",
      kind: "first_access",
    });

    expect(sent[0].text).toContain("Maria");
    expect(sent[1].text).toContain("Olá");
  });

  it("codifica tokens com caracteres especiais na URL", async () => {
    const { sent, sender } = fakeEmailSender();
    await sendMagicLink(envWith({ EMAIL: sender }), {
      to: "a@test.com",
      name: null,
      token: "a+b/c=d",
      kind: "first_access",
    });

    expect(sent[0].html).toContain("token=a%2Bb%2Fc%3Dd");
  });
});
