/**
 * Sanitiza o HTML vindo do editor, na ESCRITA, no servidor.
 *
 * O editor do painel é só uma sugestão para clientes bem-comportados — nada
 * impede um POST direto com `<script>`. Por isso a sanitização mora aqui e não
 * no browser.
 *
 * Usa o `HTMLRewriter` da plataforma em vez de DOMPurify: DOMPurify precisa de
 * DOM, o que no Worker significaria arrastar jsdom. Mesma escolha que levou a
 * PBKDF2 via WebCrypto em vez de bcrypt.
 */

/** Tudo que o TipTap pode produzir e que faz sentido numa questão. */
const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "em", "u", "s", "sub", "sup",
  "ul", "ol", "li",
  "blockquote", "code", "pre",
  "h2", "h3", "h4",
  "table", "thead", "tbody", "tr", "th", "td",
  "img", "a",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  img: new Set(["src", "alt"]),
  a: new Set(["href"]),
  th: new Set(["colspan", "rowspan"]),
  td: new Set(["colspan", "rowspan"]),
};

/** Atributos cujo VALOR é uma URL e precisa de validação de esquema. */
const URL_ATTRS = new Set(["src", "href"]);

/**
 * Permitir o atributo `href` não diz nada sobre o valor dele: uma allowlist de
 * nomes deixa `javascript:alert(1)` passar intacto. Só http, https, mailto e
 * caminhos relativos entram.
 */
function isSafeUrl(value: string): boolean {
  const v = value.trim();
  if (v.startsWith("/") || v.startsWith("#")) return true;
  try {
    const proto = new URL(v).protocol;
    return proto === "http:" || proto === "https:" || proto === "mailto:";
  } catch {
    // Não é URL absoluta nem caminho reconhecido — recusa por padrão.
    return false;
  }
}

export async function sanitizeHtml(html: string): Promise<string> {
  const res = new HTMLRewriter()
    // Precisa vir antes: remove a tag COM o conteúdo, senão o corpo do script
    // sobreviveria como texto ao ser desembrulhado pela regra genérica.
    .on("script, style, iframe, object, embed", {
      element(el) {
        el.remove();
      },
    })
    .on("*", {
      element(el) {
        if (!ALLOWED_TAGS.has(el.tagName)) {
          el.removeAndKeepContent();
          return;
        }
        const allowed = ALLOWED_ATTRS[el.tagName] ?? new Set<string>();
        for (const [name, value] of [...el.attributes]) {
          if (!allowed.has(name)) {
            el.removeAttribute(name);
          } else if (URL_ATTRS.has(name) && !isSafeUrl(value)) {
            el.removeAttribute(name);
          }
        }
      },
    })
    .transform(new Response(html));

  return await res.text();
}
