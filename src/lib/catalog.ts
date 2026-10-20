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

export const InstallerSchema = z.object({
  type: z.enum(["msi", "exe"]),
  path: relativePath,
  sha256,
  /** Silent args. For MSI, LaunchCore supplies `/i <path>`; put only extra args here (e.g. /qn /norestart). */
  args: z.string().default(""),
  /** Exit codes that count as success. 3010 = success, reboot required. */
  successCodes: z.array(z.number().int()).nonempty().default([0, 3010]),
  rebootCodes: z.array(z.number().int()).default([3010]),
  timeoutMinutes: z.number().int().positive().max(240).default(30),
});

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
