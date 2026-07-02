// Recommendations - the proactive feed. Prevail watches what you do and proposes
// the next high-leverage moves across your life: domains to create, the best model
// per domain, apps to connect. Each is one-click. Computed fresh from your vault
// signals (intents, benchmark, apps), so it stays current as you use the app.
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BarChart3, Bookmark, Check, ChevronRight, Clock, Compass, Gauge, Lightbulb, Loader2, Plug, RotateCw, Sparkles, X } from "lucide-react";
import { invoke } from "./bridge";
import { relTime, titleCase } from "./format";
import { modelLabel } from "./helpers2";
import { distillCfgFromPrefs } from "./daemoncfg";
import { lsGet, lsSet } from "./storage";
import { SettingsHeader } from "./sectionutil";

type DistillStatus = { running: boolean; last_run_ts?: number | null; interval_sec?: number | null };

// Compact cadence label, e.g. 900 -> "15m", 3600 -> "1h", 90 -> "90s". Used for
// the "runs every Nm" line when the daemon has not learned anything yet.
function cadenceLabel(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = sec / 3600;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

// Humanize the gap to the next learning pass. Overdue -> "any moment now";
// within ~30s -> "soon"; far out (> ~6h) -> an absolute clock time so a big
// number doesn't read awkwardly; otherwise a relative "~Ns/Nm/Nh".
function nextRunLabel(nextMs: number, nowMs: number): string {
  const diff = nextMs - nowMs;
  if (diff <= 0) return "next learn any moment now";
  const secs = diff / 1000;
  if (secs <= 30) return "next learn soon";
  if (secs > 6 * 3600) {
    const t = new Date(nextMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `next learn ~${t}`;
  }
  if (secs < 90) return `next learn in ~${Math.round(secs)}s`;
  if (secs < 3600) return `next learn in ~${Math.round(secs / 60)}m`;
  const h = secs / 3600;
  return `next learn in ~${h < 2 ? h.toFixed(1) : Math.round(h)}h`;
}

type Rec = {
  id: string;
  category: "domain" | "model" | "app" | "context";
  title: string;
  detail: string;
  action: { kind: "create_domain" | "set_domain_model" | "connect_app" | "improve_context"; domain?: string; model?: string; cli?: string };
};

const CAT_ICON = { domain: Compass, model: BarChart3, app: Plug, context: Gauge } as const;
const CAT_LABEL = { domain: "New domain", model: "Better model", app: "Connect an app", context: "Enrich context" } as const;
// Display order for grouped sections - most actionable first.
const CAT_ORDER: Rec["category"][] = ["model", "app", "domain", "context"];
const CAT_BLURB = {
  domain: "Areas of life worth tracking on their own",
  model: "The model that scores best per domain",
  app: "Connect a source to keep a domain fresh",
  context: "Domains that would benefit from more context",
} as const;

// REC-1: the engine's model-rec title embeds the benchmark run-id label
// (e.g. "2026-06-04_claude-claude-opus-4-6"). action.model/.cli are already the
// clean canonical ids, so for model recs we build a clean, human title ourselves.
function recTitle(r: Rec): string {
  if (r.category === "model" && r.action.model) {
    const clean = modelLabel(r.action.cli, r.action.model) || r.action.model;
    return r.action.domain ? `${titleCase(r.action.domain)}: switch to ${clean}` : `Switch to ${clean}`;
  }
  // Strip a trailing "(34/100)" score out of the title — it's rendered separately
  // as a small score chip, not jammed into the heading text.
  return r.title.replace(/\s*\(\s*\d{1,3}\s*\/\s*100\s*\)\s*$/, "").trim();
}

// The context score embedded in a rec, as "NN/100", or null. Rendered as a small
// italic figure to the right of the title so the heading reads cleanly.
function recScore(r: Rec): string | null {
  const m = r.title.match(/(\d{1,3})\s*\/\s*100/);
  return m ? `${m[1]}/100` : null;
}

// M5 (Monday feedback): show severity/impact, human-readably. Context recs carry
// a score like "(52/100)" - lower score = higher impact; others get a category tone.
function impactOf(r: Rec): { label: string; cls: string } {
  const m = `${r.title} ${r.detail}`.match(/(\d{1,3})\s*\/\s*100/);
  if (m) {
    const s = Number(m[1]);
    if (s < 50) return { label: "High impact", cls: "bg-danger/10 text-danger" };
    if (s < 70) return { label: "Medium impact", cls: "bg-warn/10 text-warn" };
    return { label: "Low impact", cls: "bg-surface-warm text-text-muted" };
  }
  if (r.category === "model") return { label: "Better answers", cls: "bg-accent-soft text-accent" };
  if (r.category === "domain") return { label: "New area", cls: "bg-accent-soft text-accent" };
  if (r.category === "app") return { label: "Fresh data", cls: "bg-accent-soft text-accent" };
  return { label: "Suggested", cls: "bg-surface-warm text-text-muted" };
}
// The "why" behind each recommendation, in plain language.
const WHY: Record<Rec["category"], string> = {
  context: "A higher context score means grounded, personal answers in this domain. Recording goals + decisions and connecting apps raises it, so every future reply gets sharper.",
  model: "Benchmarks on your own questions show this model scores best here. Setting it as the default routes this domain's chats to it automatically.",
  domain: "Prevail saw activity that doesn't fit your current domains. A dedicated domain gives it its own state, memory, and loops.",
  app: "Connecting a source keeps this domain fed with real data on a schedule, so it never goes stale.",
};

// Shared action logic: a rec that's a one-shot config write executes in place
// (the REC principle); anything that needs the user elsewhere navigates there.
// Returns the human "done" message. Used by both the full panel and the home
// Briefing so they stay in lockstep.
export async function applyRec(rec: Rec, vaultPath: string): Promise<string> {
  if (rec.action.kind === "create_domain" && rec.action.domain) {
    await invoke("create_domain", { vault: vaultPath, name: rec.action.domain });
    window.dispatchEvent(new Event("prevail:domains-changed"));
    return `Created the ${titleCase(rec.action.domain)} domain.`;
  }
  if (rec.action.kind === "connect_app") {
    window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" }));
    return "Opening Apps - connect one to feed this domain.";
  }
  if (rec.action.kind === "set_domain_model" && rec.action.domain) {
    const dom = rec.action.domain;
    if (rec.action.cli) lsSet(`prevail.domain.${dom}.cli`, rec.action.cli);
    if (rec.action.model) lsSet(`prevail.domain.${dom}.model`, rec.action.model);
    window.dispatchEvent(new CustomEvent("prevail:domain-model-set", { detail: dom }));
    return `Set ${rec.action.model || "the model"} as ${titleCase(dom)}'s default.`;
  }
  if (rec.action.kind === "improve_context" && rec.action.domain) {
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: rec.action.domain }));
    return `Opening ${titleCase(rec.action.domain)} - add context there; the score rises as Prevail learns.`;
  }
  return "Done.";
}

