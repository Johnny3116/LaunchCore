import { useMemo, useState } from "react";
import type { Package } from "./lib/catalog";
import type { LaunchCoreService } from "./lib/service";
import { isActive, isFinished, useLaunchCore, type QueueState } from "./lib/useLaunchCore";
import { AppGrid } from "./components/AppGrid";
import { QueuePanel } from "./components/QueuePanel";
import { LogView } from "./components/LogView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import logo from "./assets/logo.png";

type View = "apps" | "log";

export default function App({ service, isMock = false }: { service: LaunchCoreService; isMock?: boolean }) {
  const { env, load, queue, log, rebootRequired, actions } = useLaunchCore(service);
  const [view, setView] = useState<View>("apps");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<Package[] | null>(null);

  // Latest queue entry per package wins; drives tile status text.
  const queueState = useMemo(() => {
    const m: Record<string, QueueState> = {};
    for (const q of queue) m[q.pkg.id] = q.state;
    return m;
  }, [queue]);
  const locked = useMemo(
    () => new Set(queue.filter((q) => !isFinished(q.state)).map((q) => q.pkg.id)),
    [queue],
  );

  const catalog = load?.ok ? load.catalog : undefined;
  const selectedPkgs = catalog ? catalog.packages.filter((p) => selected.has(p.id) && !locked.has(p.id)) : [];
  const busy = queue.some((q) => q.state === "queued" || isActive(q.state));
  const hasErrors = log.some((e) => e.level === "error");

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border px-8 py-5">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="h-9 w-9" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">LaunchCore</h1>
            <p className="text-xs text-muted-foreground">{catalog?.name ?? "Windows software catalog"}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {env && (
            <span className="selectable hidden font-mono text-xs text-muted-foreground md:inline" title={`${env.osVersion}\nRunning from ${env.appDir}`}>
              {env.hostname} · {env.username}
            </span>
          )}
          <button
            onClick={() => setView(view === "log" ? "apps" : "log")}
            className="relative rounded-full bg-muted px-3 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            {view === "log" ? "← apps" : "log"}
            {hasErrors && view !== "log" && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />
            )}
          </button>
          <span
            className={`rounded-full px-3 py-1 font-mono text-xs ${
              isMock ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary"
            }`}
            title={isMock ? "Simulated data. Nothing is installed." : undefined}
          >
            {isMock ? "○ mock mode — nothing installs" : "● desktop mode"}
          </span>
        </div>
      </header>

      {view === "log" ? (
        <div className="px-8 py-8">
          <LogView log={log} logPath={env?.logPath} />
        </div>
      ) : (
        <div className="grid gap-8 px-8 py-8 lg:grid-cols-[1fr_340px]">
          {!load ? (
            <p className="text-muted-foreground">Loading catalog…</p>
          ) : !load.ok ? (
            <CatalogErrors sourcePath={load.sourcePath} errors={load.errors} onRetry={actions.reload} />
          ) : (
            <AppGrid
              catalog={load.catalog}
              queueState={queueState}
              locked={locked}
              selected={selected}
              onToggle={toggle}
              onRefresh={actions.reload}
            />
          )}
          <QueuePanel
            selected={selectedPkgs}
            queue={queue}
            busy={busy}
            rebootRequired={rebootRequired}
            onInstall={() => setConfirming(selectedPkgs)}
            onClearSelection={() => setSelected(new Set())}
            onSkipPending={actions.skipPending}
            onClearFinished={actions.clearFinished}
          />
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          pkgs={confirming}
          hostname={env?.hostname ?? "this computer"}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            actions.enqueue(confirming);
            setSelected(new Set());
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

function CatalogErrors({ sourcePath, errors, onRetry }: { sourcePath: string; errors: string[]; onRetry: () => void }) {
  return (
    <main className="rounded-lg border border-destructive bg-card p-5">
      <h2 className="font-display text-lg font-semibold text-destructive">catalog.json is invalid</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Nothing can be installed until it's fixed. Source: <span className="selectable font-mono">{sourcePath}</span>
      </p>
      <ul className="selectable mb-4 list-disc space-y-1 pl-5 font-mono text-xs">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <button onClick={onRetry} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        Reload
      </button>
    </main>
  );
}
