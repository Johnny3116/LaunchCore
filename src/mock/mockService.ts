/**
 * MOCK SERVICE — simulated data only. Nothing here touches the machine.
 * Exists so the UI can be built and reviewed in a browser before the Rust backend exists.
 * Scenarios are keyed by package id so every UI state is reachable on demand.
 */
import { parseCatalog, type Package } from "../lib/catalog";
import { describeExitCode } from "../lib/exitCodes";
import type {
  CatalogLoad,
  DetectionResult,
  Environment,
  InstallEvent,
  InstallOutcome,
  LaunchCoreService,
} from "../lib/service";
import raw from "./catalog.mock.json";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const detectionScenario: Record<string, DetectionResult> = {
  "7zip": { status: "installed", installedVersion: "24.09" },
  "notepad-plus-plus": { status: "outdated", installedVersion: "8.5.8" },
  "chrome-enterprise": { status: "installed", installedVersion: "130.0.6723.70" },
};

// Remember mock installs for this session so re-detection reflects them.
const installedThisSession = new Map<string, string>();

export class MockService implements LaunchCoreService {
  async getEnvironment(): Promise<Environment> {
    await sleep(150);
    return {
      hostname: "SHE-WS-MOCK01",
      username: "YOLO\\jmitchell",
      osVersion: "Windows 11 Enterprise 24H2 (mock)",
      appDir: "E:\\LaunchCore",
      logPath: "C:\\ProgramData\\LaunchCore\\logs\\launchcore.log",
      webview2Version: "130.0.2849.56 (mock)",
      wingetAvailable: true,
    };
  }

  async loadCatalog(): Promise<CatalogLoad> {
    await sleep(250);
    const sourcePath = "E:\\LaunchCore\\catalog.json";
    const parsed = parseCatalog(raw);
    return parsed.ok
      ? { ok: true, catalog: parsed.catalog, sourcePath }
      : { ok: false, sourcePath, errors: parsed.errors };
  }

  async detect(pkg: Package): Promise<DetectionResult> {
    await sleep(200 + Math.random() * 500);
    const local = installedThisSession.get(pkg.id);
    if (local) return { status: "installed", installedVersion: local };
    return detectionScenario[pkg.id] ?? { status: "not-installed" };
  }

  async install(pkg: Package, onEvent: (e: InstallEvent) => void): Promise<InstallOutcome> {
    const start = performance.now();
    const log = (message: string, level: "info" | "warn" | "error" = "info") =>
      onEvent({ type: "log", level, message });

    const inst = pkg.installer;
    if (inst.type === "winget") {
      log(`winget source — package ${inst.packageId}${inst.pinVersion ? ` @ ${pkg.version}` : ""} (hash verified by winget)`);
    } else {
      onEvent({ type: "phase", phase: "verifying" });
      log(`Staging and verifying SHA-256 of ${inst.path}`);
      await sleep(700);
      if (pkg.id === "vlc") {
        const actual = "9f2c" + "e".repeat(56) + "b7a1";
        log(`Hash mismatch — expected ${inst.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…`, "error");
        return { kind: "hash-mismatch", expected: inst.sha256, actual };
      }
      log("Hash verified");
    }

    onEvent({ type: "phase", phase: "waiting-elevation" });
    log("Requesting elevation (UAC)");
    await sleep(900);

    onEvent({ type: "phase", phase: "installing" });
    const cmd =
      inst.type === "winget"
        ? `winget install --id ${inst.packageId} -e${inst.pinVersion ? ` --version ${pkg.version}` : ""} --scope ${inst.scope} --silent`
        : inst.type === "msi"
          ? `msiexec.exe /i "<staged>\\${inst.path.split(/[\\/]/).pop()}" ${inst.args} /l*v "<log>"`
          : `"<staged>\\${inst.path.split(/[\\/]/).pop()}" ${inst.args}`;
    log(`Running: ${cmd}`);
    await sleep(2500 + Math.random() * 2500);

    const exitCode = pkg.id === "sire-filecenter" ? 1603 : pkg.id === "acrobat-reader" ? 3010 : 0;
    const durationMs = Math.round(performance.now() - start);

    if (!inst.successCodes.includes(exitCode)) {
      log(`Exited with ${exitCode} (${describeExitCode(exitCode)})`, "error");
      return { kind: "failed", exitCode, reason: describeExitCode(exitCode), durationMs };
    }

    const rebootRequired = inst.rebootCodes.includes(exitCode);
    log(`Exited with ${exitCode}${rebootRequired ? " — reboot required" : ""}`, rebootRequired ? "warn" : "info");
    installedThisSession.set(pkg.id, pkg.version);
    return { kind: "success", exitCode, rebootRequired, durationMs };
  }
}
