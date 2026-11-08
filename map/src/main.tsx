import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./App";

// MapLibre 6 finds its worker next to its own module; Vite pre-bundling moves the module, so point at the worker explicitly.
setWorkerUrl(workerUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
