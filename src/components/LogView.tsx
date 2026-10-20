import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../lib/useLaunchCore";

type Props = { log: LogEntry[]; logPath?: string };

const LEVEL_CLASS = { info: "text-muted-foreground", warn: "text-warning", error: "text-destructive" } as const;

const fmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });

export function LogView({ log, logPath }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [log.length]);

  const copy = async () => {
    const text = log
      .map((e) => `${new Date(e.ts).toISOString()} [${e.level.toUpperCase()}]${e.pkgId ? ` (${e.pkgId})` : ""} ${e.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be blocked by policy; text is still selectable */
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Session log</h2>
          {logPath && (
            <p className="text-xs text-muted-foreground">
              Also written to <span className="selectable font-mono">{logPath}</span>
            </p>
          )}
        </div>
        <button
          onClick={copy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          {copied ? "Copied!" : "Copy log"}
        </button>
      </div>
      <div className="selectable mt-4 max-h-[60vh] overflow-auto rounded bg-secondary p-3 font-mono text-[11px] leading-relaxed">
        {log.map((e, i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 text-muted-foreground">{fmt(e.ts)}</span>
            <span className={`w-11 shrink-0 uppercase ${LEVEL_CLASS[e.level]}`}>{e.level}</span>
            {e.pkgId && <span className="shrink-0 text-primary">{e.pkgId}</span>}
            <span className="break-all">{e.message}</span>
          </div>
        ))}
        {log.length === 0 && <span className="text-muted-foreground"># nothing logged yet</span>}
        <div ref={end} />
      </div>
    </section>
  );
}
