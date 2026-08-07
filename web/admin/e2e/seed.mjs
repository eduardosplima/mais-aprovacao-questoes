/**
 * Cria (ou recria) o admin de desenvolvimento no D1 local, e limpa o acervo.
 * Exportada como `semear()` para que cada spec a chame no próprio
 * `test.beforeAll` — cada arquivo fica independente dos outros, sem depender
 * da ordem em que a suíte executa os arquivos (Task 9: sem isso, um spec que
 * persiste dado real, como o do caminho crítico, contamina o D1 compartilhado
 * para quem rodar depois).
 *
 * Continua funcionando como script solto (`node e2e/seed.mjs` / `npm run
 * seed`), pro ambiente de desenvolvimento manual.
 *
 * O hash PBKDF2 é recalculado aqui em vez de importado de
 * `api/src/lib/password.ts`: aquele arquivo é TypeScript de Worker e este é um
 * script Node solto. A duplicação é de 12 linhas e é **auto-verificável** — se
 * o formato divergir do que `verifyPassword` espera, o primeiro teste de login
 * falha imediatamente, que é o teste logo ao lado.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

export async function semear() {
  const hash = await hashSenha(SENHA);
  const agora = Date.now();

  // Limpa o acervo inteiro — cada spec começa do zero, sem dado de nenhum
  // outro arquivo.
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
}

// Modo CLI: `node e2e/seed.mjs` (via `npm run seed`) continua preparando o
// ambiente de desenvolvimento manual.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await semear();
}
