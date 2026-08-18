/**
 * Gera o certificado auto-assinado que o `next dev` usa durante o e2e.
 *
 * Existe por causa do WebKit: o Worker marca o cookie de sessão como `Secure`
 * (api/src/lib/cookies.ts:8) e o WebKit descarta cookie `Secure` que chegue
 * por `http://localhost` — ao contrário do Chromium, que trata localhost como
 * origem confiável. Sem TLS aqui, nenhum teste que dependa de sessão passa no
 * WebKit.
 *
 * TLS só no servidor que o Playwright sobe, e não no `npm run dev`: assim o
 * `secure: true` continua sendo exatamente o que a produção usa, sem ramo de
 * desenvolvimento no código de segurança.
 *
 * `openssl` em vez de mkcert porque já vem no macOS e no Linux — nada é
 * baixado para gerar isto. O certificado não é confiável para o sistema, e não
 * precisa ser: o Playwright liga `ignoreHTTPSErrors`, e para o navegador basta
 * o esquema ser https para o cookie `Secure` ser aceito.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const pasta = join(aqui, "certs");
export const CHAVE = join(pasta, "localhost-key.pem");
export const CERTIFICADO = join(pasta, "localhost.pem");

export function garantirCertificado() {
  if (existsSync(CHAVE) && existsSync(CERTIFICADO)) return;

  mkdirSync(pasta, { recursive: true });
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", CHAVE,
      "-out", CERTIFICADO,
      // 3650 dias: este certificado nunca sai da máquina de quem roda o teste,
      // e uma validade curta só produziria falha misteriosa meses depois.
      "-days", "3650",
      "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "pipe" },
  );
  console.log("certificado de desenvolvimento gerado em e2e/certs/");
}

garantirCertificado();
