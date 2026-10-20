import { CheckCircle2, CircleDashed, HelpCircle, Loader2, ArrowUpCircle } from "lucide-react";
import type { DetectionResult } from "../lib/service";

type Props = { detection: DetectionResult | "pending" | undefined; catalogVersion: string };

export function StatusBadge({ detection, catalogVersion }: Props) {
  if (!detection || detection === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted">
        <Loader2 size={14} className="spin" /> Checking…
      </span>
    );
  }
  switch (detection.status) {
    case "installed":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ok" title={`Installed ${detection.installedVersion ?? ""}`}>
          <CheckCircle2 size={14} /> Installed
        </span>
      );
    case "outdated":
      return (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-warn"
          title={`Installed ${detection.installedVersion ?? "?"}, catalog has ${catalogVersion}`}
        >
          <ArrowUpCircle size={14} /> Update ({detection.installedVersion ?? "?"})
        </span>
      );
    case "not-installed":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted">
          <CircleDashed size={14} /> Not installed
        </span>
      );
    case "unknown":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-warn" title={detection.detail}>
          <HelpCircle size={14} /> Unknown
        </span>
      );
  }
}