const REC_DISMISSED = "prevail.recs.dismissed";
const REC_SAVED = "prevail.recs.saved";
function loadSet(key: string): Set<string> { try { return new Set(JSON.parse(lsGet(key) || "[]")); } catch { return new Set(); } }

export function RecommendationsPanel({ vaultPath }: { vaultPath: string }) {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  // M5: per-rec save/dismiss (persisted) + a "why" expander + bulk controls.
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadSet(REC_DISMISSED));
  const [saved, setSaved] = useState<Set<string>>(() => loadSet(REC_SAVED));
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  // B2-22: filter to only the saved recommendations so saved items have a home.
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const persistDismissed = (s: Set<string>) => { setDismissed(new Set(s)); lsSet(REC_DISMISSED, JSON.stringify([...s])); window.dispatchEvent(new Event("prevail:recs-changed")); };
  const persistSaved = (s: Set<string>) => { setSaved(new Set(s)); lsSet(REC_SAVED, JSON.stringify([...s])); };
  const dismissRec = (id: string) => { const s = new Set(dismissed); s.add(id); persistDismissed(s); };
  const restoreRec = (id: string) => { const s = new Set(dismissed); s.delete(id); persistDismissed(s); };
  const toggleSave = (id: string) => { const s = new Set(saved); s.has(id) ? s.delete(id) : s.add(id); persistSaved(s); };

  const [daemon, setDaemon] = useState<DistillStatus | null>(null);
  const [running, setRunning] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await invoke<{ ok: boolean; recommendations?: Rec[] }>("engine_recommendations", { vault: vaultPath });
      setRecs(Array.isArray(r?.recommendations) ? r.recommendations : []);
    } catch { setRecs([]); }
    try { setDaemon(await invoke<DistillStatus>("distill_status")); } catch { /* daemon not started */ }
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);

  // Force a learning pass now, then refresh the feed - "come up with recommendations".
  const runNow = useCallback(async () => {
    setRunning(true);
    try { await invoke("distill_run_once", { cfg: distillCfgFromPrefs(vaultPath) }); } catch { /* surfaced by reload */ }
    finally { setRunning(false); await load(); }
  }, [vaultPath, load]);

  const accept = useCallback(async (rec: Rec) => {
    setBusy(rec.id);
    try {
      const msg = await applyRec(rec, vaultPath);
      setDone((d) => ({ ...d, [rec.id]: msg }));
    } catch (e) {
      setDone((d) => ({ ...d, [rec.id]: `Failed: ${e}` }));
    } finally {
      setBusy(null);
    }
  }, [vaultPath]);

  return (
    <>
      <SettingsHeader
        title="Recommendations"
        icon={Lightbulb}
        subtitle="What Prevail suggests next, learned from how you actually use it: domains worth creating, the model that scores best per domain, and apps that would keep a domain fresh. Updated continuously."
      />
      {/* Daemon status + force-run. Minimal: a status line and one icon button. */}
      {(() => {
        const isLearning = running || !!daemon?.running;
        const interval = daemon?.interval_sec || 0;
        // While learning we don't predict a next run; otherwise show when the
        // next pass is due (from last_run_ts + interval), or the bare cadence if
        // nothing has been learned yet so the user still knows the rhythm.
        let nextLabel: string | null = null;
        if (!isLearning && interval > 0) {
          if (daemon?.last_run_ts) {
            nextLabel = nextRunLabel((daemon.last_run_ts + interval) * 1000, Date.now());
          } else {
            nextLabel = `runs every ${cadenceLabel(interval)}`;
          }
        }
        return (
          <div className="mb-4 flex items-center gap-2 text-[11px] text-text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${isLearning ? "bg-accent" : "bg-text-muted/40"}`} />
            <span>
              {isLearning ? "learning now" : daemon?.last_run_ts ? `last learned ${relTime(daemon.last_run_ts * 1000)}` : "not run yet"}
            </span>
            {nextLabel && (
              <span className="inline-flex items-center gap-1 text-text-muted/70" title="When the learning daemon runs next">
                <span className="text-text-muted/40">·</span>
                <Clock className="h-3 w-3" />
                {nextLabel}
              </span>
            )}
            <button
              onClick={runNow}
              disabled={running || daemon?.running}
              title="Run now: force the learning pass and refresh recommendations"
              aria-label="Run recommendations now"
              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40"
            >
              {running || daemon?.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            </button>
          </div>
        );
      })()}
      {recs === null ? (
        <div className="text-sm text-text-muted">loading recommendations…</div>
      ) : recs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
          <Lightbulb className="mx-auto h-7 w-7 text-text-muted opacity-50" />
          <p className="mt-3 text-sm text-text-secondary">Nothing to recommend right now.</p>
          <p className="mt-1 text-xs text-text-muted">Keep chatting, benchmarking, and connecting apps - recommendations appear as Prevail learns your patterns.</p>
        </div>
      ) : (() => {
        const visible = recs
          .filter((r) => showDismissed || !dismissed.has(r.id))
          .filter((r) => !showSavedOnly || saved.has(r.id));
        const dismissedCount = recs.filter((r) => dismissed.has(r.id)).length;
        const savedCount = recs.filter((r) => saved.has(r.id)).length;
        return (
        <div className="space-y-5">
          {/* M5: bulk controls - saved count, dismiss-all, show/hide dismissed. */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            <span>{visible.filter((r) => !dismissed.has(r.id)).length} active{savedCount > 0 ? ` · ${savedCount} saved` : ""}</span>
            <span className="ml-auto flex items-center gap-2">
              {/* B2-22: click to view only saved recs (so saved items are findable). */}
              {savedCount > 0 && (
                <button onClick={() => setShowSavedOnly((v) => !v)}
                  className={`rounded border px-2 py-0.5 font-mono uppercase tracking-wider ${showSavedOnly ? "border-accent-border bg-accent-soft text-accent" : "border-border hover:border-accent-border hover:text-accent"}`}>
                  {showSavedOnly ? "Showing saved" : "Show saved"} · {savedCount}
                </button>
              )}
              {!showSavedOnly && visible.some((r) => !dismissed.has(r.id)) && (
                <button onClick={() => { const s = new Set(dismissed); recs.forEach((r) => s.add(r.id)); persistDismissed(s); }}
                  className="rounded border border-border px-2 py-0.5 font-mono uppercase tracking-wider hover:border-accent-border hover:text-accent">Dismiss all</button>
              )}
              {dismissedCount > 0 && (
                <button onClick={() => setShowDismissed((v) => !v)}
                  className="rounded border border-border px-2 py-0.5 font-mono uppercase tracking-wider hover:border-accent-border hover:text-accent">
                  {showDismissed ? "Hide" : "Show"} dismissed · {dismissedCount}
                </button>
              )}
            </span>
          </div>
          {CAT_ORDER.filter((cat) => visible.some((r) => r.category === cat)).map((cat) => {
            const group = visible.filter((r) => r.category === cat);
            const Icon = CAT_ICON[cat];
            return (
              <section key={cat}>
                <div className="mb-2 flex items-baseline gap-2 px-1">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-accent"><Icon className="h-3.5 w-3.5" /></span>
                  <h3 className="text-sm font-semibold text-text-primary">{CAT_LABEL[cat]}</h3>
                  <span className="text-[11px] text-text-muted">{group.length}</span>
                  <span className="ml-auto text-[11px] text-text-muted">{CAT_BLURB[cat]}</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {group.map((r, i) => {
                    const accepted = done[r.id];
                    const isDismissed = dismissed.has(r.id);
                    const isSaved = saved.has(r.id);
                    const impact = impactOf(r);
                    const whyOpen = openWhy === r.id;
                    return (
                      <div key={r.id} className={`px-4 py-3.5 ${i > 0 ? "border-t border-border-subtle" : ""} ${isDismissed ? "opacity-50" : ""}`}>
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon className="h-4 w-4" /></span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-text-primary">{recTitle(r)}</span>
                              {recScore(r) && <span className="font-mono text-[10px] italic text-text-muted" title="Current context score">{recScore(r)}</span>}
                              <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${impact.cls}`}>{impact.label}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-text-secondary">{r.detail}</p>
                            <button onClick={() => setOpenWhy(whyOpen ? null : r.id)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                              <ChevronRight className={`h-3 w-3 transition-transform ${whyOpen ? "rotate-90" : ""}`} /> Why this?
                            </button>
                            {whyOpen && (
                              <div className="mt-1.5 rounded-lg border border-border-subtle bg-background p-3 text-xs leading-relaxed text-text-secondary">
                                {WHY[r.category]}
                              </div>
                            )}
                            {accepted && <p className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ok"><Check className="h-3 w-3" /> {accepted}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1 self-center">
                            {!accepted && !isDismissed && (
                              <button onClick={() => accept(r)} disabled={busy === r.id}
                                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
                                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                                {cat === "domain" ? "Create" : cat === "app" ? "Connect" : cat === "context" ? "Open" : "Set"}
                              </button>
                            )}
                            <button onClick={() => toggleSave(r.id)} title={isSaved ? "Saved - click to unsave" : "Save for later"}
                              className={`rounded p-1.5 ${isSaved ? "text-accent" : "text-text-muted hover:text-accent"}`}>
                              <Bookmark className="h-3.5 w-3.5" fill={isSaved ? "currentColor" : "none"} />
                            </button>
                            {isDismissed ? (
                              <button onClick={() => restoreRec(r.id)} title="Restore" className="rounded p-1.5 text-text-muted hover:text-accent"><ArrowRight className="h-3.5 w-3.5 rotate-180" /></button>
                            ) : (
                              <button onClick={() => dismissRec(r.id)} title="Dismiss" className="rounded p-1.5 text-text-muted hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        );
      })()}
    </>
  );
}

// HOME-1: the "Briefing" - a compact, first-class digest on the home landing:
// the top few recommendations Prevail suggests next + a glance at the recent
// distilled intents. Each links into its full panel via "see all". Kept tight
// so the landing stays no-scroll. The full logic lives in RecommendationsPanel /
// IntentsSection; this is the proactive surface that makes self-learning visible.
type BriefIntent = { title?: string; goal?: string };
export function HomeBriefing({ vaultPath }: { vaultPath: string }) {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [intents, setIntents] = useState<BriefIntent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  // Once actioned, a rec is finished - flash the tick, then clear it so the row
  // frees up and the next-best recommendation surfaces in its place.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    invoke<{ ok: boolean; recommendations?: Rec[] }>("engine_recommendations", { vault: vaultPath })
      .then((r) => { if (alive) setRecs(Array.isArray(r?.recommendations) ? r.recommendations : []); })
      .catch(() => { if (alive) setRecs([]); });
    invoke<{ intents?: BriefIntent[] }>("intents_distilled_read", { vault: vaultPath })
      .then((d) => { if (alive) setIntents(Array.isArray(d?.intents) ? d.intents : []); })
      .catch(() => { if (alive) setIntents([]); });
    return () => { alive = false; };
  }, [vaultPath]);

  const top = recs.filter((r) => !cleared.has(r.id)).slice(0, 3);
  const intentLine = intents.slice(0, 3).map((it) => it.title || it.goal || "").filter(Boolean).join(" · ");
  const openRecs = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "recommendations" }));
  const openIntents = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "intents" }));
  const act = useCallback(async (rec: Rec) => {
    setBusy(rec.id);
    try {
      await applyRec(rec, vaultPath);
      setDone((d) => ({ ...d, [rec.id]: true }));
      // Flash the tick, then clear the row to make room + surface the next rec.
      window.setTimeout(() => setCleared((c) => new Set(c).add(rec.id)), 1100);
    }
    catch { /* surfaced in the full panel */ }
    finally { setBusy(null); }
  }, [vaultPath]);

  if (top.length === 0 && intentLine === "") return null;
  return (
    <div className="mt-8 w-full max-w-5xl">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
          <Sparkles className="h-3.5 w-3.5 text-accent" /> Briefing
        </div>
        <span className="font-mono text-[10px] text-text-muted">what Prevail learned + suggests next</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
        {top.map((r, i) => {
          const Icon = CAT_ICON[r.category];
          return (
            <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-border-subtle" : ""}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-text-primary">{recTitle(r)}</span>
                  {recScore(r) && <span className="shrink-0 font-mono text-[10px] italic text-text-muted" title="Current context score">{recScore(r)}</span>}
                </div>
                <div className="truncate text-xs text-text-secondary">{r.detail}</div>
              </div>
              {done[r.id] ? (
                <Check className="h-4 w-4 shrink-0 text-ok" />
              ) : (() => {
                // Icon + tooltip instead of a text button - keeps the row uncluttered.
                const ActIcon = r.category === "domain" ? Sparkles : r.category === "app" ? Plug : r.category === "model" ? Gauge : ArrowRight;
                const tip = r.category === "domain" ? "Create domain" : r.category === "app" ? "Connect app" : r.category === "model" ? "Set as default" : "Open";
                return (
                  <button onClick={() => act(r)} disabled={busy === r.id} title={tip} aria-label={tip}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40">
                    {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ActIcon className="h-3.5 w-3.5" />}
                  </button>
                );
              })()}
            </div>
          );
        })}
        {intentLine !== "" && (
          <button onClick={openIntents} className="flex w-full items-center gap-2 border-t border-border-subtle px-4 py-2.5 text-left transition-colors hover:bg-surface-warm">
            <Compass className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary"><span className="font-semibold text-text-primary">Recent intents:</span> {intentLine}</span>
            <span className="shrink-0 text-xs text-accent">see all ›</span>
          </button>
        )}
        {top.length > 0 && (
          <button onClick={openRecs} className="flex w-full items-center justify-center gap-1 border-t border-border-subtle px-4 py-2 text-xs font-semibold text-accent transition-colors hover:bg-surface-warm">
            See all recommendations <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
