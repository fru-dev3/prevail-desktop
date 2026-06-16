// Domain-scoped panels extracted from App.tsx: the context drawer (right rail),
// the agent picker rail, the pref-picker column, and the domain prefs panel.
import { useCallback, useEffect, useState } from "react";
import { Box, Check, ChevronRight, Compass, Cpu, Folder, Loader2, Lock, MessageSquare, PanelRightClose, Pin, Share2, SlidersHorizontal, Sparkles, Terminal, ThumbsDown, ThumbsUp } from "lucide-react";
import { invoke } from "./bridge";
import { FRAMEWORKS, LENSES, MODELS } from "./constants";
import { formatFreshness, titleCase } from "./format";
import { isLocalCli } from "./helpers";
import { PREF, getPref, isBunkerOn, lsGet, lsSet } from "./storage";
import { Toggle } from "./ui";
import { ResizeHandle } from "./widgets";
import { DrawerImportsSection } from "./panels";
import { domainIcon } from "./icons";
import { pickSkillColor } from "./sectionutil";
import { useCliVerifyLive } from "./verify";
import { ProviderMark } from "./marks";
import type { CliInfo, DomainContextBundle, DomainManifest, SkillEntry } from "./types";

export const SECTION_LABEL =
  "font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary";

// agent stays expanded. Clicking sets the chat panel's primary CLI.
// Full-canvas preferences panel for the currently-selected domain.
// Replaces the popover. Every control writes to localStorage on
// click; no save button — picks are immediate. Pickers use brand
// icons for CLIs, prose labels for everything else.

