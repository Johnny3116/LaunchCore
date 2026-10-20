import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MockService } from "./mock/mockService";
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
