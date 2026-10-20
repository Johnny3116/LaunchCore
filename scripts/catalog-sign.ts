#!/usr/bin/env bun
/**
 * LaunchCore catalog tool (Ed25519 signing + installer hashes).
 *
 *   keygen --private <path>          New signing keypair. Private key → <path> (must be outside the repo).
 *                                    Public key appended to src-tauri/keys/catalog.pub (compiled into the exe).
 *   trust  --private <path>          Add an EXISTING private key's public half to catalog.pub (e.g. new clone).
 *   hash   <catalog.json> [--write]  Hash every MSI/EXE next to the catalog and compare.
 *                                    --write fills in / fixes the sha256 fields (then re-sign).
 *   sign   <catalog.json> --private <path> [--allow-missing]
 *                                    Validate, check installer hashes, write <catalog.json>.sig.
 *                                    Refuses on any hash mismatch; --allow-missing permits absent files only.
 *   verify <catalog.json>            Signature + schema + installer hashes, exactly as the exe checks.
 *
 * The signature covers the exact bytes of catalog.json; any edit needs a re-sign.
 * Keep the private key off the share and out of git. Anyone holding it can authorize installs.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  PUB_PATH,
  REPO_ROOT,
  checkInstallers,
  fail,
  isInside,
  printHashReport,
  rawPublicB64,
  readCatalogFile,
  readTrustedKeys,
  signatureValid,
  validated,
} from "./lib/kit";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) fail(`${name} needs a value`);
  return v;
}

/** First argument that isn't a flag or a flag's value. */
function positional(args: string[], valueFlags: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valueFlags.includes(a)) {
      i++;
      continue;
    }
    if (!a.startsWith("--")) return a;
  }
  return undefined;
}

function loadPrivate(path: string): KeyObject {
  if (!existsSync(path)) fail(`private key not found: ${path}`);
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== "ed25519") fail("private key is not Ed25519");
  return key;
}

/** Append a public key to catalog.pub unless already trusted. Returns true if added. */
export function trustPublicKey(pubB64: string): boolean {
  if (readTrustedKeys().includes(pubB64)) return false;
  mkdirSync(dirname(PUB_PATH), { recursive: true });
  const header = existsSync(PUB_PATH) ? "" : "# LaunchCore trusted catalog signing keys (raw Ed25519, base64). One per line.\n";
  appendFileSync(PUB_PATH, `${header}# added ${new Date().toISOString()}\n${pubB64}\n`);
  return true;
}

export function keygen(privPathArg: string): void {
  const privPath = resolve(privPathArg);
  if (isInside(privPath, REPO_ROOT)) fail("refusing to write the private key inside the repo — pick a path outside it");
  if (existsSync(privPath)) fail(`${privPath} already exists — not overwriting a signing key (use 'trust' to reuse it)`);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(privPath), { recursive: true });
  writeFileSync(privPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  trustPublicKey(rawPublicB64(publicKey));
  console.log(`private key: ${privPath}   (keep offline; back it up; never commit)`);
  console.log(`public key added to: ${PUB_PATH}  — commit this file, then rebuild.`);
}

async function hashCmd(args: string[]) {
  const catalog = resolve(positional(args, []) ?? fail("hash needs <catalog.json>"));
  const { json } = readCatalogFile(catalog);
  const rows = await checkInstallers(catalog, json);
  if (rows.length === 0) return console.log("no MSI/EXE installers in this catalog (winget-only).");
  printHashReport(rows);

  if (!args.includes("--write")) {
    if (rows.some((r) => r.status !== "ok")) {
      console.log("\nrun again with --write to update sha256 values from the files on disk.");
      process.exit(1);
    }
    return;
  }
  const blockers = rows.filter((r) => r.status === "missing" || r.status === "invalid");
  if (blockers.length) fail("fix missing/invalid installer paths before --write");
  let changed = 0;
  for (const p of (json as { packages: { id: string; installer: { type: string; sha256?: string } }[] }).packages) {
    const row = rows.find((r) => r.ref.id === p.id);
    if (row && row.status === "mismatch") {
      p.installer.sha256 = row.actual;
      changed++;
    }
  }
  if (changed === 0) return console.log("\nall hashes already correct.");
  writeFileSync(catalog, `${JSON.stringify(json, null, 2)}\n`); // LF, no BOM
  console.log(`\nupdated ${changed} hash(es) in ${catalog}. Re-sign it now.`);
}

export async function signCatalog(catalogArg: string, privArg: string, allowMissing = false): Promise<void> {
  const catalog = resolve(catalogArg);
  const { bytes, json } = readCatalogFile(catalog);
  validated(json, "catalog");

  const rows = await checkInstallers(catalog, json);
  const bad = rows.filter((r) => r.status === "mismatch" || r.status === "invalid" || (r.status === "missing" && !allowMissing));
  if (bad.length) {
    printHashReport(rows);
    fail(
      "installer files don't match the catalog — not signing.\n" +
        "  Fix with: bun run catalog hash <catalog.json> --write   (or --allow-missing if files aren't copied yet)",
    );
  }

  const key = loadPrivate(resolve(privArg));
  const mine = rawPublicB64(createPublicKey(key));
  if (!readTrustedKeys().includes(mine)) {
    console.warn("warning: this key is NOT in src-tauri/keys/catalog.pub — LaunchCore will reject the signature.");
    console.warn("         run: bun run catalog trust --private <path>   then rebuild.");
  }
  writeFileSync(`${catalog}.sig`, `${sign(null, bytes, key).toString("base64")}\n`);
  console.log(`signed: ${catalog}.sig${rows.length ? `  (${rows.filter((r) => r.status === "ok").length}/${rows.length} installers hash-verified)` : ""}`);
}

async function verifyCmd(args: string[]) {
  const catalog = resolve(positional(args, []) ?? fail("verify needs <catalog.json>"));
  const keys = readTrustedKeys();
  if (keys.length === 0) fail(`no trusted keys in ${PUB_PATH}`);
  if (!signatureValid(catalog, keys)) fail("signature missing or INVALID for every trusted key");
  const { json } = readCatalogFile(catalog);
  const cat = validated(json, "catalog");
  const rows = await checkInstallers(catalog, json);
  if (rows.length) printHashReport(rows);
  if (rows.some((r) => r.status !== "ok")) fail("signature OK, but installer files don't match — this kit will block those installs");
  console.log(`OK — signature valid, ${cat.packages.length} packages, ${rows.length} installer(s) verified`);
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "keygen":
      keygen(flag(rest, "--private") ?? fail("keygen requires --private <path>"));
      break;
    case "trust": {
      const key = loadPrivate(resolve(flag(rest, "--private") ?? fail("trust requires --private <path>")));
      console.log(trustPublicKey(rawPublicB64(createPublicKey(key))) ? `added to ${PUB_PATH} — commit it, then rebuild.` : "already trusted.");
      break;
    }
    case "hash":
      await hashCmd(rest);
      break;
    case "sign":
      await signCatalog(
        positional(rest, ["--private"]) ?? fail("sign needs <catalog.json>"),
        flag(rest, "--private") ?? fail("sign requires --private <path>"),
        rest.includes("--allow-missing"),
      );
      break;
    case "verify":
      await verifyCmd(rest);
      break;
    default:
      console.log("usage: bun run catalog <keygen|trust|hash|sign|verify> ...  (see the header of scripts/catalog-sign.ts)");
      process.exit(cmd ? 1 : 0);
  }
}
