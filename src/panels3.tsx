// Components extracted from App.tsx.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Check, ChevronRight, Circle, ExternalLink, Globe, Loader2, Plug, Plus, Settings as SettingsIcon, Sparkles, Terminal, X } from "lucide-react";
import { PrevailLogo } from "./PrevailLogo";
import { invoke } from "./bridge";
import { PALETTES, SCORE_DIMENSIONS, SETTINGS_ROW, SEVERITY_LABEL, SEVERITY_ORDER, STATUS_TINT } from "./constants";
import { formatFreshness, relTime, scoreColor, titleCase } from "./format";
import { formatAuditedAt } from "./helpers";
import { ScoreBar } from "./panels";
import { Sparkline } from "./ui";
import type { BrandLogo, CliProvider, ContextScore, EngineApp, IngestionMcpServer, IngestionTierStatus, MissingItem, OnboardingRecommendation } from "./types";

// Resolve an app's brand logo from the simple-icons map by slugging its title
// or id; falls back to a colored monogram tile so every app shows something.
function AppRowLogo({ app, logos }: { app: EngineApp; logos: Record<string, BrandLogo> }) {
  const slugs = [
    app.title.toLowerCase().replace(/[^a-z0-9]/g, ""),
    app.id.toLowerCase().replace(/[^a-z0-9]/g, ""),
    app.id.split(/[-_:]/)[0]?.toLowerCase() ?? "",
  ];
  const logo = slugs.map((s) => logos[s]).find(Boolean);
  if (logo) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-white">
        <svg width={18} height={18} viewBox="0 0 24 24" fill={`#${logo.hex}`} aria-hidden><path d={logo.path} /></svg>
      </span>
    );
  }
  const initials = app.title.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-warm font-display text-[11px] font-bold text-text-secondary" aria-hidden>
      {initials}
    </span>
  );
}

// Turn a raw engine error (e.g. "prevail exited 1: <stderr>") into something a
// human can act on. The bare "exited 1" is meaningless to the user.
function friendlyOnboardError(e: unknown, action: string): string {
  const raw = String(e ?? "").trim();
  const detail = raw.replace(/^prevail exited \d+:?\s*/i, "").trim();
  if (/no output/i.test(raw)) return `Couldn't ${action}: the engine returned nothing. Try again in a moment.`;
  if (/spawn|not found|ENOENT/i.test(raw)) return `Couldn't ${action}: the Prevail engine isn't reachable. Restart the app and try again.`;
  return detail
    ? `Couldn't ${action}: ${detail}`
    : `Couldn't ${action} right now. Try again in a moment.`;
}

