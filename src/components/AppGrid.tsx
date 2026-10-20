import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { tileColor, type Catalog } from "../lib/catalog";
import { isActive, type QueueState } from "../lib/useLaunchCore";

type Props = {
  catalog: Catalog;
  /** Latest queue state per package id — drives the spinner on running tiles. */
  queueState: Record<string, QueueState>;
  /** Package ids currently queued or running — not selectable. */
  locked: Set<string>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onRefresh: () => void;
};

export function AppGrid({ catalog, queueState, locked, selected, onToggle, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(catalog.packages.map((p) => p.category))).sort()],
    [catalog],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.packages.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!q || (p.name + (p.publisher ?? "") + p.id).toLowerCase().includes(q)),
    );
  }, [catalog, query, category]);

  return (
    <main className="min-w-0">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps…"
          className="selectable w-full rounded-md border border-input bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={onRefresh}
          title="Re-read catalog and re-check what's installed"
          className="grid w-12 shrink-0 place-items-center rounded-md border border-input bg-card text-muted-foreground hover:text-foreground"
        >
          <RefreshCw size={16} />
          <span className="sr-only">Refresh</span>
        </button>
      </div>

      {categories.length > 2 && (
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Category">
          {categories.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={category === c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                category === c ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => {
          const color = tileColor(p);
          const on = selected.has(p.id);
          const isLocked = locked.has(p.id);
          const q = queueState[p.id];
          return (
            <button
              key={p.id}
              onClick={() => onToggle(p.id)}
              disabled={isLocked}
              aria-pressed={on}
              aria-label={`${p.name} ${p.version}`}
              className="group relative flex h-[132px] flex-col justify-end overflow-hidden rounded-2xl border p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-default disabled:hover:translate-y-0"
              style={{
                backgroundColor: color,
                backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0) 55%)",
                borderColor: on ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)",
                boxShadow: on ? `0 0 0 3px ${color}66, 0 10px 30px -10px ${color}` : undefined,
              }}
            >
              <span
                className={`absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full border text-sm font-bold transition ${
                  on ? "border-white bg-white" : "border-white/50"
                }`}
                style={on ? { color } : undefined}
                aria-hidden
              >
                {on ? "✓" : isLocked && q && isActive(q) ? <span className="spin block h-3 w-3 rounded-full border-2 border-white border-t-transparent" /> : ""}
              </span>
              {/* Fixed tile height: names clamp to two lines so every tile is the same size. */}
              <h3 className="line-clamp-2 pr-8 font-display text-2xl font-bold leading-tight text-white" title={p.name}>
                {p.name}
              </h3>
              <p className="mt-1.5 font-mono text-sm font-semibold text-white/90">v{p.version}</p>
            </button>
          );
        })}
        {list.length === 0 && <p className="col-span-full py-10 text-center text-muted-foreground">No apps match.</p>}
      </div>
    </main>
  );
}
