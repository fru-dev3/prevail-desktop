import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "./bridge";
import App from "./App";
import { APP_VERSION } from "./constants";
import { initCrashReporting, osFamily, reportError, track } from "./telemetry";
import "./index.css";

// Anonymous, consent-gated, allowlisted. Logs locally always (transparency);
// only transmitted when the user opts in AND build-time keys exist.
track("app_opened", { version: APP_VERSION, os: osFamily() });

// Attach Sentry's global crash handlers if (and only if) the user has opted into
// crash reports and a DSN was built in. Uncaught errors / unhandled rejections
// are then captured automatically; React render crashes are reported explicitly
// from the ErrorBoundary below (React swallows those from window.onerror).
initCrashReporting();

// Surface fatal startup/render errors instead of a blank white window.
function showFatal(msg: string) {
  void invoke("log_fatal", { msg }).catch(() => {});
  const el = document.getElementById("root");
  if (el) {
    el.innerHTML =
      '<div style="height:100vh;overflow:auto;background:#faf8f1;padding:24px;' +
      'font:13px ui-monospace,SFMono-Regular,Menlo,monospace">' +
      '<div style="color:#1a1a1a;font-weight:700;margin-bottom:6px">Prevail hit an error and stopped this view.</div>' +
      '<div style="color:#555;margin-bottom:14px">Your vault data is safe on disk. Reload to continue.</div>' +
      '<button onclick="location.reload()" style="padding:8px 18px;border-radius:8px;border:1px solid #C4A35A;' +
      'background:#C4A35A;color:#fff;font:600 13px ui-monospace,monospace;cursor:pointer;margin-bottom:18px">Reload Prevail</button>' +
      '<pre style="white-space:pre-wrap;color:#b3261e;margin:0">' +
      msg.replace(/</g, "&lt;") +
      "</pre></div>";
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
    reportError(err); // no-op unless crash consent is on + DSN built in
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
