import React from "react";
import { createRoot } from "react-dom/client";
import "xterm/css/xterm.css";
import "./style.css";
import App from "./App";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Missing #app root element");
}

createRoot(root).render(<App />);
