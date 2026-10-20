import { useEffect, useState } from "react";
import type { Package } from "../lib/catalog";
import { describeExitCode } from "../lib/exitCodes";
import { isActive, isFinished, type QueueItem, type QueueState } from "../lib/useLaunchCore";

type Props = {
  selected: Package[];
  queue: QueueItem[];
  busy: boolean;
  rebootRequired: boolean;
  onInstall: () => void;
  onClearSelection: () => void;
  onSkipPending: () => void;
  onClearFinished: () => void;
};

const LABEL: Record<QueueState, string> = {
  queued: "queued",
  verifying: "verifying",
  "waiting-elevation": "uac",
  installing: "installing",
  success: "done",
  reboot: "reboot",
  failed: "failed",
  blocked: "blocked",
  skipped: "skipped",
};

const TONE: Record<QueueState, string> = {
  queued: "text-muted-foreground",
  verifying: "text-primary",
  "waiting-elevation": "text-primary",
  installing: "text-primary",
  success: "text-success",
  reboot: "text-warning",
  failed: "text-destructive",
  blocked: "text-destructive",
  skipped: "text-muted-foreground",
};

/** Installers don't report real progress, so show elapsed time instead of a fake bar. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</>;
}

function detail(item: QueueItem): string | undefined {
  const o = item.outcome;
  if (!o) return undefined;
  switch (o.kind) {
    case "success":
      return `exit ${o.exitCode} · ${(o.durationMs / 1000).toFixed(1)}s`;
    case "failed":
      return o.exitCode !== undefined ? `exit ${o.exitCode} — ${describeExitCode(o.exitCode)}` : o.reason;
    case "hash-mismatch":
      return "file differs from catalog — not run";
  }
}

export function QueuePanel(props: Props) {
  const { selected, queue, busy, rebootRequired } = props;
  const pending = queue.filter((q) => q.state === "queued").length;
  const finished = queue.filter((q) => isFinished(q.state)).length;

  return (
    <aside className="h-fit rounded-lg border border-border bg-card p-5 lg:sticky lg:top-8">
      <h2 className="font-display text-lg font-semibold">Install queue</h2>
      <p className="text-xs text-muted-foreground">{selected.length} selected</p>

      <ul className="mt-4 space-y-2">
        {selected.length === 0 && queue.length === 0 && (
          <li className="text-sm text-muted-foreground">Click apps to add them.</li>
        )}
        {selected.map((p) => (
          <li key={p.id} className="flex justify-between gap-2 font-mono text-xs">
            <span className="truncate">{p.id}</span>
            <span className="text-primary">ready</span>
          </li>
        ))}
      </ul>

      <button
        disabled={selected.length === 0}
        onClick={props.onInstall}
        className="mt-5 w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
      >
        {busy && selected.length === 0 ? "Installing…" : `Install ${selected.length || ""} app${selected.length === 1 ? "" : "s"}`}
      </button>
      {selected.length > 0 && (
        <button
          onClick={props.onClearSelection}
          className="mt-2 w-full py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}

      {queue.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This session</h3>
            <div className="flex gap-3 text-xs text-muted-foreground">
              {pending > 0 && (
                <button
                  onClick={props.onSkipPending}
                  className="hover:text-foreground"
                  title="Skip items that haven't started. A running install is never killed."
                >
                  Skip pending
                </button>
              )}
              {finished > 0 && (
                <button onClick={props.onClearFinished} className="hover:text-foreground">
                  Clear done
                </button>
              )}
            </div>
          </div>
          <ul className="space-y-2">
            {queue.map((item) => (
              <li key={item.key} className="font-mono text-xs">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{item.pkg.id}</span>
                  <span className={TONE[item.state]}>
                    {LABEL[item.state]}
                    {isActive(item.state) && item.startedAt && (
                      <>
                        {" "}
                        <Elapsed since={item.startedAt} />
                      </>
                    )}
                  </span>
                </div>
                {detail(item) && <div className="selectable text-[10px] text-muted-foreground">{detail(item)}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rebootRequired && (
        <p className="mt-4 rounded bg-secondary p-3 text-xs text-warning">
          A reboot is needed to finish installing. Restart once the queue is done.
        </p>
      )}
      {queue.some((q) => q.state === "blocked") && (
        <p className="mt-3 rounded bg-secondary p-3 text-xs text-destructive">
          A blocked installer may have been modified. Don't run it manually — report it and replace it from a trusted source.
        </p>
      )}
    </aside>
  );
}
