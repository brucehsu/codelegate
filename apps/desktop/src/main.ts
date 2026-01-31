import "./style.css";
import { formatWelcome } from "@codelegate/shared";

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <div class="app">
      <h1>Codelegate</h1>
      <p>${formatWelcome("desktop")}</p>
    </div>
  `;
}
