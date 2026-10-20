import { useEffect, useRef } from "react";
import { ShieldCheck } from "lucide-react";
import type { Package } from "../lib/catalog";

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
      className="m-auto w-[440px] rounded-lg border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/50"
    >
      <div className="p-5">
        <h2 className="mb-1 text-base font-semibold">
          Install {pkgs.length} package{pkgs.length === 1 ? "" : "s"} on <span className="font-mono">{hostname}</span>?
        </h2>
        <p className="mb-4 text-xs text-muted">
          Each installer is hash-checked first, then Windows will ask for admin approval.
        </p>
        <ul className="mb-4 max-h-56 overflow-auto rounded-md border border-border">
          {pkgs.map((p) => (
            <li key={p.id} className="flex justify-between border-b border-border px-3 py-2 last:border-b-0">
              <span>{p.name}</span>
              <span className="font-mono text-muted">{p.version}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-semibold text-accent-fg"
          >
            <ShieldCheck size={14} /> Install
          </button>
        </div>
      </div>
    </dialog>
  );
}
