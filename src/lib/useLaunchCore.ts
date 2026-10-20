import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { Catalog, Package } from "./catalog";
import type {
  CatalogLoad,
  DetectionResult,
  Environment,
  InstallOutcome,
  InstallPhase,
  LaunchCoreService,
  LogLevel,
} from "./service";

export type QueueState = "queued" | InstallPhase | "success" | "reboot" | "failed" | "blocked" | "skipped";

export interface QueueItem {
  key: string;
  pkg: Package;
  state: QueueState;
  startedAt?: number;
  finishedAt?: number;
  outcome?: InstallOutcome;
}

export interface LogEntry {
  ts: number;
  level: LogLevel;
  pkgId?: string;
  message: string;
}

type Detection = DetectionResult | "pending";

interface State {
  env?: Environment;
  load?: CatalogLoad;
  detection: Record<string, Detection>;
  queue: QueueItem[];
  log: LogEntry[];
}

type Action =
  | { type: "env"; env: Environment }
  | { type: "load"; load: CatalogLoad }
  | { type: "detect-start"; ids: string[] }
  | { type: "detect-done"; id: string; result: DetectionResult }
  | { type: "enqueue"; pkgs: Package[] }
  | { type: "item"; key: string; patch: Partial<QueueItem> }
  | { type: "skip-pending" }
  | { type: "clear-finished" }
  | { type: "log"; entry: LogEntry };

const ACTIVE: QueueState[] = ["verifying", "waiting-elevation", "installing"];
export const isActive = (s: QueueState) => ACTIVE.includes(s);
export const isFinished = (s: QueueState) => !isActive(s) && s !== "queued";

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "env":
      return { ...state, env: a.env };
    case "load":
      return { ...state, load: a.load };
    case "detect-start": {
      const detection = { ...state.detection };
      for (const id of a.ids) detection[id] = "pending";
      return { ...state, detection };
    }
    case "detect-done":
      return { ...state, detection: { ...state.detection, [a.id]: a.result } };
    case "enqueue": {
      const busy = new Set(state.queue.filter((q) => !isFinished(q.state)).map((q) => q.pkg.id));
      const added = a.pkgs
        .filter((p) => !busy.has(p.id))
        .map((pkg) => ({ key: `${pkg.id}-${crypto.randomUUID()}`, pkg, state: "queued" as const }));
      return { ...state, queue: [...state.queue, ...added] };
    }
    case "item":
      return { ...state, queue: state.queue.map((q) => (q.key === a.key ? { ...q, ...a.patch } : q)) };
    case "skip-pending":
      return {
        ...state,
        queue: state.queue.map((q) => (q.state === "queued" ? { ...q, state: "skipped", finishedAt: Date.now() } : q)),
      };
    case "clear-finished":
      return { ...state, queue: state.queue.filter((q) => !isFinished(q.state)) };
    case "log":
      // Cap in-memory log; the backend owns the durable log file.
      return { ...state, log: [...state.log.slice(-1999), a.entry] };
  }
}

export function useLaunchCore(service: LaunchCoreService) {
  const [state, dispatch] = useReducer(reducer, { detection: {}, queue: [], log: [] });
  const running = useRef(false);

  const log = useCallback((level: LogLevel, message: string, pkgId?: string) => {
    dispatch({ type: "log", entry: { ts: Date.now(), level, message, pkgId } });
  }, []);

  const detectAll = useCallback(
    async (catalog: Catalog) => {
      dispatch({ type: "detect-start", ids: catalog.packages.map((p) => p.id) });
      await Promise.all(
        catalog.packages.map(async (pkg) => {
          try {
            dispatch({ type: "detect-done", id: pkg.id, result: await service.detect(pkg) });
          } catch (err) {
            dispatch({ type: "detect-done", id: pkg.id, result: { status: "unknown", detail: String(err) } });
          }
        }),
      );
    },
    [service],
  );

  const reload = useCallback(async () => {
    try {
      const load = await service.loadCatalog();
      dispatch({ type: "load", load });
      if (load.ok) {
        log("info", `Loaded ${load.catalog.packages.length} packages from ${load.sourcePath}`);
        await detectAll(load.catalog);
      } else {
        log("error", `Catalog invalid (${load.errors.length} problems) at ${load.sourcePath}`);
      }
    } catch (err) {
      log("error", `Failed to load catalog: ${String(err)}`);
    }
  }, [service, detectAll, log]);

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return; // StrictMode mounts twice in dev
    initialized.current = true;
    service.getEnvironment().then((env) => dispatch({ type: "env", env }), (err) => log("error", String(err)));
    void reload();
  }, [service, reload, log]);

  // Sequential runner: exactly one installer at a time (msiexec can't run concurrently anyway — 1618).
  useEffect(() => {
    if (running.current) return;
    const next = state.queue.find((q) => q.state === "queued");
    if (!next) return;
    running.current = true;

    const { key, pkg } = next;
    dispatch({ type: "item", key, patch: { state: "verifying", startedAt: Date.now() } });
    log("info", `Starting ${pkg.name} ${pkg.version}`, pkg.id);

    service
      .install(pkg, (e) => {
        if (e.type === "phase") dispatch({ type: "item", key, patch: { state: e.phase } });
        else log(e.level, e.message, pkg.id);
      })
      .then(
        (outcome) => {
          const finalState: QueueState =
            outcome.kind === "success"
              ? outcome.rebootRequired
                ? "reboot"
                : "success"
              : outcome.kind === "hash-mismatch"
                ? "blocked"
                : "failed";
          dispatch({ type: "item", key, patch: { state: finalState, outcome, finishedAt: Date.now() } });
          if (outcome.kind === "failed" && outcome.stillRunning) {
            // Starting another installer now would just fail with 1618 (install already in progress).
            dispatch({ type: "skip-pending" });
            log("warn", `${pkg.name} is still running after its timeout. Remaining queue skipped — re-queue once it finishes.`, pkg.id);
          }
          if (outcome.kind === "hash-mismatch") {
            log("error", `${pkg.name} BLOCKED — installer hash does not match catalog. Not executed.`, pkg.id);
          }
        },
        (err) => {
          dispatch({
            type: "item",
            key,
            patch: { state: "failed", finishedAt: Date.now(), outcome: { kind: "failed", reason: String(err), durationMs: 0 } },
          });
          log("error", `${pkg.name} failed: ${String(err)}`, pkg.id);
        },
      )
      .finally(async () => {
        running.current = false;
        // Re-detect so the catalog reflects reality, then let the effect pick up the next item.
        try {
          dispatch({ type: "detect-done", id: pkg.id, result: await service.detect(pkg) });
        } catch {
          /* detection failure already surfaces as 'unknown' on next refresh */
        }
        dispatch({ type: "item", key, patch: {} });
      });
  }, [state.queue, service, log]);

  const actions = useMemo(
    () => ({
      reload,
      enqueue: (pkgs: Package[]) => {
        if (pkgs.length === 0) return;
        dispatch({ type: "enqueue", pkgs });
        log("info", `Queued: ${pkgs.map((p) => p.name).join(", ")}`);
      },
      skipPending: () => {
        dispatch({ type: "skip-pending" });
        log("warn", "Remaining queued installs skipped by user");
      },
      clearFinished: () => dispatch({ type: "clear-finished" }),
    }),
    [reload, log],
  );

  const rebootRequired = state.queue.some((q) => q.state === "reboot");
  return { ...state, rebootRequired, actions };
}
