/**
 * Shared helpers for LaunchCore's kit scripts (sign, kit builder, setup).
 * Mirrors what LaunchCore.exe checks, so "passes here" means "the exe will accept it".
 */
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseCatalog, type Catalog } from "../../src/lib/catalog";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const PUB_PATH = resolve(REPO_ROOT, "src-tauri/keys/catalog.pub");

export function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Raw catalog bytes plus parsed JSON. Tolerates a UTF-8 BOM (signature still covers raw bytes). */
export function readCatalogFile(path: string): { bytes: Buffer; json: unknown } {
  if (!existsSync(path)) fail(`catalog not found: ${path}`);
  const bytes = readFileSync(path);
  try {
    return { bytes, json: JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) };
  } catch (e) {
    fail(`${path} is not valid JSON: ${(e as Error).message}`);
  }
}

export function validated(json: unknown, label: string): Catalog {
  const parsed = parseCatalog(json);
  if (!parsed.ok) fail(`${label} failed validation:\n  ${parsed.errors.join("\n  ")}`);
  return parsed.catalog;
}

// ---------- keys & signatures ----------

/** Raw 32-byte Ed25519 public key as standard base64 (the format compiled into the exe). */
export function rawPublicB64(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || !jwk.x) fail("not an Ed25519 key");
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

export function publicFromRawB64(b64: string): KeyObject {
  const raw = Buffer.from(b64.trim(), "base64");
  if (raw.length !== 32) fail(`public key must decode to 32 bytes, got ${raw.length}`);
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
}

export function readTrustedKeys(path = PUB_PATH): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function signatureValid(catalogPath: string, keys: string[]): boolean {
  const sigPath = `${catalogPath}.sig`;
  if (!existsSync(sigPath) || keys.length === 0) return false;
  const sig = Buffer.from(readFileSync(sigPath, "utf8").trim(), "base64");
  const bytes = readFileSync(catalogPath);
  return keys.some((k) => verify(null, bytes, publicFromRawB64(k), sig));
}

// ---------- installers ----------

export interface LocalRef {
  id: string;
  path: string;
  sha256: string;
}

/** msi/exe installers straight from raw JSON (lenient, so `hash --write` can fill placeholders). */
export function localInstallers(json: unknown): LocalRef[] {
  const pkgs = (json as { packages?: unknown[] })?.packages;
  if (!Array.isArray(pkgs)) return [];
  return pkgs.flatMap((p) => {
    const pkg = p as { id?: unknown; installer?: { type?: unknown; path?: unknown; sha256?: unknown } };
    const t = pkg.installer?.type;
    if ((t !== "msi" && t !== "exe" && t !== "ps1") || typeof pkg.installer?.path !== "string") return [];
    return [{ id: String(pkg.id ?? "?"), path: pkg.installer.path, sha256: String(pkg.installer.sha256 ?? "") }];
  });
}

/** Resolve a catalog-relative installer path inside the kit; refuses escapes (incl. via symlinks). */
export function resolveInKit(kitDir: string, rel: string): { ok: true; path: string } | { ok: false; why: string } {
  if (/^[a-zA-Z]:|^[\\/]/.test(rel) || rel.split(/[\\/]/).includes("..")) return { ok: false, why: "path escapes kit" };
  const full = resolve(kitDir, ...rel.split(/[\\/]/));
  if (!existsSync(full)) return { ok: false, why: "missing" };
  const real = realpathSync(full);
  if (!isInside(real, realpathSync(kitDir))) return { ok: false, why: "path escapes kit" };
  if (!statSync(real).isFile()) return { ok: false, why: "not a file" };
  return { ok: true, path: real };
}

export function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => h.update(c))
      .on("error", rej)
      .on("end", () => res(h.digest("hex")));
  });
}

export type HashStatus =
  | { ref: LocalRef; status: "ok"; actual: string }
  | { ref: LocalRef; status: "mismatch"; actual: string }
  | { ref: LocalRef; status: "missing" | "invalid"; why: string };

/** Hash every local installer next to the catalog and compare with the catalog. */
export async function checkInstallers(catalogPath: string, json: unknown): Promise<HashStatus[]> {
  const kit = dirname(catalogPath);
  const out: HashStatus[] = [];
  for (const ref of localInstallers(json)) {
    const r = resolveInKit(kit, ref.path);
    if (!r.ok) {
      out.push({ ref, status: r.why === "missing" ? "missing" : "invalid", why: r.why });
      continue;
    }
    const actual = await sha256File(r.path);
    out.push({ ref, status: actual === ref.sha256.toLowerCase() ? "ok" : "mismatch", actual });
  }
  return out;
}

export function printHashReport(rows: HashStatus[]): void {
  for (const r of rows) {
    const tag = { ok: "  ok     ", mismatch: "  MISMATCH", missing: "  MISSING ", invalid: "  INVALID " }[r.status];
    const extra = r.status === "mismatch" ? `  (file is ${r.actual})` : "why" in r ? `  (${r.why})` : "";
    console.log(`${tag}  ${r.ref.id.padEnd(24)} ${r.ref.path}${extra}`);
  }
}

export const toNative = (p: string) => p.split(/[\\/]/).join(sep);

/** Where setup/keygen put the private key by default: %USERPROFILE%\.launchcore\catalog-signing.key */
export const DEFAULT_PRIVATE = resolve(homedir(), ".launchcore", "catalog-signing.key");
