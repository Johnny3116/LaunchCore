import { useMemo, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import type { Catalog, Package } from "../lib/catalog";
import type { DetectionResult } from "../lib/service";
import { isFinished, type QueueItem } from "../lib/useLaunchCore";
import { StatusBadge } from "./StatusBadge";

type Props = {
  catalog: Catalog;
  detection: Record<string, DetectionResult | "pending">;
  queue: QueueItem[];
  onInstall: (pkgs: Package[]) => void;
  onRefresh: () => void;
};

export function CatalogView({ catalog, detection, queue, onInstall, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const inQueue = useMemo(
    () => new Set(queue.filter((q) => !isFinished(q.state)).map((q) => q.pkg.id)),
    [queue],
  );

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(catalog.packages.map((p) => p.category))).sort()],
    [catalog],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.packages.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!q || [p.name, p.publisher ?? "", p.id].some((s) => s.toLowerCase().includes(q))),
    );
  }, [catalog, query, category]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectable = visible.filter((p) => !inQueue.has(p.id));
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((p) => p.id)));

  const selectedPkgs = catalog.packages.filter((p) => selected.has(p.id) && !inQueue.has(p.id));

  const installSelected = () => {
    onInstall(selectedPkgs);
    setSelected(new Set());
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <label className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search packages"
            className="selectable h-8 w-56 rounded-md border border-border bg-bg pl-8 pr-2 outline-none focus:border-accent"
          />
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-8 rounded-md border border-border bg-bg px-2"
          aria-label="Category"
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          onClick={onRefresh}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 hover:bg-surface-2"
          title="Re-read catalog and re-check what's installed"
        >
          <RefreshCw size={14} /> Refresh
        </button>
        <div className="flex-1" />
        <button
          onClick={installSelected}
          disabled={selectedPkgs.length === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={14} /> Install selected{selectedPkgs.length ? ` (${selectedPkgs.length})` : ""}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-10 px-4 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="py-2 pr-4 font-semibold">Package</th>
              <th className="py-2 pr-4 font-semibold">Version</th>
              <th className="py-2 pr-4 font-semibold">Category</th>
              <th className="py-2 pr-4 font-semibold">Status</th>
              <th className="py-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const det = detection[p.id];
              const queued = inQueue.has(p.id);
              const installed = det !== "pending" && det?.status === "installed";
              return (
                <tr key={p.id} className="border-b border-border bg-surface hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      disabled={queued}
                      onChange={() => toggle(p.id)}
                      aria-label={`Select ${p.name}`}
                    />
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-muted">
                      {p.publisher ?? "—"}
                      <span className="mx-1.5">·</span>
                      <span className="font-mono">{p.installer.type.toUpperCase()}</span>
                      {p.description && <span className="ml-1.5">· {p.description}</span>}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 font-mono">{p.version}</td>
                  <td className="py-2.5 pr-4 text-muted">{p.category}</td>
                  <td className="py-2.5 pr-4">
                    <StatusBadge detection={det} catalogVersion={p.version} />
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    <button
                      onClick={() => onInstall([p])}
                      disabled={queued}
                      className="h-7 rounded-md border border-border px-2.5 hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {queued ? "Queued" : installed ? "Reinstall" : det !== "pending" && det?.status === "outdated" ? "Update" : "Install"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  No packages match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
