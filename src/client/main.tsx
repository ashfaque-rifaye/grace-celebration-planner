import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createPlanStore, createBrowserStorage } from "./lib/plan-store";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

const store = createPlanStore(createBrowserStorage());
window.addEventListener("pagehide", () => store.flush());

createRoot(container).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
