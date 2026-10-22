// First, for its side effect: Chrome can fire `beforeinstallprompt` before any component has mounted.
import "./pwa-install";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "flag-icons/css/flag-icons.min.css";
import "./styles.css";
import App from "./App";
import { registerOfflineSupport } from "./pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void registerOfflineSupport();
