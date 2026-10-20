import { useEffect, useRef } from "react";
import { tileColor, type Package } from "../lib/catalog";

type Props = { pkgs: Package[]; hostname: string; onConfirm: () => void; onCancel: () => void };

/** Last stop before anything runs. Names the machine so nobody installs on the wrong box. */
export function ConfirmDialog({ pkgs, hostname, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[440px] rounded-lg border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/50"
    >
      <div className="p-6">
        <h2 className="font-display text-lg font-semibold">
          Install {pkgs.length} app{pkgs.length === 1 ? "" : "s"} on <span className="font-mono">{hostname}</span>?
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Each installer is hash-checked first, then Windows asks for admin approval.
        </p>
        <ul className="mt-4 max-h-56 space-y-2 overflow-auto">
          {pkgs.map((p) => (
            <li key={p.id} className="flex items-center gap-3 text-sm">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tileColor(p) }} />
              <span className="flex-1">{p.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{p.version}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Install
          </button>
        </div>
      </div>
    </dialog>
  );
}
