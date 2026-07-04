// Chat-display leaf components extracted from App.tsx: ChatBubble (one rendered
// turn), MessageList (windowed transcript), DomainStatusBar, and DomainHome.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ListPlus, NotebookPen, Pin, Repeat, SlidersHorizontal, Sparkles, User, X } from "lucide-react";
import { invoke } from "./bridge";
import { FRAMEWORKS, LENSES, MODELS } from "./constants";
import { titleCase } from "./format";
import { splitThinking, vendorAccent } from "./helpers";
import { buildQuickActions, modelLabel } from "./helpers2";
import { PREF, getDomainToggle, getPref, incognitoActive, isBunkerOn, setDomainToggle, setPref } from "./storage";
import { ThinkingDisclosure, Toggle } from "./ui";
import { Markdown, StreamingPlain } from "./Markdown";
import { DomainAppsStrip, PreamblePicker, SkillsList, SurfacePanel, TasksPanel } from "./panels";
import { domainIcon } from "./icons";
import { ThinkingDots, ThinkingWord, useFrameworkLens } from "./hooks";
import { extractCliError, renderSkillTokens } from "./textutil";
import { ProviderMark } from "./marks";
import type { ChatMessage, DomainContextBundle, DomainToggle, RouteInfo } from "./types";

export const MESSAGE_WINDOW = 80;

// Coarse difficulty band for the learned-router bucket. Mirrors the engine's
// light/moderate/hard split (see route-learning.ts) so the desktop and the CLI
// agree on the bucket a preference is recorded against.
function routeBand(difficulty: number | undefined): "light" | "moderate" | "hard" {
  const d = typeof difficulty === "number" ? difficulty : 3;
  if (d <= 2) return "light";
  if (d === 3) return "moderate";
  return "hard";
}

