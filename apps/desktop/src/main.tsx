import React from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles/tokens.css";
import "./styles/global.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Missing #app root element");
}

createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
