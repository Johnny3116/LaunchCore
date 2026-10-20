#!/usr/bin/env bun
/**
 * First-time setup on a dev machine:  bun run setup [--private <path>]
 *
 *  - checks the toolchain (Bun, Rust/Cargo, MSVC target on Windows, WebView2)
 *  - creates your catalog signing key if you don't have one (never overwrites)
 *  - signs the test kit so `bun run tauri dev` works straight away
 *
 * Safe to re-run.
 */
import { spawnSync } from "node:child_process";
import { createPublicKey } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { flag, keygen, loadPrivate, signCatalog, trustPublicKey } from "./catalog-sign";
import { DEFAULT_PRIVATE, PUB_PATH, REPO_ROOT, rawPublicB64, readTrustedKeys } from "./lib/kit";

const isWin = process.platform === "win32";
let problems = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => console.log(`  ! ${m}`);
const bad = (m: string) => {
  problems++;
  console.log(`  ✗ ${m}`);
};

function run(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: isWin });
  return r.status === 0 ? `${r.stdout}`.trim() : null;
}

const args = process.argv.slice(2);
const privPath = resolve(flag(args, "--private") ?? DEFAULT_PRIVATE);

console.log("Toolchain");
ok(`bun ${Bun.version}`);
const cargo = run("cargo", ["--version"]);
cargo ? ok(cargo) : bad("Rust not found — install from https://rustup.rs, then re-run");
const rustc = run("rustc", ["-vV"]);
const host = rustc?.match(/^host: (.+)$/m)?.[1];
if (isWin && host) {
  host.includes("msvc")
    ? ok(`rust target ${host}`)
    : bad(`rust target is ${host} — run: rustup default stable-msvc  (needs Visual Studio C++ Build Tools)`);
}
if (isWin) {
  const keys = [
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  ];
  const found = keys.map((k) => run("reg", ["query", k, "/v", "pv"])).find((o) => o && !/\s0\.0\.0\.0\s*$/.test(o));
  found ? ok("WebView2 runtime found") : warn("WebView2 runtime not detected — the app will tell you if it's really missing");
} else {
  warn("not on Windows — you can build the UI and run tests here, but LaunchCore itself runs on Windows only");
}
if (!existsSync(resolve(REPO_ROOT, "node_modules"))) bad("dependencies not installed — run: bun install");

console.log("\nSigning key");
const trusted = readTrustedKeys();
if (existsSync(privPath)) {
  const pub = rawPublicB64(createPublicKey(loadPrivate(privPath)));
  if (trustPublicKey(pub)) ok(`added your existing key to ${PUB_PATH} — commit that file`);
  else ok(`using ${privPath} (already trusted)`);
} else if (trusted.length > 0) {
  bad(
    `catalog.pub already trusts ${trusted.length} key(s), but there's no private key at ${privPath}.\n` +
      "      If your key lives elsewhere: bun run setup --private <path>",
  );
} else {
  keygen(privPath);
}

console.log("\nTest kit");
const testCatalog = resolve(REPO_ROOT, "examples/test-kit/catalog.json");
if (existsSync(privPath)) {
  await signCatalog(testCatalog, privPath);
} else {
  warn("skipped — no signing key");
}

console.log(problems ? `\n${problems} problem(s) above — fix them and re-run.` : "\nAll set. Try it:");
if (!problems) {
  console.log(isWin ? '  $env:LAUNCHCORE_KIT_DIR = "$PWD\\examples\\test-kit"' : '  export LAUNCHCORE_KIT_DIR="$PWD/examples/test-kit"');
  console.log("  bun run tauri dev");
}
process.exit(problems ? 1 : 0);
