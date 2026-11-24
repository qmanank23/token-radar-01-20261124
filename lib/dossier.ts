// Dossier writer for token-radar-01, v2 build.
//
// Builds the makefun/dossier/v1 document from an output directory: the
// screenshots as base64 images plus a capped text of the dashboard source.
// Written from the format the competition rules describe — the scorer
// rebuilds the same document from the same files and compares bytes, so
// this writer must agree with it exactly on every byte it emits.
//
// Layout of the text:
//   ## Dashboard — file count, total bytes, one line per file
//   ## Source — one section per source file: heading, fenced contents
// The text is capped at text_max_bytes UTF-8 bytes. When every source file
// fits whole, nothing is cut and no cut line appears. When one does not fit,
// only its first lines go in, closed by its fence, with a line saying how
// many of its lines were left out, then a cut line for the rest.

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class DossierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DossierError";
  }
}

const SCHEMA = "makefun/dossier/v1";
const MAX_DOSSIER_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 8;
const NAME_OK = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const SOURCE_EXT = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_HEAD = [0xff, 0xd8, 0xff];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function utf8Len(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function startsWith(bytes: Buffer, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
}

function sortStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Canonical JSON: object keys in code-unit order, no spaces, no trailing
// newline. Only plain JSON values are allowed.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError("canonicalJson: not a plain object");
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort(sortStrings)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",")}}`;
  }
  throw new TypeError(`canonicalJson: no JSON form for ${typeof value}`);
}

interface DashEntry {
  path: string;
  size: number;
}

function walkDashboard(root: string): DashEntry[] {
  let st;
  try {
    st = lstatSync(root);
  } catch {
    throw new DossierError("dossier: no dashboard/ directory");
  }
  if (!st.isDirectory()) throw new DossierError("dossier: dashboard is not a directory");
  const found: DashEntry[] = [];
  const stack: string[] = [""];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const dir = rel === "" ? root : join(root, rel);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) throw new DossierError(`dossier: dashboard/${p} is a dot-directory`);
        stack.push(p);
      } else if (entry.isFile()) {
        if (!NAME_OK.test(entry.name)) throw new DossierError(`dossier: dashboard/${p} has a name the dossier refuses`);
        found.push({ path: p, size: lstatSync(join(root, p)).size });
      } else {
        throw new DossierError(`dossier: dashboard/${p} is neither a file nor a directory`);
      }
    }
  }
  return found.sort((x, y) => sortStrings(x.path, y.path));
}

function countLines(bytes: Buffer): number {
  if (bytes.length === 0) return 0;
  let n = 0;
  for (const b of bytes) if (b === 0x0a) n++;
  return bytes[bytes.length - 1] === 0x0a ? n : n + 1;
}

function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

function langOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1);
  return ext === "mjs" ? "js" : ext;
}

interface Section {
  heading: string;
  headingBytes: number;
  body: string | null; // fenced block, null for an empty file
  blockBytes: number;
  fileBytes: number;
  lines: number;
  text: string;
  fence: string;
  lang: string;
  raw: Buffer;
}

export interface DossierCaps {
  text_max_bytes: number;
}

export function buildDossier(dir: string, caps: DossierCaps): Uint8Array {
  const max = caps.text_max_bytes;
  if (!Number.isSafeInteger(max) || max <= 0) {
    throw new DossierError(`dossier: text_max_bytes must be a positive integer, not ${String(max)}`);
  }

  const files = walkDashboard(join(dir, "dashboard"));

  let shotNames: string[];
  try {
    shotNames = readdirSync(join(dir, "screenshots"), { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort(sortStrings);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") throw new DossierError("dossier: no screenshots/ directory");
    throw new DossierError("dossier: screenshots/ cannot be read");
  }
  if (shotNames.length === 0) throw new DossierError("dossier: screenshots/ holds no image");
  if (shotNames.length > MAX_IMAGES) throw new DossierError(`dossier: screenshots/ holds ${shotNames.length} files, over ${MAX_IMAGES}`);

  const images = shotNames.map((name) => {
    if (!NAME_OK.test(name)) throw new DossierError(`dossier: screenshots/${name} has a name the dossier refuses`);
    const st = lstatSync(join(dir, "screenshots", name));
    if (!st.isFile()) throw new DossierError(`dossier: screenshots/${name} is not a regular file`);
    const bytes = readFileSync(join(dir, "screenshots", name));
    const mediaType = startsWith(bytes, PNG_HEAD) ? "image/png" : startsWith(bytes, JPG_HEAD) ? "image/jpeg" : null;
    if (mediaType === null) throw new DossierError(`dossier: screenshots/${name} is neither a PNG nor a JPEG`);
    return { name, media_type: mediaType, sha256: sha256(bytes), base64: bytes.toString("base64") };
  });

  const head = [
    "## Dashboard",
    "",
    `Files: ${files.length} (${files.reduce((n, f) => n + f.size, 0)} bytes)`,
    ...files.map((f) => `- ${f.path} (${f.size} bytes)`),
    "",
    "## Source",
    "",
    "",
  ].join("\n");

  const shown = files.filter((f) => SOURCE_EXT.test(f.path));
  const sections: Section[] = shown.map((f) => {
    const raw = readFileSync(join(dir, "dashboard", f.path));
    const lines = countLines(raw);
    const heading = `### ${f.path}\n\n${raw.length} bytes, ${lines} line${lines === 1 ? "" : "s"}\n\n`;
    if (raw.length === 0) {
      return { heading, headingBytes: utf8Len(heading), body: null, blockBytes: 0, fileBytes: 0, lines, text: "", fence: "```", lang: langOf(f.path), raw };
    }
    const text = new TextDecoder("utf-8").decode(raw);
    const fence = fenceFor(text);
    const lang = langOf(f.path);
    const body = `${fence}${lang}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}\n\n`;
    return { heading, headingBytes: utf8Len(heading), body, blockBytes: utf8Len(body), fileBytes: raw.length, lines, text, fence, lang, raw };
  });

  // restBytes[k]: the file bytes of the shown files after section k, for the
  // cut line. restBytes[last] is 0; each earlier entry adds the next file.
  const restBytes = new Array<number>(sections.length + 1).fill(0);
  for (let k = sections.length - 1; k >= 0; k--) {
    restBytes[k] = restBytes[k + 1]! + (k + 1 < sections.length ? sections[k + 1]!.fileBytes : 0);
  }
  const cutLine = (count: number, bytes: number): string =>
    `[Cut at ${max} bytes: ${count} file${count === 1 ? "" : "s"} and ${bytes} bytes left out.]\n`;

  let out = head;
  let used = utf8Len(head);
  if (used + utf8Len(cutLine(0, 0)) > max) {
    throw new DossierError(`dossier: text_max_bytes ${max} cannot hold even the Dashboard block and the cut line`);
  }
  let kept = 0;
  for (; kept < sections.length; kept++) {
    const section = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const tail = restCount === 0 ? 0 : utf8Len(cutLine(restCount, restBytes[kept]!));
    const size = section.headingBytes + section.blockBytes;
    if (used + size + tail > max) break;
    out += section.body === null ? section.heading : `${section.heading}${section.body}`;
    used += size;
  }
  if (kept < sections.length) {
    const first = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const after = restBytes[kept]!;
    const partial = partialSection(first, max - used, (hidden) => cutLine(restCount, after + hidden));
    out += partial ?? cutLine(restCount + 1, after + first.fileBytes);
  }
  if (utf8Len(out) > max) {
    throw new DossierError(`dossier: text_max_bytes ${max} cannot hold even the Dashboard block and the cut line`);
  }

  const doc = { schema: SCHEMA, cover: 0, text: out.replace(/\n+$/, "\n"), images };
  const bytes = Buffer.from(canonicalJson(doc), "utf8");
  if (bytes.length > MAX_DOSSIER_BYTES) {
    throw new DossierError(`dossier: the dossier is ${bytes.length} bytes, over ${MAX_DOSSIER_BYTES}`);
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

// A section cut inside its contents: heading, the first k lines inside the
// fence (closed), a line saying how many lines were left out, then the cut
// line. k is the most lines whose whole fits in `room`; null when not one
// line fits. Cuts happen only after a line feed, so no character is split.
function partialSection(section: Section, room: number, tail: (hidden: number) => string): string | null {
  if (section.body === null) return null;
  const total = section.lines;
  const lines = section.text.split("\n");
  const open = `${section.fence}${section.lang}\n`;
  const close = `${section.fence}\n\n`;
  const note = (k: number): string => `[${total - k} of this file's ${total} lines not shown.]\n`;
  const fixed = section.headingBytes + utf8Len(open) + utf8Len(close);
  let best = 0;
  let shown = 0;
  let raw = 0;
  for (let k = 1; k < total; k++) {
    shown += utf8Len(lines[k - 1]!) + 1;
    raw = section.raw.indexOf(0x0a, raw) + 1;
    if (fixed + shown + utf8Len(note(k)) + utf8Len(tail(section.raw.length - raw)) <= room) best = k;
  }
  if (best === 0) return null;
  let rawEnd = 0;
  for (let k = 0; k < best; k++) rawEnd = section.raw.indexOf(0x0a, rawEnd) + 1;
  const head = lines.slice(0, best).map((l) => `${l}\n`).join("");
  return `${section.heading}${open}${head}${close}${note(best)}${tail(section.raw.length - rawEnd)}`;
}
