import { Channel, invoke } from "@tauri-apps/api/core";
import { parseCatalog, type Package } from "./catalog";
import type {
  CatalogLoad,
  DetectionResult,
  Environment,
  InstallEvent,
  InstallOutcome,
  LaunchCoreService,
} from "./service";

type RawCatalogLoad =
  | { ok: true; sourcePath: string; catalog: unknown }
  | { ok: false; sourcePath: string; errors: string[] };

/**
 * Real backend. Only package *ids* cross the bridge for detect/install — the Rust side looks up
 * paths, args and hashes from its own signature-verified catalog.
 */
export class TauriService implements LaunchCoreService {
  getEnvironment(): Promise<Environment> {
    return invoke<Environment>("get_environment");
  }

  async loadCatalog(): Promise<CatalogLoad> {
    const raw = await invoke<RawCatalogLoad>("load_catalog");
    if (!raw.ok) return raw;
    // Backend already verified signature + schema; parse again to get typed defaults on this side.
    const parsed = parseCatalog(raw.catalog);
    return parsed.ok
      ? { ok: true, catalog: parsed.catalog, sourcePath: raw.sourcePath }
      : { ok: false, sourcePath: raw.sourcePath, errors: parsed.errors };
  }

  detect(pkg: Package): Promise<DetectionResult> {
    return invoke<DetectionResult>("detect", { packageId: pkg.id });
  }

  install(pkg: Package, onEvent: (e: InstallEvent) => void): Promise<InstallOutcome> {
    const channel = new Channel<InstallEvent>();
    channel.onmessage = onEvent;
    return invoke<InstallOutcome>("install", { packageId: pkg.id, onEvent: channel });
  }
}
