import { useState } from "react";
import { AlertOctagon, FlaskConical, Monitor, RotateCcw } from "lucide-react";
import type { Package } from "./lib/catalog";
import type { LaunchCoreService } from "./lib/service";
import { useLaunchCore } from "./lib/useLaunchCore";
import { CatalogView } from "./components/CatalogView";
import { QueuePanel } from "./components/QueuePanel";
import { LogView } from "./components/LogView";
import { ConfirmDialog } from "./components/ConfirmDialog";

type Tab = "catalog" | "log";

export default function App({ service, isMock = false }: { service: LaunchCoreService; isMock?: boolean }) {
  const { env, load, detection, queue, log, rebootRequired, actions } = useLaunchCore(service);
  const [tab, setTab] = useState<Tab>("catalog");
  const [pending, setPending] = useState<Package[] | null>(null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-border bg-surface px-4 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tracking-tight">LaunchCore</span>
          {load?.ok && <span className="text-xs text-muted">{load.catalog.name}</span>}
        </div>
        {isMock && (
          <span
            className="inline-flex items-center gap-1 rounded bg-warn px-1.5 py-0.5 text-[11px] font-bold uppercase text-bg"
            title="Simulated data. Nothing is installed."
          >
            <FlaskConical size={12} /> Mock
          </span>
        )}
        <nav className="ml-4 flex gap-1" role="tablist">
          {(["catalog", "log"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 capitalize ${tab === t ? "bg-surface-2 font-semibold" : "text-muted hover:bg-surface-2"}`}
            >
              {t}
              {t === "log" && log.some((e) => e.level === "error") && (
                <span className="ml-1.5 inline-block size-1.5 rounded-full bg-bad align-middle" />
              )}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        {env && (
          <div className="flex items-center gap-2 text-xs text-muted" title={`${env.osVersion}\nRunning from ${env.appDir}`}>
            <Monitor size={14} />
            <span className="selectable font-mono text-text">{env.hostname}</span>
            <span>·</span>
            <span className="selectable font-mono">{env.username}</span>
          </div>
        )}
      </header>

      {rebootRequired && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2 text-warn">
          <RotateCcw size={14} />
          <span>One or more installs need a reboot to finish. Restart when the queue is done.</span>
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {tab === "log" ? (
            <LogView log={log} logPath={env?.logPath} />
          ) : !load ? (
            <div className="p-10 text-center text-muted">Loading catalog…</div>
          ) : !load.ok ? (
            <CatalogErrors sourcePath={load.sourcePath} errors={load.errors} onRetry={actions.reload} />
          ) : (
            <CatalogView
              catalog={load.catalog}
              detection={detection}
              queue={queue}
              onInstall={setPending}
              onRefresh={actions.reload}
            />
          )}
        </div>
        <QueuePanel queue={queue} onSkipPending={actions.skipPending} onClearFinished={actions.clearFinished} />
      </main>

      {pending && (
        <ConfirmDialog
          pkgs={pending}
          hostname={env?.hostname ?? "this computer"}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            actions.enqueue(pending);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}

function CatalogErrors({ sourcePath, errors, onRetry }: { sourcePath: string; errors: string[]; onRetry: () => void }) {
  return (
    <div className="m-6 rounded-lg border border-bad bg-surface p-5">
      <div className="mb-2 flex items-center gap-2 font-semibold text-bad">
        <AlertOctagon size={16} /> catalog.json is invalid — nothing can be installed until it's fixed
      </div>
      <div className="mb-3 text-xs text-muted">
        Source: <span className="selectable font-mono">{sourcePath}</span>
      </div>
      <ul className="selectable mb-4 list-disc space-y-1 pl-5 font-mono text-xs">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <button onClick={onRetry} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
        Reload
      </button>
    </div>
  );
}
