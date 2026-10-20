#!/usr/bin/env bun
/**
 * LaunchCore catalog signing tool (Ed25519).
 *
 *   bun scripts/catalog-sign.ts keygen --private <path-outside-repo>
 *       Creates a signing keypair. Private key (PKCS#8 PEM) goes to --private.
 *       Public key is appended to src-tauri/keys/catalog.pub and gets compiled into LaunchCore.exe.
 *
 *   bun scripts/catalog-sign.ts sign <catalog.json> --private <path>
 *       Validates the catalog, then writes <catalog.json>.sig next to it.
 *
 *   bun scripts/catalog-sign.ts verify <catalog.json> [--pub <catalog.pub>]
 *       Checks <catalog.json>.sig against the public key(s).
 *
 * The signature covers the exact bytes of catalog.json. Any edit — even whitespace — needs a re-sign.
 * Keep the private key off the share and out of git. Anyone holding it can authorize installs.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { parseCatalog } from "../src/lib/catalog";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_PUB = resolve(REPO_ROOT, "src-tauri/keys/catalog.pub");

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) fail(`${name} needs a value`);
  return v;
}

const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Raw 32-byte Ed25519 public key as standard base64 (the format LaunchCore compiles in). */
function rawPublicB64(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || !jwk.x) fail("not an Ed25519 key");
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

function publicFromRawB64(b64: string): KeyObject {
  const raw = Buffer.from(b64.trim(), "base64");
  if (raw.length !== 32) fail(`public key must decode to 32 bytes, got ${raw.length}`);
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
}

function readPublicKeys(path: string): string[] {
  if (!existsSync(path)) fail(`no public key file at ${path} — run keygen first`);
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function loadPrivate(path: string): KeyObject {
  if (!existsSync(path)) fail(`private key not found: ${path}`);
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== "ed25519") fail("private key is not Ed25519");
  return key;
}

function validateCatalogFile(path: string): Buffer {
  if (!existsSync(path)) fail(`catalog not found: ${path}`);
  const bytes = readFileSync(path);
  let json: unknown;
  try {
    // Tolerate a UTF-8 BOM (PowerShell 5 `-Encoding UTF8`). The signature still covers the raw bytes.
    json = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
  } catch (e) {
    fail(`catalog is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = parseCatalog(json);
  if (!parsed.ok) fail(`catalog failed validation:\n  ${parsed.errors.join("\n  ")}`);
  return bytes;
}

function keygen(args: string[]) {
  const priv = flag(args, "--private") ?? fail("keygen requires --private <path>");
  const privPath = resolve(priv);
  if (isInside(privPath, REPO_ROOT)) fail("refusing to write the private key inside the repo — pick a path outside it");
  if (existsSync(privPath)) fail(`${privPath} already exists — not overwriting a signing key`);

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(privPath), { recursive: true });
  writeFileSync(privPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });

  const pubB64 = rawPublicB64(publicKey);
  mkdirSync(dirname(DEFAULT_PUB), { recursive: true });
  const header = existsSync(DEFAULT_PUB) ? "" : "# LaunchCore trusted catalog signing keys (raw Ed25519, base64). One per line.\n";
  appendFileSync(DEFAULT_PUB, `${header}# added ${new Date().toISOString()}\n${pubB64}\n`);

  console.log(`private key: ${privPath}   (keep offline; back it up; never commit)`);
  console.log(`public key appended to: ${DEFAULT_PUB}`);
  console.log("rebuild LaunchCore so the new key is compiled in.");
}

function signCmd(args: string[]) {
  const catalog = args.find((a) => !a.startsWith("--") && a !== flag(args, "--private")) ?? fail("sign needs <catalog.json>");
  const priv = flag(args, "--private") ?? fail("sign requires --private <path>");
  const bytes = validateCatalogFile(resolve(catalog));
  const key = loadPrivate(resolve(priv));
  const sig = sign(null, bytes, key).toString("base64");

  // Self-check against the compiled-in key list so a wrong key is caught before deployment.
  const pubs = existsSync(DEFAULT_PUB) ? readPublicKeys(DEFAULT_PUB) : [];
  const mine = rawPublicB64(createPublicKey(key));
  if (pubs.length && !pubs.includes(mine)) {
    console.warn("warning: this private key's public half is NOT in src-tauri/keys/catalog.pub — LaunchCore will reject this signature.");
  }

  const out = `${resolve(catalog)}.sig`;
  writeFileSync(out, `${sig}\n`);
  console.log(`signed: ${out}`);
}

function verifyCmd(args: string[]) {
  const catalog = args.find((a) => !a.startsWith("--") && a !== flag(args, "--pub")) ?? fail("verify needs <catalog.json>");
  const pubPath = resolve(flag(args, "--pub") ?? DEFAULT_PUB);
  const bytes = readFileSync(resolve(catalog));
  const sigPath = `${resolve(catalog)}.sig`;
  if (!existsSync(sigPath)) fail(`no signature file: ${sigPath}`);
  const sig = Buffer.from(readFileSync(sigPath, "utf8").trim(), "base64");
  const ok = readPublicKeys(pubPath).some((k) => verify(null, bytes, publicFromRawB64(k), sig));
  if (!ok) fail("signature INVALID for every trusted key");
  console.log("signature OK");
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "keygen":
    keygen(rest);
    break;
  case "sign":
    signCmd(rest);
    break;
  case "verify":
    verifyCmd(rest);
    break;
  default:
    console.log("usage: bun scripts/catalog-sign.ts <keygen|sign|verify> ...  (see header of this file)");
    process.exit(cmd ? 1 : 0);
}
