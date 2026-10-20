import { useEffect, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { describeExitCode } from "../lib/exitCodes";
import { isActive, isFinished, type QueueItem, type QueueState } from "../lib/useLaunchCore";

type Props = { queue: QueueItem[]; onSkipPending: () => void; onClearFinished: () => void };

const LABEL: Record<QueueState, string> = {
  queued: "Queued",
  verifying: "Verifying hash…",
  "waiting-elevation": "Waiting for UAC…",
  installing: "Installing…",
  success: "Installed",
  reboot: "Installed — reboot required",
  failed: "Failed",
  blocked: "Blocked — hash mismatch",
  skipped: "Skipped",
};

function Icon({ state }: { state: QueueState }) {
  if (isActive(state)) return <Loader2 size={16} className="spin text-info" />;
  switch (state) {
    case "queued":
      return <Clock size={16} className="text-muted" />;
    case "success":
      return <CheckCircle2 size={16} className="text-ok" />;
    case "reboot":
      return <RotateCcw size={16} className="text-warn" />;
    case "failed":
      return <XCircle size={16} className="text-bad" />;
    case "blocked":
      return <ShieldAlert size={16} className="text-bad" />;
    default:
      return <Ban size={16} className="text-muted" />;
  }
}

/** Live elapsed timer. Installers don't report real progress, so we don't fake a percentage. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="font-mono">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

function detail(item: QueueItem): string | undefined {
  const o = item.outcome;
  if (!o) return undefined;
  switch (o.kind) {
    case "success":
      return `Exit ${o.exitCode} · ${(o.durationMs / 1000).toFixed(1)}s`;
    case "failed":
      return o.exitCode !== undefined ? `Exit ${o.exitCode} — ${describeExitCode(o.exitCode)}` : o.reason;
    case "hash-mismatch":
      return "Installer file differs from catalog. It was not run.";
  }
}

export function QueuePanel({ queue, onSkipPending, onClearFinished }: Props) {
  const pending = queue.filter((q) => q.state === "queued").length;
  const finished = queue.filter((q) => isFinished(q.state)).length;

  return (
    <aside className="flex h-full min-h-0 w-80 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Install queue</h2>
        <div className="flex gap-1">
          <button
            onClick={onSkipPending}
            disabled={pending === 0}
            className="rounded px-2 py-1 text-xs hover:bg-surface-2 disabled:opacity-40"
            title="Skip items that haven't started. A running install is never killed."
          >
            Skip pending
          </button>
          <button
            onClick={onClearFinished}
            disabled={finished === 0}
            className="rounded px-2 py-1 text-xs hover:bg-surface-2 disabled:opacity-40"
          >
            Clear done
          </button>
        </div>
      </div>

      <ol className="min-h-0 flex-1 overflow-auto">
        {queue.length === 0 && (
          <li className="px-4 py-10 text-center text-muted">
            Nothing queued.
            <br />
            Pick packages and hit Install.
          </li>
        )}
        {queue.map((item) => (
          <li key={item.key} className="flex gap-3 border-b border-border px-4 py-3">
            <div className="pt-0.5">
              <Icon state={item.state} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{item.pkg.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{item.pkg.version}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{LABEL[item.state]}</span>
                {isActive(item.state) && item.startedAt && <Elapsed since={item.startedAt} />}
              </div>
              {detail(item) && <div className="selectable mt-1 text-xs text-muted">{detail(item)}</div>}
            </div>
          </li>
        ))}
      </ol>

      {queue.some((q) => q.state === "blocked") && (
        <div className="flex gap-2 border-t border-border bg-surface-2 px-4 py-3 text-xs">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-bad" />
          <span>A blocked installer may have been modified. Don't run it manually — report it and replace it from a trusted source.</span>
        </div>
      )}
    </aside>
  );
}