// Routing chip for an Auto turn: shows the model the engine chose + why, with a
// one-click override that pins that concrete model as the runtime's default. The
// same click also feeds the LEARNED router: it emits a route-override signal so
// Auto personalizes this bucket (domain + difficulty band) over time.
//
// The "switch" affordance lets the user pick a DIFFERENT model than Auto's pick.
// That records a REAL from -> to preference (not a self-confirm) so the learned
// router actually learns, AND re-runs the turn with the chosen model (onRerun) so
// the user immediately gets the answer from their choice.
function RouteChip({ route, onRerun }: { route: RouteInfo; onRerun?: () => void }) {
  const [pinned, setPinned] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pct = Math.round((route.confidence ?? 0) * 100);
  const band = routeBand(route.difficulty);
  const pin = () => {
    if (!route.cli || !route.model) return;
    // Replace the "auto" default for this runtime with the concrete model, so the
    // next turn runs it directly (the composer reads this key live at send time).
    setPref(`prevail.model.${route.cli}`, route.model);
    window.dispatchEvent(new Event("prevail:models-refreshed"));
    // Feed the learned router: record that the user chose this model for this
    // bucket. A ChatPanel listener (which knows the domain + vault) persists it
    // via the route_learn_record engine command. Best-effort, never blocks.
    // from === to here: a confirm of Auto's own pick (no preference change).
    window.dispatchEvent(new CustomEvent("prevail:route-override", {
      detail: { band, fromModel: route.model, toModel: route.model },
    }));
    setPinned(true);
  };
  // Pick a DIFFERENT model than Auto chose. Records a genuine from -> to override
  // (so the learned router sees a real preference for this bucket) AND re-runs the
  // current turn with the chosen model.
  const pickModel = (toModel: string) => {
    setMenuOpen(false);
    if (!route.cli || !route.model || toModel === route.model) return;
    // The composer reads prevail.model.<cli> live at send time, so setting it here
    // makes the re-run below use the chosen model.
    setPref(`prevail.model.${route.cli}`, toModel);
    window.dispatchEvent(new Event("prevail:models-refreshed"));
    window.dispatchEvent(new CustomEvent("prevail:route-override", {
      detail: { band, fromModel: route.model, toModel },
    }));
    // Re-run this turn now so the user gets the answer from their chosen model.
    onRerun?.();
  };
  // Models available for this runtime, minus the Auto sentinel and Auto's own pick
  // (choosing the same model would be a no-op / confirm, which "pin" already does).
  const alternatives = (MODELS[route.cli] ?? []).filter((m) => m.id !== "auto" && m.id !== route.model);
  const detail = [route.reason, `${pct}% confidence`].filter(Boolean).join(" · ");
  return (
    <span
      className="relative inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent"
      title={`Auto routed to ${route.model} · ${detail}`}
    >
      <Sparkles className="h-2.5 w-2.5" />
      Auto <ArrowRight className="h-2.5 w-2.5" /> {modelLabel(route.cli, route.model)}
      {route.reason && <span className="hidden text-accent/70 sm:inline">· {route.reason}</span>}
      <button
        onClick={pin}
        title={pinned ? "Pinned as this runtime's default" : `Always use ${route.model} on ${route.cli}`}
        className="ml-0.5 rounded px-1 text-[9px] uppercase tracking-wider transition-colors hover:bg-accent hover:text-background"
      >
        {pinned ? "pinned" : "pin"}
      </button>
      {alternatives.length > 0 && onRerun && (
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="Pick a different model and re-run this turn"
          aria-label="Pick a different model"
          aria-expanded={menuOpen}
          className="flex items-center rounded px-0.5 text-[9px] uppercase tracking-wider transition-colors hover:bg-accent hover:text-background"
        >
          <SlidersHorizontal className="h-2.5 w-2.5" />
        </button>
      )}
      {menuOpen && (
        <>
          {/* Click-away backdrop so a click anywhere else closes the menu. */}
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[9rem] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
            <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-text-muted">Re-run with</div>
            {alternatives.map((m) => (
              <button
                key={m.id}
                onClick={() => pickModel(m.id)}
                title={m.blurb}
                className="block w-full px-2 py-1 text-left text-[11px] normal-case text-text-primary transition-colors hover:bg-accent hover:text-background"
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// Compact elapsed-time formatter for the step checklist ("18s", "2m 4s").
function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// The live "what is it doing" view under a running assistant bubble: an optional
// Plan header the model declared, then a checklist of the REAL steps as they run
// (Reading Gmail, Creating a Google Doc, Saving to Drive) with status + elapsed.
// A heartbeat re-renders each second while a step runs, so a long step reads
// "still working (18s)" instead of a dead spinner. Shown identically for app and
// domain chats (they share the message/stream path).
function StepChecklist({ msg, accent }: { msg: ChatMessage; accent: string }) {
  const steps = msg.steps ?? [];
  const plan = msg.plan ?? [];
  const running = steps.some((s) => s.status === "running");
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (steps.length === 0 && plan.length === 0) return null;
  const now = Date.now();
  return (
    <div className="mb-2.5 flex flex-col gap-1 rounded-lg border border-border-subtle bg-background/40 px-3 py-2">
      {plan.length > 0 && (
        <div className="mb-1 flex flex-col gap-0.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted">Plan</div>
          <ol className="flex flex-col gap-0.5">
            {plan.map((p, i) => (
              <li key={i} className="font-mono text-[11px] leading-relaxed text-text-secondary">{i + 1}. {p}</li>
            ))}
          </ol>
        </div>
      )}
      {steps.length > 0 && (
        <>
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted">
            {running ? "Working" : "Steps · verified"}
          </div>
          <div className="flex flex-col gap-0.5">
            {steps.map((s) => {
              const dur = elapsedLabel((s.endedAt ?? now) - s.startedAt);
              return (
                <div key={s.id} className="flex items-center gap-2 font-mono text-[11px] leading-relaxed">
                  <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {s.status === "running" ? (
                      <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
                    ) : s.status === "failed" ? (
                      <X className="h-3 w-3 text-warn" />
                    ) : (
                      <Check className="h-3 w-3" style={{ color: accent }} />
                    )}
                  </span>
                  <span className={s.status === "failed" ? "text-warn" : s.status === "running" ? "text-text-primary" : "text-text-secondary"}>
                    {s.label}
                  </span>
                  <span className="shrink-0 text-text-muted/70">· {dur}{s.status === "running" ? "…" : ""}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function ChatBubble({
  msg,
  onCopy,
  onRetry,
  onEdit,
  onMakeTask,
  onSaveNote,
  onPinMemory,
  onMakeLoop,
  onMakeSkill,
}: {
  msg: ChatMessage;
  onCopy?: (text: string) => void;
  onRetry?: () => void;
  onEdit?: (text: string) => void;
  onMakeTask?: (text: string) => void;
  onSaveNote?: (text: string) => void;
  onPinMemory?: (text: string) => void;
  onMakeLoop?: (text: string) => void;
  onMakeSkill?: (text: string) => void;
}) {
  // Small inline action button used on bubble hover. Stays muted by
  // default so the chat stays calm; lights up on hover.
  const ActionButton = ({
    label,
    title,
    onClick,
    icon,
  }: {
    label?: string;
    title: string;
    onClick: () => void;
    icon: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );

  // BP3 (06-27 feedback): a timestamp on every message (like the reference).
  const stamp = msg.ts ? new Date(msg.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  if (msg.role === "user") {
    // Right-aligned card with accent tint + tail. Hover reveals
    // Copy + Edit actions in a thin tray below the bubble.
    return (
      <div className="group mb-6 flex flex-col items-end">
        {/* BP3: "You · <time>" header with a person icon. */}
        <div className="mb-1 flex items-center gap-1.5 pr-1 text-[11px] text-text-muted">
          <span className="font-medium text-text-secondary">You</span>
          {stamp && <span>· {stamp}</span>}
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-accent"><User className="h-3 w-3" /></span>
        </div>
        <div className="max-w-[78%] rounded-2xl rounded-br-md border border-accent-border bg-surface-strong px-4 py-3 text-[15px] leading-relaxed text-text-primary shadow-sm">
          <div className="whitespace-pre-wrap">{renderSkillTokens(msg.content)}</div>
        </div>
        <div className="mt-1 flex h-5 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <ActionButton
            title="Copy message"
            label="Copy"
            onClick={() => onCopy?.(msg.content)}
            icon={<svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="4" y="4" width="9" height="10" rx="1.5" /><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10" /></svg>}
          />
          {onEdit && (
            <ActionButton
              title="Edit and resend"
              label="Edit"
              onClick={() => onEdit(msg.content)}
              icon={<svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M11.5 2.5l2 2-7 7-2.5.5.5-2.5 7-7z" /></svg>}
            />
          )}
          {onMakeTask && (
            <ActionButton
              title="Turn this into a task on your board"
              label="Task"
              onClick={() => onMakeTask(msg.content)}
              icon={<ListPlus className="h-3 w-3" />}
            />
          )}
          {onMakeLoop && (
            <ActionButton
              title="Turn this into a recurring automation in this domain"
              label="Automate"
              onClick={() => onMakeLoop(msg.content)}
              icon={<Repeat className="h-3 w-3" />}
            />
          )}
        </div>
      </div>
    );
  }
  // Assistant: left-aligned avatar + body. Hover reveals Copy + Retry.
  const vendor = msg.cli ?? "claude";
  const vendorName =
    vendor === "claude" ? "Claude"
    : vendor === "codex" ? "Codex"
    : vendor === "antigravity" ? "Antigravity"
    : vendor === "ollama" ? "Ollama"
    : vendor === "lmstudio" ? "LM Studio"
    : vendor === "mlx" ? "oMLX"
    : vendor;
  const empty = !msg.content && !msg.streaming;
  // Per-provider brand color for the name + bubble accent so each
  // model's turns are visually distinguishable at a glance.
  const { accent, tint } = vendorAccent(vendor);
  // The real failure reason from the CLI's stderr, if any.
  const cliError = empty ? extractCliError(msg.stderr) : null;
  // Brand styling only on normal replies - error bubbles keep the warn
  // palette so failures still read as failures.
  const bubbleStyle: React.CSSProperties = empty
    ? {}
    : { borderLeftColor: accent, borderLeftWidth: 3, background: tint };
  return (
    <div className="group mb-8 flex items-start gap-3">
      {/* BP3 (clarified): the Prevail logo is the assistant identity; the provider
          mark + model/lens/framework still appear as metadata in the header. */}
      <img src="/logo.png" alt="Prevail" className="h-8 w-8 shrink-0 rounded-lg shadow-sm" />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-secondary">
          <span className="font-display font-semibold tracking-tight text-text-primary">Assistant</span>
          <ProviderMark vendor={vendor} size={14} />
          <span className="font-display font-semibold tracking-tight" style={{ color: accent }}>{vendorName}</span>
          {/* I9: which model + how it was shaped (framework/lens) - so each turn
              is self-describing, not a mystery. */}
          {msg.role === "assistant" && msg.route && <RouteChip route={msg.route} onRerun={onRetry} />}
          {msg.role === "assistant" && msg.model && !msg.route && (
            <span className="font-mono text-[10px] lowercase text-text-muted" title={`Model: ${msg.model}`}>{modelLabel(msg.cli, msg.model)}</span>
          )}
          {msg.role === "assistant" && msg.framework && (
            <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted" title="Reasoning framework in effect">{msg.framework}</span>
          )}
          {msg.role === "assistant" && msg.lens && (
            <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted" title="Lens in effect">{msg.lens}</span>
          )}
          {/* BP3: timestamp on the assistant turn. */}
          {stamp && <span className="font-mono text-[10px] text-text-muted/70">· {stamp}</span>}
          {msg.streaming && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider" style={{ color: accent, background: tint }}>
              <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
              {msg.content ? "writing" : <ThinkingWord />}
            </span>
          )}
        </div>
        <div
          className={`rounded-2xl rounded-tl-md border px-4 py-3 text-[15px] leading-relaxed shadow-sm ${
            empty
              ? "border-warn/40 bg-warn/5"
              : "border-border-subtle bg-surface"
          }`}
          style={bubbleStyle}
        >
          <StepChecklist msg={msg} accent={accent} />
          {/* Back-compat: legacy persisted turns that only carried a flat toolLog. */}
          {(!msg.steps || msg.steps.length === 0) && msg.toolLog && msg.toolLog.length > 0 && (
            <div className="mb-2.5 flex flex-col gap-0.5 rounded-lg border border-border-subtle bg-background/40 px-3 py-2">
              <div className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted">Tools used · verified</div>
              {msg.toolLog.map((t, i) => (
                <div key={i} className="font-mono text-[11px] leading-relaxed text-text-secondary">{t}</div>
              ))}
            </div>
          )}
          {msg.content ? (
            msg.role === "assistant" ? (() => {
              const showThinking = getPref(PREF.showThinking, "1") === "1";
              const { thinking, answer } = splitThinking(msg.content);
              return (
                <>
                  {showThinking && thinking && <ThinkingDisclosure text={thinking} open={!answer} />}
                  {answer ? (msg.streaming ? <StreamingPlain source={answer} /> : <Markdown source={answer} />) : (!thinking && msg.streaming ? <ThinkingDots /> : null)}
                </>
              );
            })() : (
              <Markdown source={msg.content} />
            )
          ) : msg.streaming ? (
            <ThinkingDots />
          ) : (
            // Empty-reply fallback - explain + offer Retry instead of
            // dead "(empty reply)" text.
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-warn">
                  No output
                </div>
                {cliError ? (
                  <>
                    <p className="mt-1 text-sm text-text-secondary">
                      {vendorName} returned an error instead of a reply:
                    </p>
                    <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-warn/10 px-2 py-1.5 font-mono text-[11px] leading-snug text-warn">
                      {cliError}
                    </pre>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-text-secondary">
                    {vendorName} finished without producing any text. This usually means
                    the model rejected the prompt, hit a quota, or returned an error.
                  </p>
                )}
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}
          {msg.streaming && msg.content && <span className="cursor-blink text-accent">▌</span>}
        </div>
        {msg.content && (
          <div className="mt-1 flex h-5 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <ActionButton
              title="Copy reply"
              label="Copy"
              onClick={() => onCopy?.(msg.content)}
              icon={<svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="4" y="4" width="9" height="10" rx="1.5" /><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H10" /></svg>}
            />
            {onRetry && (
              <ActionButton
                title="Regenerate from the previous prompt"
                label="Retry"
                onClick={onRetry}
                icon={<svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M14 8a6 6 0 1 1-1.76-4.24" /><path d="M14 2v4h-4" /></svg>}
              />
            )}
            {onMakeTask && (
              <ActionButton
                title="Turn this reply into a task on your board"
                label="Task"
                onClick={() => onMakeTask(msg.content)}
                icon={<ListPlus className="h-3 w-3" />}
              />
            )}
            {onSaveNote && (
              <ActionButton
                title="Save this reply to your notes"
                label="Note"
                onClick={() => onSaveNote(msg.content)}
                icon={<NotebookPen className="h-3 w-3" />}
              />
            )}
            {onPinMemory && (
              <ActionButton
                title="Pin this to memory so it grounds future answers in this domain"
                label="Pin"
                onClick={() => onPinMemory(msg.content)}
                icon={<Pin className="h-3 w-3" />}
              />
            )}
            {onMakeSkill && (
              <ActionButton
                title="Save this as a reusable skill Prevail can replay"
                label="Skill"
                onClick={() => onMakeSkill(msg.content)}
                icon={<Sparkles className="h-3 w-3" />}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// COUNCIL PANEL

export function MessageList({ messages, resetKey, onCopy, onRetry, onEdit, onMakeTask, onSaveNote, onPinMemory, onMakeLoop, onMakeSkill }: {
  messages: ChatMessage[];
  resetKey: number;
  onCopy: (text: string) => void;
  onRetry: (i: number) => void;
  onEdit: (text: string, i: number) => void;
  onMakeTask?: (text: string) => void;
  onSaveNote?: (text: string) => void;
  onPinMemory?: (text: string) => void;
  onMakeLoop?: (text: string) => void;
  onMakeSkill?: (text: string) => void;
}) {
  const [limit, setLimit] = useState(MESSAGE_WINDOW);
  // Reset the window when the thread changes (switched/cleared) so a new thread
  // always opens at the latest messages, never inheriting a huge expanded window.
  useEffect(() => { setLimit(MESSAGE_WINDOW); }, [resetKey]);
  const start = Math.max(0, messages.length - limit);
  const shown = messages.slice(start);
  return (
    <>
      {start > 0 && (
        <div className="mb-4 flex justify-center">
          <button
            onClick={() => setLimit((l) => l + MESSAGE_WINDOW)}
            className="rounded-full border border-border bg-surface px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          >
            Show earlier messages ({start} hidden)
          </button>
        </div>
      )}
      {shown.map((m, idx) => {
        const i = start + idx;
        return (
          <ChatBubble
            key={i}
            msg={m}
            onCopy={onCopy}
            onRetry={m.role === "assistant" ? () => onRetry(i) : undefined}
            onEdit={m.role === "user" ? (text) => onEdit(text, i) : undefined}
            onMakeTask={onMakeTask}
            onSaveNote={m.role === "assistant" ? onSaveNote : undefined}
            onPinMemory={m.role === "assistant" ? onPinMemory : undefined}
            onMakeLoop={m.role === "user" ? onMakeLoop : undefined}
            onMakeSkill={m.role === "assistant" ? onMakeSkill : undefined}
          />
        );
      })}
    </>
  );
}

export function DomainStatusBar({
  domain,
  fwLens,
  surface = "chat",
  googleInContext = false,
  googleBound = null,
}: {
  domain: string | null;
  fwLens: ReturnType<typeof useFrameworkLens>;
  // Which surface this bar's Modes control - so Chat and Council share the same
  // Modes menu (incognito included) but toggle their own per-surface flag.
  surface?: "chat" | "council";
  // The Google account chip only appears once the Google app is actually in the
  // chat's context (dragged/attached) - keeping the composer clean otherwise.
  googleInContext?: boolean;
  // The attached app instance's account binding (manifest.account.label), when
  // it has one. A bound app already resolves WHICH identity to act as, so the
  // chip shows that identity instead of demanding a pick.
  googleBound?: string | null;
}) {
  // Hooks must be top-level - initialize state from localStorage once
  // per domain, then keep React state as the source of truth so toggles
  // re-render reliably.
  const [council, setCouncil]     = useState(false);
  const [web, setWeb]             = useState(true);
  const [save, setSave]           = useState(true);
  const [serendipity, setSeren]   = useState(false);
  const [auto, setAuto]           = useState(false);
  // Act mode: route this domain's sends through the agent runtime (real,
  // broker-gated tools + a Prevail-verified action ledger) instead of an
  // advisory text reply. Off by default — a normal chat stays a normal chat.
  const [act, setAct]             = useState(false);
  const [autoMode, setAutoMode]   = useState(() => getPref(`prevail.domain.${domain}.autoMode`, "smart"));
  // Google accounts: which connected profile(s) Act mode acts for. Multi-select
  // so you can work across two inboxes in one send (the agent labels results by
  // account). Persisted per-domain; read back in chatpanel.send() for Act runs.
  interface GProfile { label: string; email: string | null; status: string }
  const [gProfiles, setGProfiles] = useState<GProfile[]>([]);
  const [gSelected, setGSelected] = useState<string[]>(() => {
    try { return JSON.parse(getPref(`prevail.domain.${domain}.googleAccounts`, "[]")) as string[]; } catch { return []; }
  });
  const toggleGAccount = (label: string) => {
    setGSelected((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      setPref(`prevail.domain.${domain}.googleAccounts`, JSON.stringify(next));
      return next;
    });
  };
  // Incognito now lives in Modes (a plain model, none of your context sent). The
  // master switch (Settings: Privacy) can force it on globally.
  const [incognito, setIncognito] = useState(() => incognitoActive(surface));
  const globalIncognito = getPref(PREF.incognito, "0") === "1";
  const incogPref = surface === "council" ? PREF.incognitoCouncil : PREF.incognitoChat;
  const toggleIncognito = () => {
    if (globalIncognito) return; // forced on globally
    const next = !(getPref(incogPref, "0") === "1");
    setPref(incogPref, next ? "1" : "0");
    setIncognito(incognitoActive(surface));
    window.dispatchEvent(new Event("prevail:incognito-changed"));
  };
  useEffect(() => {
    // Loads for General too (domain null → the __general__ bucket).
    setCouncil(getDomainToggle(domain, "council", false));
    setWeb(getDomainToggle(domain, "web", true));
    setSave(getDomainToggle(domain, "save", true));
    setSeren(getDomainToggle(domain, "serendipity", false));
    setAuto(getDomainToggle(domain, "auto", false));
    setAct(getDomainToggle(domain, "act", false));
    setAutoMode(getPref(`prevail.domain.${domain}.autoMode`, "smart"));
    try { setGSelected(JSON.parse(getPref(`prevail.domain.${domain}.googleAccounts`, "[]")) as string[]); } catch { setGSelected([]); }
  }, [domain]);
  // The per-domain modes (web/save/serendipity/auto) live in a popover so the
  // composer row stays focused on the per-prompt Framework + Lens controls.
  const [modesOpen, setModesOpen] = useState(false);
  const modesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modesOpen) return;
    const onDoc = (e: MouseEvent) => { if (modesRef.current && !modesRef.current.contains(e.target as Node)) setModesOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [modesOpen]);
  // The Google account chooser is a TOP-LEVEL composer control (not buried in
  // Modes) so the active account is always visible and one click to change.
  const [gOpen, setGOpen] = useState(false);
  const gRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gOpen) return;
    const onDoc = (e: MouseEvent) => { if (gRef.current && !gRef.current.contains(e.target as Node)) setGOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [gOpen]);
  // Load connected Google profiles on mount (cheap, cached by gws) so the
  // top-level account chip can render. Only connected accounts show up.
  useEffect(() => {
    let alive = true;
    invoke<Array<{ label?: string; email?: string | null; status?: string }>>("google_profiles")
      .then((ps) => {
        if (!alive) return;
        const rows = (ps ?? [])
          .filter((p) => p && (p.status === "connected" || !!p.email) && !!p.label)
          .map((p) => ({ label: String(p.label), email: p.email ?? null, status: String(p.status ?? "unknown") }));
        setGProfiles(rows);
      })
      .catch(() => { /* no gws / no accounts — chip just stays hidden */ });
    return () => { alive = false; };
  }, []);
  // Bunker Mode forbids any request leaving the device, so Web access can never
  // be on while it's active. We show it off and locked regardless of the stored
  // preference (which is preserved for when Bunker Mode is turned back off). The
  // send path enforces the same coercion independently (see `web:` in prefs).
  const bunker = isBunkerOn();
  const webShown = bunker ? false : web;
  const incogOn = incognito || globalIncognito;
  const activeModes = [webShown, save, serendipity, auto, incogOn, act].filter(Boolean).length;

  const flip = (
    t: DomainToggle,
    cur: boolean,
    set: (v: boolean) => void,
  ) => {
    const next = !cur;
    set(next);
    setDomainToggle(domain, t, next);
    // Auto-council also lives in the engine config so the SAME escalation fires
    // when a host LLM calls prevail.chat over MCP, not only in this preview chat.
    if (t === "auto") {
      void invoke("set_auto_council", { domain: domain ?? "general", on: next }).catch(() => {});
    }
  };
  // One row of the Modes popover: name + one-line description on the left, a pill
  // toggle on the right that slides on/off.
  const ModeRow = ({
    label, on, desc, onClick, disabled,
  }: { label: string; on: boolean; desc: string; onClick: () => void; disabled?: boolean }) => (
    <div className="flex items-center gap-3 rounded-lg px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{label}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-text-muted">{desc}</div>
      </div>
      <Toggle on={on} onChange={onClick} label={label} disabled={disabled} />
    </div>
  );
  // The composer's "Council" pill is the action button - this strip is
  // for persistent per-domain settings only. Silence unused-var warnings.
  void council; void setCouncil;
  // Returns the pills as a fragment so they participate in the parent
  // composer toolbar's flex-wrap layout (no wrapper div). Framework
  // and Lens are global (always shown). Web / Save / Serendipity /
  // Auto are per-domain so they only render when a domain is selected.
  return (
    <>
      {/* Per-prompt reasoning controls - change often, so they sit inline.
          Each opens a labelled list so you pick directly. */}
      <PreamblePicker glyph="◆" label="Framework" options={FRAMEWORKS} selectedId={fwLens.framework} onSelect={fwLens.setFramework} />
      <PreamblePicker glyph="◇" label="Lens" options={LENSES} selectedId={fwLens.lens} onSelect={fwLens.setLens} />
      <div ref={modesRef} className="relative inline-flex items-center">
          <span className="mx-1 select-none text-text-muted/40">·</span>
          {/* Modes - set once, rarely changed, so they're tucked in a popover
              with an active-count badge instead of crowding the row. Available
              everywhere, including General (stored in its own bucket). */}
          <button
            onClick={() => setModesOpen((v) => !v)}
            title="Modes: web access, save history, serendipity, auto-council"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              modesOpen
                ? "border-accent-border bg-accent-soft text-accent"
                : "border-border bg-surface text-text-muted hover:bg-surface-warm hover:text-text-secondary"
            }`}
          >
            <SlidersHorizontal className="h-3 w-3" /> Modes
            {activeModes > 0 && (
              <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[10px] font-bold text-background">{activeModes}</span>
            )}
          </button>
          {modesOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
              <div className="px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Modes</div>
              <ModeRow label="Act mode" on={act} onClick={() => flip("act", act, setAct)}
                desc="Let this domain actually do things: create skills and loops in your vault, and queue emails for your approval. You see a verified list of exactly what ran." />
              <ModeRow label="Web access" on={webShown} disabled={bunker}
                onClick={() => { if (bunker) return; flip("web", web, setWeb); }}
                desc={bunker ? "Off in Bunker Mode - nothing leaves this device." : "Fetch URLs + web search while replying."} />
              <ModeRow label="Auto-council" on={auto} onClick={() => flip("auto", auto, setAuto)}
                desc="Convene the full council automatically for judgment calls." />
              <ModeRow label="Serendipity" on={serendipity} onClick={() => flip("serendipity", serendipity, setSeren)}
                desc="Invite lateral, off-topic angles." />
              <ModeRow label="Save history" on={save} onClick={() => flip("save", save, setSave)}
                desc="Log replies so you can re-read them later." />
              <ModeRow label="Incognito" on={incogOn} disabled={globalIncognito} onClick={toggleIncognito}
                desc={globalIncognito ? "Forced on in Privacy settings." : "Plain model: none of your context is sent."} />
              {auto && (
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Trigger</span>
                  <select
                    value={autoMode}
                    onChange={(e) => { setAutoMode(e.target.value); setPref(`prevail.domain.${domain}.autoMode`, e.target.value); }}
                    className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary"
                  >
                    <option value="smart">Smart: only judgment calls</option>
                    <option value="always">Always: every send</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
        {/* Top-level Google account chip - ONLY when the Google app is in this
            chat's context (dragged/attached). Keeps the composer clean until you
            actually bring Google in; then you pick which account(s) are active. */}
        {googleInContext && gProfiles.length > 0 && (
          <div ref={gRef} className="relative inline-flex items-center">
            <span className="mx-1 select-none text-text-muted/40">·</span>
            {/* With 2+ connected accounts and none picked, Prevail will refuse to
                guess which identity to act as - make the required pick visible
                here instead of only in the refusal message. */}
            <button
              onClick={() => setGOpen((v) => !v)}
              title={gProfiles.length > 1 && gSelected.length === 0 && !googleBound
                ? "Multiple Google accounts are connected - pick which one(s) this conversation acts as"
                : "Choose which Google account(s) this domain uses"}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                gOpen
                  ? "border-accent-border bg-accent-soft text-accent"
                  : gProfiles.length > 1 && gSelected.length === 0 && !googleBound
                    ? "border-warn/50 bg-warn/10 text-warn hover:bg-warn/15"
                    : "border-border bg-surface text-text-muted hover:bg-surface-warm hover:text-text-secondary"
              }`}
            >
              {(() => {
                const sel = gProfiles.filter((p) => gSelected.includes(p.label));
                // The attached app's own identity binding resolves the account
                // with no pick: show it (a pick in the popover still overrides).
                if (sel.length === 0 && googleBound) {
                  const bp = gProfiles.find((p) => p.label === googleBound);
                  const who = bp?.email || googleBound;
                  return (<><span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-background">{(who || "?").charAt(0).toUpperCase()}</span> <span className="normal-case">{who.split("@")[0] || who}</span></>);
                }
                if (sel.length === 0 && gProfiles.length > 1) return (<><span className="flex h-4 w-4 items-center justify-center rounded-full bg-warn/20 text-[9px] font-bold text-warn">G</span> Pick account</>);
                if (sel.length === 0) return (<><span className="flex h-4 w-4 items-center justify-center rounded-full bg-surface-warm text-[9px] font-bold text-text-secondary">G</span> Google</>);
                if (sel.length === 1) { const who = sel[0].email || sel[0].label; return (<><span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-background">{(who || "?").charAt(0).toUpperCase()}</span> <span className="normal-case">{who.split("@")[0] || who}</span></>); }
                return (<><span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-background">{sel.length}</span> accounts</>);
              })()}
            </button>
            {gOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                <div className="px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Active Google accounts</div>
                <div className="mb-1 px-2.5 text-[11px] leading-snug text-text-muted">Check the account(s) to keep active in this conversation. Check more than one to work across inboxes at once.</div>
                <div className="flex flex-col gap-1 p-1">
                  {gProfiles.map((p) => {
                    const on = gSelected.includes(p.label);
                    const who = p.email || p.label;
                    const initial = (who || "?").charAt(0).toUpperCase();
                    return (
                      <button
                        key={p.label}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleGAccount(p.label)}
                        title={`${p.label}${p.email ? ` — ${p.email}` : ""}`}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-left transition-colors ${
                          on ? "border-accent-border bg-accent-soft" : "border-border bg-surface hover:bg-surface-warm"
                        }`}
                      >
                        {/* Explicit checkbox so multi-select is obvious. */}
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on ? "border-accent bg-accent text-background" : "border-border bg-surface"
                        }`}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          on ? "bg-accent text-background" : "bg-surface-warm text-text-secondary"
                        }`}>{initial}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">{who}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}

export function DomainHome({
  domain,
  vaultPath,
  isApp,
  onInjectContext,
  onPickPrompt,
  onInsertSkill,
  preferredSet,
  onTogglePreferred,
}: {
  domain: string;
  vaultPath: string;
  // When an app is open we reuse DomainHome for the conversation body but hide
  // the "apps refreshing this domain" strip - that's a domain view, and an app
  // shouldn't list its sibling apps.
  isApp?: boolean;
  onInjectContext: (body: string, label: string) => void;
  onPickPrompt: (text: string) => void;
  onInsertSkill: (name: string) => void;
  preferredSet: Set<string>;
  onTogglePreferred: (name: string) => void;
}) {
  type Tab = "chat" | "state" | "decisions" | "journal" | "logs" | "skills";
  // Chat is the default - state is already auto-loaded as context, so
  // we don't dump the user into the state doc on entry.
  const [tab, setTab] = useState<Tab>("chat");
  const [ctx, setCtx] = useState<DomainContextBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskNonce, setTaskNonce] = useState(0); // bump to reload the tasks panel
  // Starter prompts from the domain's PROMPTS.md (written by pack import) - the
  // one-click conversation starters that make an imported pack chat-ready.
  const [starterPrompts, setStarterPrompts] = useState<string[]>([]);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => { if (mounted) setCtx(c); })
      .catch(() => { if (mounted) setCtx(null); })
      .finally(() => { if (mounted) setLoading(false); });
    invoke<string[]>("read_domain_prompts", { vault: vaultPath, domain })
      .then((ps) => { if (mounted) setStarterPrompts(ps); })
      .catch(() => { if (mounted) setStarterPrompts([]); });
    return () => { mounted = false; };
  }, [vaultPath, domain]);

  const counts = {
    state: ctx?.state ? 1 : 0,
    decisions: ctx?.decisions ? 1 : 0,
    journal: ctx?.journal ? 1 : 0,
    logs: ctx?.recent_logs.length ?? 0,
    skills: ctx?.skills.length ?? 0,
  };
  const Icon = domainIcon(domain);

  // Suppress unused warning - kept for future read-only views.
  void onInjectContext;
  void Icon;
  // Domain title lives in the ChatPanel header above; here we go
  // straight to the tab strip. Avoids the duplicate "Estate · Estate"
  // problem the user flagged.
  // ChatPanel owns the persistent tab strip now; DomainHome just
  // renders the body for whichever tab the user has selected.
  void tab; void setTab; void counts;
  return (
    <div className="flex h-full w-full flex-col px-6 py-6">
      <div className="flex-1 overflow-y-auto">
        {!isApp && <DomainAppsStrip domain={domain} />}
        {loading && <div className="text-sm text-text-muted">loading domain context…</div>}
        {!loading && ctx && (
          <div>
            {tab === "chat" && (
              <div className="w-full">
                {starterPrompts.length > 0 && (
                  <div className="mb-3 rounded-xl border border-accent-border bg-accent-soft p-3">
                    <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
                      <Sparkles className="h-3 w-3" /> Start a conversation
                    </div>
                    <div className="flex flex-col gap-1">
                      {starterPrompts.map((p, i) => (
                        <button
                          key={i}
                          onClick={() => onPickPrompt(p)}
                          className="group flex items-center gap-2 rounded-lg border border-accent-border/60 bg-background px-3 py-1.5 text-left text-sm text-text-secondary hover:border-accent hover:text-text-primary"
                        >
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-accent opacity-60 group-hover:opacity-100" />
                          <span className="truncate">{p}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <SurfacePanel vaultPath={vaultPath} domain={domain} onPick={onPickPrompt}
                  onAddTask={async (t) => { try { await invoke("tasks_add", { vault: vaultPath, domain, text: t, source: "surface" }); setTaskNonce((n) => n + 1); } catch (e) { console.error("tasks_add", e); } }} />
                <TasksPanel vaultPath={vaultPath} domain={domain} nonce={taskNonce} />
                {/* Quick actions - compact single-line rows (label + one-line prompt)
                    so the home fits without scrolling; full prompt on hover. */}
                <ul className="mt-2 flex flex-col gap-1">
                {buildQuickActions(domain).map((q) => (
                  <li key={q.label}>
                    <button
                      title={q.prompt}
                      onClick={() => q.council
                        ? window.dispatchEvent(new CustomEvent("prevail:council-seed", { detail: { domain, prompt: q.prompt } }))
                        : onPickPrompt(q.prompt)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
                    >
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-accent"><span className="mr-1">{q.glyph}</span>{q.label}</span>
                      {q.council && <span className="shrink-0 rounded-full border border-accent-border bg-accent-soft px-1.5 py-0 font-mono text-[10px] uppercase tracking-wider text-accent">→ Council</span>}
                      <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{q.prompt}</span>
                    </button>
                  </li>
                ))}
                </ul>
              </div>
            )}
            {tab === "state" && (
              ctx.state ? (
                <Markdown source={ctx.state} />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no <code className="text-accent">state.md</code> in this domain.
                </div>
              )
            )}
            {tab === "decisions" && (
              ctx.decisions ? (
                <Markdown source={ctx.decisions} />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no <code className="text-accent">decisions.md</code> yet.
                </div>
              )
            )}
            {tab === "journal" && (
              ctx.journal ? (
                <Markdown source={ctx.journal} />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no journal entries yet: they accumulate as you save sessions.
                </div>
              )
            )}
            {tab === "logs" && (
              ctx.recent_logs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no past sessions. Start chatting: each "New chat" saves a session to _log/.
                </div>
              ) : (
                <ul className="space-y-2">
                  {ctx.recent_logs.map((l) => (
                    <li key={l.path}>
                      <button
                        onClick={async () => {
                          try {
                            const body = await invoke<string>("read_file", { path: l.path });
                            onInjectContext(body, l.name);
                            setTab("chat");
                          } catch (e) { console.error(e); }
                        }}
                        className="block w-full rounded-lg border border-border bg-surface p-3 text-left hover:border-accent-border hover:bg-surface-warm"
                      >
                        <div className="font-mono text-sm text-text-primary">{l.name}</div>
                        {l.preview && <div className="mt-1 line-clamp-2 text-xs text-text-muted">{l.preview}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === "skills" && (
              ctx.skills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no skills in <code className="text-accent">{titleCase(domain)}/skills/</code>.
                </div>
              ) : (
                <SkillsList
                  skills={ctx.skills}
                  onInsert={(name) => { onInsertSkill(name); setTab("chat"); }}
                  preferredSet={preferredSet}
                  onTogglePreferred={onTogglePreferred}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* The "Quick prompts" block below was a duplicate; tab-driven
          UI above now hosts them under the Chat tab. Keep an empty
          render for backward compat. */}
      <div className="hidden">
        <div className="grid w-full grid-cols-1 gap-2">
          {buildQuickActions(domain).map((q) => (
            <button
              key={q.label}
              onClick={() => onPickPrompt(q.prompt)}
              className="rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
            >
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent">
                <span>{q.glyph}</span> {q.label}
              </div>
              <div className="mt-1 line-clamp-2 text-sm text-text-secondary">
                {q.prompt}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
