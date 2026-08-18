/**
 * Cria ou rotaciona a senha de um admin.
 *
 * É o único jeito de uma linha nascer em `admins` — nenhuma rota escreve lá.
 * O direito de ser admin não vem daqui: vem de `ADMIN_EMAILS`, em
 * `wrangler.jsonc`, editado à mão. Este script só instala a senha de quem já
 * está na lista.
 *
 * Uso:
 *   npm run admin:senha -- pessoa@dominio.com            (D1 remoto)
 *   npm run admin:senha -- pessoa@dominio.com --local    (D1 de desenvolvimento)
 *   npm run admin:senha -- pessoa@dominio.com --remover
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripJsonComments } from "./jsonc.mjs";

const ITERACOES = 100_000;
const MIN_SENHA = 12;
const RAIZ = new URL("..", import.meta.url).pathname;

// Escritos por código para não deixar byte de controle solto no fonte.
const EOT = String.fromCharCode(4);
const ETX = String.fromCharCode(3);
const DEL = String.fromCharCode(127);

function normalizar(email) {
  return email.trim().toLowerCase();
}

export function allowlist() {
  const bruto = readFileSync(join(RAIZ, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(stripJsonComments(bruto));
  const csv = config.vars?.ADMIN_EMAILS;
  if (typeof csv !== "string") {
    throw new Error("ADMIN_EMAILS não encontrado em wrangler.jsonc");
  }
  return csv.split(",").map(normalizar).filter(Boolean);
}

/**
 * Lê sem eco. O `readline` não oferece isso sem mexer em API privada, então o
 * caminho é o terminal cru: nada é impresso de volta enquanto a pessoa digita.
 */
function perguntaSenha(rotulo) {
  process.stdout.write(rotulo);
  const { stdin } = process;
  if (!stdin.isTTY) {
    throw new Error("este script precisa de um terminal interativo");
  }
  return new Promise((resolve) => {
    let buffer = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const aoDado = (chunk) => {
      // Colar uma senha entrega vários caracteres num chunk só.
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === EOT) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", aoDado);
          process.stdout.write("\n");
          resolve(buffer);
          return;
        }
        if (ch === ETX) {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === DEL || ch === "\b") buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    };
    stdin.on("data", aoDado);
  });
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

/** Mesmo formato de api/src/lib/password.ts. */
export async function hashSenha(senha) {
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

const aspas = (valor) => `'${valor.replace(/'/g, "''")}'`;

/**
 * O SQL vai por arquivo, não por `--command`: um argumento de linha de comando
 * fica visível em `ps` para qualquer processo da máquina e cai no histórico do
 * shell. O hash não é a senha, mas também não é para circular.
 */
function executarSql(sql, local) {
  const arquivo = join(mkdtempSync(join(tmpdir(), "admin-senha-")), "comando.sql");
  writeFileSync(arquivo, sql, { mode: 0o600 });
  try {
    execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "mais-aprovacao-db",
        local ? "--local" : "--remote",
        "--file",
        arquivo,
      ],
      { cwd: RAIZ, stdio: "inherit" },
    );
  } finally {
    unlinkSync(arquivo);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const remover = args.includes("--remover");
  const alvo = args.find((a) => !a.startsWith("--"));

  if (!alvo) {
    console.error("uso: npm run admin:senha -- <email> [--local] [--remover]");
    process.exit(1);
  }

  const email = normalizar(alvo);

  // Conveniência, não fronteira: quem decide de verdade é requireSessaoAdmin,
  // que confere ADMIN_EMAILS a cada requisição. Isto só evita criar uma senha
  // que nunca serviria para nada.
  if (!allowlist().includes(email)) {
    console.error(
      `${email} não está em ADMIN_EMAILS (api/wrangler.jsonc).\n` +
        "Acrescente o email à lista, publique o Worker e rode de novo.",
    );
    process.exit(1);
  }

  const agora = Date.now();

  if (remover) {
    executarSql(`delete from admins where email = ${aspas(email)};`, local);
    console.log(`senha de ${email} removida${local ? " (local)" : ""}`);
  } else {
    const senha = await perguntaSenha(`senha para ${email}: `);
    const confirmacao = await perguntaSenha("confirme: ");
    if (senha !== confirmacao) {
      console.error("as senhas não conferem");
      process.exit(1);
    }
    if (senha.length < MIN_SENHA) {
      console.error(`a senha precisa de pelo menos ${MIN_SENHA} caracteres`);
      process.exit(1);
    }
    const hash = await hashSenha(senha);
    executarSql(
      `insert into admins (email, password_hash, created_at, updated_at)
       values (${aspas(email)}, ${aspas(hash)}, ${agora}, ${agora})
       on conflict(email) do update
         set password_hash = excluded.password_hash,
             updated_at = excluded.updated_at;`,
      local,
    );
    console.log(`senha de ${email} definida${local ? " (local)" : ""}`);
  }
}

// Modo CLI: `npm run admin:senha -- ...`. Sem isto, importar `hashSenha` ou
// `allowlist` para testar dispararia o CLI inteiro como efeito colateral.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
