import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/globals.css";
import { getThemeCache } from "./lib/theme-cache.js";

const cached = getThemeCache();
if (cached) {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(cached.cssVars)) {
    style.setProperty(name, value);
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
