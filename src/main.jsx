import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { StoreProvider } from "./store/store.jsx";
import "./index.css";

const IS_ANDROID = /android/i.test(navigator.userAgent || "");
if (IS_ANDROID) {
  const top = window.screen?.availTop ?? 0;
  const bottom = window.screen?.height - (window.screen?.availTop ?? 0) - (window.screen?.availHeight ?? 0);
  document.documentElement.style.setProperty("--sat", `${Math.max(top, 24)}px`);
  document.documentElement.style.setProperty("--sab", `${Math.max(bottom, 16)}px`);
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
