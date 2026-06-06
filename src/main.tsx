import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Intentionally NOT wrapping in <React.StrictMode>. In dev it
// double-invokes effects to surface bugs; in production it's
// supposed to be inert. We're chasing a duplicate-thread bug
// that smells like double-dispatch, so we eliminate the variable.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
