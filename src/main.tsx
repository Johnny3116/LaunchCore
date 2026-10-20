import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MockService } from "./mock/mockService";
// Self-hosted fonts (latin subset, only the weights the design uses).
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

// Phase 1: mock only. Phase 2 swaps in a TauriService implementing the same interface.
const service = new MockService();

createRoot(root).render(
  <StrictMode>
    <App service={service} isMock />
  </StrictMode>,
);
