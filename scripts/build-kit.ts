#!/usr/bin/env bun
/**
 * Build a ready-to-copy LaunchCore kit folder.
 *
 *   bun run kit --catalog <source\catalog.json> --out <new-folder> [--no-build]
 *
 * 1. Checks the source catalog exactly like the exe will (signature, schema, installer hashes). Stops on any problem.
 * 2. Builds the release exe (skip with --no-build).
 * 3. Copies LaunchCore.exe, catalog.json, catalog.json.sig and ONLY the installers the catalog references.
 * 4. Re-verifies the copied kit.
 *
 * Never overwrites: --out must not exist or must be empty.
 */
import { spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  PUB_PATH,
  REPO_ROOT,
  checkInstallers,
  fail,
  printHashReport,
  readCatalogFile,
  readTrustedKeys,
  resolveInKit,
  signatureValid,
  toNative,
  validated,
} from "./lib/kit";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) fail(`${name} needs a value`);
  return v;
}

async function verifyKit(catalog: string, label: string) {
  const keys = readTrustedKeys();
  if (keys.length === 0) fail(`no trusted keys in ${PUB_PATH} — run: bun run setup`);
  if (!signatureValid(catalog, keys)) fail(`${label}: catalog signature missing or invalid — run: bun run catalog sign ${catalog} --private <key>`);
  const { json } = readCatalogFile(catalog);
  const cat = validated(json, label);
  const rows = await checkInstallers(catalog, json);
  if (rows.some((r) => r.status !== "ok")) {
    printHashReport(rows);
    fail(`${label}: installer files don't match the catalog`);
  }
  return { cat, json, rows };
}

const args = process.argv.slice(2);
const catalogArg = flag(args, "--catalog");
const outArg = flag(args, "--out");
if (!catalogArg || !outArg) {
  console.log("usage: bun run kit --catalog <source\\catalog.json> --out <new-folder> [--no-build]");
  process.exit(1);
}
const source = resolve(catalogArg);
const out = resolve(outArg);

if (existsSync(out) && (!statSync(out).isDirectory() || readdirSync(out).length > 0)) {
  fail(`${out} already exists and isn't empty — not overwriting. Pick a new folder.`);
}

console.log("1/4  checking source catalog…");
const { cat, json } = await verifyKit(source, "source");
console.log(`     ok — ${cat.packages.length} packages`);

const exeName = process.platform === "win32" ? "LaunchCore.exe" : "LaunchCore";
const exe = join(REPO_ROOT, "target", "release", exeName);
if (args.includes("--no-build")) {
  console.log("2/4  skipping build (--no-build)");
  if (!existsSync(exe)) fail(`${exe} not found — build first or drop --no-build`);
  if (statSync(exe).mtimeMs < statSync(PUB_PATH).mtimeMs) {
    fail("the exe is older than src-tauri/keys/catalog.pub — it may not trust your current key. Rebuild (drop --no-build).");
  }
} else {
  console.log("2/4  building release exe (this takes a few minutes the first time)…");
  const r = spawnSync("bun", ["run", "tauri", "build"], { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) fail("build failed — see output above");
  if (!existsSync(exe)) fail(`build finished but ${exe} wasn't found`);
}

console.log(`3/4  assembling ${out}…`);
// COPYFILE_EXCL: never overwrite anything, even if something appeared in --out during the build.
const copy = (from: string, to: string) => {
  try {
    copyFileSync(from, to, constants.COPYFILE_EXCL);
  } catch (e) {
    fail(`refusing to overwrite ${to} (${(e as Error).message})`);
  }
};
const RESERVED = new Set([exeName, "catalog.json", "catalog.json.sig"].map((n) => n.toLowerCase()));
mkdirSync(out, { recursive: true });
copy(exe, join(out, exeName));
copy(source, join(out, "catalog.json")); // byte-exact: the signature covers these bytes
copy(`${source}.sig`, join(out, "catalog.json.sig"));
let bytes = statSync(exe).size;
const srcKit = dirname(source);
const copied = new Set<string>();
for (const p of (json as { packages: { installer: { type: string; path?: string } }[] }).packages) {
  if (p.installer.type === "winget") continue;
  const rel = toNative(p.installer.path!);
  const key = rel.toLowerCase();
  if (RESERVED.has(key)) fail(`installer path '${p.installer.path}' collides with a kit file — move it under packages\\`);
  if (copied.has(key)) continue; // two packages sharing one installer
  copied.add(key);
  const from = resolveInKit(srcKit, p.installer.path!);
  if (!from.ok) fail(`unexpected: ${p.installer.path} ${from.why}`);
  const to = join(out, rel);
  mkdirSync(dirname(to), { recursive: true });
  copy(from.path, to);
  bytes += statSync(to).size;
}

console.log("4/4  verifying the copied kit…");
const { rows } = await verifyKit(join(out, "catalog.json"), "kit");

console.log(`\nkit ready: ${out}`);
console.log(`  ${exeName} + catalog.json + catalog.json.sig + ${rows.length} installer(s), ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log("  copy the whole folder to the flash drive or share. Make the share read-only for users.");
