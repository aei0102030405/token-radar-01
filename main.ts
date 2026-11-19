// Token Radar, model radar-2 (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), ranks every rankable
// pre-token protocol with the model in lib/model.ts, and writes the entry to /output:
//   board.json    the ranked board (197 rows: the 40-protocol watchlist plus every other rankable
//                 pre-token protocol, above the floor as well as below it)
//   launch.json   the top 25 launch candidates by readiness times log implied value
//   data.js       the dashboard's dataset, written beside dashboard/
//   dashboard/    the static page (index.html, app.css, app.js), copied from this repository
//   screenshots/  the three captures of the page, copied from this repository
//   dossier.json  the judge's summary, built last with the vendored make.fun library, so the
//                 scorer can rebuild it from this /output and compare bytes.
//
// The dashboard is a static page with no framework and no network. It renders from data.js, so the
// page and the board are the same data. Run it outside the grader's container with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { LAUNCH_CANDIDATES, LAUNCH_VERSION, launchCandidates, scoreReadiness } from './lib/launch.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of --name <value>, or the fallback when the flag is absent. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// Launch readiness (launch-1): score every board row from the snapshot's own figures — momentum,
// scale, maturity, breadth and category — and name the 25 protocols where a launch would be both
// ready and worth the most. The board's order never changes: readiness is a second lens on the
// same rows, and the candidates are ranked by readiness times the log of implied value.
const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
for (let i = 0; i < board.length; i++) {
  const row = board[i]!;
  const protocol = bySlug.get(row.slug);
  if (protocol === undefined) continue;
  const { readiness, reason, parts } = scoreReadiness(protocol, snapshot.as_of);
  const partScores = { momentum: parts.momentum, scale: parts.scale, maturity: parts.maturity, breadth: parts.breadth, category: parts.category };
  row.launch_readiness = readiness;
  row.readiness_reason = reason;
  row.readiness_parts = partScores;
  const radarRow = radar.rows[i]!;
  radarRow.launch_readiness = readiness;
  radarRow.readiness_reason = reason;
  radarRow.readiness_parts = partScores;
}
const candidates = launchCandidates(board);
if (candidates.length !== LAUNCH_CANDIDATES) {
  process.stderr.write(`token radar: expected ${LAUNCH_CANDIDATES} launch candidates, scored ${candidates.length}\n`);
  process.exit(1);
}
radar.launch_candidates = candidates;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'launch.json'), `${JSON.stringify({ version: LAUNCH_VERSION, as_of: snapshot.as_of, candidates })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside), ${candidates.length} launch candidates (${LAUNCH_VERSION})\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'launch.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
