import { z } from "zod";

/**
 * catalog.json schema — the single source of truth for what LaunchCore can install.
 * Lives next to LaunchCore.exe. All installer paths are RELATIVE to that folder so the
 * same kit works from a flash drive (E:\) or a share (\\server\share\LaunchCore\).
 */

const relativePath = z
  .string()
  .min(1)
  .refine((p) => !/^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith("\\\\") && !p.startsWith("/"), {
    message: "must be relative to the LaunchCore folder (no drive letters or UNC roots)",
  })
  .refine((p) => !p.split(/[\\/]/).includes(".."), {
    message: "must not contain '..' segments",
  });

const sha256 = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, "must be a 64-character hex SHA-256 hash")
  .transform((h) => h.toLowerCase());

const guid = z
  .string()
  .regex(/^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/, "must be a {GUID}");

const exitCodes = z.array(z.number().int());
const timeoutMinutes = z.number().int().positive().max(240).default(30);
/** No quotes, ampersands, pipes, redirects or other shell metacharacters. */
const safeArgs = z
  .string()
  .max(1000)
  .regex(/^[^"&|<>^`\r\n]*$/, 'must not contain " & | < > ^ ` or newlines');

const localInstaller = {
  path: relativePath,
  sha256,
  /** Silent args. For MSI, LaunchCore supplies `/i <path>` and `/l*v <log>`; put only extra args here. */
  args: safeArgs.default(""),
  /** Exit codes that count as success. 3010 = success, reboot required. */
  successCodes: exitCodes.nonempty().default([0, 3010]),
  rebootCodes: exitCodes.default([3010]),
  timeoutMinutes,
};

/** winget package identifiers, e.g. "7zip.7zip", "Google.Chrome.EXE". */
export const WINGET_ID = /^[A-Za-z0-9][A-Za-z0-9.+_-]{1,99}$/;

export const InstallerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("msi"), ...localInstaller }),
  z.object({ type: z.literal("exe"), ...localInstaller }),
  /** PowerShell script. Runs elevated via powershell.exe -ExecutionPolicy Bypass -File; the machine policy is untouched. */
  z.object({
    type: z.literal("ps1"),
    ...localInstaller,
    path: relativePath.refine((p) => p.toLowerCase().endsWith(".ps1"), { message: "ps1 installers must point at a .ps1 file" }),
  }),
  z.object({
    /** Downloads from the internet via winget at install time. Needs winget + network on the target. */
    type: z.literal("winget"),
    packageId: z.string().regex(WINGET_ID, "must be a winget package id like Vendor.App"),
    /** Install exactly the catalog version (--version). Recommended so the signed catalog pins what installs. */
    pinVersion: z.boolean().default(true),
    scope: z.enum(["machine", "user"]).default("machine"),
    successCodes: exitCodes.nonempty().default([0]),
    rebootCodes: exitCodes.default([]),
    timeoutMinutes,
  }),
]);

export const DetectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("msiProductCode"), productCode: guid }),
  z.object({
    type: z.literal("registry"),
    /** Must be under HKLM. Uninstall keys are the usual target. */
    key: z.string().regex(/^HKLM\\/i, "registry detection must use an HKLM\\ key"),
    valueName: z.string().min(1),
  }),
  z.object({
    type: z.literal("file"),
    /** Environment variables like %ProgramFiles% are expanded on the target machine. */
    path: z.string().min(1),
  }),
]);

export const PackageSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "lowercase letters, digits and dashes"),
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(40),
  publisher: z.string().max(100).optional(),
  category: z.string().max(40).default("General"),
  description: z.string().max(300).optional(),
  /** Tile color, #RRGGBB. Optional — a stable color is derived from the id when omitted. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a #RRGGBB hex color")
    .optional(),
  installer: InstallerSchema,
  detection: DetectionSchema,
});

export const CatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().max(80).default("LaunchCore Catalog"),
    packages: z.array(PackageSchema),
  })
  .superRefine((cat, ctx) => {
    const seen = new Set<string>();
    cat.packages.forEach((p, i) => {
      if (p.installer.type === "winget" && p.installer.pinVersion && !/^[A-Za-z0-9._+-]+$/.test(p.version)) {
        ctx.addIssue({
          code: "custom",
          path: ["packages", i, "version"],
          message: "pinned winget versions may only use letters, digits and . _ + -",
        });
      }
      if (seen.has(p.id)) {
        ctx.addIssue({ code: "custom", path: ["packages", i, "id"], message: `duplicate id '${p.id}'` });
      }
      seen.add(p.id);
    });
  });

export type Installer = z.infer<typeof InstallerSchema>;
export type Detection = z.infer<typeof DetectionSchema>;
export type Package = z.infer<typeof PackageSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

export type CatalogParseResult =
  | { ok: true; catalog: Catalog }
  | { ok: false; errors: string[] };

/** Validate untrusted catalog JSON. Never throws. */
export function parseCatalog(raw: unknown): CatalogParseResult {
  const result = CatalogSchema.safeParse(raw);
  if (result.success) return { ok: true, catalog: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

// Palette from the Deploy design; used when a package has no explicit color.
const TILE_PALETTE = [
  "#0A84FF", "#FF9F0A", "#FF375F", "#5E5CE6", "#FF453A", "#32D74B", "#30B0C7",
  "#32ADE6", "#A2845E", "#00C7BE", "#34C759", "#FF9500", "#BF5AF2", "#5865F2",
  "#2D8CFF", "#AF52DE", "#14B8A6", "#7C3AED",
] as const;

/** Explicit color, or a stable pick from the palette based on the id. */
export function tileColor(pkg: Pick<Package, "id" | "color">): string {
  if (pkg.color) return pkg.color;
  let h = 0;
  for (const ch of pkg.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_PALETTE[h % TILE_PALETTE.length] ?? "#5E5CE6";
}

/** Compare dotted versions numerically ("24.9" vs "24.09" are equal). Non-numeric parts compare as strings. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/);
  const pb = b.split(/[.\-+]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    const cmp = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (cmp !== 0) return cmp < 0 ? -1 : 1;
  }
  return 0;
}