export function DomainContextDrawer({
  domain,
  vaultPath,
  domainPath,
  onClose,
  onInjectContext,
  onInsertSkill,
  preferredSet,
  onTogglePreferred,
}: {
  domain: string;
  vaultPath: string;
  domainPath: string;
  onClose: () => void;
  onInjectContext: (text: string, label: string) => void;
  onInsertSkill: (skillName: string) => void;
  preferredSet?: Set<string>;
  onTogglePreferred?: (name: string) => void;
}) {
  const [ctx, setCtx] = useState<DomainContextBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({
    recent: true, memory: false, state: false, decisions: false, journal: false, logs: false, skills: false,
  });
  // Live decision ledger (_decisions.jsonl) + distilled long-term memory.
  // These update the moment a verdict is saved — no waiting on distillation.
  type DecisionRecord = { id?: string; ts?: number; kind?: string; prompt?: string; verdict?: string; feedback?: { rating?: string } | string | null };
  const [decisionLog, setDecisionLog] = useState<DecisionRecord[]>([]);
  const [memory, setMemory] = useState<string>("");
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    const v = parseInt(lsGet("prevail.contextDrawer.width"), 10);
    return Number.isFinite(v) && v > 0 ? v : 320;
  });
  useEffect(() => { lsSet("prevail.contextDrawer.width", String(drawerWidth)); }, [drawerWidth]);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const load = () => {
      // C1 (Monday feedback): General now gets the SAME context items as domains.
      // domain_context with an empty domain reads the vault ROOT, which is exactly
      // where General's journal / session logs / skills / decisions live — so the
      // panel shows them instead of only the cross-cutting trio.
      invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain: domain || "" })
        .then((c) => { if (mounted) { setCtx(c); setErr(null); } })
        .catch((e) => { if (mounted) { setCtx(null); setErr(domain ? String(e) : null); } })
        .finally(() => { if (mounted) setLoading(false); });
      invoke<DecisionRecord[]>("decisions_read", { vault: vaultPath, domain: domain || null, limit: 15 })
        .then((d) => { if (mounted) setDecisionLog(Array.isArray(d) ? d : []); })
        .catch(() => { if (mounted) setDecisionLog([]); });
      invoke<string>("read_memory_md", { vault: vaultPath, domain: domain || null })
        .then((m) => { if (mounted) setMemory(m || ""); })
        .catch(() => { if (mounted) setMemory(""); });
      invoke<string>("read_ideal_state", { vault: vaultPath })
        .then((s) => { if (mounted) setIdealState(s || ""); })
        .catch(() => { if (mounted) setIdealState(""); });
    };
    load();
    // Refresh the instant a decision/verdict is saved anywhere in the app.
    const onChanged = () => load();
    window.addEventListener("prevail:context-changed", onChanged);
    return () => { mounted = false; window.removeEventListener("prevail:context-changed", onChanged); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, domain]);

  const [idealState, setIdealState] = useState<string>("");

  const Section = ({
    keyName, title, count, body,
  }: { keyName: string; title: string; count?: number; body: React.ReactNode }) => (
    <div className="border-b border-border-subtle">
      <button
        onClick={() => setOpen((o) => ({ ...o, [keyName]: !o[keyName] }))}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-surface-warm"
      >
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
          <span className="text-accent">{open[keyName] ? "▾" : "▸"}</span>
          {title}
          {count !== undefined && <span className="text-text-muted">· {count}</span>}
        </span>
      </button>
      {open[keyName] && <div className="px-4 pb-4 text-sm">{body}</div>}
    </div>
  );

  return (
    <div className="flex shrink-0">
      <ResizeHandle
        ariaLabel="Resize context drawer"
        onChange={(dx) => setDrawerWidth((w) => Math.max(260, Math.min(640, w - dx)))}
      />
      <aside className="flex shrink-0 flex-col border-l border-border-subtle bg-surface-warm" style={{ width: drawerWidth }}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Context</div>
          <div className="flex items-center gap-2 font-display text-base font-semibold">
            {(() => {
              const I = domain ? domainIcon(domain) : MessageSquare;
              return I ? <I className="h-4 w-4 text-accent" /> : <span className="text-accent">◆</span>;
            })()}
            {domain ? titleCase(domain) : "General"}
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          title="Collapse context"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-text-muted">loading…</div>}
        {err && <div className="m-2 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">{err}</div>}
        {!domain && (
          <div className="border-b border-border-subtle px-4 py-2.5 text-[11px] leading-relaxed text-text-muted">
            General is your no-domain workspace, so it shows only what spans everything: recent decisions, your ideal state, and long-term memory. State, journal, session logs, and skills live inside each domain's own folder, so open a domain to see those.
          </div>
        )}
        <Section keyName="ideal" title="Ideal state" body={
          idealState.trim() ? (
            <>
              <p className="mb-2 text-[11px] leading-relaxed text-text-muted">
                Your constitution. It is already injected at highest precedence into every chat and council turn; pull it in explicitly when you want the model to reason against it at length.
              </p>
              <button
                onClick={() => onInjectContext(idealState, "Ideal State · constitution")}
                className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
              >
                → use in chat
              </button>
              <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                {idealState.length > 1200 ? idealState.slice(0, 1200) + "\n…" : idealState}
              </pre>
            </>
          ) : <div className="text-xs text-text-muted">No Ideal State written yet. Settings → Ideal State.</div>
        } />
        <Section keyName="memory" title="Long-term memory" body={
          memory.trim() ? (
            <>
              <button
                onClick={() => onInjectContext(memory, `${domain ? titleCase(domain) : "General"} · memory`)}
                className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
              >
                → use in chat
              </button>
              <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                {memory.length > 1200 ? memory.slice(0, 1200) + "\n…" : memory}
              </pre>
            </>
          ) : <div className="text-xs text-text-muted">No distilled memory yet. The background distiller (Settings → Daemons) compacts your activity into memory once enough new material accumulates, usually within a few sessions.</div>
        } />
        {ctx && (
          <>
            <Section keyName="state" title="State" body={
              ctx.state ? (
                <>
                  <button
                    onClick={() => onInjectContext(ctx.state!, `${titleCase(domain)}/state.md`)}
                    className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                  >
                    → use in chat
                  </button>
                  <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {ctx.state.length > 1200 ? ctx.state.slice(0, 1200) + "\n…" : ctx.state}
                  </pre>
                </>
              ) : <div className="text-xs text-text-muted">No state yet. The distiller derives a state snapshot from your activity in this domain; it appears after your first few chats here.</div>
            } />
            {/* Decisions = the live ledger (latest, raw) + the distiller's curated
                summary, in ONE section (was split into "Recent decisions" + "Decisions"). */}
            <Section keyName="decisions" title="Decisions" count={decisionLog.length || undefined} body={
              <>
              <div className="mb-2 text-[11px] leading-snug text-text-muted">
                Council verdicts and saved decisions — latest first. The distiller folds them into a curated summary over time.
              </div>
              {decisionLog.length > 0 && (
                <ul className="mb-2 flex flex-col gap-2">
                  {decisionLog.slice(0, 6).map((d, i) => {
                    const fb = typeof d.feedback === "object" && d.feedback ? d.feedback.rating : (typeof d.feedback === "string" ? d.feedback : undefined);
                    const ago = d.ts ? formatFreshness(Math.max(0, Math.floor((Date.now() - d.ts) / 1000))) : "";
                    return (
                      <li key={d.id ?? i} className="rounded-lg border border-border-subtle bg-background p-2.5">
                        <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                          <span>{d.kind ?? "decision"}{ago ? ` · ${ago}` : ""}</span>
                          {fb === "up" && <ThumbsUp className="h-3 w-3 text-accent" />}
                          {fb === "down" && <ThumbsDown className="h-3 w-3 text-red-500" />}
                        </div>
                        {d.prompt && <div className="line-clamp-1 text-[11px] font-semibold text-text-primary">{d.prompt}</div>}
                        {d.verdict && <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] leading-snug text-text-secondary">{d.verdict}</div>}
                        {d.verdict && (
                          <button onClick={() => onInjectContext(d.verdict!, `decision · ${(d.prompt ?? "").slice(0, 30)}`)}
                            className="mt-1.5 rounded-md border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background">
                            → use in chat
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {ctx.decisions ? (
                <>
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted/70">Curated summary</div>
                  <button onClick={() => onInjectContext(ctx.decisions!, `${titleCase(domain)}/decisions.md`)}
                    className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background">
                    → use in chat
                  </button>
                  <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {ctx.decisions.length > 1200 ? ctx.decisions.slice(0, 1200) + "\n…" : ctx.decisions}
                  </pre>
                </>
              ) : (decisionLog.length === 0 && <div className="text-xs text-text-muted">No decisions yet. Run a council or save a decision; the distiller curates a summary over time.</div>)}
              </>
            } />
            {/* Activity = the raw record: what you asked (journal) + session logs,
                merged (was split into "Journal" + "Session logs"). The distilled
                sections above are derived from this. */}
            <Section keyName="activity" title="Activity" count={ctx.recent_logs.length || undefined} body={
              <>
              <div className="mb-2 text-[11px] leading-snug text-text-muted">
                The raw record — what you asked, and session logs. State, Memory, and Decisions above are distilled from this.
              </div>
              {ctx.journal && (
                <>
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted/70">Journal · what you asked</div>
                  <button onClick={() => onInjectContext(ctx.journal!, `${titleCase(domain)}/_journal`)}
                    className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background">
                    → use in chat
                  </button>
                  <pre className="mb-3 whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {ctx.journal.length > 1200 ? ctx.journal.slice(0, 1200) + "\n…" : ctx.journal}
                  </pre>
                </>
              )}
              {ctx.recent_logs.length > 0 ? (
                <>
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted/70">Session logs</div>
                  <ul className="space-y-1">
                    {ctx.recent_logs.map((l) => (
                      <li key={l.path}>
                        <button onClick={async () => { try { const body = await invoke<string>("read_file", { path: l.path }); onInjectContext(body, l.name); } catch (e) { console.error(e); } }}
                          className="w-full rounded border border-border-subtle bg-background px-2 py-1.5 text-left hover:border-accent-border hover:bg-surface-warm">
                          <div className="font-mono text-[11px] text-text-primary">{l.name}</div>
                          {l.preview && <div className="mt-0.5 line-clamp-2 text-[10px] text-text-muted">{l.preview}</div>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (!ctx.journal && <div className="text-xs text-text-muted">No activity yet. Your chats here build this raw record, which the distiller folds into State, Memory, and Decisions.</div>)}
              </>
            } />
            <Section keyName="skills" title="Skills" count={ctx.skills.length} body={
              ctx.skills.length === 0 ? (
                <div className="text-xs text-text-muted">drop a folder under <code className="text-accent">{titleCase(domain)}/skills/</code> with a SKILL.md.</div>
              ) : (
                <ul className="space-y-1">
                  {ctx.skills.map((s) => (
                    <li key={s.path} className="flex items-stretch gap-1">
                      <button
                        onClick={() => onInsertSkill(s.name)}
                        className="flex-1 rounded border border-border-subtle bg-background px-2 py-1.5 text-left hover:border-accent-border hover:bg-surface-warm"
                      >
                        <div className="font-mono text-[11px] text-accent">/{s.name}</div>
                        {s.description && <div className="mt-0.5 line-clamp-2 text-[10px] text-text-muted">{s.description}</div>}
                      </button>
                      {onTogglePreferred && (
                        <button
                          onClick={() => onTogglePreferred(s.name)}
                          title={preferredSet?.has(s.name) ? "Unpin" : "Pin: auto-attach"}
                          className={`shrink-0 rounded border px-2 text-[12px] transition-colors ${
                            preferredSet?.has(s.name)
                              ? "border-accent-border bg-accent-soft text-accent"
                              : "border-border-subtle bg-background text-text-muted hover:border-accent-border hover:text-accent"
                          }`}
                        >
                          {preferredSet?.has(s.name) ? "★" : "☆"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )
            } />
            <DrawerImportsSection
              domain={domain}
              onInject={(body, label) => onInjectContext(body, label)}
            />
          </>
        )}
      </div>
      <button
        onClick={() => { void invoke("open_in_finder", { path: domainPath }); }}
        title={`Open ${domainPath} in Finder`}
        className="flex w-full items-center gap-1.5 border-t border-border-subtle px-4 py-2 text-left font-mono text-[10px] text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
      >
        <Folder className="h-3 w-3 shrink-0" />
        <span className="truncate">{domainPath.split("/").slice(-3).join("/")}</span>
      </button>
      </aside>
    </div>
  );
}

// Drawer section that surfaces a domain's ingested imports without
// the user having to navigate to Settings → Ingestion. Click a row
// to load the first chunk into the chat as primed context, or
// "reveal" to open in Finder. Read-only — toggling for attachment
// happens via the chips above the composer.

// Domain actions menu — "Back up" and "Archive" for a single domain.
// Used in the domain header. Backs up via engine_vault_backup(domainOpt),
// archives via engine_vault_archive. Archive never deletes data; it just
// flips the manifest flag and hides the domain from the active sidebar.

// ─────────────────────────────────────────────────────────────────────
// Usage dashboard (P4.7 Phase 4) — reads the aggregated <vault>/usage
// summary written by usage_append at each turn close and renders totals
// plus breakdowns by CLI, model, and domain, with a per-day activity
// strip. Surfaced on the no-domain landing; renders nothing until there's
// at least one captured turn, so new vaults stay clean.



// The user's Ideal State (constitution) framed as highest-precedence law and
// prepended to chat/council prompts the desktop sends directly. Mirrors the
// engine framing (cli-bridge.ts buildConstitutionPreamble) and the Rust daemon
// helper (lib.rs ideal_state_preamble) so the constitution reads identically
// everywhere. Empty string when the Ideal State is blank.


// Fetches the engine-backed usage roll-up (whole-vault, or scoped to one domain
// when `domain` is set) and renders it. On the no-domain landing we pass
// hideWhenEmpty so a fresh vault stays clean; in the Usage tab we show a
// friendly empty state instead.

export function AgentPickerRail({
  clis,
  selected,
  onSelect,
}: {
  clis: CliInfo[];
  selected: string | null;
  onSelect: (cliId: string) => void;
}) {
  const verify = useCliVerifyLive();
  if (clis.length === 0) return null;
  return (
    <div className="mt-3 flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-1 shadow-sm">
      {clis
        .filter((c) => !isBunkerOn() || isLocalCli(c.id))
        // A provider that failed validation is not offered for chat: pick a
        // dead provider and the send just errors. It stays on the Models page
        // with the reason and a login hint.
        .filter((c) => verify.get(c.id)?.status !== "failed")
        .map((c) => {
        const active = c.id === selected;
        const v = verify.get(c.id)?.status;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            title={`${c.label}${v === "ok" ? " · validated" : v === "verifying" ? " · validating…" : " · not validated yet"}`}
            className={`group relative flex items-center gap-2 rounded-full px-2 py-1 transition-all ${
              active ? "bg-surface-warm" : "hover:bg-surface-warm"
            }`}
          >
            <span className="relative">
              <ProviderMark vendor={c.id} size={24} />
              {v === "ok" && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-ok text-[8px] font-bold leading-none text-background">✓</span>
              )}
              {v === "verifying" && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-text-muted" />
              )}
            </span>
            <span
              className={`overflow-hidden whitespace-nowrap font-display text-sm font-semibold tracking-tight transition-all duration-200 ease-out ${
                active
                  ? "max-w-[160px] pr-1 opacity-100"
                  : "max-w-0 pr-0 opacity-0 group-hover:max-w-[160px] group-hover:pr-1 group-hover:opacity-100"
              }`}
            >
              {c.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// I7: create a reusable skill from the UI — the "build skills over time" path.
// A skill is just a named, reusable prompt the model runs on demand (slash
// `/name` in chat). Seeded from the composer's "Save as skill" or written here.


// Side drawer that shows the current domain's state.md, decisions,
// journal, recent session logs, and skills. Loaded on-demand via the
// `domain_context` Rust command. Items can be "used in chat" to
// inject as prompt context.

export function PrefPickerColumn({
  glyph,
  title,
  options,
  selected,
  onSelect,
  onClear,
}: {
  glyph: string;
  title: string;
  options: readonly { id: string; label: string; blurb: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className={`flex items-center gap-2 ${SECTION_LABEL}`}>
          <span className="text-accent">{glyph}</span> {title}
        </div>
        {selected && (
          <button
            onClick={onClear}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          >
            use global
          </button>
        )}
      </div>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {options.map((o) => {
          const picked = selected === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onSelect(o.id)}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                picked
                  ? "border-accent bg-accent-soft"
                  : "border-border-subtle bg-background hover:border-accent-border"
              }`}
            >
              <span className={`shrink-0 font-mono text-sm ${picked ? "font-semibold text-accent" : "text-text-primary"}`}>{o.label}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{o.blurb}</span>
              {picked && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-background">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Collapsible card for a Preferences section. Collapsed by default so the page
// reads as a tidy list of sections; click the header (or expand the one you want)
// to reveal its controls. `right` is an optional header-aligned action that does
// not toggle the section.
function PrefSection({ title, subtitle, icon, right, defaultOpen = false, children }: { title: string; subtitle?: string; icon?: React.ReactNode; right?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
          {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">{icon}</span>}
          <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">{title}</span>
        </button>
        {/* Right-side summary of what's inside, so the row reads at a glance
            even while collapsed (founder ask: icon left, summary right). */}
        {subtitle && <span className="min-w-0 truncate text-right font-mono text-[10px] uppercase tracking-wider text-text-muted">{subtitle}</span>}
        {right && <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{right}</div>}
      </div>
      {open && <div className="border-t border-border-subtle px-4 py-4">{children}</div>}
    </section>
  );
}

export function DomainPrefsPanel({
  domain,
  vaultPath,
  clis,
  skills,
  preferredSkills,
  onTogglePreferredSkill,
  onChanged,
  onBack,
}: {
  domain: string;
  vaultPath: string;
  clis: CliInfo[];
  skills: SkillEntry[];
  preferredSkills: string[];
  onTogglePreferredSkill: (name: string) => void;
  onChanged: () => void;
  onBack?: () => void;
}) {
  // Read overrides directly so save buttons are unnecessary —
  // bump tick on every write so this component re-renders.
  const [tick, setTick] = useState(0);
  const force = () => { setTick((t) => t + 1); onChanged(); };
  void tick;
  // Skill list collapses by default so a long roster doesn't crowd the panel.
  const [skillsOpen, setSkillsOpen] = useState(false);

  const cliKey = `prevail.domain.${domain}.cli`;
  const modelKey = `prevail.domain.${domain}.model`;
  const fwKey = `prevail.domain.${domain}.framework`;
  const lensKey = `prevail.domain.${domain}.lens`;
  const autoStateKey = `prevail.domain.${domain}.autoState`;
  // Privacy / sandbox / routing live in top-level manifest blocks (not
  // config), but we mirror to localStorage too so the rest of the app
  // (ChatPanel reads prevail.domain.<name>.localOnly) keeps working.
  const localOnlyKey = `prevail.domain.${domain}.localOnly`;
  const sandboxKey = `prevail.domain.${domain}.sandbox`;
  const keywordsKey = `prevail.domain.${domain}.routing.keywords`;
  // M6: per-domain Ideal State (this domain's own target, layered under global).
  const [domainIdeal, setDomainIdeal] = useState<string>("");
  const [domainIdealSaved, setDomainIdealSaved] = useState(false);
  const [draftingIdeal, setDraftingIdeal] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("read_domain_ideal", { vault: vaultPath, domain }).then((s) => setDomainIdeal(s || "")).catch(() => setDomainIdeal(""));
  }, [vaultPath, domain]);
  const saveDomainIdeal = async () => {
    try { await invoke("write_domain_ideal", { vault: vaultPath, domain, body: domainIdeal }); setDomainIdealSaved(true); window.setTimeout(() => setDomainIdealSaved(false), 1500); } catch (e) { console.error("write domain ideal", e); }
  };
  // IDEAL-AI: draft the ideal state from the domain's real context, for review.
  const draftIdealWithAI = async () => {
    setDraftingIdeal(true); setDraftErr(null);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      const text = await invoke<string>("domain_draft_ideal", { vault: vaultPath, domain, provider, model });
      if (text?.trim()) setDomainIdeal(text.trim());
    } catch (e) { setDraftErr(String(e)); }
    finally { setDraftingIdeal(false); }
  };

  // Per-domain daemon config (_daemon.json) — taskgen + reminders toggles.
  // Default true so domains work without any config file.
  const daemonCfgPath = `${vaultPath}/${domain}/_daemon.json`;
  const [daemonTaskgen, setDaemonTaskgen] = useState(true);
  const [daemonReminders, setDaemonReminders] = useState(true);
  const [daemonSkillgen, setDaemonSkillgen] = useState(true);
  useEffect(() => {
    invoke<string>("read_text_file", { path: daemonCfgPath })
      .then((raw) => {
        try {
          const cfg = JSON.parse(raw);
          if (typeof cfg.taskgen === "boolean") setDaemonTaskgen(cfg.taskgen);
          if (typeof cfg.reminders === "boolean") setDaemonReminders(cfg.reminders);
          if (typeof cfg.skillgen === "boolean") setDaemonSkillgen(cfg.skillgen);
        } catch {}
      })
      .catch(() => {}); // file absent → defaults (true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daemonCfgPath]);
  function saveDaemonCfg(patch: { taskgen?: boolean; reminders?: boolean; skillgen?: boolean }) {
    const next = { taskgen: daemonTaskgen, reminders: daemonReminders, skillgen: daemonSkillgen, ...patch };
    invoke("write_text_file", { path: daemonCfgPath, contents: JSON.stringify(next, null, 2) }).catch(() => {});
  }

  // Per-domain prefs are stored in the domain's manifest (config block)
  // when the engine supports it, and ALSO mirrored to localStorage so the
  // rest of the app (ChatPanel) — which reads localStorage — keeps working.
  // On mount we load the manifest and hydrate any localStorage keys that
  // aren't already set from it. When the manifest is unavailable we fall
  // back to localStorage-only (the previous behavior).
  const [manifestReady, setManifestReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await invoke<DomainManifest>("engine_manifest_get", { vault: vaultPath, domain });
        if (cancelled) return;
        const cfg = m?.config;
        if (cfg) {
          // Hydrate localStorage from the manifest only where the user
          // hasn't already set a local override, so the manifest acts as
          // the durable store without clobbering an in-flight local edit.
          if (!lsGet(cliKey) && cfg.cli) lsSet(cliKey, cfg.cli);
          if (!lsGet(modelKey) && cfg.model) lsSet(modelKey, cfg.model);
          if (!lsGet(fwKey) && cfg.framework) lsSet(fwKey, cfg.framework);
          if (!lsGet(lensKey) && cfg.lens) lsSet(lensKey, cfg.lens);
          if (!lsGet(autoStateKey)) lsSet(autoStateKey, cfg.autoState === false ? "0" : "1");
          // Preferred skills come from the parent; seed them from the
          // manifest when none are pinned yet.
          if (Array.isArray(cfg.skills) && cfg.skills.length > 0 && preferredSkills.length === 0) {
            for (const s of cfg.skills) onTogglePreferredSkill(s);
          }
        }
        // Hydrate top-level privacy / sandbox / routing blocks.
        if (!lsGet(localOnlyKey)) lsSet(localOnlyKey, m?.privacy?.localOnly ? "1" : "0");
        if (!lsGet(sandboxKey)) lsSet(sandboxKey, m?.sandbox?.mode === "locked" ? "locked" : "open");
        if (!lsGet(keywordsKey) && Array.isArray(m?.routing?.keywords)) {
          // A6: the domain name is an implicit, non-editable default keyword, so
          // strip it from the editable "extras" we hydrate into the input.
          const extras = (m.routing!.keywords as string[]).filter(
            (k) => k.trim().toLowerCase() !== domain.toLowerCase(),
          );
          lsSet(keywordsKey, extras.join(", "));
        }
        // Nothing stored and nothing in the manifest: derive routing keywords
        // from the domain's own goals/soul so routing works without manual
        // setup. Frequency-ranked distinctive words, top six.
        if (!lsGet(keywordsKey)) {
          try {
            // B5 (Monday feedback): routing keywords weren't populating because
            // this only read the LEGACY path; v3 vaults keep domains under
            // domains/<d>/. Try the v3 path first, then legacy.
            const texts = await Promise.all(
              ["goals.md", "soul.md", "config.md"].map(async (f) => {
                for (const base of [`${vaultPath}/domains/${domain}`, `${vaultPath}/${domain}`]) {
                  const t = await invoke<string>("read_text_file", { path: `${base}/${f}` }).catch(() => "");
                  if (t && t.trim()) return t;
                }
                return "";
              }),
            );
            const STOP = new Set("the and for with that this from your you are was have has not but they them then than when what where which while will would could should about into over under each every some most more very just also like been being our their his her its only own same can may might must a an of to in on at by it is as or be do if no so we i me my".split(" "));
            const freq = new Map<string, number>();
            for (const w of texts.join(" ").toLowerCase().split(/[^a-z][^a-z]*/)) {
              if (w.length < 4 || STOP.has(w) || w === domain.toLowerCase()) continue;
              freq.set(w, (freq.get(w) ?? 0) + 1);
            }
            const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
            if (top.length > 0) lsSet(keywordsKey, top.join(", "));
          } catch { /* derivation is best-effort */ }
        }
      } catch {
        // Engine/manifest unavailable — localStorage remains the source.
      } finally {
        if (!cancelled) { setManifestReady(true); force(); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, domain]);

  // Merge a partial config block into the manifest. Best-effort: failures
  // are swallowed so localStorage stays the working fallback.
  const persistManifest = useCallback(
    (config: Record<string, unknown>) => {
      const json = JSON.stringify({ config });
      invoke("engine_manifest_set", { vault: vaultPath, domain, json }).catch(() => {
        /* manifest write unsupported — localStorage already holds the value */
      });
    },
    [vaultPath, domain],
  );

  // Merge an arbitrary top-level manifest patch (e.g. privacy / sandbox /
  // routing blocks). Best-effort — same fallback contract as persistManifest.
  const persistManifestTop = useCallback(
    (patch: Record<string, unknown>) => {
      const json = JSON.stringify(patch);
      invoke("engine_manifest_set", { vault: vaultPath, domain, json }).catch(() => {
        /* manifest write unsupported — localStorage already holds the value */
      });
    },
    [vaultPath, domain],
  );

  // Mirror preferred-skill changes into the manifest once loaded.
  const skillsSig = preferredSkills.join(",");
  useEffect(() => {
    if (!manifestReady) return;
    persistManifest({ skills: preferredSkills });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillsSig, manifestReady]);

  const pickedCli = lsGet(cliKey);
  const pickedModel = lsGet(modelKey);
  const pickedFw = lsGet(fwKey);
  const pickedLens = lsGet(lensKey);
  const autoState = lsGet(autoStateKey) !== "0";
  const localOnly = lsGet(localOnlyKey) === "1";
  const sandboxMode = lsGet(sandboxKey) === "locked" ? "locked" : "open";
  const keywordsRaw = lsGet(keywordsKey);

  // Map a localStorage pref key to its manifest config field so writes go
  // to both stores.
  const KEY_TO_CONFIG: Record<string, string> = {
    [cliKey]: "cli",
    [modelKey]: "model",
    [fwKey]: "framework",
    [lensKey]: "lens",
  };

  function setOverride(key: string, value: string) {
    lsSet(key, value);
    const field = KEY_TO_CONFIG[key];
    if (field) persistManifest({ [field]: value || null });
    force();
  }

  void onBack;
  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Preferences</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Domain-only overrides. Pickers apply on the next reload of this domain; global defaults still apply when these are unset.
          </p>
        </div>
        <button
          onClick={() => {
            for (const k of [cliKey, modelKey, fwKey, lensKey, autoStateKey, `prevail.domain.${domain}.skills`, localOnlyKey, sandboxKey, keywordsKey]) {
              lsSet(k, "");
            }
            // Clear the manifest config overrides too.
            persistManifest({ cli: null, model: null, framework: null, lens: null, autoState: true, skills: [] });
            persistManifestTop({ privacy: { localOnly: false }, sandbox: { mode: "open" }, routing: { keywords: [] } });
            force();
          }}
          className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
        >
          reset all
        </button>
      </div>

      {/* CLI picker — select a CLI to expand its models inline (collapse & indent) */}
      <PrefSection
        title="CLI"
        defaultOpen
        icon={<Terminal className="h-4 w-4" />}
        subtitle={pickedCli ? titleCase(pickedCli) : "Global default"}
        right={pickedCli ? (
          <button
            onClick={() => { setOverride(cliKey, ""); setOverride(modelKey, ""); }}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          >
            use global
          </button>
        ) : undefined}
      >
        <p className="mb-3 text-sm text-text-secondary">Which agent runs every prompt in {titleCase(domain)}. Pick one to choose its model.</p>
        {/* List rows; the selected CLI expands to show its models indented below. */}
        <div className="flex flex-col gap-1.5">
          {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
            const picked = pickedCli === c.id;
            const disabled = !c.available;
            const models = MODELS[c.id] ?? [];
            return (
              <div key={c.id}>
                <button
                  disabled={disabled}
                  onClick={() => setOverride(cliKey, c.id)}
                  title={disabled ? `${c.label} not installed` : c.label}
                  className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                    picked
                      ? "border-accent bg-accent-soft ring-1 ring-accent/20"
                      : disabled
                      ? "border-border-subtle bg-background opacity-40"
                      : "border-border bg-background hover:bg-surface-warm"
                  }`}
                >
                  <ProviderMark vendor={c.id} size={22} />
                  <span className={`flex-1 font-display text-sm font-semibold tracking-tight ${picked ? "text-accent" : "text-text-primary"}`}>
                    {c.label}
                  </span>
                  {disabled && (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">not installed</span>
                  )}
                  {!disabled && models.length > 0 && (
                    <svg className={`h-3.5 w-3.5 text-text-muted transition-transform ${picked ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {picked && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-background">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </button>
                {/* Models — indented under the selected CLI, collapsed otherwise. */}
                {picked && models.length > 0 && (
                  <div className="ml-4 mt-1.5 flex flex-col gap-1.5 border-l-2 border-accent-border/40 pl-4">
                    <div className="flex items-center justify-between pt-0.5">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Model</span>
                      {pickedModel && (
                        <button
                          onClick={() => setOverride(modelKey, "")}
                          className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                        >
                          use cli default
                        </button>
                      )}
                    </div>
                    {models.map((m) => {
                      const mpicked = pickedModel === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setOverride(modelKey, m.id)}
                          className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                            mpicked
                              ? "border-accent bg-accent-soft"
                              : "border-border-subtle bg-background hover:border-accent-border"
                          }`}
                        >
                          <span className={`shrink-0 font-mono text-sm ${mpicked ? "font-semibold text-accent" : "text-text-primary"}`}>{m.label}</span>
                          {m.blurb && <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{m.blurb}</span>}
                          {mpicked && (
                            <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-background">
                              <Check className="h-2.5 w-2.5" strokeWidth={3} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PrefSection>

      {/* Framework + Lens — stacked full-width, one per row */}
      <PrefSection title="Framework & Lens" icon={<Compass className="h-4 w-4" />} subtitle={[pickedFw && pickedFw !== "none" ? "framework" : "", pickedLens && pickedLens !== "none" ? "lens" : ""].filter(Boolean).join(" + ") || "none set"}>
        <div className="grid grid-cols-1 gap-4">
          <PrefPickerColumn
            glyph="◆"
            title="Framework"
            options={FRAMEWORKS as readonly { id: string; label: string; blurb: string }[]}
            selected={pickedFw}
            onSelect={(id) => setOverride(fwKey, id)}
            onClear={() => setOverride(fwKey, "")}
          />
          <PrefPickerColumn
            glyph="◇"
            title="Lens"
            options={LENSES as readonly { id: string; label: string; blurb: string }[]}
            selected={pickedLens}
            onSelect={(id) => setOverride(lensKey, id)}
            onClear={() => setOverride(lensKey, "")}
          />
        </div>
      </PrefSection>

      {/* Skills — star-toggle list with avatars; collapsed by default, indented when open */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <button
          onClick={() => setSkillsOpen((v) => !v)}
          className="flex w-full items-start gap-2 text-left"
        >
          <ChevronRight className={`mt-1 h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${skillsOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
          <div className="flex-1">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Skills · {skills.length}</div>
            <p className="mt-0.5 text-sm text-text-secondary">
              Pinned skills auto-attach to every new chat in {titleCase(domain)}.
              <span className="ml-2 font-mono text-[10px] text-text-muted">★ pinned · ☆ tap to pin</span>
            </p>
          </div>
        </button>
        {skillsOpen && (skills.length === 0 ? (
          <div className="mt-3 ml-5 rounded border border-dashed border-border bg-background p-4 text-sm text-text-muted">
            No skills under <code className="text-accent">{titleCase(domain)}/skills/</code> yet.
          </div>
        ) : (
          <ul className="mt-3 ml-5 flex flex-col gap-1.5 border-l border-border-subtle pl-3">
            {skills.map((s) => {
              const on = preferredSkills.includes(s.name);
              const color = pickSkillColor(s.name);
              return (
                <li key={s.path} className="flex items-center gap-3 rounded-md border border-border-subtle bg-background px-3 py-2">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-display text-sm font-bold ring-1 ring-black/5"
                    style={{ background: color.bg, color: color.fg }}
                  >
                    {(s.name || "·").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm text-accent">/{s.name}</div>
                    {s.description && <div className="line-clamp-1 text-[11px] text-text-muted">{s.description}</div>}
                  </div>
                  <button
                    onClick={() => onTogglePreferredSkill(s.name)}
                    className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                      on
                        ? "border-accent-border bg-accent-soft text-accent"
                        : "border-border bg-background text-text-muted hover:border-accent-border hover:text-accent"
                    }`}
                  >
                    {on ? "★ pinned" : "☆ pin"}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </section>

      {/* Behavior toggles */}
      <PrefSection title="Behavior" icon={<SlidersHorizontal className="h-4 w-4" />} subtitle={autoState ? "Auto-attach on" : "Manual"}>
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-semibold text-text-primary">Auto-attach state.md</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {autoState
                ? "Each new chat starts with state.md as a context chip you can remove."
                : "Manual: drag the domain in or use the Context drawer to attach state.md."}
            </div>
          </div>
          <Toggle
            on={autoState}
            onChange={(v) => { lsSet(autoStateKey, v ? "1" : "0"); persistManifest({ autoState: v }); force(); }}
            label="Auto-attach state.md"
          />
        </div>
      </PrefSection>

      {/* Privacy — local-only (Ollama) pin → manifest.privacy.localOnly */}
      <PrefSection title="Privacy" icon={<Lock className="h-4 w-4" />} subtitle={localOnly ? "Local only" : "Standard"}>
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-semibold text-text-primary">Local-only (Ollama)</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {localOnly
                ? "Every prompt in this domain is forced through a local model: nothing leaves your machine."
                : "Off: prompts use the domain's configured CLI, which may call a cloud model."}
            </div>
          </div>
          <Toggle
            on={localOnly}
            onChange={(v) => {
              lsSet(localOnlyKey, v ? "1" : "0");
              persistManifestTop({ privacy: { localOnly: v } });
              force();
            }}
            label="Local-only (Ollama)"
          />
        </div>
      </PrefSection>

      {/* Sandbox — open | locked → manifest.sandbox.mode */}
      <PrefSection title="Sandbox" icon={<Box className="h-4 w-4" />} subtitle={sandboxMode === "locked" ? "Locked: read-only" : "Open: read + write"}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-secondary">
            {sandboxMode === "locked"
              ? "Locked: agents can read this domain but cannot write files or run shell side-effects."
              : "Open: agents can read and write within this domain's folder."}
          </p>
          <select
            value={sandboxMode}
            onChange={(e) => {
              const v = e.target.value === "locked" ? "locked" : "open";
              lsSet(sandboxKey, v);
              persistManifestTop({ sandbox: { mode: v } });
              force();
            }}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
          >
            <option value="open">open</option>
            <option value="locked">locked</option>
          </select>
        </div>
      </PrefSection>

      {/* M6: per-domain Ideal State — this domain's own target, layered under the
          global Ideal State (which wins on conflict). Injected into this domain's
          turns by the engine. */}
      <PrefSection
        title="Ideal state"
        icon={<Compass className="h-4 w-4" />}
        subtitle={domainIdeal.trim() ? "set" : "not set"}
      >
        {/* One per-domain target (ideal-state.md). The SAME field the Loops page
            uses as its gap-target; grounds every chat in this domain. */}
        <p className="mb-2.5 text-xs leading-relaxed text-text-muted">
          What a thriving <span className="font-medium text-text-secondary">{titleCase(domain)}</span> looks like. Grounds every {titleCase(domain)} chat (under your global Ideal State) and is the target every {titleCase(domain)} loop closes the gap to. One target, used everywhere.
        </p>
        <div className="rounded-xl border border-border-subtle bg-background p-1 transition-colors focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-border/20">
          <textarea
            value={domainIdeal}
            onChange={(e) => setDomainIdeal(e.target.value)}
            placeholder={`e.g. "${titleCase(domain)}: thriving, resilient, and on a clear upward path." Or let AI draft it from what it knows about your ${titleCase(domain)}.`}
            rows={4}
            disabled={draftingIdeal}
            className="w-full resize-y bg-transparent px-2.5 py-2 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted/70 disabled:opacity-60"
          />
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <button onClick={saveDomainIdeal} disabled={draftingIdeal} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Save
          </button>
          <button onClick={draftIdealWithAI} disabled={draftingIdeal}
            title={`Draft from what Prevail knows about your ${titleCase(domain)} — review before saving`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent hover:text-background disabled:opacity-50">
            {draftingIdeal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {draftingIdeal ? "Drafting…" : domainIdeal.trim() ? "Redraft with AI" : "Draft with AI"}
          </button>
          {domainIdealSaved && <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ok"><Check className="h-3 w-3" /> saved</span>}
        </div>
        {draftErr && <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">{draftErr}</div>}
      </PrefSection>

      {/* Channels / routing — domain name is always matched (A6); the input
          holds extra keywords → manifest.routing.keywords = [domain, ...extras] */}
      <PrefSection
        title="Channels & routing"
        icon={<Share2 className="h-4 w-4" />}
        subtitle={(() => { const n = 1 + keywordsRaw.split(",").map((s) => s.trim()).filter(Boolean).length; return `${n} keyword${n === 1 ? "" : "s"}`; })()}
      >
        <p className="mb-3 text-sm text-text-secondary">
          When a bridge (e.g. Telegram) receives a message, these keywords route it to {titleCase(domain)}.
          The domain name always matches; add extras below. Saved to the domain manifest.
        </p>
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-xs text-accent" title="Always matched: the domain name is a built-in keyword">
            <Pin className="h-3 w-3" /> {domain.toLowerCase()}
          </span>
          <span className="font-mono text-[10px] text-text-muted">always on</span>
        </div>
        <input
          defaultValue={keywordsRaw}
          key={`kw-${domain}-${manifestReady ? 1 : 0}`}
          placeholder="extra keywords: invoices, taxes, deductions…"
          onBlur={(e) => {
            const extras = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .filter((k) => k.toLowerCase() !== domain.toLowerCase());
            lsSet(keywordsKey, extras.join(", "));
            // Persist the domain name as the first keyword so routing always
            // matches it even when the user adds none.
            const full = [domain.toLowerCase(), ...extras].filter(
              (k, i, a) => a.indexOf(k) === i,
            );
            persistManifestTop({ routing: { keywords: full } });
            force();
          }}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:border-accent-border focus:outline-none"
          spellCheck={false}
        />
        <div className="mt-2 font-mono text-[10px] text-text-muted">
          Edits save when the field loses focus.
        </div>
      </PrefSection>

      <PrefSection title="Routines" icon={<Cpu className="h-4 w-4" />} subtitle={`${[daemonTaskgen, daemonReminders, daemonSkillgen].filter(Boolean).length}/3 on`}>
        <p className="mb-2.5 text-xs leading-relaxed text-text-muted">
          Background work Prevail does for {titleCase(domain)} on its own, even when the app is closed.
        </p>
        <div className="space-y-2">
          {([
            { on: daemonTaskgen, set: setDaemonTaskgen, key: "taskgen", icon: ChevronRight, title: "Task generation", desc: "Proactively writes tasks for this domain from your goals and memory." },
            { on: daemonReminders, set: setDaemonReminders, key: "reminders", icon: Cpu, title: "Reminders", desc: "Fires a notification when tasks in this domain are due or overdue." },
            { on: daemonSkillgen, set: setDaemonSkillgen, key: "skillgen", icon: Sparkles, title: "Skill learning", desc: "Distills reusable skills from this domain's conversations as you use it." },
          ] as const).map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.key} className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${r.on ? "border-accent-border/50 bg-accent-soft/15" : "border-border-subtle bg-surface"}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${r.on ? "bg-accent text-background" : "bg-surface-warm text-text-muted"}`}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">{r.title}</span>
                    <span className={`font-mono text-[9px] uppercase tracking-wider ${r.on ? "text-ok" : "text-text-muted"}`}>{r.on ? "on" : "off"}</span>
                  </div>
                  <div className="mt-0.5 text-xs leading-relaxed text-text-secondary">{r.desc}</div>
                </div>
                <Toggle on={r.on} onChange={(v) => { r.set(v); saveDaemonCfg({ [r.key]: v }); }} />
              </div>
            );
          })}
        </div>
      </PrefSection>
    </div>
  );
}