export function OnboardingModal({
  vaultPath,
  onClose,
  onApplied,
}: {
  vaultPath: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  type Step = "loading" | "review" | "applying";
  const [step, setStep] = useState<Step>("loading");
  const [rec, setRec] = useState<OnboardingRecommendation | null>(null);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Domains the vault ALREADY has - never offer to create these again.
  const [existing, setExisting] = useState<Set<string>>(new Set());
  useEffect(() => {
    invoke<{ name: string }[]>("scan_vault", { path: vaultPath })
      .then((ds) => setExisting(new Set((ds ?? []).map((d) => d.name.toLowerCase()))))
      .catch(() => setExisting(new Set()));
  }, [vaultPath]);
  // Only the proposed domains that don't already exist in the vault.
  const offered = useMemo(() => (rec?.domains ?? []).filter((d) => !existing.has(d.name.toLowerCase())), [rec, existing]);
  // Pre-select the recommended NEW domains whenever the proposal or existing set changes.
  useEffect(() => { setPicks(new Set(offered.filter((d) => d.recommended).map((d) => d.name))); }, [offered]);

  // No questionnaire. Prevail proposes a starter set automatically; the user
  // just picks what to keep. Recommendation runs once on open.
  async function requestRecommendation() {
    setBusy(true);
    setError(null);
    setStep("loading");
    try {
      const answersJson = JSON.stringify({ answers: {} });
      const value = await invoke<OnboardingRecommendation>("engine_onboard_recommend", {
        vault: vaultPath,
        answersJson,
      });
      setRec(value);
      // Picks are derived from `offered` (recommended minus existing) by an effect.
      setStep("review");
    } catch (e) {
      setError(friendlyOnboardError(e, "propose starter domains"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    requestRecommendation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyPicks() {
    if (picks.size === 0) return;
    setBusy(true);
    setError(null);
    setStep("applying");
    try {
      const picksJson = JSON.stringify({ picks: Array.from(picks) });
      await invoke("engine_onboard_apply", { vault: vaultPath, picksJson });
      onApplied();
      onClose();
    } catch (e) {
      setError(friendlyOnboardError(e, "create the domains"));
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  function togglePick(name: string) {
    setPicks((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-2">
            <PrevailLogo size={22} src="/logo-512.png" />
            <h2 className="font-display text-lg font-semibold tracking-tight">Set up your domains</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          {step === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-text-secondary">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <span className="text-sm">Proposing a starter set of domains…</span>
            </div>
          )}

          {step === "review" && rec && offered.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Check className="h-7 w-7 text-ok" />
              <div className="text-sm font-semibold text-text-primary">This vault is already set up</div>
              <div className="max-w-sm text-xs text-text-muted">It already has {existing.size} domain{existing.size === 1 ? "" : "s"}. There's nothing to create here - close this and start working.</div>
            </div>
          )}

          {step === "review" && rec && offered.length > 0 && (
            <>
              {rec.rationale && (
                <p className="mb-4 rounded-md border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
                  {rec.rationale}
                </p>
              )}
              <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
                Recommended domains · {picks.size} selected
              </div>
              <ul className="flex flex-col gap-2">
                {offered.map((d) => {
                  const on = picks.has(d.name);
                  return (
                    <li key={d.name}>
                      <button
                        onClick={() => togglePick(d.name)}
                        className={`flex w-full items-start gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${
                          on
                            ? "border-accent bg-accent-soft ring-2 ring-accent/20"
                            : "border-border-subtle bg-background hover:border-accent-border"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                            on ? "border-accent bg-accent text-background" : "border-border bg-surface"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className="text-xl leading-none">{d.emoji || "◆"}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-sm font-semibold text-text-primary">{d.label}</span>
                            <span className="font-mono text-[10px] text-text-muted">/{d.name}</span>
                            {d.recommended && (
                              <span className="rounded-full bg-accent/15 px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-accent">
                                recommended
                              </span>
                            )}
                          </div>
                          {d.summary && <div className="mt-0.5 text-xs text-text-secondary">{d.summary}</div>}
                          {d.reason && <div className="mt-1 text-[11px] italic text-text-muted">{d.reason}</div>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {step === "applying" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-text-secondary">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <span className="text-sm">Scaffolding {picks.size} domain{picks.size === 1 ? "" : "s"}…</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-6 py-4">
          {step === "review" && offered.length === 0 ? (
            <button
              onClick={onClose}
              className="ml-auto flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              <Check className="h-4 w-4" /> Done
            </button>
          ) : step === "review" ? (
            <>
              <button
                onClick={requestRecommendation}
                disabled={busy}
                className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Re-propose
              </button>
              <button
                onClick={applyPicks}
                disabled={busy || picks.size === 0}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Create {picks.size} domain{picks.size === 1 ? "" : "s"}
              </button>
            </>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">working…</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function DomainAppsTab({ domain, vaultPath }: { domain: string; vaultPath: string }) {
  const [apps, setApps] = useState<EngineApp[] | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [binding, setBinding] = useState<string | null>(null);
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  useEffect(() => {
    invoke<EngineApp[]>("engine_apps_list").then(setApps).catch(() => setApps([]));
    invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setLogos).catch(() => {});
  }, []);
  const domainApps = useMemo(() => (apps ?? []).filter((a) => a.domains.includes(domain)), [apps, domain]);
  // Apps NOT yet feeding this domain - the candidates the picker offers.
  const available = useMemo(() => (apps ?? []).filter((a) => !a.domains.includes(domain)), [apps, domain]);

  async function sync(id: string) {
    setProbing(id);
    try {
      const r = await invoke<{ ok: boolean; artifacts?: number; error?: string }>("engine_app_sync", { id, vault: vaultPath });
      setProbeResult((m) => ({ ...m, [id]: r.ok ? `synced. ${r.artifacts ?? 0} artifact(s)` : `failed: ${r.error}` }));
      invoke<EngineApp[]>("engine_apps_list").then(setApps).catch(() => {});
    } catch (e) { setProbeResult((m) => ({ ...m, [id]: `error: ${e}` })); }
    setProbing(null);
  }

  // Bind an app to THIS domain - the mirror of the app-side domain editor. Same
  // engine_app_set_domains backend, just adding `domain` to the app's set.
  async function bindApp(app: EngineApp) {
    setBinding(app.id);
    try {
      const r = await invoke<{ ok: boolean; domains?: string[]; error?: string }>("engine_app_set_domains", { id: app.id, domains: [...app.domains, domain] });
      if (r.ok) {
        window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
        const next = await invoke<EngineApp[]>("engine_apps_list").catch(() => apps ?? []);
        setApps(next);
        setAddValue("");
      }
    } catch { /* leave open to retry */ }
    finally { setBinding(null); }
  }

  // The add-app picker, shared by the populated and empty states.
  const q = addValue.trim().toLowerCase();
  const matches = available.filter((a) => a.title.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
  const addPicker = addOpen ? (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-warm/40">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Plus className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <input
          autoFocus value={addValue} onChange={(e) => setAddValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) bindApp(matches[0]); if (e.key === "Escape") { setAddOpen(false); setAddValue(""); } }}
          placeholder="Filter apps to feed this domain"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/60"
        />
        <button onClick={() => { setAddOpen(false); setAddValue(""); }} title="Close" className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
      </div>
      <ul className="max-h-56 overflow-y-auto p-1">
        {matches.map((a) => {
          const tint = STATUS_TINT[a.status] ?? "#9aa0a6";
          return (
            <li key={a.id}>
              <button onClick={() => bindApp(a)} disabled={binding === a.id} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent-soft disabled:opacity-40">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tint }} />
                <span className="text-sm font-medium text-text-primary">{a.title}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{a.integration}</span>
                <span className="ml-auto font-mono text-[10px] text-text-muted/60">{binding === a.id ? "adding…" : ""}</span>
              </button>
            </li>
          );
        })}
        {matches.length === 0 && (
          <li className="px-2.5 py-3 text-center text-[12px] text-text-muted">
            {available.length === 0 ? "Every app already feeds this domain." : "No matching app."}
          </li>
        )}
      </ul>
    </div>
  ) : (
    <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"><Plus className="h-3.5 w-3.5" /> add app</button>
  );

  if (!apps) return <div className="text-sm text-text-muted">loading…</div>;
  if (domainApps.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          No apps are refreshing this domain yet. Add one below, or from Settings → Apps.
        </div>
        {addPicker}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{domainApps.length} app{domainApps.length !== 1 ? "s" : ""} refreshing {domain}</span>
      </div>
      {domainApps.map((app) => {
        const tint = STATUS_TINT[app.status] ?? "#9aa0a6";
        const openConfig = () => window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: app }));
        return (
          <div key={app.id} className={`${SETTINGS_ROW} hover:border-accent-border hover:bg-surface-warm`}>
            {/* Logo + status dot. The whole identity block links to the app's
                config page so you can authenticate / configure it. */}
            <button onClick={openConfig} title={`Open ${app.title} configuration`} className="group flex min-w-0 flex-1 items-center gap-3 text-left">
              <span className="relative shrink-0">
                <AppRowLogo app={app} logos={logos} />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface" style={{ backgroundColor: tint }} title={app.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-text-primary group-hover:text-accent">{app.account?.label ? `${app.title} · ${app.account.label}` : app.title}</span>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted">{app.integration}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-text-muted/0 transition-colors group-hover:text-accent" />
                </div>
                <div className="font-mono text-[10px] text-text-muted">
                  {app.configured ? app.status : <span className="text-warn">not configured · click to set up</span>}{app.refresh?.every ? ` · every ${app.refresh.every}` : ""} · synced {relTime(app.lastSuccessTs)}
                  {probeResult[app.id] && <span className="ml-2 text-text-secondary">{probeResult[app.id]}</span>}
                  {app.lastError && !probeResult[app.id] && <span className="ml-2 text-warn">{app.lastError}</span>}
                </div>
              </div>
            </button>
            {app.configured ? (
              <button
                onClick={() => sync(app.id)}
                disabled={probing === app.id}
                className="shrink-0 rounded border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
              >
                {probing === app.id ? "syncing" : "sync"}
              </button>
            ) : (
              <button
                onClick={openConfig}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
              >
                <SettingsIcon className="h-3 w-3" /> set up
              </button>
            )}
          </div>
        );
      })}
      <div className="pt-1">{addPicker}</div>
    </div>
  );
}

export function ContextScorePanel({
  score,
  loading,
  rescanning,
  error,
  onRescan,
  vaultPath,
}: {
  score: ContextScore | null;
  loading: boolean;
  rescanning: boolean;
  error: string | null;
  onRescan: () => void;
  vaultPath: string;
}) {
  // The score over time - makes the "ever-improving" nature visible: it climbs on
  // its own as apps sync, memory distills, and context is added. Refetched when
  // the score changes (a new scan appended a point).
  const [history, setHistory] = useState<number[]>([]);
  useEffect(() => {
    if (!score?.domain) { setHistory([]); return; }
    let alive = true;
    invoke<{ ts: number; score: number }[]>("engine_score_history", { vault: vaultPath, domain: score.domain })
      .then((pts) => { if (alive) setHistory(Array.isArray(pts) ? pts.map((p) => p.score) : []); })
      .catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [vaultPath, score?.domain, score?.computed_at]);
  const delta = history.length >= 2 ? history[history.length - 1] - history[0] : null;

  if (loading && !score) {
    return <div className="text-sm text-text-muted">computing context score…</div>;
  }
  if (error && !score) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
        couldn't compute a context score: <span className="text-text-secondary">{error}</span>
      </div>
    );
  }
  if (!score) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
        no context score yet.
      </div>
    );
  }

  const color = scoreColor(score.score);
  // Group missing items by severity for the what's-missing section.
  const grouped: Record<string, MissingItem[]> = {};
  for (const m of score.missing) {
    (grouped[m.severity] ??= []).push(m);
  }
  const severities = Object.keys(grouped).sort(
    (a, b) => (SEVERITY_ORDER[a] ?? 99) - (SEVERITY_ORDER[b] ?? 99),
  );
  // I3: surface what's out of date as an explicit, scannable summary.
  const staleItems = score.relevance?.items.filter((it) => it.stale) ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Big score + re-scan */}
      <div className="flex items-center gap-5 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div
          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4"
          style={{ borderColor: color }}
        >
          <span className="font-display text-4xl font-bold leading-none" style={{ color }}>
            {score.score}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-semibold tracking-tight">Context Score</div>
          <div className="mt-0.5 text-xs text-text-muted">
            updated {formatFreshness(score.freshness_secs)}
            {score.audit_source ? ` · ${score.audit_source}` : " · heuristic"}
          </div>
          {/* Trend - the self-learning story: this climbs on its own as Prevail
              syncs apps, distills memory, and you add context. */}
          {history.length >= 2 ? (
            <div className="mt-2 flex items-center gap-2">
              <Sparkline values={history} width={84} height={22} />
              {delta != null && (
                <span className={`font-mono text-[11px] ${delta > 0 ? "text-ok" : delta < 0 ? "text-warn" : "text-text-muted"}`}>
                  {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {delta > 0 ? "+" : ""}{Math.round(delta)} over {history.length} scans
                </span>
              )}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-text-muted">Climbs automatically as apps sync, memory builds, and you add context.</div>
          )}
          <div className="mt-3">
            <button
              onClick={onRescan}
              disabled={rescanning}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:bg-accent-soft hover:text-accent disabled:opacity-50"
            >
              {rescanning ? "Re-scanning…" : "Re-scan (audit)"}
            </button>
          </div>
        </div>
      </div>

      {/* I3: explicit "what's out of date" summary, so staleness is obvious at
          a glance rather than buried in the per-item list below. */}
      {staleItems.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-warn/40 bg-warn/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div className="text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">
              {staleItems.length} {staleItems.length === 1 ? "item is" : "items are"} out of date.
            </span>{" "}
            {staleItems.map((it) => it.label).join(", ")}. Refreshing these lifts the freshness score.
          </div>
        </div>
      )}

      {/* Domain fit - the domain-intelligent relevance checklist. Only present
          when the CLI matched a rubric for this domain. */}
      {score.relevance && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
              Domain fit
            </span>
            <span className="font-mono text-[10px] text-text-muted">{score.relevance.detail}</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-3">
            {score.relevance.items.map((it) => {
              const tone = it.present && !it.stale ? "ok" : it.stale ? "warn" : it.severity === "critical" ? "danger" : "muted";
              const dotColor =
                tone === "ok" ? "var(--color-ok, #2e9e5b)"
                : tone === "warn" ? "var(--color-warn, #c98a2b)"
                : tone === "danger" ? "var(--color-danger, #d24b4b)"
                : "var(--color-text-muted, #888)";
              return (
                <div
                  key={it.id}
                  className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-warm"
                >
                  <span className="mt-0.5 shrink-0" style={{ color: dotColor }}>
                    {it.present && !it.stale ? (
                      <Check className="h-4 w-4" />
                    ) : it.stale ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm font-medium ${it.present ? "text-text-primary" : "text-text-secondary"}`}
                      >
                        {it.label}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-text-muted">{it.detail}</span>
                    </div>
                    {(!it.present || it.stale) && (
                      <div className="mt-0.5 text-[11px] text-text-muted">{it.recommend}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Six dimensions */}
      <div>
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
          Structural readiness
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          {SCORE_DIMENSIONS.map(({ key, label }) => {
            const dim = score.breakdown[key];
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">{label}</span>
                  <span className="font-mono text-xs" style={{ color: scoreColor(dim.score) }}>
                    {dim.score}
                  </span>
                </div>
                <ScoreBar value={dim.score} max={100} color={scoreColor(dim.score)} />
                {dim.detail && (
                  <div className="mt-1 text-[11px] text-text-muted">{dim.detail}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* What's missing, grouped by severity */}
      {score.missing.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
            What's missing
          </div>
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
            {severities.map((sev) => {
              const tone =
                sev === "critical" ? "danger" : sev === "warn" ? "warn" : "ok";
              const dot =
                tone === "danger"
                  ? "var(--color-danger, #d24b4b)"
                  : tone === "warn"
                  ? "var(--color-warn, #c98a2b)"
                  : "var(--color-text-muted, #888)";
              return (
                <div key={sev}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    {SEVERITY_LABEL[sev] ?? sev}
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {grouped[sev].map((m, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                        <span
                          className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: dot }}
                        />
                        <span>
                          {m.label}
                          {m.kind && (
                            <span className="ml-1.5 rounded bg-surface-warm px-1 py-0 font-mono text-[10px] text-text-muted">
                              {m.kind}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Assessment + last audited */}
      {score.assessment && (
        <div>
          <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
            Assessment
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <p className="text-sm leading-relaxed text-text-primary">{score.assessment}</p>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-text-muted">
              last audited · {formatAuditedAt(score.audited_at)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function IngestionTierCard({
  tier,
  mcp,
  onRefresh,
  onOpenMcpConfig,
  onReloadMcp,
}: {
  tier: IngestionTierStatus;
  mcp?: IngestionMcpServer[];
  onRefresh: () => void;
  onOpenMcpConfig?: () => void;
  onReloadMcp?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [composioKey, setComposioKey] = useState<string>("");
  const [stderr, setStderr] = useState<Record<string, string>>({});
  const [cliProviders, setCliProviders] = useState<CliProvider[]>([]);
  const [cliProbe, setCliProbe] = useState<Record<string, boolean>>({});
  const [cliMsg, setCliMsg] = useState<Record<string, string>>({});
  // Each connector type is its own collapsible card so the page reads as
  // clearly separated sections; open by default only when this tier is active
  // (running or ready) so the user lands focused on what they actually use.
  const [open, setOpen] = useState<boolean>(() => tier.active || tier.running > 0);
  const TierIcon = tier.id === "tier_a_mcp" ? Plug : tier.id === "tier_b_composio" ? Boxes : tier.id === "tier_c_browser" ? Globe : Terminal;

  // Tier D - load the bundled providers and probe which CLIs are installed.
  useEffect(() => {
    if (tier.id !== "tier_d_cli") return;
    (async () => {
      try {
        const ps = await invoke<CliProvider[]>("ingestion_cli_providers");
        setCliProviders(ps);
        for (const p of ps) {
          try {
            const ok = await invoke<boolean>("ingestion_cli_probe", { providerId: p.id });
            setCliProbe((c) => ({ ...c, [p.id]: ok }));
          } catch { /* probe is best-effort */ }
        }
      } catch (e) { console.error(e); }
    })();
  }, [tier.id]);

  async function cliRun(id: string) {
    setBusy(`cli:${id}`);
    setCliMsg((m) => ({ ...m, [id]: "" }));
    try {
      const r = await invoke<{ app: string; domain: string; bytes: number }>("ingestion_cli_run", { providerId: id });
      setCliMsg((m) => ({ ...m, [id]: `Pulled ${r.bytes.toLocaleString()} bytes into ${titleCase(r.domain)}` }));
      await onRefresh();
    } catch (e) { setCliMsg((m) => ({ ...m, [id]: `${e}` })); }
    setBusy(null);
  }

  async function peekStderr(name: string) {
    try {
      const text = await invoke<string>("ingestion_mcp_stderr", { name });
      setStderr((cur) => ({ ...cur, [name]: text || "(empty)" }));
    } catch (e) {
      setStderr((cur) => ({ ...cur, [name]: `error: ${e}` }));
    }
  }

  async function doMcp(name: string, action: "start" | "stop") {
    setBusy(`${action}:${name}`);
    try {
      await invoke(action === "start" ? "ingestion_mcp_start" : "ingestion_mcp_stop", { name });
      await onRefresh();
    } catch (e) { console.error(e); }
    setBusy(null);
  }
  async function setComposio() {
    setBusy("composio:set");
    try {
      await invoke("ingestion_composio_set_key", { key: composioKey });
      setComposioKey("");
      await onRefresh();
    } catch (e) { console.error(e); }
    setBusy(null);
  }
  async function composioRun(action: "start" | "stop") {
    setBusy(`composio:${action}`);
    try {
      await invoke(action === "start" ? "ingestion_composio_start" : "ingestion_composio_stop");
      await onRefresh();
    } catch (e) { console.error(e); }
    setBusy(null);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 p-5 text-left">
        <div className="flex min-w-0 items-center gap-2.5">
          <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
          <TierIcon className="h-4 w-4 shrink-0 text-text-muted" />
          <div className="min-w-0">
            <div className="font-display text-base font-semibold tracking-tight">{tier.label}</div>
            <div className="mt-0.5 font-mono text-[11px] text-text-muted">{tier.state}</div>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
          tier.active
            ? tier.running > 0
              ? "border border-accent-border bg-accent-soft text-accent"
              : "border border-border bg-background text-text-secondary"
            : "border border-border bg-background text-text-muted"
        }`}>
          {tier.running > 0 ? `running · ${tier.running}` : tier.active ? "ready" : "inactive"}
        </span>
      </button>
      {open && (
      <div className="border-t border-border-subtle px-5 pb-5 pt-4">
      {tier.last_error && (
        <div className="mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {tier.last_error}
        </div>
      )}

      {/* Tier A - MCP server list */}
      {tier.id === "tier_a_mcp" && mcp && (
        <div className="mt-4">
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={onOpenMcpConfig}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent"
            >
              edit mcp_config.json
            </button>
            <button
              onClick={onReloadMcp}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
            >
              reload
            </button>
            <span className="font-mono text-[10px] text-text-muted">
              ~/Library/Application Support/Prevail/
            </span>
          </div>
          {mcp.length === 0 ? (
            <p className="text-xs text-text-muted">
              No servers in config yet. Click "edit mcp_config.json" to create / edit.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {mcp.map((s) => (
                <li key={s.name} className="flex items-center gap-3 rounded-md border border-border-subtle bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-text-primary">{s.name}</span>
                      {s.running && s.pid != null && (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] text-accent">pid {s.pid}</span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-text-muted">
                      {s.command} {s.args.join(" ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {s.running && (
                      <button
                        onClick={() => peekStderr(s.name)}
                        className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                      >
                        stderr
                      </button>
                    )}
                    <button
                      onClick={() => doMcp(s.name, s.running ? "stop" : "start")}
                      disabled={busy?.endsWith(s.name) === true}
                      className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                        s.running
                          ? "border-border bg-background text-text-muted hover:border-warn hover:text-warn"
                          : "border-accent-border bg-accent-soft text-accent hover:bg-accent hover:text-background"
                      }`}
                    >
                      {s.running ? "stop" : "start"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {Object.entries(stderr).map(([name, text]) => (
            <pre key={name} className="mt-2 max-h-32 overflow-auto rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[10px] leading-relaxed text-text-secondary">
              {`${name}:\n${text}`}
            </pre>
          ))}
        </div>
      )}

      {/* Tier B - Composio key input + start */}
      {tier.id === "tier_b_composio" && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={composioKey}
              onChange={(e) => setComposioKey(e.target.value)}
              placeholder="COMPOSIO_API_KEY (stored in macOS keychain)"
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs focus:border-accent-border focus:outline-none"
            />
            <button
              onClick={setComposio}
              disabled={!composioKey.trim() || busy === "composio:set"}
              className="rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
            >
              save key
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => composioRun("start")}
              disabled={!tier.active || tier.running > 0 || busy === "composio:start"}
              className="rounded border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
            >
              start gateway
            </button>
            <button
              onClick={() => composioRun("stop")}
              disabled={tier.running === 0 || busy === "composio:stop"}
              className="rounded border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn disabled:opacity-50"
            >
              stop
            </button>
            <span className="font-mono text-[10px] text-text-muted">
              spawns <code className="text-accent">npx @composio/mcp</code>
            </span>
          </div>
        </div>
      )}

      {/* Tier C - described inline; run UI is in IngestionBrowserRunner below */}
      {tier.id === "tier_c_browser" && (
        <p className="mt-3 text-xs text-text-muted">
          Run a portal automation below. Browser opens in headed mode with a persistent profile per (domain, portal). Downloads are intercepted into the domain's <code className="text-accent">imports/</code> folder.
        </p>
      )}

      {/* Tier D - official CLI connectors. Read-only pull of an installed CLI. */}
      {tier.id === "tier_d_cli" && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-text-muted">
            Pull from a first-party CLI you have already installed and signed into. Runs a read-only command; output lands in the domain's <code className="text-accent">imports/</code> folder.
          </p>
          {cliProviders.length === 0 ? (
            <p className="text-xs text-text-muted">No CLI providers bundled.</p>
          ) : (
            cliProviders.map((p) => {
              const installed = cliProbe[p.id];
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-md border border-border-subtle bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{p.label}</span>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">→ {titleCase(p.domain)}</span>
                      {installed === true && <span className="font-mono text-[9px] text-accent">installed</span>}
                      {installed === false && <span className="font-mono text-[9px] text-text-muted/60">not found on PATH</span>}
                    </div>
                    <div className="font-mono text-[10px] text-text-muted">{p.binary} {p.fetch_args.join(" ")}</div>
                    {cliMsg[p.id] && <div className="mt-0.5 font-mono text-[10px] text-text-muted">{cliMsg[p.id]}</div>}
                  </div>
                  <button
                    onClick={() => cliRun(p.id)}
                    disabled={busy === `cli:${p.id}` || installed === false}
                    className="shrink-0 rounded border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
                  >
                    {busy === `cli:${p.id}` ? "pulling" : "pull"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
}

export function PaletteCard({
  palette,
  active,
  onSelect,
}: {
  palette: (typeof PALETTES)[number];
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`group overflow-hidden rounded-xl border-2 text-left transition-all ${
        active
          ? "border-accent shadow-md"
          : "border-border-subtle hover:border-border"
      }`}
    >
      {/* Preview card - solid swatch of the palette */}
      <div
        className="relative h-24 px-4 py-3"
        style={{ backgroundColor: palette.swatch.bg }}
      >
        {/* mock message bubble */}
        <div
          className="absolute left-4 right-12 top-3 h-2 rounded-full opacity-90"
          style={{ backgroundColor: palette.swatch.accent }}
        />
        <div
          className="absolute left-4 right-20 top-7 h-2 rounded-full opacity-50"
          style={{ backgroundColor: palette.swatch.accent }}
        />
        {/* mock pill */}
        <div
          className="absolute bottom-3 right-4 h-5 w-12 rounded-full"
          style={{ backgroundColor: palette.swatch.surface, opacity: 0.7 }}
        />
        {/* AI dot */}
        <div
          className="absolute bottom-4 left-4 h-3 w-3 rounded-full"
          style={{ backgroundColor: palette.swatch.ai }}
        />
        {active && (
          <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-background">
            <Check className="h-3 w-3" />
          </div>
        )}
      </div>
      {/* Label */}
      <div className="border-t border-border-subtle bg-surface px-4 py-3">
        <div className="font-medium">{palette.name}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{palette.blurb}</div>
      </div>
    </button>
  );
}
