// Token launch radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json (or --input <file|dir>),
// scores every pre-token protocol with the frozen radar-2 model in
// lib/valuation.ts, writes the ranked board to /output/board.json, writes the
// dashboard's data to /output/data.js, copies dashboard/ and screenshots/
// into /output, and writes /output/dossier.json with lib/dossier.ts.
//
// The run is deterministic: the same snapshot always writes the same bytes,
// because no clock, random value or map iteration order leaks into output.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardIssue, buildRadar, dataScript, parseSnapshot } from "./lib/valuation.ts";
import { buildDossier } from "./lib/dossier.ts";

const TEXT_MAX_BYTES = 65_536;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flagValue("input", "/input");
const inputFile = inputArg.endsWith(".json") ? inputArg : join(inputArg, "snapshot.json");
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const outDir = flagValue("output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

const snapshot = parseSnapshot(readFileSync(inputFile, "utf8"));
const radar = buildRadar(snapshot);
const issue = boardIssue(radar.board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: refusing to write a board the gate rejects: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "board.json"), `${JSON.stringify({ rows: radar.board })}\n`);
writeFileSync(join(outDir, "data.js"), dataScript(radar, snapshot));

function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    copied.push(name);
  }
  return copied;
}

const here = fileURLToPath(new URL(".", import.meta.url));
const dashFiles = copyTree(join(here, "dashboard"), join(outDir, "dashboard"));
if (!dashFiles.includes("index.html") || !dashFiles.some((f) => f.endsWith(".css")) || !dashFiles.some((f) => f.endsWith(".js"))) {
  process.stderr.write("token radar: dashboard/ must hold index.html and at least one .css and one .js file\n");
  process.exit(1);
}
const shots = copyTree(join(here, "screenshots"), join(outDir, "screenshots"));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3 or 4\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last, from exactly what /output now holds, with
// the one call the gate makes: text_max_bytes 65,536 and nothing else. It
// must be the last write: anything written after it would make it stale.
writeFileSync(join(outDir, "dossier.json"), buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES }));

const top = radar.board.slice(0, 3).map((r) => `${r.slug} $${r.implied_value_usd.toLocaleString("en-US")}`).join(" | ");
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${radar.board.length} rows (${radar.counts.earlyKept} early, ${radar.live.length} live set aside, ` +
    `${radar.restricted.length} restricted, ${radar.excluded.length} excluded)\n` +
    `token radar: exponent e=${radar.exponent}, fitted b=${radar.fit.b} (R2=${radar.fit.r2}, n=${radar.fit.n})\n` +
    `token radar: top 3: ${top}\n` +
    `token radar: wrote ${join(outDir, "board.json")}, ${join(outDir, "data.js")}, dashboard (${dashFiles.length} files), ` +
    `screenshots (${shots.length} images) and ${join(outDir, "dossier.json")}\n`,
);
