// Connect an app by describing the goal - no tier dropdowns, no auth forms.
// The user types the app name + what they want from it; the Connection Agent
// (engine) researches the best method and returns a plan + the ONE auth step.
// See docs/APPS-REDESIGN.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Sparkles, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { PREF, getPref } from "./storage";
import { AppRowLogo } from "./panels3";
import type { BrandLogo, CatalogApp, ConnectorCatalog, EngineApp } from "./types";

type Plan = {
  app_id?: string;
  title?: string;
  integration?: string;
  why?: string;
  auth_step?: { kind?: string; instruction?: string };
  schedule?: { every?: string };
  domains?: string[];
  data?: string;
};
type ConnectResult = { ok: boolean; plan?: Plan; error?: string; raw?: string; verified?: boolean | null; proof?: string | null };

const METHOD_LABEL: Record<string, string> = {
  mcp: "MCP server", api: "API", oauth: "API (OAuth)", cli: "CLI", composio: "Composio", browser: "Browser automation", manual: "Manual",
};

// Small edit-distance (Levenshtein) for the "did you mean" catalog suggestion.
// Kept tiny + dependency-free; only ever runs over short app names.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function ConnectAppFlow({ vaultPath, onDone, onCancel, presetName, presetGoal }: { vaultPath: string; onDone: () => void; onCancel: () => void; presetName?: string; presetGoal?: string }) {
  const [name, setName] = useState(presetName ?? "");
  const [goal, setGoal] = useState(presetGoal ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);
  // While the engine researches (one long async call), cycle a visible status so
  // it's clear work is happening - a button spinner alone reads as "stuck".
  const RESEARCH_PHASES = [
    "Reading what you want to pull in…",
    "Checking for an MCP server…",
    "Checking the official API…",
    "Checking a local CLI…",
    "Checking Composio connectors…",
    "Considering browser automation…",
    "Picking the best method for you…",
  ];
  const [phaseIdx, setPhaseIdx] = useState(0);
  useEffect(() => {
    if (!busy) { setPhaseIdx(0); return; }
    const id = window.setInterval(() => setPhaseIdx((i) => Math.min(i + 1, RESEARCH_PHASES.length - 1)), 1400);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  // APP-2: IntelliSense - match what's typed against already-connected apps so we
  // REUSE an existing one instead of silently creating a duplicate. (No dropdown;
  // a single inline match that the user can open, or override to connect anew.)
  const [existing, setExisting] = useState<EngineApp[]>([]);
  useEffect(() => { void invoke<EngineApp[]>("engine_apps_list").then((l) => setExisting(Array.isArray(l) ? l : [])).catch(() => {}); }, []);
  // APP-2b: NAME CORRECTION - load the connector catalog once so we can offer a
  // light "did you mean <Correct Name>?" when the typed name is a near-miss of a
  // known app. Optional: if the command isn't available, skip silently.
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  useEffect(() => {
    void invoke<ConnectorCatalog>("ingestion_connector_catalog")
      .then((c) => setCatalog(Array.isArray(c?.apps) ? c.apps : []))
      .catch(() => {});
  }, []);
  // Real brand marks so the result card + the "already connected" match row show
  // the app's actual logo (resolved by AppRowLogo) rather than nothing.
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  useEffect(() => { void invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setLogos).catch(() => {}); }, []);
  const match = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (q.length < 2) return null;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const nq = norm(q);
    return existing.find((a) => {
      const t = norm(a.title || ""); const id = norm(a.id || "");
      return t === nq || id === nq || (nq.length >= 3 && (t.includes(nq) || id.includes(nq) || nq.includes(t)));
    }) ?? null;
  }, [name, existing]);
  // APP-2b: fuzzy "did you mean" against the catalog. Only surfaces when the typed
  // name is NOT already an exact/substring catalog hit but is CLOSE to one (small
  // edit distance on the normalized name). It's a suggestion - never blocks submit.
  const didYouMean = useMemo(() => {
    const q = name.trim();
    if (q.length < 2 || catalog.length === 0) return null;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const nq = norm(q);
    if (!nq) return null;
    let best: { name: string; dist: number } | null = null;
    for (const a of catalog) {
      const label = a.name || "";
      const nl = norm(label);
      if (!nl) continue;
      // Already a good match (exact or clear substring) - no correction needed.
      if (nl === nq || (nq.length >= 3 && (nl.includes(nq) || nq.includes(nl)))) return null;
      const dist = editDistance(nq, nl);
      // Allow up to ~1 typo per 4 chars (min 1), capped at 2.
      const tol = Math.min(2, Math.max(1, Math.floor(Math.min(nq.length, nl.length) / 4)));
      if (dist <= tol && (!best || dist < best.dist)) best = { name: label, dist };
    }
    return best?.name ?? null;
  }, [name, catalog]);

  // APP-3: SUGGEST DOMAINS - when a plan comes back, surface the domains the agent
  // suggests this app should feed as selectable chips (pre-selected from plan), let
  // the user toggle / add one, then persist the confirmed set before finishing.
  const [domSel, setDomSel] = useState<Set<string>>(new Set());
  const [allDomains, setAllDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [savingDomains, setSavingDomains] = useState(false);
  // Pre-select from the returned plan whenever a successful result arrives.
  useEffect(() => {
    const ds = result?.ok ? result.plan?.domains : undefined;
    setDomSel(new Set((ds ?? []).map((d) => d.toLowerCase())));
    setNewDomain("");
  }, [result]);
  // Pull the vault's existing domains so the chips can show options beyond what the
  // plan suggested (optional - the user can also type a brand-new one).
  useEffect(() => {
    void invoke<{ name: string }[]>("scan_vault", { path: vaultPath })
      .then((ds) => setAllDomains((ds ?? []).map((d) => d.name.toLowerCase()).sort()))
      .catch(() => {});
  }, [vaultPath]);
  const toggleDomain = (d: string) => setDomSel((prev) => {
    const next = new Set(prev); const k = d.toLowerCase();
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const addNewDomain = () => {
    const d = newDomain.trim().toLowerCase();
    if (!d) return;
    setDomSel((prev) => new Set(prev).add(d));
    setNewDomain("");
  };

  // Google Workspace is special: it has a dedicated, fully Prevail-driven setup
  // panel (opens the browser, authenticates via the gws CLI, shows which account
  // you signed in as, and manages multiple Google accounts). It must NEVER go
  // through the generic "research + run a command" connect flow (which wrongly
  // told the user to run `gws auth setup` by hand). Detect it and hand off.
  const isGoogleWorkspace = (s: string) => {
    const n = (s || "").toLowerCase().replace(/[^a-z]/g, "");
    return n === "google" || n === "googleworkspace" || n === "gws";
  };
  const openGoogleDedicated = () => {
    window.dispatchEvent(new CustomEvent("prevail:app-open", { detail: "google" }));
    onCancel();
  };

  const find = async () => {
    if (!name.trim()) return;
    if (isGoogleWorkspace(name)) { openGoogleDedicated(); return; }
    setBusy(true);
    setResult(null);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      const r = await invoke<ConnectResult>("engine_app_connect", { name: name.trim(), goal: goal.trim(), vault: vaultPath, provider, model });
      setResult(r);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  // Opened pre-seeded from a catalog pick: kick off the research immediately so
  // the user lands on the picked method/plan instead of an empty form. Once only.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (presetName && presetName.trim() && !autoStarted.current) {
      autoStarted.current = true;
      if (isGoogleWorkspace(presetName)) { openGoogleDedicated(); return; }
      void find();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetName]);

  const plan = result?.plan;
  // APP-3: persist the confirmed domains (if we have an app id + the set changed
  // from the plan) before handing off to onDone. Best-effort - never blocks finish.
  const finishWithDomains = async () => {
    const id = plan?.app_id;
    const chosen = [...domSel].sort();
    const original = (plan?.domains ?? []).map((d) => d.toLowerCase()).sort();
    const changed = chosen.length !== original.length || chosen.some((d, i) => d !== original[i]);
    if (id && changed) {
      setSavingDomains(true);
      try { await invoke("engine_app_set_domains", { id, domains: chosen }); }
      catch (e) { console.error("set domains", e); }
      finally { setSavingDomains(false); }
    }
    onDone();
  };
  const authNeeded = plan?.auth_step && plan.auth_step.kind && plan.auth_step.kind !== "none" && (plan.auth_step.instruction ?? "").trim() !== "";

  return (
    <div className="mb-5 rounded-xl border border-accent-border bg-accent-soft/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Sparkles className="h-4 w-4 text-accent" /> Connect an app
        </div>
        <button onClick={onCancel} className="rounded p-1 text-text-muted hover:text-text-primary" title="Cancel"><X className="h-4 w-4" /></button>
      </div>

      {!result && (
        <div className="space-y-2">
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="App name (e.g. AllTrails, Gmail, PayPal)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-border"
          />
          <textarea
            value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder="What should it pull in, and into which domain? (e.g. my completed hikes and saved trails into Health, weekly)"
            rows={2}
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-text-primary outline-none focus:border-accent-border"
          />
          {/* APP-2: already-connected match - reuse instead of duplicating. */}
          {match && (
            <div className="flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/40 px-3 py-2">
              <AppRowLogo app={match} logos={logos} size={28} fallback="letter" />
              <span className="min-w-0 flex-1 text-xs text-text-secondary">
                <span className="font-semibold text-text-primary">{match.title || match.id}</span> is already connected. Open it instead of creating a duplicate.
              </span>
              <button onClick={() => { window.dispatchEvent(new CustomEvent("prevail:app-open", { detail: match.id })); onCancel(); }}
                className="shrink-0 rounded-md border border-accent-border bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:opacity-90">
                Open {match.title || match.id}
              </button>
            </div>
          )}
          {/* APP-2b: light "did you mean" correction - a suggestion, not a gate. */}
          {!match && didYouMean && (
            <div className="flex items-center gap-1.5 text-xs text-text-muted">
              <span>Did you mean</span>
              <button
                onClick={() => setName(didYouMean)}
                className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft/40 px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent-soft/70"
              >
                {didYouMean}
              </button>
              <span>?</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={find} disabled={busy || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Finding the best way to connect…" : match ? "Connect a new one anyway" : "Find the best way to connect"}
            </button>
            <span className="text-[11px] text-text-muted">Prevail researches MCP, API, CLI, Composio, or browser - and picks the best.</span>
          </div>
          {busy && (
            <div className="relative mt-3 overflow-hidden rounded-lg border border-accent-border bg-accent-soft/30 p-3">
              {/* Subtle pulsing glow so the panel always reads as alive (uses the
                  built-in animate-pulse; no custom keyframe needed). */}
              <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-accent/10 to-transparent" />
              <div className="relative flex items-center gap-2 text-sm font-semibold text-accent">
                <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/40" />
                  <Loader2 className="relative h-4 w-4 animate-spin" />
                </span>
                <span>Researching the best way to connect {name.trim() || "this app"}<span className="animate-pulse">…</span></span>
              </div>
              <div className="relative mt-2.5 space-y-1.5">
                {RESEARCH_PHASES.map((p, i) => {
                  const done = i < phaseIdx, active = i === phaseIdx;
                  return (
                    <div key={i} className={`flex items-center gap-2 text-xs transition-colors ${done ? "text-text-muted" : active ? "font-medium text-text-primary" : "text-text-muted/40"}`}>
                      <span className="flex w-4 shrink-0 items-center justify-center">
                        {done ? <Check className="h-3 w-3 text-ok" /> : active ? <Loader2 className="h-3 w-3 animate-spin text-accent" /> : <span className="h-1 w-1 rounded-full bg-text-muted/40" />}
                      </span>
                      <span className={active ? "animate-pulse" : ""}>{p}</span>
                    </div>
                  );
                })}
              </div>
              <div className="relative mt-2.5 text-[11px] text-text-muted">This runs a model to research + test the best path - usually 10-30s.</div>
            </div>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="space-y-2">
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            Couldn't establish a connection: {result.error ?? "no method found"}.
          </div>
          <button onClick={() => setResult(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Try again</button>
        </div>
      )}

      {result?.ok && plan && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border-subtle bg-background p-3">
            <div className="flex items-center gap-2">
              {/* Resolved real brand mark for the app being connected; falls back
                  to its letter only when no logo resolves. */}
              <AppRowLogo app={{ title: plan.title || name, id: plan.app_id }} logos={logos} size={28} fallback="letter" />
              <span className="text-sm font-semibold text-text-primary">{plan.title || name}</span>
              <Check className="h-4 w-4 text-ok" />
              <span className="rounded border border-border-subtle px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-text-muted">{METHOD_LABEL[plan.integration ?? "manual"] ?? plan.integration}</span>
            </div>
            {plan.why && <p className="mt-1.5 text-xs text-text-secondary">{plan.why}</p>}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
              {plan.data && <span>pulls: {plan.data}</span>}
              {plan.schedule?.every && <span>· every {plan.schedule.every}</span>}
              {(plan.domains ?? []).length > 0 && <span>· feeds {plan.domains!.map(titleCase).join(", ")}</span>}
            </div>
          </div>

          {/* APP-3: SUGGEST DOMAINS - confirm/adjust which domains this app feeds.
              Pre-selected from the plan; user can toggle, add one, or change before
              finishing. The chosen set is persisted on finish. */}
          <div className="rounded-lg border border-accent-border bg-accent-soft/30 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
              <Sparkles className="h-3.5 w-3.5" /> Prevail suggests feeding
            </div>
            <p className="mt-1 text-[11px] text-text-muted">Tap to adjust which domains this app feeds before finishing.</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {Array.from(new Set([
                ...(plan.domains ?? []).map((d) => d.toLowerCase()),
                ...[...domSel],
                ...allDomains,
              ])).sort().map((d) => {
                const on = domSel.has(d);
                return (
                  <button key={d} onClick={() => toggleDomain(d)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${on ? "border-accent-border bg-accent text-background" : "border-border bg-background text-text-secondary hover:border-accent-border hover:text-accent"}`}>
                    {on && <Check className="h-3 w-3" />}{titleCase(d)}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={newDomain} onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewDomain(); } }}
                placeholder="Add another domain…"
                className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-border"
              />
              <button onClick={addNewDomain} disabled={!newDomain.trim()}
                className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">Add</button>
            </div>
          </div>

          {/* Autonomous verification: the engine tested the connection itself. */}
          {result.verified === true && (
            <div className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-xs text-ok">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><span className="font-semibold">Connected + verified.</span> {result.proof || "the connection test passed."} Prevail will sync on schedule from here.</span>
            </div>
          )}
          {result.verified === false && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              Set up, but the automatic test didn't pass: {result.proof || "unknown"}. {authNeeded ? "Finish the step below and it'll re-test." : "It may still work; check the app's status."}
            </div>
          )}

          {authNeeded ? (
            <div className="rounded-lg border border-accent-border bg-accent-soft/40 p-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-accent">One step only - then Prevail does the rest</div>
              <p className="mt-1 text-sm text-text-primary">{plan.auth_step!.instruction}</p>
              <p className="mt-1 text-[11px] text-text-muted">This is the one thing only you can do (a secret/login). Do it, then mark done - Prevail tests it and syncs on schedule from then on.</p>
            </div>
          ) : result.verified == null ? (
            <div className="rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-xs text-ok">No authorization needed - it's ready to sync.</div>
          ) : null}

          <div className="flex items-center gap-2">
            <button onClick={() => void finishWithDomains()} disabled={savingDomains} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
              {savingDomains ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {authNeeded ? "I've done it - finish" : "Done"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => { setResult(null); setName(""); setGoal(""); }} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Connect another</button>
          </div>
        </div>
      )}
    </div>
  );
}
