// App-shell pieces extracted from App.tsx: AppFacetPanel (the open-app detail
// view), BunkerRibbon (the always-on trust bar), and VaultWizard (first-run vault
// setup).
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { Activity, Archive, ArrowRight, Briefcase, Clock, Cloud, Cpu, Folder, FolderLock, FolderOpen, Ghost, Globe, Heart, Home, KeyRound, Laptop, Layers, Lock, Plus, Receipt, RefreshCw, Server, Shield, ShieldCheck, Sparkles, TrendingUp, Users, Wallet, X, Zap } from "lucide-react";
import { PrevailLogo } from "./PrevailLogo";
import { invoke } from "./bridge";
import { PREF, getPref } from "./storage";
import { APP_VERSION, AUTONOMY_LABEL, AUTONOMY_TINT, INTEGRATION_LABEL, STATUS_TINT } from "./constants";
import { relTime, titleCase } from "./format";
import { appScheduleText } from "./helpers";
import { AppCard, AppKV, FloatingChip } from "./widgets";
import { domainIcon } from "./icons";
import { ConnectorRunPanel, type ConnectorRunMode } from "./connectorrun";
import { LoopsPanel } from "./loopspanel";
import { BrandMark } from "./brandmark";
import type { AppRunHistory, Domain, EngineApp } from "./types";

// Plain-language guidance for what "connect" means per integration pattern, so
// "not-configured" is actionable instead of a dead end.
function connectHelp(integration: string): string {
  switch (integration) {
    case "api":
      return "Uses an API key. Test shows which keys it needs; set them as environment variables, then Test verifies the connection.";
    case "oauth":
      return "Uses OAuth. Sign in to the provider when prompted; the token is stored in your OS keychain, never in plain text.";
    case "browser":
      return "Drives a real browser session (no public API). Sign in once in the automation browser and Prevail reuses that session. These can't always self-verify, so Test may be inconclusive even when it works.";
    case "mcp":
      return "Runs through an MCP server. Configure its command or endpoint under Settings : Connections : MCP.";
    case "cli":
      return "Uses a CLI already installed on this machine and its own login. No key needed here.";
    default:
      return "Configure this app's credentials, then use Test to verify and Sync to pull its data into the mapped domains.";
  }
}

// Turn the engine probe result into something actionable. Some apps have no
// credential to verify (a manual data drop, or one that only runs through its
// skills): the raw "manifest doesn't declare an auth_check" is a dead end, so we
// say what the app actually needs instead.
function humanizeProbe(integration: string, raw: string): string {
  const r = (raw || "").trim();
  if (/auth_check|can'?t verify|cannot verify|no\s+\w*\s*check|nothing to (test|verify)/i.test(r)) {
    if (integration === "manual")
      return "Nothing to verify here. This app is a manual data drop: add its exports or files under its folder, then run a skill. There is no login or key to test.";
    if (integration === "browser")
      return "Nothing to auto-verify. This app signs in through a real browser session: use Connect and learn, then a sync proves it works.";
    return "Nothing to verify here. This app has no login or key to test, it runs through its skills. Run a skill (or Sync) to see it work.";
  }
  return r || "tested";
}

