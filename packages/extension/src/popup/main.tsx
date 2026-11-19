import React from "react";
import ReactDOM from "react-dom/client";
import { PopupApp } from "./PopupApp.js";
import "./popup.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <PopupApp />
    </React.StrictMode>,
  );
}
