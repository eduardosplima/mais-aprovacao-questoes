/**
 * Audita a árvore de node_modules contra a base OSV.dev.
 *
 * Sem dependências: lê os package.json instalados, monta um querybatch e usa
 * fetch nativo. `npm audit` compara contra CVEs publicados e não enxerga pacote
 * comprometido ontem — isto aqui cobre a metade conhecida do problema; a
 * proteção contra a metade desconhecida é o cooldown de 14 dias e o
 * ignore-scripts (ver ~/.claude/CLAUDE.md, seção 5).
 *
 * Uso: node scripts/audit-osv.mjs   (exit 1 se houver vulnerabilidade)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../node_modules", import.meta.url).pathname;

/**
 * Percorre node_modules, incluindo escopos (@org/pkg) e **node_modules
 * aninhados** — é neles que o npm coloca a cópia divergente quando duas deps
 * pedem versões incompatíveis do mesmo pacote, e é exatamente onde uma versão
 * vulnerável se esconde enquanto a do topo aparece limpa.
 */
function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".bin" || entry === ".package-lock.json") continue;
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry.startsWith("@")) {
      found.push(...collect(path));
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      if (pkg.name && pkg.version) found.push({ name: pkg.name, version: pkg.version });
    } catch {
      // diretório sem package.json legível — não é um pacote
    }
    try {
      found.push(...collect(join(path, "node_modules")));
    } catch {
      // sem node_modules aninhado — caso comum
    }
  }
  return found;
}

const packages = collect(ROOT);
const res = await fetch("https://api.osv.dev/v1/querybatch", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    queries: packages.map((p) => ({
      package: { name: p.name, ecosystem: "npm" },
      version: p.version,
    })),
  }),
});

if (!res.ok) {
  console.error(`OSV.dev respondeu ${res.status}`);
  process.exit(2);
}

const { results } = await res.json();
const hits = results
  .map((r, i) => ({ ...packages[i], vulns: r.vulns ?? [] }))
  .filter((r) => r.vulns.length > 0);

console.log(`${packages.length} pacotes consultados na OSV.dev`);

if (hits.length === 0) {
  console.log("Nenhuma vulnerabilidade conhecida.");
  process.exit(0);
}

for (const hit of hits) {
  console.log(`\n${hit.name}@${hit.version}`);
  for (const v of hit.vulns) console.log(`  ${v.id}  https://osv.dev/${v.id}`);
}
process.exit(1);
