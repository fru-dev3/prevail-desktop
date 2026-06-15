// Recommendations — the proactive feed. Prevail watches what you do and proposes
// the next high-leverage moves across your life: domains to create, the best model
// per domain, apps to connect. Each is one-click. Computed fresh from your vault
// signals (intents, benchmark, apps), so it stays current as you use the app.
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BarChart3, Check, Compass, Gauge, Lightbulb, Loader2, Plug, Sparkles } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { modelLabel } from "./helpers2";
import { lsSet } from "./storage";
import { SettingsHeader } from "./sectionutil";

type Rec = {
  id: string;
  category: "domain" | "model" | "app" | "context";
  title: string;
  detail: string;
  action: { kind: "create_domain" | "set_domain_model" | "connect_app" | "improve_context"; domain?: string; model?: string; cli?: string };
};

const CAT_ICON = { domain: Compass, model: BarChart3, app: Plug, context: Gauge } as const;
const CAT_LABEL = { domain: "New domain", model: "Better model", app: "Connect an app", context: "Enrich context" } as const;
// Display order for grouped sections — most actionable first.
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
  return r.title;
}

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
    return "Opening Apps — connect one to feed this domain.";
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
    return `Opening ${titleCase(rec.action.domain)} — add context there; the score rises as Prevail learns.`;
  }
  return "Done.";
}

export function RecommendationsPanel({ vaultPath }: { vaultPath: string }) {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await invoke<{ ok: boolean; recommendations?: Rec[] }>("engine_recommendations", { vault: vaultPath });
      setRecs(Array.isArray(r?.recommendations) ? r.recommendations : []);
    } catch { setRecs([]); }
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);

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
      {recs === null ? (
        <div className="text-sm text-text-muted">loading recommendations…</div>
      ) : recs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
          <Lightbulb className="mx-auto h-7 w-7 text-text-muted opacity-50" />
          <p className="mt-3 text-sm text-text-secondary">Nothing to recommend right now.</p>
          <p className="mt-1 text-xs text-text-muted">Keep chatting, benchmarking, and connecting apps — recommendations appear as Prevail learns your patterns.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {CAT_ORDER.filter((cat) => recs.some((r) => r.category === cat)).map((cat) => {
            const group = recs.filter((r) => r.category === cat);
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
                    return (
                      <div key={r.id} className={`flex items-start gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-border-subtle" : ""}`}>
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-semibold text-text-primary">{recTitle(r)}</span>
                          <p className="mt-0.5 text-xs text-text-secondary">{r.detail}</p>
                          {accepted && <p className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ok"><Check className="h-3 w-3" /> {accepted}</p>}
                        </div>
                        {!accepted && (
                          <button
                            onClick={() => accept(r)}
                            disabled={busy === r.id}
                            className="inline-flex shrink-0 items-center gap-1.5 self-center rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
                          >
                            {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                            {cat === "domain" ? "Create" : cat === "app" ? "Connect" : cat === "context" ? "Open" : "Set"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

// HOME-1: the "Briefing" — a compact, first-class digest on the home landing:
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

  const top = recs.slice(0, 3);
  const intentLine = intents.slice(0, 3).map((it) => it.title || it.goal || "").filter(Boolean).join(" · ");
  const openRecs = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "recommendations" }));
  const openIntents = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "intents" }));
  const act = useCallback(async (rec: Rec) => {
    setBusy(rec.id);
    try { await applyRec(rec, vaultPath); setDone((d) => ({ ...d, [rec.id]: true })); }
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
                <div className="truncate text-sm font-medium text-text-primary">{recTitle(r)}</div>
                <div className="truncate text-xs text-text-secondary">{r.detail}</div>
              </div>
              {done[r.id] ? (
                <Check className="h-4 w-4 shrink-0 text-ok" />
              ) : (
                <button onClick={() => act(r)} disabled={busy === r.id}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">
                  {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {r.category === "domain" ? "Create" : r.category === "app" ? "Connect" : r.category === "context" ? "Open" : "Set"}
                </button>
              )}
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
