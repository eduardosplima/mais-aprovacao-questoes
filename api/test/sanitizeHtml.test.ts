import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../src/lib/sanitizeHtml";

describe("sanitizeHtml", () => {
  it("mantém a formatação que o editor produz", async () => {
    const html = "<p><strong>a</strong> <em>b</em></p><ul><li>c</li></ul>";
    expect(await sanitizeHtml(html)).toBe(html);
  });

  it("remove script inteiro, com o conteúdo", async () => {
    expect(await sanitizeHtml("<p>oi</p><script>alert(1)</script>")).toBe(
      "<p>oi</p>",
    );
  });

  it("remove script aninhado em tag não permitida", async () => {
    expect(await sanitizeHtml("<div><script>alert(1)</script>oi</div>")).toBe(
      "oi",
    );
  });

  it("remove handler de evento e mantém a tag", async () => {
    expect(await sanitizeHtml('<p onclick="x()">oi</p>')).toBe("<p>oi</p>");
  });

  it("remove onerror de img preservando src e alt", async () => {
    expect(
      await sanitizeHtml('<img src="/a.png" alt="x" onerror="y()">'),
    ).toBe('<img src="/a.png" alt="x">');
  });

  it("neutraliza href javascript:", async () => {
    const out = await sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  it("neutraliza src javascript: em img", async () => {
    const out = await sanitizeHtml('<img src="javascript:alert(1)">');
    expect(out).not.toContain("javascript:");
  });

  it("aceita http, https, mailto e caminho relativo", async () => {
    for (const href of [
      "https://a.test/x",
      "http://a.test/x",
      "mailto:a@test.com",
      "/interno",
    ]) {
      expect(await sanitizeHtml(`<a href="${href}">x</a>`)).toContain(href);
    }
  });

  it("neutraliza href protocol-relative (//) e o disfarce com barra invertida (/\\)", async () => {
    for (const href of ["//evil.com/x", "/\\evil.com"]) {
      const out = await sanitizeHtml(`<a href="${href}">x</a>`);
      expect(out).toBe("<a>x</a>");
    }
  });

  it("neutraliza esquemas perigosos disfarçados (case, tab, newline) e outros esquemas não permitidos", async () => {
    const hrefs = [
      "JavaScript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
    ];
    for (const href of hrefs) {
      const out = await sanitizeHtml(`<a href="${href}">x</a>`);
      expect(out).toBe("<a>x</a>");
    }
  });

  it("continua aceitando os esquemas e caminhos legítimos", async () => {
    for (const href of [
      "/interno",
      "#ancora",
      "https://a.test/x",
      "mailto:a@test.com",
    ]) {
      expect(await sanitizeHtml(`<a href="${href}">x</a>`)).toContain(href);
    }
  });

  it("descarta svg com script", async () => {
    const out = await sanitizeHtml("<svg><script>alert(1)</script></svg>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("svg");
  });

  it("preserva tabela, que é o que prova de concurso mais usa", async () => {
    const html =
      "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>";
    expect(await sanitizeHtml(html)).toBe(html);
  });
});
