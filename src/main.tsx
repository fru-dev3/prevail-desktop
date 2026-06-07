import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "./bridge";
import App from "./App";
import "./index.css";

// Surface fatal startup/render errors instead of a blank white window.
function showFatal(msg: string) {
  void invoke("log_fatal", { msg }).catch(() => {});
  const el = document.getElementById("root");
  if (el) {
    el.innerHTML =
      '<pre style="white-space:pre-wrap;padding:24px;margin:0;height:100vh;overflow:auto;' +
      'font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#b3261e;background:#faf8f1">' +
      "PREVAIL failed to start:\n\n" +
      msg.replace(/</g, "&lt;") +
      "</pre>";
  }
}
window.addEventListener("error", (e) =>
  showFatal((e.error && (e.error.stack || e.error.message)) || e.message || "unknown error"),
);
// A stray promise rejection should NOT nuke the whole app — log it and keep
// running. Only render/startup errors (the "error" listener + ErrorBoundary
// above) are fatal.
window.addEventListener("unhandledrejection", (e) => {
  const msg = (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason);
  console.error("[prevail] unhandled rejection (non-fatal):", msg);
  void invoke("log_fatal", { msg: "unhandledrejection (non-fatal): " + msg }).catch(() => {});
});

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) {
    return { err };
  }
  componentDidCatch(err: unknown) {
    showFatal((err as Error)?.stack || (err as Error)?.message || String(err));
  }
  render() {
    return this.state.err ? null : this.props.children;
  }
}

try {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
} catch (err) {
  showFatal((err as Error)?.stack || (err as Error)?.message || String(err));
}
