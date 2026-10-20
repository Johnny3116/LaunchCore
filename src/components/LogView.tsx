import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { LogEntry } from "../lib/useLaunchCore";

type Props = { log: LogEntry[]; logPath?: string };

const LEVEL_CLASS = { info: "text-muted", warn: "text-warn", error: "text-bad" } as const;

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
        <div className="text-xs text-muted">
          Session log{logPath && <> · also written to <span className="selectable font-mono">{logPath}</span></>}
        </div>
        <button onClick={copy} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-surface-2">
          <Copy size={12} /> {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      <div className="selectable min-h-0 flex-1 overflow-auto bg-bg px-4 py-3 font-mono text-xs leading-relaxed">
        {log.map((e, i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 text-muted">{fmt(e.ts)}</span>
            <span className={`w-12 shrink-0 uppercase ${LEVEL_CLASS[e.level]}`}>{e.level}</span>
            {e.pkgId && <span className="shrink-0 text-info">{e.pkgId}</span>}
            <span className="break-all">{e.message}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
