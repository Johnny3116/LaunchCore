import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import { MockService } from "./mock/mockService";
import { TauriService } from "./lib/tauriService";
// Self-hosted fonts (latin subset, only the weights the design uses).
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

// Inside the desktop app: real backend. In a plain browser (bun run dev): mock data, clearly badged.
const inApp = isTauri();
const service = inApp ? new TauriService() : new MockService();

createRoot(root).render(
  <StrictMode>
    <App service={service} isMock={!inApp} />
  </StrictMode>,
);
