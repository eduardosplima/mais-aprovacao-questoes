/**
 * Cria (ou recria) o admin de desenvolvimento no D1 local. Roda uma vez por
 * suíte, pelo script `npm test` — nunca por import de spec.
 *
 * O hash PBKDF2 é recalculado aqui em vez de importado de
 * `api/src/lib/password.ts`: aquele arquivo é TypeScript de Worker e este é um
 * script Node solto. A duplicação é de 12 linhas e é **auto-verificável** — se
 * o formato divergir do que `verifyPassword` espera, o primeiro teste de login
 * falha imediatamente, que é o teste logo ao lado.
 */
import { execFileSync } from "node:child_process";
import { EMAIL, SENHA } from "./credenciais.mjs";

const ITERACOES = 100_000;

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function hashSenha(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERACOES, hash: "SHA-256" },
    chave,
    256,
  );
  return `pbkdf2$sha256$${ITERACOES}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

function d1(sql) {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "mais-aprovacao-db", "--local", "--command", sql],
    { cwd: new URL("../../../api", import.meta.url).pathname, stdio: "inherit" },
  );
}

const hash = await hashSenha(SENHA);
const agora = Date.now();

// Limpa o acervo entre execuções para que o e2e do caminho crítico não conte
// questões deixadas pela rodada anterior.
d1("delete from alternatives");
d1("delete from explanations");
d1("delete from questions");
d1("delete from taxonomy_terms");
d1(`delete from users where email = '${EMAIL}'`);
d1(
  `insert into users (id, email, name, role, password_hash, created_at, updated_at)
   values ('dev-admin', '${EMAIL}', 'Admin Dev', 'admin', '${hash}', ${agora}, ${agora})`,
);

console.log(`admin de desenvolvimento pronto: ${EMAIL}`);
