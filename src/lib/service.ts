import type { Catalog, Package } from "./catalog";

/**
 * The only contract the UI depends on. Today it's backed by MockService;
 * next phase it's backed by Tauri commands (Rust) that do the real work.
 */

export type DetectionStatus = "installed" | "outdated" | "not-installed" | "unknown";

export interface DetectionResult {
  status: DetectionStatus;
  installedVersion?: string;
  detail?: string;
}

export interface Environment {
  hostname: string;
  username: string;
  osVersion: string;
  /** Folder LaunchCore.exe was launched from (flash drive or share). */
  appDir: string;
  /** Local log file path — never on the kit itself, which may be read-only. */
  logPath: string;
  webview2Version?: string;
  /** winget found for this user. winget packages fail fast without it. */
  wingetAvailable: boolean;
}

export type CatalogLoad =
  | { ok: true; catalog: Catalog; sourcePath: string }
  | { ok: false; sourcePath: string; errors: string[] };

export type InstallPhase = "verifying" | "waiting-elevation" | "installing";

export type InstallOutcome =
  | { kind: "success"; exitCode: number; rebootRequired: boolean; durationMs: number }
  | { kind: "failed"; exitCode?: number; reason: string; durationMs: number }
  | { kind: "hash-mismatch"; expected: string; actual: string };

export type InstallEvent =
  | { type: "phase"; phase: InstallPhase }
  | { type: "log"; level: LogLevel; message: string };

export type LogLevel = "info" | "warn" | "error";

export interface LaunchCoreService {
  getEnvironment(): Promise<Environment>;
  loadCatalog(): Promise<CatalogLoad>;
  detect(pkg: Package): Promise<DetectionResult>;
  /**
   * Verify hash, elevate, run the installer, wait for exit.
   * Resolves with an outcome; rejects only on programmer error.
   * Deliberately not cancellable: killing msiexec mid-install leaves machines half-configured.
   * Cancelling the queue only drops items that haven't started.
   */
  install(pkg: Package, onEvent: (e: InstallEvent) => void): Promise<InstallOutcome>;
}