export function AppFacetPanel({ app, vaultPath, domains, appTab, onOpenDomain, onChanged }: { app: EngineApp; vaultPath: string; domains: Domain[]; appTab: "runs" | "settings" | "domains" | "loops"; onOpenDomain: (d: string) => void; onChanged: () => void }) {
  const [skills, setSkills] = useState<{ id: string; runner: string; trigger: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [doms, setDoms] = useState<string[]>(app.domains);
  const [savingDoms, setSavingDoms] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState("");
  // Demo mode means these are sample apps that don't really connect - surface
  // that on the Connection card so "not-configured" reads as expected, not broken.
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    invoke<{ mode: "demo" | "production" }>("engine_appmode_get").then((m) => setDemoMode(m.mode === "demo")).catch(() => {});
  }, []);
  useEffect(() => { setDoms(app.domains); setAddOpen(false); setAddValue(""); }, [app.id, app.domains]);
  // Per-app Privacy (local-only) + default model — parity with domain settings.
  const [localOnly, setLocalOnly] = useState(!!app.localOnly);
  const [modelDraft, setModelDraft] = useState(app.model ?? "");
  useEffect(() => { setLocalOnly(!!app.localOnly); setModelDraft(app.model ?? ""); }, [app.id, app.localOnly, app.model]);
  const toggleLocalOnly = useCallback(async () => {
    const v = !localOnly; setLocalOnly(v);
    try { await invoke("engine_app_set_privacy", { id: app.id, localOnly: v }); onChanged(); }
    catch (e) { setLocalOnly(!v); setNote(`privacy: ${e}`); }
  }, [localOnly, app.id, onChanged]);
  const saveModel = useCallback(async (m: string) => {
    try { await invoke("engine_app_set_model", { id: app.id, model: m }); onChanged(); }
    catch (e) { setNote(`model: ${e}`); }
  }, [app.id, onChanged]);
  // Account identity binding: WHICH account of a multi-account connector this
  // app instance is (e.g. which Google profile). Attaching the app to a chat
  // carries this identity into the turn. Empty = unbound (single-account
  // connectors never need it).
  const [accountDraft, setAccountDraft] = useState(app.account?.label ?? "");
  useEffect(() => { setAccountDraft(app.account?.label ?? ""); }, [app.id, app.account?.label]);
  const saveAccount = useCallback(async (label: string) => {
    try { await invoke("engine_app_set_account", { id: app.id, label, address: null }); onChanged(); }
    catch (e) { setNote(`account: ${e}`); }
  }, [app.id, onChanged]);
  useEffect(() => {
    setSkills(null);
    invoke<{ id: string; runner: string; trigger: string }[]>("engine_app_skills", { id: app.id, vault: vaultPath }).then(setSkills).catch(() => setSkills([]));
  }, [app.id]);
  // Per-app run history (the bounded ring the sync layer records). Refetched
  // when the app changes and after a manual "Sync now" so the list stays live.
  const [history, setHistory] = useState<AppRunHistory | null>(null);
  const loadRuns = useCallback(() => {
    invoke<AppRunHistory>("engine_app_runs", { id: app.id })
      .then(setHistory)
      .catch(() => setHistory({ runs: [], nextDueTs: null, consecutiveFailures: 0 }));
  }, [app.id]);
  useEffect(() => { setHistory(null); loadRuns(); }, [app.id, loadRuns]);
  const addable = useMemo(
    () => domains.map((d) => d.name).filter((n) => !doms.includes(n)).sort((a, b) => a.localeCompare(b)),
    [domains, doms],
  );
  async function persistDomains(next: string[]) {
    const prev = doms;
    setDoms(next); setSavingDoms(true); setNote(null);
    try {
      const r = await invoke<{ ok: boolean; domains?: string[]; error?: string }>("engine_app_set_domains", { id: app.id, domains: next });
      if (!r.ok) { setDoms(prev); setNote(`failed: ${r.error}`); return; }
      if (r.domains) setDoms(r.domains);
      window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      onChanged();
    } catch (e) { setDoms(prev); setNote(`error: ${e}`); } finally { setSavingDoms(false); }
  }
  function removeDomain(d: string) { void persistDomains(doms.filter((x) => x !== d)); }
  function addDomain(raw: string) {
    const d = raw.trim().toLowerCase();
    if (!d || doms.includes(d)) { setAddOpen(false); setAddValue(""); return; }
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(d)) { setNote(`invalid domain "${raw}"`); return; }
    setAddOpen(false); setAddValue("");
    void persistDomains([...doms, d]);
  }
  async function test() {
    setBusy("test"); setNote(null);
    try { const r = await invoke<{ status?: string; message?: string }>("engine_app_probe", { id: app.id }); setNote(humanizeProbe(app.integration, r.message || r.status || "")); }
    catch (e) { setNote(`error: ${e}`); } finally { setBusy(null); }
  }
  async function sync() {
    setBusy("sync"); setNote(null);
    try {
      const r = await invoke<{ ok: boolean; artifacts?: number; error?: string }>("engine_app_sync", { id: app.id, vault: vaultPath });
      setNote(r.ok ? `Synced. ${r.artifacts ?? 0} artifact(s) written.` : `Failed: ${r.error}`);
      onChanged();
      loadRuns();
    } catch (e) { setNote(`error: ${e}`); } finally { setBusy(null); }
  }
  const tint = STATUS_TINT[app.status] ?? "#9aa0a6";
  const autonomy = app.autonomy ?? "read-only";
  // Browser-lane apps get the agentic learn/replay controls (live ConnectorRunPanel).
  const isBrowser = (app.integration ?? "").includes("browser");
  const [run, setRun] = useState<ConnectorRunMode | null>(null);
  const browserCard = isBrowser ? (
    <AppCard icon={Globe} label="Browser sync">
      {run ? (
        <ConnectorRunPanel
          appId={app.id}
          mode={run}
          vault={vaultPath}
          onDone={() => { setRun(null); loadRuns(); onChanged(); }}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-text-muted">
            A real browser opens; you log in once (and do 2FA). The agent learns the steps and records them, then later syncs replay fast with no AI.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setRun("learn")} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent/10">
              <Sparkles className="h-3 w-3" /> Connect &amp; learn
            </button>
            <button onClick={() => setRun("replay")} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent">
              <RefreshCw className="h-3 w-3" /> Sync now (replay)
            </button>
            <button onClick={() => setRun("relearn")} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent">
              Re-learn
            </button>
          </div>
        </div>
      )}
    </AppCard>
  ) : null;

  const domainEditor = (
    <AppCard icon={Layers} label="Domains this app refreshes" action={savingDoms ? <span className="font-mono text-[10px] text-text-muted/60">saving…</span> : undefined}>
      <p className="mb-2 text-[11px] text-text-muted">Many-to-many. Click a domain to open it and chat there; remove or add bindings here.</p>
      {doms.length === 0 ? (
        <div className="text-[11px] text-text-muted">Not bound to any domain yet. Add one below to start refreshing it.</div>
      ) : (
        <ul className="space-y-1">
          {doms.map((d) => (
            <li key={d} className="group/dom flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
              {(() => { const I = domainIcon(d); return I ? <I className="h-4 w-4 shrink-0 text-accent" /> : <span className="text-accent">◆</span>; })()}
              <button onClick={() => onOpenDomain(d)} className="text-sm font-medium text-text-primary hover:text-accent hover:underline" title={`Open ${titleCase(d)} and chat there`}>{titleCase(d)}</button>
              <span className="font-mono text-[10px] text-text-muted/60">vault/{d}/</span>
              <button onClick={() => onOpenDomain(d)} title={`Open ${titleCase(d)}`} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-accent-soft hover:text-accent group-hover/dom:opacity-100"><ArrowRight className="h-3.5 w-3.5" /></button>
              <button onClick={() => removeDomain(d)} disabled={savingDoms} title={`Remove ${titleCase(d)} from ${app.title}`} className="flex h-6 w-6 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-surface-warm hover:text-warn group-hover/dom:opacity-100 disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        {addOpen ? (
          (() => {
            const q = addValue.trim().toLowerCase();
            const matches = addable.filter((n) => n.includes(q));
            const isNew = q.length > 0 && !addable.includes(q) && !doms.includes(q);
            return (
              <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-warm/40">
                <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
                  <Plus className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <input
                    autoFocus
                    value={addValue}
                    onChange={(e) => setAddValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addDomain(matches[0] ?? addValue);
                      if (e.key === "Escape") { setAddOpen(false); setAddValue(""); }
                    }}
                    placeholder="Filter domains, or type a new one"
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/60"
                  />
                  <button onClick={() => { setAddOpen(false); setAddValue(""); }} title="Close" className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
                </div>
                <ul className="max-h-56 overflow-y-auto p-1">
                  {matches.map((n) => {
                    const I = domainIcon(n);
                    return (
                      <li key={n}>
                        <button
                          onClick={() => addDomain(n)}
                          disabled={savingDoms}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent-soft disabled:opacity-40"
                        >
                          {I ? <I className="h-4 w-4 shrink-0 text-accent" /> : <span className="text-accent">◆</span>}
                          <span className="text-sm font-medium text-text-primary">{titleCase(n)}</span>
                          <span className="ml-auto font-mono text-[10px] text-text-muted/60">vault/{n}/</span>
                          <Plus className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      </li>
                    );
                  })}
                  {isNew && (
                    <li>
                      <button
                        onClick={() => addDomain(addValue)}
                        disabled={savingDoms}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent-soft disabled:opacity-40"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-accent-soft text-accent"><Plus className="h-3 w-3" /></span>
                        <span className="text-sm text-text-secondary">Create new domain</span>
                        <span className="ml-1 text-sm font-semibold text-accent">{titleCase(q)}</span>
                      </button>
                    </li>
                  )}
                  {matches.length === 0 && !isNew && (
                    <li className="px-2.5 py-3 text-center text-[11px] text-text-muted">
                      {addable.length === 0 ? "This app already feeds every domain." : "No match. Keep typing to create a new domain."}
                    </li>
                  )}
                </ul>
              </div>
            );
          })()
        ) : (
          <button onClick={() => setAddOpen(true)} disabled={savingDoms} className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> add domain</button>
        )}
      </div>
    </AppCard>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-6">
      {appTab === "settings" && (
        <>
          <AppCard icon={KeyRound} label="Connection" action={
            app.integration === "manual" ? undefined :
            <button onClick={test} disabled={busy === "test"} className="rounded-lg border border-border bg-background px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{busy === "test" ? "testing…" : "test"}</button>
          }>
            <AppKV k="Status"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: tint }} />{app.status}</span></AppKV>
            <AppKV k="Method">{INTEGRATION_LABEL[app.integration] ?? app.integration}</AppKV>
            <AppKV k="Account">{app.account?.label ? <span>{app.account.label}{app.account.address ? <span className="text-text-muted"> · {app.account.address}</span> : null}</span> : <span className="text-text-muted">-</span>}</AppKV>
            <AppKV k="Autonomy"><span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${AUTONOMY_TINT[autonomy] ?? "#9aa0a6"}1a`, color: AUTONOMY_TINT[autonomy] ?? "#9aa0a6" }}><ShieldCheck className="h-3 w-3" />{AUTONOMY_LABEL[autonomy] ?? autonomy}</span></AppKV>
            {app.connections && app.connections.length > 0 && (
              <AppKV k="Strategies">{app.connections.map((c) => c.kind).join(" → ")}</AppKV>
            )}
            {/* S5: when the app isn't connected yet, lead with a clear primary
                action and concrete steps instead of a passive status line - the
                founder couldn't tell what "not-configured" expected them to do. */}
            {app.status === "not-configured" && app.integration === "manual" && (
              // Manual-drop apps have no credential to verify, so "Check setup"
              // is a dead end (the probe just reports there's no auth_check).
              // Tell the user what actually makes this app work instead.
              <div className="mt-2 rounded-lg border border-accent-border bg-accent-soft/40 px-3 py-2.5">
                <div className="font-mono text-[10px] uppercase tracking-wider text-accent">No connection step needed</div>
                <p className="mt-1 text-[12px] leading-relaxed text-text-primary">This app has no login or key to verify. Add its exports or files under its folder, or just run a skill: it works without a connection step. There is nothing to test here.</p>
              </div>
            )}
            {app.status === "not-configured" && app.integration !== "manual" && (
              <div className="mt-2 rounded-lg border border-accent-border bg-accent-soft/40 px-3 py-2.5">
                <div className="font-mono text-[10px] uppercase tracking-wider text-accent">Not connected yet - here's how</div>
                <p className="mt-1 text-[11px] leading-relaxed text-text-primary">{connectHelp(app.integration)}</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={test}
                    disabled={busy === "test"}
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50"
                  >
                    {busy === "test" ? "Checking…" : "Check setup"}
                  </button>
                  <span className="text-[11px] text-text-muted">Runs a real test and tells you the exact next step (a key to set, or a login).</span>
                </div>
              </div>
            )}
            {/* Pattern-specific "how to connect" - kept for already-connected apps
                as a quiet reference (the prominent version above covers setup). */}
            {app.status !== "not-configured" && (
              <div className="mt-2 rounded-lg border border-border-subtle bg-background px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">How to connect</span>
                <p className="mt-1">{connectHelp(app.integration)}</p>
              </div>
            )}
            {demoMode && (
              <div className="mt-2 rounded-lg border border-ai/40 bg-ai/10 px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
                You're in the <span className="font-semibold">Sandbox</span>, so this is a sample app and won't make a real connection. Switch to your own vault (Settings → Workspace) to connect real accounts.
              </div>
            )}
            {note && <div className="mt-2 rounded-lg bg-surface-warm px-3 py-1.5 font-mono text-[11px] text-text-secondary">{note}</div>}
          </AppCard>
          {/* Per-app Privacy (local-only) — the same pin domains have: keeps this
              app's data processing on a local model. */}
          <AppCard icon={Lock} label="Privacy">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-text-primary">{localOnly ? "Local only" : "Standard"}</div>
                <div className="mt-0.5 text-[12px] text-text-muted">{localOnly ? "This app's data is processed only by a local model (Ollama). Nothing goes to a cloud model." : "This app may be processed by your selected cloud or local model."}</div>
              </div>
              <button role="switch" aria-checked={localOnly} onClick={toggleLocalOnly}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${localOnly ? "bg-accent" : "bg-surface-strong"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${localOnly ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>
          </AppCard>
          {/* Per-app default model for its skill / sync / agent runs. Empty =
              the global default. */}
          <AppCard icon={Cpu} label="Default model">
            <div className="flex items-center gap-2">
              <input
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onBlur={() => { if ((modelDraft.trim() || "") !== (app.model ?? "")) void saveModel(modelDraft.trim()); }}
                placeholder="Global default (leave empty)"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
              />
              {modelDraft && <button onClick={() => { setModelDraft(""); void saveModel(""); }} className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">Clear</button>}
            </div>
            <div className="mt-1.5 text-[12px] text-text-muted">Which model runs this app's skills and syncs. Leave empty to use your global default.</div>
          </AppCard>
          {/* Identity binding: which account of a multi-account connector this
              app instance IS. Attaching the app to any chat carries this
              identity into the turn (no per-chat account pick needed). */}
          <AppCard icon={KeyRound} label="Account identity">
            <div className="flex items-center gap-2">
              <input
                value={accountDraft}
                onChange={(e) => setAccountDraft(e.target.value)}
                onBlur={() => { if ((accountDraft.trim() || "") !== (app.account?.label ?? "")) void saveAccount(accountDraft.trim()); }}
                placeholder="Unbound (e.g. a connected profile label)"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
              />
              {accountDraft && <button onClick={() => { setAccountDraft(""); void saveAccount(""); }} className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">Clear</button>}
            </div>
            <div className="mt-1.5 text-[12px] text-text-muted">Which account this app instance acts as when its connector has several (use the profile label you connected, e.g. under Google). Chats with this app attached authenticate as this account; a per-chat pick in Modes still overrides.</div>
          </AppCard>
          <AppCard icon={Clock} label="Schedule">
            <div className="text-sm text-text-primary">{appScheduleText(app)}</div>
            <p className="mt-1 text-[11px] text-text-muted">The sync daemon refreshes this app on this cadence when it is enabled.</p>
          </AppCard>
          <AppCard icon={Zap} label="Skills">
            {skills === null ? (
              <div className="text-[11px] text-text-muted">loading…</div>
            ) : skills.length === 0 ? (
              <div className="text-[11px] text-text-muted">No skills yet. Add one under <code className="text-accent">skills/</code> to enable syncing.</div>
            ) : (
              <ul className="space-y-1">
                {skills.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-[13px] text-text-secondary"><span className="text-accent">▸</span> <span className="font-medium text-text-primary">{s.id}</span> <span className="font-mono text-[10px] text-text-muted">{s.runner} · {s.trigger}</span></li>
                ))}
              </ul>
            )}
          </AppCard>
        </>
      )}

      {appTab === "loops" && (
        // App/domain parity: an app gets the SAME standing-loops surface a domain
        // has, scoped to data/apps/<id>/_loops.json. isApp hides the domain-only
        // ideal-state + skips the domain built-in loop seeding.
        app.path ? (
          <LoopsPanel domain={app.id} vaultPath={vaultPath} domainPath={app.path} isApp />
        ) : (
          <div className="rounded-lg border border-border-subtle bg-background px-4 py-6 text-[13px] leading-relaxed text-text-muted">
            Loops become available once this app is added to your vault. Add it, then create standing loops here, just like a domain.
          </div>
        )
      )}
      {appTab === "runs" && (
        <>
          {browserCard}
          <AppCard icon={RefreshCw} label="Last run" action={
            <button onClick={sync} disabled={busy === "sync"} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent/10 disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${busy === "sync" ? "animate-spin" : ""}`} />{busy === "sync" ? "syncing…" : "sync now"}</button>
          }>
            <div className="text-2xl font-semibold text-text-primary">{relTime(app.lastSuccessTs)}</div>
            <div className="mt-0.5 text-[11px] text-text-muted">{app.lastSuccessTs ? "last successful refresh" : "this app has never run"}</div>
            {app.lastError && (
              <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn"><span className="font-mono uppercase tracking-wider">last error</span> · {app.lastError}</div>
            )}
            {note && <div className="mt-3 rounded-lg bg-surface-warm px-3 py-1.5 font-mono text-[11px] text-text-secondary">{note}</div>}
          </AppCard>
          <AppCard icon={Clock} label="Schedule">
            <div className="text-sm text-text-primary">{appScheduleText(app)}</div>
            {history?.nextDueTs && <div className="mt-1 text-[11px] text-text-muted">Next autonomous run {relTime(history.nextDueTs)}.</div>}
          </AppCard>
          <AppCard icon={Activity} label="Run history">
            {history === null ? (
              <div className="text-[11px] text-text-muted">loading…</div>
            ) : history.runs.length === 0 ? (
              <div className="text-[11px] text-text-muted">No runs recorded yet. Use Sync now above to run this app.</div>
            ) : (
              <ul className="space-y-1">
                {[...history.runs].reverse().map((r, i) => (
                  <li key={`${r.ts}-${i}`} title={r.error ?? r.summary ?? undefined} className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-background px-3 py-2 text-[11px]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: r.ok ? "#2fb87a" : "#e06c75" }} />
                    <span className="shrink-0 text-text-secondary">{relTime(r.ts)}</span>
                    <span className="truncate font-mono text-[10px] text-text-muted">{r.skill}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2.5 font-mono text-[10px] text-text-muted">
                      {r.artifacts > 0 && <span>{r.artifacts} artifact{r.artifacts === 1 ? "" : "s"}</span>}
                      <span>{r.duration_ms < 1000 ? `${r.duration_ms}ms` : `${(r.duration_ms / 1000).toFixed(1)}s`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {history && history.runs.length > 0 && (
              <p className="mt-2 text-[10px] text-text-muted/60">Most recent {history.runs.length} run{history.runs.length === 1 ? "" : "s"} (manual and autonomous). Older runs roll off.</p>
            )}
          </AppCard>
        </>
      )}

      {appTab === "domains" && (
        <>
          {domainEditor}
          <p className="px-1 text-[11px] text-text-muted/70">Conversations with {app.title} are kept here, independent of any domain{doms.length > 0 ? `, grounded in ${titleCase(doms[0])}` : ""}.</p>
        </>
      )}
    </div>
  );
}


// I8 + I6: domain-level Insights - aggregates the proactive "For You" surface
// (questions + suggested next steps), the per-domain task list, and the recent
// intents ledger in one place, independent of any single thread. This is where
// "what should I work on?" and "what have I been asking?" live for a domain.


// Compact strip of the apps bound to this domain, with live status dots, shown
// at the top of the domain view so you can see at a glance which feeds are fresh.

export function BunkerRibbon({ enabled }: { enabled: boolean }) {
  // Vault Lock status, surfaced in the trust bar so the user always knows whether
  // reads/writes are confined to the vault. Defaults to ON (locked) until the
  // backend says otherwise, and refreshes when the toggle changes or on focus.
  const [vaultLocked, setVaultLocked] = useState(true);
  // Global incognito: a separate axis from network/vault posture - it governs
  // whether prompts are logged + memory is written. Reflected live so the bar
  // updates the instant the master toggle fires `prevail:incognito-changed`.
  const [incognito, setIncognito] = useState(() => getPref(PREF.incognito, "0") === "1");
  // Machine role (hub | client) for a vault shared across two Macs. Shown in the
  // trust bar so it's obvious at a glance which machine this is: the always-on
  // HUB that runs all background automation, or a CLIENT that captures prompts
  // only. Sourced from the CLI (prevail role) via a Tauri command, exactly like
  // the other bar indicators pull their state from the backend. Defaults to hub.
  const [machineRole, setMachineRole] = useState<"hub" | "client">("hub");
  // Outbound Guardrail (Privacy > Outbound Guardrail): ONE flag mirrored from
  // the engine - on means email to others only drafts and sensitive details are
  // held at the boundary. Defaults ON (the locked-down default) until the
  // backend says otherwise.
  const [guardrail, setGuardrail] = useState(true);
  useEffect(() => {
    const pull = () => { void invoke<{ enabled: boolean }>("vault_lock_status").then((s) => setVaultLocked(s?.enabled !== false)).catch(() => {}); };
    const pullGuardrail = () => {
      void Promise.all([
        invoke<{ policy?: string }>("email_policy_get").catch(() => null),
        invoke<{ mode?: string }>("egress_guard_get").catch(() => null),
      ]).then(([p, g]) => { if (p || g) setGuardrail(p?.policy !== "allow" && g?.mode !== "off"); });
    };
    const syncIncognito = () => setIncognito(getPref(PREF.incognito, "0") === "1");
    const pullRole = () => { void invoke<string>("machine_role_get").then((r) => setMachineRole(r === "client" ? "client" : "hub")).catch(() => {}); };
    pull();
    syncIncognito();
    pullRole();
    pullGuardrail();
    window.addEventListener("prevail:guardrail-changed", pullGuardrail);
    window.addEventListener("focus", pullGuardrail);
    window.addEventListener("prevail:vault-lock-changed", pull);
    window.addEventListener("prevail:incognito-changed", syncIncognito);
    window.addEventListener("prevail:role-changed", pullRole);
    window.addEventListener("focus", pull);
    window.addEventListener("focus", syncIncognito);
    window.addEventListener("focus", pullRole);
    return () => {
      window.removeEventListener("prevail:guardrail-changed", pullGuardrail);
      window.removeEventListener("focus", pullGuardrail);
      window.removeEventListener("prevail:vault-lock-changed", pull);
      window.removeEventListener("prevail:incognito-changed", syncIncognito);
      window.removeEventListener("prevail:role-changed", pullRole);
      window.removeEventListener("focus", pull);
      window.removeEventListener("focus", syncIncognito);
      window.removeEventListener("focus", pullRole);
    };
  }, []);
  // The bar carries three INDEPENDENT trust axes, each its own labelled segment
  // with a tooltip so the distinction is obvious at a glance (feedback: "the
  // difference between Cloud Connected and Vault Locked isn't clear"):
  //   1. Network  - does anything leave this machine? (Cloud vs Bunker)
  //   2. Vault    - are file reads/writes confined to your vault folder?
  //   3. Incognito- shown only when the global master is on (no logging/memory).
  // High-contrast in BOTH modes: a tinted bar (not a translucent wash that
  // disappears over warm/cream themes), dark text on cyan, light text on dark.
  const Seg = ({ Icon, label, on, tip, onClick }: { Icon: typeof Cloud; label: string; on: boolean; tip: string; onClick?: () => void }) => (
    <span
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={`inline-flex select-none items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${onClick ? "cursor-pointer underline-offset-2 hover:underline" : "cursor-default"} ${on ? "opacity-100" : "opacity-55"}`}
      title={onClick ? `${tip} (click to change)` : tip}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
  const divider = <span className="select-none opacity-30">|</span>;
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center gap-3 border-t px-4 py-1 text-[11px] ${
        enabled
          ? "border-ai bg-ai text-[#0a2230]"
          : "border-black/30 bg-[#141416] text-white/90"
      }`}
    >
      {/* 1. Network posture */}
      <Seg
        Icon={enabled ? ShieldCheck : Cloud}
        label={enabled ? "Bunker mode" : "Cloud connected"}
        on
        tip={enabled
          ? "Bunker Mode: nothing leaves this device. Only local models run; cloud models and web access are blocked."
          : "Cloud Connected: cloud models and web access are enabled. Requests may leave this device. Switch to Bunker Mode for local-only."}
      />
      {divider}
      {/* 2. Vault filesystem scope */}
      <Seg
        Icon={vaultLocked ? FolderLock : FolderOpen}
        label={vaultLocked ? "Vault locked" : "Vault unlocked"}
        on={vaultLocked}
        tip={vaultLocked
          ? "Vault Locked: the assistant only reads and writes inside your vault folder."
          : "Vault Unlocked: the assistant may reach files outside your vault folder."}
      />
      {divider}
      {/* 3. Outbound Guardrail - can anything reach another party without you? */}
      <Seg
        Icon={guardrail ? ShieldCheck : Shield}
        label={guardrail ? "Guardrail on" : "Guardrail off"}
        on={guardrail}
        onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "privacy" }))}
        tip={guardrail
          ? "Outbound Guardrail ON: email to anyone but you only drafts, and sensitive details (PII, figures, health, legal, salary, plans) are held at the boundary until you release them."
          : "Outbound Guardrail OFF: approved sends go out exactly as addressed, unscanned."}
      />
      {/* 4. Incognito - only present when the global master is on. */}
      {incognito && (
        <>
          {divider}
          <Seg
            Icon={Ghost}
            label="Incognito"
            on
            tip="Global Incognito is ON: prompts aren't logged and nothing is written to memory, everywhere in the app."
          />
        </>
      )}
      {/* 4. Machine role - which Mac this is for a shared vault. Distinct icon
          (server tower for the hub, laptop for a client) so it's obvious at a
          glance. Always shown; hub is the default single-machine state. */}
      {divider}
      <Seg
        Icon={machineRole === "hub" ? Server : Laptop}
        label={machineRole === "hub" ? "Hub" : "Client"}
        on
        onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "daemons" }))}
        tip={machineRole === "hub"
          ? "Hub: this Mac runs all background automation for the vault (learn, loops, connector sync, schedule ticks)."
          : "Client: this Mac captures prompts only. Background automation for the shared vault runs on the hub."}
      />
      {/* Version - inside the ribbon so it inherits the high-contrast ribbon
          text color (the old standalone pill was invisible over the dark bar). */}
      <span className="pointer-events-none absolute right-3 select-none font-mono text-[10px] tracking-wider opacity-70">
        v{APP_VERSION}
      </span>
    </div>
  );
}

// A7: live "bridge running" chips in the app footer - so you always know a
// Telegram bridge or the WebUI is serving your vault, from anywhere in the app
// (not just buried in Settings). Polls every 4s; renders nothing when idle.

// A prominent, full-width ribbon pinned to the very bottom of the app whenever
// you're in the demo sandbox - so you always know this is sample data. The
// "Switch to Production" link takes you to the configuration page. Removed
// entirely (no ribbon) the moment you're in production.

// Per-domain preferred skills - auto-attach on entering a domain.

// Concatenates a list of chat messages into a single text payload for
// passing as context to a stateless CLI. Drops the oldest turns until
// the total stays under `maxChars`. Empty-content messages (the streaming
// placeholder for an in-flight reply) are excluded automatically.
//
// IMPORTANT: callers pass the PRIOR conversation - at send() time React's
// state update for the just-typed user turn + its placeholder has not yet
// committed, so `msgs` does NOT contain them. We must therefore keep every
// prior turn (filtering only empties). A previous version sliced off the
// last two entries on the assumption the new pair was already present, which
// silently dropped the most-recent completed exchange - so a follow-up that
// referenced it (e.g. "was he any good?") reached the model with no context,
// most visibly when switching models mid-thread. (feedback v0.4.1 B1)

// ─────────────────────────────────────────────────────────────────────
// App root - vault picker, sidebar, tabs.

export function VaultWizard({ onPick }: { onPick: () => void }) {
  // Staggered entrance for the center column.
  const container = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.12 } } };
  const item = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 120, damping: 16 } },
  };
  const reduce = useReducedMotion();
  // Pointer parallax - shared springs the chips read from for depth.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const onMove = (e: React.MouseEvent) => {
    if (reduce) return;
    px.set(e.clientX / window.innerWidth - 0.5);
    py.set(e.clientY / window.innerHeight - 0.5);
  };
  // Decorative life-domain chips (icons, never emojis) that drift + parallax.
  const chips = [
    { Icon: Wallet,    t: "Wealth",  x: "11%", y: "24%", d: 0.0, depth: 26 },
    { Icon: Heart,     t: "Health",  x: "79%", y: "18%", d: 0.6, depth: 38 },
    { Icon: Receipt,   t: "Tax",     x: "17%", y: "71%", d: 1.2, depth: 20 },
    { Icon: Briefcase, t: "Career",  x: "82%", y: "67%", d: 0.9, depth: 32 },
    { Icon: Home,      t: "Home",    x: "7%",  y: "48%", d: 1.6, depth: 44 },
    { Icon: Archive,   t: "Records", x: "87%", y: "45%", d: 0.3, depth: 16 },
  ];
  return (
    <div
      className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-background text-text-primary"
      data-tauri-drag-region
      onMouseMove={onMove}
    >
      {/* animated aurora background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <motion.div
          className="absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle at center, rgba(196,163,90,0.20), transparent 60%)" }}
          animate={{ x: [0, 60, -20, 0], y: [0, 40, 10, 0], scale: [1, 1.1, 0.95, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -right-40 top-1/4 h-[38rem] w-[38rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle at center, rgba(45,127,228,0.15), transparent 60%)" }}
          animate={{ x: [0, -50, 20, 0], y: [0, 30, -20, 0], scale: [1, 1.08, 1, 1] }}
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-[-12rem] left-1/3 h-[34rem] w-[34rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle at center, rgba(196,163,90,0.13), transparent 60%)" }}
          animate={{ x: [0, 40, -30, 0], y: [0, -30, 10, 0] }}
          transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* film grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
        aria-hidden
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "140px 140px",
        }}
      />

      {/* drifting + parallaxing life-domain chips */}
      <div className="pointer-events-none absolute inset-0 hidden md:block" aria-hidden>
        {chips.map((c) => (
          <FloatingChip key={c.t} chip={c} sx={sx} sy={sy} reduce={!!reduce} />
        ))}
      </div>

      {/* center column */}
      <motion.div variants={container} initial="hidden" animate="show" className="relative z-10 max-w-xl px-8 text-center">
        {/* logo with orbiting rings + pulsing glow */}
        <motion.div variants={item} className="mb-7 flex justify-center">
          <div className="relative flex items-center justify-center" style={{ width: 132, height: 132 }}>
            <motion.div
              className="absolute rounded-full"
              style={{ inset: 16, boxShadow: "0 0 60px rgba(196,163,90,0.40)" }}
              animate={{ opacity: [0.45, 0.85, 0.45], scale: [0.95, 1.06, 0.95] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.svg className="absolute" width={132} height={132} viewBox="0 0 132 132" fill="none"
              animate={{ rotate: 360 }} transition={{ duration: 24, repeat: Infinity, ease: "linear" }}>
              <circle cx="66" cy="66" r="62" stroke="var(--color-accent)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 7" />
            </motion.svg>
            <motion.svg className="absolute" width={112} height={112} viewBox="0 0 112 112" fill="none"
              animate={{ rotate: -360 }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }}>
              <circle cx="56" cy="56" r="53" stroke="#2d7fe4" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="2 10" />
            </motion.svg>
            <PrevailLogo size={88} src="/logo-512.png" />
          </div>
        </motion.div>

        <motion.div variants={item} className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">◆ first launch</motion.div>

        <motion.div variants={item} className="relative mt-5 inline-block overflow-hidden px-1 py-1">
          <h1 className="font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
            Welcome to <BrandMark />.
          </h1>
          {!reduce && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)",
                mixBlendMode: "overlay",
              }}
              initial={{ x: "-130%" }}
              animate={{ x: "130%" }}
              transition={{ duration: 1.1, delay: 0.7, ease: "easeInOut" }}
            />
          )}
        </motion.div>

        <motion.p variants={item} className="mx-auto mt-5 max-w-2xl text-balance text-[15px] text-text-secondary">
          Your life in <span className="font-medium text-text-primary">domains</span>: scored, private, <span className="font-medium text-accent">local-first</span>.
        </motion.p>

        {/* feature pills */}
        <motion.div variants={item} className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {[
            { Icon: Shield, t: "Local-first vault · cloud optional" },
            { Icon: TrendingUp, t: "Context Score" },
            { Icon: Users, t: "Multi-model council" },
          ].map(({ Icon, t }) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-soft px-3 py-1 font-mono text-[11px] text-accent">
              <Icon className="h-3 w-3" />{t}
            </span>
          ))}
        </motion.div>

        {/* CTA - point to a vault. Sample data is available later from
            Settings > Workspace; we don't push it here (it read as the user's own
            data and caused confusion on a fresh install). */}
        <motion.div variants={item} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <motion.button
            onClick={onPick}
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-2.5 rounded-xl bg-accent px-7 py-3.5 text-[15px] font-semibold text-background shadow-lg transition-colors hover:bg-accent-hover"
          >
            <Folder className="h-4 w-4" /> Pick your vault folder
          </motion.button>
        </motion.div>

        <motion.div variants={item} className="mt-5 text-xs text-text-muted">
          Your vault is a folder on your Mac. Want to explore first? Load sample data anytime from Settings, Workspace.
          <span className="mx-2 opacity-40">·</span>
          <span className="font-mono">v{APP_VERSION} · stays on your Mac</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
