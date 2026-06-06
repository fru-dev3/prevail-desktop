import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders LLM output as proper markdown — headings, lists, bold,
// inline code, fenced blocks, tables. Wraps each block element in
// `prose`-like Tailwind so the spacing reads.
// Code-fence renderer for ReactMarkdown — multi-line blocks get a
// card with a language label + copy button at the top-right;
// inline `code` stays as a plain <code>. Stable component identity
// (declared at module scope) so React doesn't reuse stale closures.
function MarkdownCode(props: React.HTMLAttributes<HTMLElement> & { className?: string; children?: React.ReactNode }) {
  const { className, children, ...rest } = props;
  // ReactMarkdown gives us a className like "language-ts" for fenced
  // blocks and no className for inline code. We use the presence of
  // a newline in the body as a backup signal because some prompts
  // emit triple-backtick blocks with no language.
  const text = typeof children === "string"
    ? children
    : Array.isArray(children)
      ? children.map((c) => (typeof c === "string" ? c : "")).join("")
      : "";
  const lang = (className ?? "").replace(/^language-/, "") || "code";
  const isBlock = (className && className.startsWith("language-")) || text.includes("\n");
  if (!isBlock) {
    return <code className={className} {...rest}>{children}</code>;
  }
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border-subtle bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-warm px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{lang}</span>
        <button
          onClick={() => { void navigator.clipboard.writeText(text); }}
          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted transition-colors hover:border-accent-border hover:text-accent"
        >
          copy
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-text-primary">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const MARKDOWN_COMPONENTS = { code: MarkdownCode } as const;

const Markdown = React.memo(function Markdown({ source, compact = false }: { source: string; compact?: boolean }) {
  // Two flavors: default (chat reply) and compact (state/decisions/
  // journal). Compact mode is denser, sans-serif headings, smaller
  // bullets, no emoji bloat — looks like a real doc, not AI slop.
  //
  // Memoized so that re-rendering a parent doesn't force ReactMarkdown
  // to reparse the source string. During streaming, each new chunk
  // creates a new source string anyway — that's intentional. But
  // sibling re-renders (hover state, neighbor message updates) no
  // longer redo the parse.
  return (
    <div
      className={`prose-prevail max-w-none ${compact ? "prose-prevail--compact" : ""}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{source}</ReactMarkdown>
    </div>
  );
});

// Single source of truth for the version chip in title bar.
const APP_VERSION = "0.2.92";

// Canonical on/off toggle. Track 36×20px, thumb 16×16px, slides
// 18px. Every switch in the app routes through this so we never
// drift back into bespoke implementations that misalign the thumb.
function Toggle({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-accent" : "bg-surface-strong"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
          on ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// VS Code-style quick switcher modal. Centered overlay, single
// search input at the top, combined list of domains + recent
// threads (loaded async from each domain's _threads/ dir).
//
// Arrow keys navigate, Enter picks, Esc dismisses. Click outside
// also dismisses. Items are sorted: domains first, then threads
// newest-first, with fuzzy substring filtering.
function QuickSwitcher({
  vaultPath,
  domains,
  onClose,
  onPickDomain,
  onPickThread,
}: {
  vaultPath: string;
  domains: Domain[];
  onClose: () => void;
  onPickDomain: (name: string) => void;
  onPickThread: (domain: string | null, path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [allThreads, setAllThreads] = useState<Array<{ domain: string | null; meta: ThreadMeta }>>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load every domain's threads once on mount. Vault-root threads
  // (no-domain) are loaded with domain=null.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const collected: Array<{ domain: string | null; meta: ThreadMeta }> = [];
      const tasks: Promise<void>[] = [];
      const fetchOne = async (name: string | null) => {
        try {
          const rows = await invoke<ThreadMeta[]>("list_threads", { vault: vaultPath, domain: name });
          for (const r of rows) collected.push({ domain: name, meta: r });
        } catch { /* ignore — empty dir is fine */ }
      };
      tasks.push(fetchOne(null));
      for (const d of domains) tasks.push(fetchOne(d.name));
      await Promise.all(tasks);
      if (cancelled) return;
      collected.sort((a, b) => b.meta.updated - a.meta.updated);
      setAllThreads(collected);
    })();
    return () => { cancelled = true; };
  }, [vaultPath, domains]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Combined filtered list. Domains first, then threads. Each item
  // gets a stable id so cursor highlight survives filter changes.
  type Item =
    | { kind: "domain"; id: string; label: string; sub: string }
    | { kind: "thread"; id: string; label: string; sub: string; domain: string | null; path: string };
  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (s: string) => !q || s.toLowerCase().includes(q);
    const out: Item[] = [];
    for (const d of domains) {
      const label = titleCase(d.name);
      const sub = d.state_preview ? d.state_preview.slice(0, 80).replace(/\n/g, " ") : "domain";
      if (matches(label) || matches(d.name) || matches(sub)) {
        out.push({ kind: "domain", id: `d:${d.name}`, label, sub });
      }
    }
    for (const t of allThreads) {
      const label = t.meta.title || t.meta.slug;
      const where = t.domain ? titleCase(t.domain) : "no domain";
      const sub = `${where} · ${t.meta.turn_count} turns`;
      if (matches(label) || matches(t.meta.preview) || matches(where)) {
        out.push({ kind: "thread", id: `t:${t.meta.path}`, label, sub, domain: t.domain, path: t.meta.path });
      }
    }
    return out;
  }, [query, domains, allThreads]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    // Scroll selected into view.
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function pick(it: Item) {
    if (it.kind === "domain") onPickDomain(it.id.slice(2));
    else onPickThread(it.domain, it.path);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
        else if (e.key === "Enter") { e.preventDefault(); const it = items[cursor]; if (it) pick(it); }
      }}
    >
      <div className="mt-24 w-[560px] max-w-[90vw] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <span className="text-text-muted">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a domain or thread…"
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">⌘P</span>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-text-muted">
              {allThreads.length === 0 && domains.length === 0 ? "loading…" : "no matches"}
            </div>
          )}
          {items.map((it, i) => {
            const active = i === cursor;
            return (
              <button
                key={it.id}
                data-idx={i}
                onClick={() => pick(it)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                  active ? "bg-accent-soft" : "hover:bg-surface-warm"
                }`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[11px] ${
                  it.kind === "domain"
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-warm text-text-secondary"
                }`}>
                  {it.kind === "domain" ? "◆" : "▶"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-display text-sm font-semibold tracking-tight ${active ? "text-accent" : "text-text-primary"}`}>
                    {it.label}
                  </div>
                  <div className="truncate font-mono text-[10px] text-text-muted">{it.sub}</div>
                </div>
                <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                  {it.kind}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-border-subtle px-4 py-1.5 font-mono text-[10px] text-text-muted">
          <span>↑↓ navigate · ↵ open · ⎋ close</span>
          <span>{items.length} {items.length === 1 ? "result" : "results"}</span>
        </div>
      </div>
    </div>
  );
}

// Per-CLI model quickpicks. Picked in Settings → Defaults and per-
// session in Council. Display labels are friendly, ids are passed
// through to the CLI's --model flag.
interface ModelPick {
  id: string;
  label: string;
  blurb?: string;
}
const MODELS: Record<string, ModelPick[]> = {
  claude: [
    { id: "opus",              label: "Opus (latest)",  blurb: "alias · auto-upgrades" },
    { id: "claude-opus-4-8",   label: "Opus 4.8",       blurb: "current flagship" },
    { id: "claude-opus-4-7",   label: "Opus 4.7",       blurb: "previous flagship" },
    { id: "claude-opus-4-6",   label: "Opus 4.6",       blurb: "legacy flagship" },
    { id: "sonnet",            label: "Sonnet (latest)", blurb: "alias · balanced" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6",     blurb: "balanced workhorse" },
    { id: "haiku",             label: "Haiku (latest)", blurb: "alias · fast + cheap" },
    { id: "claude-haiku-4-5",  label: "Haiku 4.5",      blurb: "fastest, cheapest" },
  ],
  codex: [
    // ChatGPT-account users: gpt-5.5 is the only model that works
    // — every gpt-5 / gpt-4o / o-series variant returns
    // "model not supported when using Codex with a ChatGPT account".
    // gpt-5 family kept for users with API-key or Pro access.
    { id: "gpt-5.5",     label: "GPT-5.5",       blurb: "current flagship · works on ChatGPT login" },
    { id: "gpt-5-codex", label: "GPT-5 Codex",   blurb: "API / Pro only" },
    { id: "gpt-5",       label: "GPT-5",         blurb: "API / Pro only" },
    { id: "gpt-5-high",  label: "GPT-5 (high)",  blurb: "API / Pro · extra reasoning" },
    { id: "gpt-5-mini",  label: "GPT-5 mini",    blurb: "API / Pro · fast + cheap" },
  ],
  antigravity: [
    { id: "Gemini 3.1 Pro (High)",        label: "Gemini 3.1 Pro (High)",        blurb: "extra reasoning" },
    { id: "Gemini 3.1 Pro (Low)",         label: "Gemini 3.1 Pro (Low)",         blurb: "flagship · less reasoning" },
    { id: "Gemini 3.5 Flash (High)",      label: "Gemini 3.5 Flash (High)",      blurb: "fast + reasoning" },
    { id: "Gemini 3.5 Flash (Medium)",    label: "Gemini 3.5 Flash (Medium)",    blurb: "balanced" },
    { id: "Gemini 3.5 Flash (Low)",       label: "Gemini 3.5 Flash (Low)",       blurb: "fastest" },
    { id: "Claude Sonnet 4.6 (Thinking)", label: "Claude Sonnet 4.6 (Thinking)", blurb: "via Antigravity" },
    { id: "Claude Opus 4.6 (Thinking)",   label: "Claude Opus 4.6 (Thinking)",   blurb: "via Antigravity" },
    { id: "GPT-OSS 120B (Medium)",        label: "GPT-OSS 120B (Medium)",        blurb: "open model" },
  ],
  ollama: [
    { id: "llama3.2", label: "Llama 3.2",  blurb: "local · meta" },
    { id: "qwen2.5",  label: "Qwen 2.5",   blurb: "local · alibaba" },
    { id: "mistral",  label: "Mistral 7B", blurb: "local · mistral" },
  ],
};
import {
  ArrowLeft,
  ArrowUpRight,
  Award,
  BookOpen,
  Brain,
  Briefcase,
  Calendar as CalendarIcon,
  Check,
  Compass,
  Crown,
  Eye,
  FileText,

  Folder,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Github,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  Paperclip,
  PenLine,
  Pin,
  Plus,
  Receipt,
  Scale,
  Send,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

// Context-relevant icons per life-domain slug. Anything not matched
// falls back to the diamond glyph in render so unknown domains still
// look intentional.
const DOMAIN_ICONS: Record<string, LucideIcon> = {
  tax: Receipt,
  taxes: Receipt,
  wealth: TrendingUp,
  finance: TrendingUp,
  finances: TrendingUp,
  health: Heart,
  fitness: Heart,
  "real-estate": Home,
  realestate: Home,
  home: Home,
  estate: Home,
  insurance: Shield,
  security: Shield,
  business: Briefcase,
  career: Briefcase,
  work: Briefcase,
  content: PenLine,
  brand: Award,
  benefits: Gift,
  calendar: CalendarIcon,
  schedule: CalendarIcon,
  vision: Eye,
  chief: Crown,
  learning: GraduationCap,
  learn: GraduationCap,
  education: GraduationCap,
  records: FileText,
  logs: FileText,
  social: Users,
  family: Users,
  intel: Brain,
  intelligence: Brain,
  explore: Compass,
  exploration: Compass,
  travel: Compass,
  research: BookOpen,
  books: BookOpen,
  reading: BookOpen,
};

function domainIcon(name: string): LucideIcon | null {
  return DOMAIN_ICONS[name.toLowerCase()] ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Provider brand marks. Real SVG glyphs from simple-icons (MIT) for
// Anthropic/Claude and Ollama. OpenAI's mark isn't in simple-icons due
// to trademark policy, so we render a faithful version. Antigravity is
// Google's CLI, so we render the multicolor "G" wordmark.

import {
  siClaude as siClaudeRaw,
  siOllama as siOllamaRaw,
} from "simple-icons";

const siClaude = siClaudeRaw as { path: string };
const siOllama = siOllamaRaw as { path: string };

const VENDOR_BRAND: Record<string, { hex: string; name: string }> = {
  claude:      { hex: "#cc785c", name: "Anthropic Claude" },
  codex:       { hex: "#10a37f", name: "OpenAI Codex" },
  antigravity: { hex: "#ffffff", name: "Google Antigravity" },
  ollama:      { hex: "#0a0a0a", name: "Ollama (local)" },
  other:       { hex: "#6b7280", name: "—" },
};

function ProviderMark({ vendor, size = 28 }: { vendor: string; size?: number }) {
  const v = VENDOR_BRAND[vendor] ?? VENDOR_BRAND.other;
  const glyphSize = Math.round(size * 0.62);
  let inner: React.ReactNode;
  let bg = v.hex;
  switch (vendor) {
    case "claude":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d={siClaude.path} />
        </svg>
      );
      break;
    case "codex":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973l-.001.142v5.518a.79.79 0 0 0 .388.677l5.815 3.354-2.02 1.168a.075.075 0 0 1-.071 0l-4.83-2.788a4.504 4.504 0 0 1-1.647-6.098zm16.597 3.855L13.116 8.38 15.131 7.22a.071.071 0 0 1 .07 0l4.83 2.792a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.394-.674zm2.01-3.023l-.142-.085-4.774-2.781a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.659 4.139l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
        </svg>
      );
      break;
    case "antigravity":
      // White tile with the four-color Google G so the brand stays
      // true on any background.
      bg = "#ffffff";
      inner = (
        <svg viewBox="0 0 48 48" width={glyphSize} height={glyphSize} aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 0-24 11.9 11.9 0 0 1 8.5 3.3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12a11.9 11.9 0 0 1 8.5 3.3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.3a11.9 11.9 0 0 1-7.3 2.5 12 12 0 0 1-11.3-8L6.1 33A20 20 0 0 0 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12.1 12.1 0 0 1-4.1 5.5l6.2 5.3c.4-.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
      );
      break;
    case "ollama":
      inner = (
        <svg viewBox="0 0 24 24" width={glyphSize} height={glyphSize} fill="white" aria-hidden="true">
          <path d={siOllama.path} />
        </svg>
      );
      break;
    default:
      inner = <span className="font-mono text-white">·</span>;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md ring-1 ring-black/5"
      style={{ background: bg, height: size, width: size }}
      title={v.name}
    >
      {inner}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Types matching the Rust commands in src-tauri/src/lib.rs

// Thread types — match Rust ThreadMeta / ThreadTurn / ThreadFull.
interface ThreadMeta {
  path: string;
  slug: string;
  title: string;
  domain: string | null;
  created: number;
  updated: number;
  turn_count: number;
  preview: string;
}
interface ThreadTurn {
  role: "user" | "assistant";
  cli: string | null;
  model: string | null;
  content: string;
}

interface DomainLogEntry {
  name: string;
  path: string;
  mtime_secs: number;
  preview: string;
}
interface DomainContextBundle {
  state: string | null;
  decisions: string | null;
  journal: string | null;
  recent_logs: DomainLogEntry[];
  skills: { domain: string; name: string; path: string; description: string | null }[];
}

interface Domain {
  name: string;
  path: string;
  has_state: boolean;
  state_preview: string | null;
}

interface CliInfo {
  id: string;
  label: string;
  bin: string;
  available: boolean;
  version?: string | null;
}

interface BenchmarkRun {
  label: string;
  run_dir: string;
  judge_avg: number | null;
  keyword_avg: number | null;
  questions: number;
}

interface QuestionScore {
  id: string;
  domain: string;
  keyword_score: number | null;
  keyword_hits: string[];
  keyword_misses: string[];
  judge_score: number | null;
  judge_rationale: string | null;
}

interface RunDetail {
  records: Array<{
    id: string;
    prompt: string;
    reply: string;
    expected_decision?: string;
    expected_verdict_keywords?: string[];
    ms: number;
    cli?: string;
    model?: string;
    ok: boolean;
  }>;
  score: {
    label: string;
    runDir: string;
    questionScores: QuestionScore[];
    keyword_avg: number | null;
    judge_avg: number | null;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Frameworks + Lenses — kept in sync with the CLI's src/framework.ts
// and src/lens.ts. When the user picks one, the instruction gets
// prepended to every prompt as a bracketed preamble before the CLI
// is spawned.

interface Framework {
  id: string;
  label: string;
  blurb: string;
  instruction: string;
}
const FRAMEWORKS: Framework[] = [
  { id: "none", label: "OFF", blurb: "No framework — model's default response shape", instruction: "" },
  { id: "bluf", label: "BLUF", blurb: "Bottom Line Up Front — lead with the answer", instruction: "Apply the BLUF framework. Your first sentence MUST be the bottom line — the single most important conclusion or recommendation. Then provide supporting context in 1-3 short paragraphs. Never bury the conclusion under context." },
  { id: "win", label: "WIN", blurb: "What's Important Now — name the ONE next move", instruction: "Apply the WIN (What's Important Now) framework. Identify the ONE most important next move the user should make. State that move in the first sentence. Drop everything that doesn't directly serve that next step." },
  { id: "scqa", label: "SCQA", blurb: "Situation → Complication → Question → Answer", instruction: "Structure your response as SCQA: a one-line Situation, a one-line Complication, a one-line Question, then a decisive Answer." },
  { id: "sbar", label: "SBAR", blurb: "Situation · Background · Assessment · Recommendation", instruction: "Structure your response as SBAR: Situation, Background, Assessment, Recommendation. Each in 1-2 lines max." },
  { id: "ooda", label: "OODA", blurb: "Observe → Orient → Decide → Act", instruction: "Structure your response as an OODA loop: Observe, Orient, Decide, Act. Each step labelled and one line." },
  { id: "proscons", label: "PROS/CONS", blurb: "Structured trade-off with weight", instruction: "Structure your response as a PROS/CONS analysis. Two columns. End with a one-line Weight verdict naming the winner." },
  { id: "steelman", label: "STEELMAN", blurb: "Strongest version of the other side first", instruction: "Steelman the opposing position first — give it the strongest framing you can. Then give your verdict." },
];

interface Lens {
  id: string;
  label: string;
  blurb: string;
  instruction: string;
}
const LENSES: Lens[] = [
  { id: "none", label: "OFF", blurb: "No lens — single response, default angle", instruction: "" },
  { id: "first-principles", label: "FIRST PRINCIPLES", blurb: "Strip the problem to fundamentals", instruction: "Approach this problem from first principles. Forget conventional wisdom, prior advice, industry best practice, or what 'most people do.' Strip the problem to its fundamental mechanics and rebuild the answer from there." },
  { id: "outsider", label: "OUTSIDER", blurb: "Challenge the thinking; ignore prior context", instruction: "Approach this as a complete outsider with no prior context. Challenge every assumption that the question seems to bake in." },
  { id: "contrarian", label: "CONTRARIAN", blurb: "Argue the strongest case against the obvious answer", instruction: "Argue the strongest possible case against the obvious or expected answer. Don't be devil's advocate — actually pressure-test the consensus until something cracks." },
  { id: "expansionist", label: "EXPANSIONIST", blurb: "What's the bigger version of this question?", instruction: "Don't answer the question as asked. First ask: what's the bigger version of this question? Then answer THAT." },
  { id: "executor", label: "EXECUTOR", blurb: "Skip the framing — literal next step today", instruction: "Skip all framing. The user wants the literal next step they should take today. State the action in one imperative sentence, then list 2-3 concrete tasks." },
  { id: "alien", label: "ALIEN", blurb: "An outsider notices what's obvious to you", instruction: "You are an alien observer with no familiarity with this user's biases. State what is plainly obvious about their situation that they themselves are too close to see." },
  { id: "mom", label: "MOM", blurb: "Plain English — what would she actually do?", instruction: "Answer as a wise mom would — plain English, no jargon, sentimentally honest, practical. What would she actually tell her child to do?" },
  { id: "dad", label: "DAD", blurb: "Hard-nosed — what's the trap you're not seeing?", instruction: "Answer as a hard-nosed dad would — direct, no coddling. Name the trap the user is not seeing. Tell them what they will regret in 10 years if they get this wrong." },
];

// ─────────────────────────────────────────────────────────────────────
// Top-level tabs

// Top-level tabs. Council is NOT its own tab — it's a mode toggle
// inside Chat. Tools is NOT its own tab — it's a section inside
// Settings. Keeps the surface count low so each tab has a clear job.
type TabId = "chat" | "council" | "benchmark" | "settings";
const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Conversation", icon: MessageSquare },
  { id: "council", label: "Council", icon: Scale },
  { id: "benchmark", label: "Benchmark", icon: Sparkles },
];

// ─────────────────────────────────────────────────────────────────────
// localStorage keys + helpers

const LS = {
  vault: "prevail.desktop.vaultPath",
  theme: "prevail.desktop.theme",
  palette: "prevail.desktop.palette",
  framework: "prevail.desktop.framework",
  lens: "prevail.desktop.lens",
  defaultChatCli: "prevail.desktop.defaultChatCli",
  defaultChairCli: "prevail.desktop.defaultChairCli",
  telegramToken: "prevail.desktop.telegramToken",
  telegramChatId: "prevail.desktop.telegramChatId",
  whatsappNumber: "prevail.desktop.whatsappNumber",
  mcpEnabled: "prevail.desktop.mcpEnabled",
} as const;

// Per-domain toggles mirroring the CLI status bar:
// council on/off · web access · save replies · serendipity · auto-council.
type DomainToggle = "council" | "web" | "save" | "serendipity" | "auto";
function domainTogglesKey(domain: string, t: DomainToggle): string {
  return `prevail.desktop.domain.${domain}.${t}`;
}
function getDomainToggle(domain: string, t: DomainToggle, fallback: boolean): boolean {
  const raw = lsGet(domainTogglesKey(domain, t));
  if (raw === "") return fallback;
  return raw === "1";
}
function setDomainToggle(domain: string, t: DomainToggle, v: boolean): void {
  lsSet(domainTogglesKey(domain, t), v ? "1" : "0");
}

function lsGet(key: string, fallback: string = ""): string {
  return localStorage.getItem(key) ?? fallback;
}
function lsSet(key: string, value: string): void {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

// Per-domain preferred skills — auto-attach on entering a domain.
function loadPreferredSkills(domain: string | null): string[] {
  if (!domain) return [];
  try {
    const raw = lsGet(`prevail.domain.${domain}.skills`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
function savePreferredSkills(domain: string | null, skills: string[]): void {
  if (!domain) return;
  lsSet(`prevail.domain.${domain}.skills`, JSON.stringify(skills));
}

// Concatenates a list of chat messages into a single text payload for
// passing as context to a stateless CLI. Drops the oldest turns until
// the total stays under `maxChars`. The most-recent placeholder reply
// (empty content) is excluded automatically.
function buildChatContext(
  msgs: { role: "user" | "assistant"; cli?: string; content: string }[],
  maxChars: number,
): string {
  // Skip trailing streaming placeholder + the user msg we just pushed.
  const sliced = msgs.slice(0, -2).filter((m) => m.content.trim().length > 0);
  if (sliced.length === 0) return "";
  const lines: string[] = [];
  for (let i = sliced.length - 1; i >= 0; i--) {
    const m = sliced[i];
    const tag = m.role === "user" ? "User" : `Assistant${m.cli ? ` (${m.cli})` : ""}`;
    lines.unshift(`${tag}: ${m.content.trim()}`);
    const total = lines.join("\n\n").length;
    if (total > maxChars) {
      lines.shift(); // drop the just-added oldest line to stay under budget
      break;
    }
  }
  return lines.join("\n\n");
}

// Render plain text with `/skill` tokens highlighted like inline pills
// — a small visual cue that the model will treat them as skill refs.
const SKILL_TOKEN_RE = /(^|\s)(\/[a-zA-Z][a-zA-Z0-9_-]*)/g;
function renderSkillTokens(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(SKILL_TOKEN_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    const [full, prefix, token] = m;
    const start = m.index;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    if (prefix) parts.push(prefix);
    parts.push(
      <span
        key={start}
        className="rounded-md border border-accent-border bg-accent-soft px-1.5 py-0.5 font-mono text-[13px] font-medium text-accent"
      >
        {token}
      </span>,
    );
    lastIndex = start + full.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

// Vertical drag handle between rails. Calls `onChange(delta)` while
// the user drags. Owner is responsible for clamping the resulting
// width. Hover surfaces a subtle accent line so the affordance is
// visible without dominating the UI.
function ResizeHandle({ onChange, ariaLabel }: { onChange: (deltaPx: number) => void; ariaLabel?: string }) {
  const lastX = useRef(0);
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      if (dx !== 0) onChange(dx);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return (
    <div
      onMouseDown={onDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className="group relative w-1 cursor-col-resize bg-transparent hover:bg-accent-border"
    >
      <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent-border/40" />
    </div>
  );
}

// Strip ANSI escape codes (CSI sequences) that some CLIs emit even in
// non-TTY mode — ollama is the worst offender with its progress
// spinner. Without this the chat shows garbage like `[4D[K`.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const SYCOPHANCY_RE = /\b(you're absolutely right!?|you are absolutely right!?|great question!?|excellent question!?|that's a great point!?)\b\s*/gi;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
function maybeStripSycophancy(s: string): string {
  if (lsGet("prevail.pref.stripSycophancy") !== "1") return s;
  return s.replace(SYCOPHANCY_RE, "");
}

// ─────────────────────────────────────────────────────────────────────
// Brand — official Prevail logo, byte-identical to the site

function PrevailLogo({ size = 28, rounded = true }: { size?: number; rounded?: boolean }) {
  // iOS-style rounded-square radius: ~22.37% of side (Apple's "superellipse"
  // approximation rounds to ~22% — we use the same ratio everywhere).
  const radius = rounded ? Math.round(size * 0.22) : 0;
  return (
    <img
      src="/logo.png"
      alt="Prevail"
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: radius }}
      draggable={false}
    />
  );
}

function Brand({ className = "", fill = false }: { className?: string; fill?: boolean }) {
  if (fill) {
    // Flexbox justify-between spreads the letters edge-to-edge across
    // whatever width the parent provides. No letter-spacing math.
    return (
      <span className={`flex w-full items-baseline justify-between ${className}`}>
        <span>P</span>
        <span>R</span>
        <span>E</span>
        <span>V</span>
        <span className="text-ai">A</span>
        <span className="text-ai">I</span>
        <span>L</span>
      </span>
    );
  }
  return (
    <span className={className} style={{ letterSpacing: "inherit" }}>
      PREV<span className="text-ai">AI</span>L
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Theme = Mode (light / dark / system) + Palette (vault / midnight / ember / mono / cyberpunk / slate)
// Mode controls brightness; palette controls accent + surface styling.

type Mode = "light" | "dark" | "system";
type Palette = "vault" | "midnight" | "ember" | "mono" | "cyberpunk" | "slate";

const PALETTES: { id: Palette; name: string; blurb: string; swatch: { bg: string; surface: string; accent: string; ai: string } }[] = [
  { id: "vault",     name: "Vault",     blurb: "Cream + gold — focused, warm",                       swatch: { bg: "#faf8f1", surface: "#ffffff", accent: "#a8862d", ai: "#1976d2" } },
  { id: "midnight",  name: "Midnight",  blurb: "Deep blue-violet with cool accents",                  swatch: { bg: "#0a0d1f", surface: "#131730", accent: "#818cf8", ai: "#22d3ee" } },
  { id: "ember",     name: "Ember",     blurb: "Warm crimson and bronze — forge vibes",               swatch: { bg: "#1a0a06", surface: "#2a130c", accent: "#ef6c4a", ai: "#fbbf24" } },
  { id: "mono",      name: "Mono",      blurb: "Clean grayscale — minimal and focused",               swatch: { bg: "#f7f7f8", surface: "#ffffff", accent: "#18181b", ai: "#3b82f6" } },
  { id: "cyberpunk", name: "Cyberpunk", blurb: "Neon green on black — matrix terminal",               swatch: { bg: "#030a06", surface: "#08130c", accent: "#22ff77", ai: "#ff45a1" } },
  { id: "slate",     name: "Slate",     blurb: "Cool slate blue — focused developer theme",           swatch: { bg: "#0c1220", surface: "#131b2e", accent: "#38bdf8", ai: "#a5b4fc" } },
];

function useAppearance() {
  const [mode, setMode] = useState<Mode>(() => {
    const saved = lsGet(LS.theme);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
    return "light";
  });
  const [palette, setPalette] = useState<Palette>(() => {
    const saved = lsGet(LS.palette) as Palette;
    return PALETTES.some((p) => p.id === saved) ? saved : "vault";
  });
  // Track system preference for "system" mode
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // Apply to <html>
  useEffect(() => {
    const effectiveDark = mode === "dark" || (mode === "system" && systemDark);
    document.documentElement.setAttribute("data-theme", effectiveDark ? "dark" : "light");
    document.documentElement.setAttribute("data-palette", palette);
    lsSet(LS.theme, mode);
    lsSet(LS.palette, palette);
  }, [mode, palette, systemDark]);
  return { mode, setMode, palette, setPalette };
}

// ─────────────────────────────────────────────────────────────────────
// Active framework + lens (shared between Chat and Council)

function useFrameworkLens() {
  const [framework, setFramework] = useState<string>(() => lsGet(LS.framework, "none"));
  const [lens, setLens] = useState<string>(() => lsGet(LS.lens, "none"));
  useEffect(() => { lsSet(LS.framework, framework); }, [framework]);
  useEffect(() => { lsSet(LS.lens, lens); }, [lens]);

  function buildPrompt(raw: string): string {
    const fw = FRAMEWORKS.find((f) => f.id === framework);
    const ln = LENSES.find((l) => l.id === lens);
    const parts: string[] = [];
    if (fw?.instruction) parts.push(`[FRAMEWORK]\n${fw.instruction}`);
    if (ln?.instruction) parts.push(`[LENS]\n${ln.instruction}`);
    parts.push(raw);
    return parts.join("\n\n");
  }

  return { framework, setFramework, lens, setLens, buildPrompt };
}

// ─────────────────────────────────────────────────────────────────────
// App root — vault picker, sidebar, tabs

export default function App() {
  const appearance = useAppearance();
  const [vaultPath, setVaultPath] = useState<string | null>(() =>
    localStorage.getItem(LS.vault),
  );
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  // Threads — backed by <vault>/<domain>/_threads/<slug>.md files.
  // Active thread defines what's loaded into the chat transcript.
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [activeThreadPath, setActiveThreadPath] = useState<string | null>(null);
  // Per-domain import counts shown as a tiny badge in the sidebar.
  // Refreshed when ingestion:artifact fires (any tier writes a file)
  // or when the domain list changes.
  const [domainStats, setDomainStats] = useState<Record<string, number>>({});
  const domainsRef = useRef<Domain[]>([]);
  useEffect(() => { domainsRef.current = domains; }, [domains]);
  const refreshDomainStats = useCallback(async (names: string[]) => {
    const results = await Promise.all(
      names.map(async (n) => {
        try {
          const s = await invoke<{ imports: number }>("ingestion_domain_stats", { domain: n });
          return [n, s.imports] as const;
        } catch { return [n, 0] as const; }
      }),
    );
    setDomainStats(Object.fromEntries(results));
  }, []);
  useEffect(() => {
    let unl: UnlistenFn | null = null;
    (async () => {
      unl = await listen("ingestion:artifact", () => {
        void refreshDomainStats(domainsRef.current.map((d) => d.name));
      });
    })();
    return () => { if (unl) unl(); };
  }, [refreshDomainStats]);
  // Switching domains starts a fresh chat in the new domain instead of
  // dragging the previous domain's thread pointer along — which would
  // cause the next auto-save to try writing into a path that lives
  // under the wrong domain folder.
  useEffect(() => { setActiveThreadPath(null); }, [selectedDomain]);
  // Cross-domain streaming awareness — App-level map of in-flight
  // streams. Sidebar + ThreadsRail read this to pulse domains/threads
  // that have work happening in the background.
  type RunningStream = {
    sessionId: string;
    domain: string | null;
    threadPath: string | null;
    title: string;
    startedAt: number;
  };
  const [runningStreams, setRunningStreams] = useState<RunningStream[]>([]);
  const notifyPermissionRef = useRef<NotificationPermission | "unknown">(typeof Notification !== "undefined" ? Notification.permission : "unknown");
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (notifyPermissionRef.current === "default") {
      Notification.requestPermission().then((p) => { notifyPermissionRef.current = p; }).catch(() => {});
    }
  }, []);
  function notifyDone(title: string, body: string) {
    if (lsGet("prevail.pref.desktopNotif") !== "1") return;
    if (typeof Notification === "undefined") return;
    if (notifyPermissionRef.current === "granted") {
      try { new Notification(title, { body }); } catch {}
    }
  }
  function playDoneChime() {
    if (lsGet("prevail.pref.soundOnDone") !== "1") return;
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.34);
      o.onended = () => ctx.close();
    } catch {}
  }
  const markStreamStart = useCallback((s: RunningStream) => {
    setRunningStreams((cur) => [...cur.filter((x) => x.sessionId !== s.sessionId), s]);
  }, []);
  const selectedDomainRef = useRef<string | null>(null);
  useEffect(() => { selectedDomainRef.current = selectedDomain; }, [selectedDomain]);
  const markStreamEnd = useCallback((sessionId: string) => {
    setRunningStreams((cur) => {
      const ended = cur.find((x) => x.sessionId === sessionId);
      if (ended) {
        playDoneChime();
        if (ended.domain !== selectedDomainRef.current) {
          const where = ended.domain ? titleCase(ended.domain) : "no domain";
          notifyDone(`Reply ready · ${where}`, ended.title || "Your conversation just finished.");
        }
      }
      return cur.filter((x) => x.sessionId !== sessionId);
    });
  }, []);
  const runningDomains = useMemo(() => new Set(runningStreams.map((s) => s.domain ?? "")), [runningStreams]);
  const runningThreadPaths = useMemo(() => new Set(runningStreams.map((s) => s.threadPath ?? "").filter(Boolean)), [runningStreams]);
  // Persisted rail widths. Min/max enforced when dragging.
  const [domainRailWidth, setDomainRailWidth] = useState<number>(() => {
    const v = parseInt(lsGet("prevail.domainRailWidth"), 10);
    return Number.isFinite(v) && v > 0 ? v : 240;
  });
  const [threadsRailWidth, setThreadsRailWidth] = useState<number>(() => {
    const v = parseInt(lsGet("prevail.threadsRailWidth"), 10);
    return Number.isFinite(v) && v > 0 ? v : 240;
  });
  useEffect(() => { lsSet("prevail.domainRailWidth", String(domainRailWidth)); }, [domainRailWidth]);
  useEffect(() => { lsSet("prevail.threadsRailWidth", String(threadsRailWidth)); }, [threadsRailWidth]);
  const refreshThreads = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<ThreadMeta[]>("list_threads", { vault: vaultPath, domain: selectedDomain || null });
      setThreads(list);
    } catch (e) { console.error("list_threads", e); }
  }, [vaultPath, selectedDomain]);
  useEffect(() => { void refreshThreads(); }, [refreshThreads]);
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [tab, setTab] = useState<TabId>("chat");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => lsGet("prevail.sidebarCollapsed") === "1",
  );
  useEffect(() => {
    lsSet("prevail.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  const fwLens = useFrameworkLens();

  const selectedDomainPath = useMemo(() => {
    if (!selectedDomain) return null;
    return domains.find((d) => d.name === selectedDomain)?.path ?? null;
  }, [domains, selectedDomain]);

  // Quick switcher (⌘P) — fuzzy finder over all domains + recent
  // threads across all domains. Modal owns its own state when open.
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);

  // Keyboard shortcuts — global. Skip when a text input has focus
  // (so typing ⌘B in the composer doesn't toggle the sidebar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? "";
      const editable = tag === "input" || tag === "textarea" || target?.isContentEditable;
      // Allow the global shortcuts that are clearly intentional even
      // when in a field (Cmd+,, Cmd+K, Cmd+P).
      const k = e.key.toLowerCase();
      if (editable && k !== "," && k !== "k" && k !== "p") return;
      switch (k) {
        case "k": // ⌘K — new chat (no domain)
          e.preventDefault();
          setSelectedDomain("");
          setActiveThreadPath(null);
          setTab("chat");
          break;
        case ",": // ⌘, — open settings
          e.preventDefault();
          setTab("settings");
          break;
        case "b": // ⌘B — toggle the domain rail
          e.preventDefault();
          setSidebarCollapsed((v) => !v);
          break;
        case "p": // ⌘P — quick switcher
          e.preventDefault();
          setQuickSwitcherOpen(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function openInFinder(path: string | null) {
    if (!path) return;
    try { await invoke("open_in_finder", { path }); } catch (e) { console.error("open_in_finder", e); }
  }

  useEffect(() => {
    invoke<CliInfo[]>("detect_clis").then(setClis).catch(() => setClis([]));
  }, []);

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    let attempts = 0;
    const tryScan = async () => {
      while (!cancelled && attempts < 5) {
        try {
          const d = await invoke<Domain[]>("scan_vault", { path: vaultPath });
          if (cancelled) return;
          setDomains(d);
          setVaultError(null);
          void refreshDomainStats(d.map((x) => x.name));
          // Land on no-domain chat by default. User picks a domain
          // from the sidebar to enter its context.
          return;
        } catch (e) {
          attempts++;
          const msg = String(e);
          // Transient macOS EINTR — wait briefly and retry.
          if (msg.includes("os error 4") || msg.toLowerCase().includes("interrupted")) {
            await new Promise((r) => setTimeout(r, 100 * attempts));
            continue;
          }
          if (!cancelled) {
            setVaultError(msg);
            setDomains([]);
          }
          return;
        }
      }
      if (!cancelled) {
        setVaultError("vault scan failed after retries — try toggling vault in Settings");
      }
    };
    tryScan();
    return () => { cancelled = true; };
  }, [vaultPath]);

  async function pickVault() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setVaultPath(dir);
      lsSet(LS.vault, dir);
      setSelectedDomain(null);
    }
  }

  if (!vaultPath) return <VaultWizard onPick={pickVault} />;

  if (tab === "settings") {
    return (
      <div className="relative flex h-screen flex-col bg-background text-text-primary">
        <SettingsPanel
          appearance={appearance}
          vaultPath={vaultPath}
          onChangeVault={pickVault}
          clis={clis}
          onBack={() => setTab("chat")}
          onStartChatWith={(cliId, modelId) => {
            lsSet(LS.defaultChatCli, cliId);
            if (modelId) lsSet(`prevail.model.${cliId}`, modelId);
            setSelectedDomain("");
            setTab("chat");
          }}
        />
        <span className="pointer-events-none absolute bottom-1.5 right-2 select-none font-mono text-[9px] tracking-wider text-text-muted/60">
          v{APP_VERSION}
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen flex-col bg-background text-text-primary">
      <div className="flex min-h-0 flex-1">
        <Sidebar
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          vaultPath={vaultPath}
          domains={domains}
          vaultError={vaultError}
          selectedDomain={selectedDomain}
          setSelectedDomain={setSelectedDomain}
          openInFinder={openInFinder}
          tab={tab}
          setTab={setTab}
          onDomainCreated={(d) => {
            setDomains((cur) => [...cur, d].sort((a, b) => a.name.localeCompare(b.name)));
            setSelectedDomain(d.name);
          }}
          appearance={appearance}
          runningDomains={runningDomains}
          domainStats={domainStats}
          railWidth={domainRailWidth}
        />
        {!sidebarCollapsed && (
          <ResizeHandle
            ariaLabel="Resize domain rail"
            onChange={(dx) => setDomainRailWidth((w) => Math.max(180, Math.min(420, w + dx)))}
          />
        )}
        {/* legacy single-render below disabled */}
        {false && !sidebarCollapsed && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface" />
        )}

        {/* Threads rail — visible on Chat and Council so the domain's
            conversation history stays one click away regardless of mode.
            Hidden on Benchmark which is its own evaluation surface. */}
        {(tab === "chat" || tab === "council") && (
          <>
            <ThreadsRail
              threads={threads}
              activePath={activeThreadPath}
              selectedDomain={selectedDomain}
              vaultPath={vaultPath}
              onPick={(p) => setActiveThreadPath(p)}
              onNew={async () => {
                // Create the thread file immediately so the user gets
                // a renameable entry in the rail BEFORE typing the
                // first prompt. Backend accepts empty turns.
                try {
                  const path = await invoke<string>("save_thread", {
                    vault: vaultPath,
                    domain: selectedDomain || null,
                    slug: null,
                    title: "Untitled",
                    turns: [],
                  });
                  setActiveThreadPath(path);
                  await refreshThreads();
                } catch (e) {
                  console.error("create thread stub", e);
                  // Fall back to the old behavior on failure so + at
                  // least clears the chat for a fresh start.
                  setActiveThreadPath(null);
                }
              }}
              onRefresh={() => void refreshThreads()}
              runningThreadPaths={runningThreadPaths}
              railWidth={threadsRailWidth}
            />
            <ResizeHandle
              ariaLabel="Resize threads rail"
              onChange={(dx) => setThreadsRailWidth((w) => Math.max(180, Math.min(480, w + dx)))}
            />
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-background px-4">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative -mb-px flex items-center gap-2 px-4 py-3 text-sm transition-colors ${
                    active ? "text-accent" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                  {active && <span className="absolute bottom-0 left-0 right-0 h-px bg-accent" />}
                </button>
              );
            })}
            <div className="flex-1" />
            <a
              href="https://github.com/fru-dev3/prevail-desktop"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-accent"
            >
              <Github className="h-3.5 w-3.5" />
              github
            </a>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "chat" && (
              <ChatPanel
                domain={selectedDomain}
                domainPath={selectedDomainPath}
                vaultPath={vaultPath}
                clis={clis}
                fwLens={fwLens}
                onSwitchToCouncil={() => setTab("council")}
                onOpenInFinder={() => openInFinder(selectedDomainPath)}
                activeThreadPath={activeThreadPath}
                onActiveThreadChange={setActiveThreadPath}
                onThreadsChanged={() => void refreshThreads()}
                onStreamStart={markStreamStart}
                onStreamEnd={markStreamEnd}
                domains={domains}
                domainStats={domainStats}
                runningDomains={runningDomains}
                onPickDomain={(name) => setSelectedDomain(name)}
              />
            )}
            {tab === "council" && (
              <CouncilPanel
                domain={selectedDomain}
                domainPath={selectedDomainPath}
                vaultPath={vaultPath}
                clis={clis}
                fwLens={fwLens}
                onOpenInFinder={() => openInFinder(selectedDomainPath)}
                onSwitchToChat={() => setTab("chat")}
                onThreadsChanged={() => void refreshThreads()}
              />
            )}
            {tab === "benchmark" && <BenchmarkPanel vaultPath={vaultPath} />}
          </div>
        </main>
      </div>
      {/* Tiny version pill — bottom-right corner, low-prominence */}
      <span className="pointer-events-none absolute bottom-1.5 right-2 select-none font-mono text-[9px] tracking-wider text-text-muted/60">
        v{APP_VERSION}
      </span>
      {quickSwitcherOpen && (
        <QuickSwitcher
          vaultPath={vaultPath}
          domains={domains}
          onClose={() => setQuickSwitcherOpen(false)}
          onPickDomain={(name) => {
            setSelectedDomain(name);
            setActiveThreadPath(null);
            setTab("chat");
            setQuickSwitcherOpen(false);
          }}
          onPickThread={(domain, path) => {
            setSelectedDomain(domain ?? "");
            setActiveThreadPath(path);
            setTab("chat");
            setQuickSwitcherOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Title-case helper. 'real-estate' → 'Real Estate', 'tax' → 'Tax'.
// Used to render life domain labels in the UI without mutating the
// underlying folder names that drive everything else.
function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

// ─────────────────────────────────────────────────────────────────────
// Vault wizard

function Sidebar({
  collapsed,
  setCollapsed,
  vaultPath,
  domains,
  vaultError,
  selectedDomain,
  setSelectedDomain,
  openInFinder,
  tab,
  setTab,
  onDomainCreated,
  appearance,
  runningDomains,
  domainStats,
  railWidth,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean | ((cur: boolean) => boolean)) => void;
  vaultPath: string;
  domains: Domain[];
  vaultError: string | null;
  selectedDomain: string | null;
  setSelectedDomain: (n: string) => void;
  openInFinder: (p: string | null) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  onDomainCreated: (d: Domain) => void;
  appearance: ReturnType<typeof useAppearance>;
  runningDomains: Set<string>;
  domainStats: Record<string, number>;
  railWidth: number;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  // Pinned domains live in localStorage as a comma-separated slug list.
  const PIN_KEY = "prevail.desktop.pinnedDomains";
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      const raw = lsGet(PIN_KEY);
      return new Set(raw ? raw.split(",").filter(Boolean) : []);
    } catch { return new Set(); }
  });
  // Group collapse — Pinned vs All. Persisted so collapsing survives
  // app restarts.
  const [pinnedOpen, setPinnedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.pinnedOpen") !== "0");
  const [allOpen, setAllOpen] = useState<boolean>(() => lsGet("prevail.sidebar.allOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.pinnedOpen", pinnedOpen ? "1" : "0"); }, [pinnedOpen]);
  useEffect(() => { lsSet("prevail.sidebar.allOpen", allOpen ? "1" : "0"); }, [allOpen]);
  const togglePin = (name: string) => {
    setPinned((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      lsSet(PIN_KEY, Array.from(next).join(","));
      return next;
    });
  };
  const [railFilter, setRailFilter] = useState("");
  const sortedDomains = useMemo(() => {
    const q = railFilter.trim().toLowerCase();
    const isPinned = (d: Domain) => pinned.has(d.name);
    const matches = (d: Domain) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      titleCase(d.name).toLowerCase().includes(q);
    const filtered = domains.filter(matches);
    const pin = filtered.filter(isPinned);
    const rest = filtered.filter((d) => !isPinned(d));
    return [...pin, ...rest];
  }, [domains, pinned, railFilter]);
  const [addError, setAddError] = useState<string | null>(null);

  async function createDomain() {
    setAddError(null);
    try {
      const d = await invoke<Domain>("create_domain", { vault: vaultPath, name: newName });
      onDomainCreated(d);
      setNewName("");
      setAdding(false);
    } catch (e) {
      setAddError(String(e));
    }
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-border-subtle bg-surface"
      style={{ width: collapsed ? 56 : railWidth }}
    >
      {/* Top — brand + collapse. The whole row is draggable so the
          user can move the window from here. Collapsed: only logo. */}
      <div
        data-tauri-drag-region
        className={`flex shrink-0 items-center ${collapsed ? "justify-center" : "justify-between"} titlebar-pad border-b border-border-subtle px-2 py-2.5`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3" data-tauri-drag-region>
          <PrevailLogo size={32} />
          {!collapsed && (
            <Brand fill className="flex-1 font-sans text-2xl font-extrabold text-text-primary" />
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            <span className="text-[12px] leading-none">◂</span>
          </button>
        )}
      </div>
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="mx-auto mt-1 flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
        >
          <span className="text-[12px] leading-none">▸</span>
        </button>
      )}

      {/* Domain list (icon rail when collapsed, full list when expanded) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* New chat — no-domain conversation. Clearing selectedDomain
            unbinds the chat from any domain context. */}
        <div className={collapsed ? "flex justify-center p-2" : "px-2 pt-2"}>
          <button
            onClick={() => {
              setSelectedDomain("");
              if (tab === "settings") setTab("chat");
            }}
            title="Start a chat with no domain attached"
            className={
              collapsed
                ? `flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                    selectedDomain === "" && tab !== "settings"
                      ? "bg-accent-soft text-accent"
                      : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                  }`
                : `flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                    selectedDomain === "" && tab !== "settings"
                      ? "bg-accent-soft text-accent"
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`
            }
          >
            <Plus className="h-4 w-4" />
            {!collapsed && "New chat"}
          </button>
        </div>
        {!collapsed && domains.length >= 4 && (
          <div className="px-2 pt-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">⌕</span>
              <input
                value={railFilter}
                onChange={(e) => setRailFilter(e.target.value)}
                placeholder="filter domains…"
                className="w-full rounded-md border border-border-subtle bg-background py-1 pl-6 pr-6 font-mono text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
              />
              {railFilter && (
                <button
                  onClick={() => setRailFilter("")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-[12px] text-text-muted hover:text-warn"
                  title="Clear filter"
                >×</button>
              )}
            </div>
          </div>
        )}
        {!collapsed && (
          <div className="mb-1 px-3 pt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
            Domains
          </div>
        )}
        {vaultError && !collapsed && (
          <div className="mx-2 my-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{vaultError}</div>
        )}
        {domains.length === 0 && !vaultError && !collapsed && (
          <div className="px-3 py-3 text-xs text-text-muted">
            no domains yet. click <span className="text-accent">+ new domain</span> below to create one.
          </div>
        )}
        <ul className={`space-y-0.5 ${collapsed ? "px-1.5 py-2" : "px-2"}`}>
          {sortedDomains.map((d, i) => {
            const active = d.name === selectedDomain && tab !== "settings";
            const Icon = domainIcon(d.name);
            const isPinned = pinned.has(d.name);
            const isFirstPinned = !collapsed && isPinned && (i === 0 || !pinned.has(sortedDomains[i - 1].name));
            const isFirstAll = !collapsed && !isPinned && (i === 0 || pinned.has(sortedDomains[i - 1].name));
            // Hide entries when their group is collapsed.
            if (!collapsed && isPinned && !pinnedOpen && !isFirstPinned) return null;
            if (!collapsed && !isPinned && !allOpen && !isFirstAll) return null;
            const renderGroupHeader = (label: "Pinned" | "All", open: boolean, set: (v: boolean) => void, count: number) => (
              <li key={`${label}-header`} className="mt-1 first:mt-0">
                <button
                  onClick={() => set(!open)}
                  title={`${open ? "Collapse" : "Expand"} ${label}`}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted hover:bg-surface-warm hover:text-text-secondary"
                >
                  <span className={`inline-flex h-3 w-3 items-center justify-center text-[11px] leading-none transition-transform ${open ? "rotate-90" : ""} text-text-secondary`}>
                    ▶
                  </span>
                  <span>{label}</span>
                  <span className="ml-auto rounded-full bg-surface-warm px-1.5 py-0 font-mono text-[10px] text-text-muted">{count}</span>
                </button>
              </li>
            );
            // Render a thin "Pinned / All" divider when transitioning.
            const showDivider = false;
            void showDivider;
            if (collapsed) {
              return (
                <li key={d.name}>
                  <button
                    onClick={() => {
                      setSelectedDomain(d.name);
                      if (tab === "settings") setTab("chat");
                    }}
                    title={titleCase(d.name)}
                    className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                      active
                        ? "bg-accent-soft text-accent"
                        : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                    }`}
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : (
                      <span className="font-mono text-xs font-semibold">
                        {titleCase(d.name).charAt(0)}
                      </span>
                    )}
                  </button>
                </li>
              );
            }
            return (
              <Fragment key={d.name}>
                {isFirstPinned && renderGroupHeader("Pinned", pinnedOpen, setPinnedOpen, pinned.size)}
                {isFirstAll && renderGroupHeader("All", allOpen, setAllOpen, sortedDomains.length - pinned.size)}
                {((isPinned && pinnedOpen) || (!isPinned && allOpen)) && (
              <li
                className="group flex items-center gap-1"
              >
                <button
                  onMouseDown={(e) => {
                    // Manual drag — WebKit's HTML5 DnD in WKWebView
                    // doesn't reliably fire dragstart. Track mouse
                    // movement; on mouseup, hit-test the chat composer
                    // / messages area and call its global attach hook.
                    if (e.button !== 0) return;
                    const startX = e.clientX;
                    const startY = e.clientY;
                    let dragging = false;
                    let pill: HTMLDivElement | null = null;
                    const onMove = (ev: MouseEvent) => {
                      const dx = ev.clientX - startX;
                      const dy = ev.clientY - startY;
                      if (!dragging && Math.hypot(dx, dy) < 6) return;
                      if (!dragging) {
                        dragging = true;
                        pill = document.createElement("div");
                        pill.textContent = `◆ ${titleCase(d.name)}`;
                        pill.style.cssText =
                          "position:fixed;z-index:9999;pointer-events:none;" +
                          "padding:6px 10px;border-radius:9999px;" +
                          "background:var(--color-accent,#a8862d);color:#fff;" +
                          "font-family:ui-monospace,monospace;font-size:11px;" +
                          "box-shadow:0 6px 20px rgba(0,0,0,0.2);" +
                          "transform:translate(-50%,-50%);";
                        document.body.appendChild(pill);
                        document.body.style.userSelect = "none";
                      }
                      if (pill) {
                        pill.style.left = ev.clientX + "px";
                        pill.style.top = ev.clientY + "px";
                      }
                    };
                    const onUp = (ev: MouseEvent) => {
                      window.removeEventListener("mousemove", onMove);
                      window.removeEventListener("mouseup", onUp);
                      document.body.style.userSelect = "";
                      if (pill) { pill.remove(); pill = null; }
                      if (!dragging) return; // treat as a click — let onClick fire
                      // Don't let onClick fire after a drag ended
                      ev.preventDefault();
                      ev.stopPropagation();
                      const hook = (window as unknown as { __prevailAttach?: (n: string) => void }).__prevailAttach;
                      if (hook) hook(d.name);
                      else console.warn("[prevail/drag] no attach hook registered — drop fell outside chat panel");
                    };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  }}
                  onClick={() => {
                    setSelectedDomain(d.name);
                    if (tab === "settings") setTab("chat");
                  }}
                  title="Click to enter · drag to add as context to current chat"
                  className={`flex flex-1 cursor-grab items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors active:cursor-grabbing ${
                    active
                      ? "bg-surface-strong text-text-primary font-medium"
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`}
                >
                  {Icon ? (
                    <Icon className={`h-4 w-4 ${active ? "text-accent" : "text-text-muted"}`} />
                  ) : (
                    <span className={active ? "text-accent" : "text-text-muted"}>◆</span>
                  )}
                  <span className="flex-1 truncate">{titleCase(d.name)}</span>
                  {(domainStats[d.name] ?? 0) > 0 && (
                    <span
                      className="shrink-0 rounded-full bg-surface-warm px-1.5 py-0 font-mono text-[9px] text-text-muted"
                      title={`${domainStats[d.name]} imports`}
                    >
                      {domainStats[d.name]}
                    </span>
                  )}
                  {runningDomains.has(d.name) && (
                    <span className="pulse-soft inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="A reply is streaming in this domain" />
                  )}
                </button>
                <button
                  onClick={() => togglePin(d.name)}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${
                    isPinned || active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={isPinned ? "Unpin" : "Pin to top"}
                >
                  <Pin className={`h-3.5 w-3.5 ${isPinned ? "fill-accent text-accent" : ""}`} />
                </button>
                <button
                  onClick={() => openInFinder(d.path)}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={`Open ${titleCase(d.name)} in Finder`}
                >
                  <Folder className="h-3.5 w-3.5" />
                </button>
              </li>
                )}
              </Fragment>
            );
          })}
        </ul>

        {/* Add domain */}
        {!collapsed && (
          <div className="mt-2 px-2">
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-left text-xs text-text-muted hover:border-accent-border hover:bg-surface-warm hover:text-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                new domain
              </button>
            )}
            {adding && (
              <div className="rounded-md border border-border bg-background p-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createDomain();
                    if (e.key === "Escape") { setAdding(false); setNewName(""); setAddError(null); }
                  }}
                  placeholder="e.g. travel"
                  className="w-full bg-transparent px-1 py-0.5 font-mono text-xs focus:outline-none"
                />
                {addError && <div className="mt-1 text-[10px] text-err">{addError}</div>}
                <div className="mt-1.5 flex gap-1">
                  <button
                    onClick={createDomain}
                    disabled={!newName.trim()}
                    className="rounded bg-accent px-2 py-0.5 font-mono text-[10px] text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
                  >
                    create
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewName(""); setAddError(null); }}
                    className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-muted hover:bg-surface-warm"
                  >
                    cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {collapsed && (
          <div className="mt-2 flex justify-center">
            <button
              onClick={() => setCollapsed(false)}
              title="New domain (expand sidebar first)"
              className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border text-text-muted hover:border-accent-border hover:bg-surface-warm hover:text-accent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Settings + Upgrade + theme — pinned to bottom */}
      <div className={`border-t border-border-subtle ${collapsed ? "flex flex-col items-center gap-1 p-2" : "flex items-center gap-1 px-2 py-2"}`}>
        <button
          onClick={() => setTab("settings")}
          title="Settings"
          className={
            collapsed
              ? `flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                  tab === "settings"
                    ? "bg-accent-soft text-accent"
                    : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
                }`
              : `flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  tab === "settings"
                    ? "bg-accent-soft text-accent"
                    : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                }`
          }
        >
          <SettingsIcon className="h-4 w-4" />
          {!collapsed && "Settings"}
        </button>
        {!collapsed && (
          <button
            onClick={async () => {
              try {
                await invoke("open_in_finder", { path: "https://prevail.sh/Prevail.dmg" });
              } catch {
                window.open("https://prevail.sh/Prevail.dmg", "_blank");
              }
            }}
            title="Download the latest Prevail DMG"
            className="rounded-full border border-border bg-background px-3 py-1 font-mono text-[11px] text-text-muted hover:border-accent-border hover:bg-accent-soft hover:text-accent"
          >
            Upgrade
          </button>
        )}
        <button
          onClick={() => {
            const cycle: Mode[] = ["light", "dark", "system"];
            const i = cycle.indexOf(appearance.mode);
            appearance.setMode(cycle[(i + 1) % cycle.length]);
          }}
          className={
            collapsed
              ? "flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-text-primary"
              : "flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-text-primary"
          }
          title={`Theme: ${appearance.mode} — click to cycle`}
        >
          {appearance.mode === "dark" ? <Moon className="h-4 w-4" /> : appearance.mode === "system" ? <Monitor className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}

function ThreadsRail({
  threads,
  activePath,
  selectedDomain,
  vaultPath,
  onPick,
  onNew,
  onRefresh,
  runningThreadPaths,
  railWidth,
}: {
  threads: ThreadMeta[];
  activePath: string | null;
  selectedDomain: string | null;
  vaultPath: string;
  onPick: (path: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  runningThreadPaths: Set<string>;
  railWidth: number;
}) {
  void vaultPath;
  // Collapse state persisted across launches.
  const [collapsed, setCollapsed] = useState<boolean>(() => lsGet("prevail.threadsRail.collapsed") === "1");
  useEffect(() => { lsSet("prevail.threadsRail.collapsed", collapsed ? "1" : "0"); }, [collapsed]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [threadFilter, setThreadFilter] = useState("");
  const filteredThreads = useMemo(() => {
    const q = threadFilter.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.preview.toLowerCase().includes(q));
  }, [threads, threadFilter]);
  const [renameInput, setRenameInput] = useState("");
  if (collapsed) {
    return (
      <aside className="flex w-7 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface py-2">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand threads rail"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
        >
          <span className="text-[12px] leading-none">▸</span>
        </button>
        <button
          onClick={onNew}
          title="New thread"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <div className="mt-1 flex flex-col gap-1">
          {threads.slice(0, 12).map((t) => (
            <button
              key={t.path}
              onClick={() => onPick(t.path)}
              title={t.title}
              className={`flex h-5 w-5 items-center justify-center rounded text-[9px] font-mono ${
                t.path === activePath
                  ? "bg-accent-soft text-accent"
                  : "text-text-muted hover:bg-surface-warm hover:text-text-primary"
              }`}
            >
              {(t.title || "·").charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
      </aside>
    );
  }
  async function applyRename(path: string) {
    if (!renameInput.trim()) { setRenaming(null); return; }
    try {
      await invoke("rename_thread", { path, newTitle: renameInput.trim() });
      onRefresh();
    } catch (e) { console.error("rename_thread", e); }
    setRenaming(null);
  }
  async function deleteThread(path: string) {
    try {
      await invoke("delete_thread", { path });
      onRefresh();
    } catch (e) { console.error("delete_thread", e); }
  }
  function fmtRelative(secs: number): string {
    const delta = Date.now() / 1000 - secs;
    if (delta < 60) return "just now";
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d ago`;
    return new Date(secs * 1000).toLocaleDateString();
  }
  return (
    <aside className="flex shrink-0 flex-col border-r border-border-subtle bg-surface" style={{ width: railWidth }}>
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Threads{selectedDomain ? ` · ${titleCase(selectedDomain)}` : ""}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNew}
            title="New thread"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse threads rail"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            <span className="text-[12px] leading-none">◂</span>
          </button>
        </div>
      </div>
      {threads.length > 0 && (
        <div className="border-b border-border-subtle px-2 py-1.5">
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">⌕</span>
            <input
              value={threadFilter}
              onChange={(e) => setThreadFilter(e.target.value)}
              placeholder="filter threads…"
              className="w-full rounded-md border border-border-subtle bg-background py-1 pl-6 pr-2 font-mono text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
            />
            {threadFilter && (
              <button
                onClick={() => setThreadFilter("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-[12px] text-text-muted hover:text-warn"
                title="Clear filter"
              >×</button>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {threads.length === 0 && (
          <div className="px-2 py-3 text-xs text-text-muted">
            no threads yet. Click + to start one.
          </div>
        )}
        {threads.length > 0 && filteredThreads.length === 0 && (
          <div className="px-2 py-3 text-xs text-text-muted">
            no matches for <code className="text-accent">{threadFilter}</code>
          </div>
        )}
        <ul className="space-y-0.5">
          {filteredThreads.map((t) => {
            const active = t.path === activePath;
            const isRenaming = renaming === t.path;
            return (
              <li key={t.path} className="group">
                <div
                  className={`relative rounded-md px-2 py-1.5 transition-colors ${
                    active ? "bg-surface-strong" : "hover:bg-surface-warm"
                  }`}
                >
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyRename(t.path);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => applyRename(t.path)}
                      className="w-full rounded border border-accent-border bg-background px-1 py-0.5 text-sm focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => onPick(t.path)}
                      onDoubleClick={() => { setRenameInput(t.title); setRenaming(t.path); }}
                      className="block w-full text-left"
                      title="double-click to rename"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`truncate text-sm ${active ? "font-medium text-text-primary" : "text-text-secondary"}`}>
                          {t.title}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-text-muted">
                        {runningThreadPaths.has(t.path) ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-accent">
                            <span className="pulse-soft inline-block h-1 w-1 rounded-full bg-accent" />
                            writing
                          </span>
                        ) : (
                          <>
                            <span>{t.turn_count} turns</span>
                            <span>·</span>
                            <span>{fmtRelative(t.updated)}</span>
                          </>
                        )}
                      </div>
                      {t.preview && (
                        <div className="mt-0.5 line-clamp-1 text-[11px] text-text-muted">
                          {t.preview}
                        </div>
                      )}
                    </button>
                  )}
                  {!isRenaming && (
                    <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenameInput(t.title); setRenaming(t.path); }}
                        title="Rename"
                        className="flex h-5 w-5 items-center justify-center rounded bg-background/80 text-text-muted hover:text-accent"
                      >
                        <PenLine className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${t.title}"?`)) deleteThread(t.path); }}
                        title="Delete"
                        className="flex h-5 w-5 items-center justify-center rounded bg-background/80 text-text-muted hover:text-err"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

function VaultWizard({ onPick }: { onPick: () => void }) {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center bg-background text-text-primary"
      data-tauri-drag-region
    >
      <div className="max-w-xl px-8 text-center">
        <div className="mb-6 flex justify-center">
          <PrevailLogo size={88} />
        </div>
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-accent">◆ first launch</div>
        <h1 className="mt-6 font-display text-5xl font-semibold tracking-tight">
          Welcome to <Brand />.
        </h1>
        <p className="mt-6 text-text-secondary">
          Pick a folder to use as your vault. Each child folder with a <code className="text-accent">state.md</code> file becomes a life domain.
        </p>
        <p className="mt-3 text-sm text-text-muted">
          New to <Brand />?{" "}
          <a
            href="https://github.com/fru-dev3/prevail/tree/main/vault-demo"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            grab the demo vault on GitHub
          </a>{" "}
          and point this at it.
        </p>
        <button
          onClick={onPick}
          className="mt-10 inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 font-medium text-background transition-all hover:bg-accent-hover hover:-translate-y-0.5"
        >
          <Folder className="h-4 w-4" /> Pick vault folder
        </button>
        <div className="mt-6 font-mono text-xs text-text-muted">v0.2.0 · vault stays local · no cloud</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CLI badges in sidebar footer

// CLI badges moved to Settings → CLIs section (was in main sidebar).

// MODELS quickpicks (Claude Opus 4.7, GPT 5.4, Gemini 3.1 Pro, etc.)
// land in v0.2.6 — wiring them into Defaults + per-council picker.

// ─────────────────────────────────────────────────────────────────────
// FRAMEWORK + LENS CHIPS — shared above both Chat and Council composers

function DomainStatusBar({
  domain,
  fwLens,
}: {
  domain: string | null;
  fwLens: ReturnType<typeof useFrameworkLens>;
}) {
  // Hooks must be top-level — initialize state from localStorage once
  // per domain, then keep React state as the source of truth so toggles
  // re-render reliably.
  const [council, setCouncil]     = useState(false);
  const [web, setWeb]             = useState(true);
  const [save, setSave]           = useState(true);
  const [serendipity, setSeren]   = useState(false);
  const [auto, setAuto]           = useState(false);
  useEffect(() => {
    if (!domain) return;
    setCouncil(getDomainToggle(domain, "council", false));
    setWeb(getDomainToggle(domain, "web", true));
    setSave(getDomainToggle(domain, "save", true));
    setSeren(getDomainToggle(domain, "serendipity", false));
    setAuto(getDomainToggle(domain, "auto", false));
  }, [domain]);

  const fw = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const ln = LENSES.find((l) => l.id === fwLens.lens);
  const flip = (
    t: DomainToggle,
    cur: boolean,
    set: (v: boolean) => void,
  ) => {
    const next = !cur;
    set(next);
    if (domain) setDomainToggle(domain, t, next);
  };
  const Toggle = ({
    glyph, label, on, onClick, help,
  }: { glyph: string; label: string; on: boolean; onClick: () => void; help: string }) => (
    <button
      onClick={onClick}
      title={`${label}: ${on ? "ON" : "OFF"}\n${help}`}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
        on
          ? "border-accent-border bg-accent-soft text-accent"
          : "border-border bg-surface text-text-muted hover:bg-surface-warm hover:text-text-secondary"
      }`}
    >
      <span>{glyph}</span>
      <span className="uppercase tracking-wider">{label}</span>
      <span className={`ml-0.5 rounded px-1 ${on ? "bg-accent text-background" : "bg-surface-strong text-text-muted"}`}>
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
  const Cycle = ({
    glyph, label, value, active, onClick,
  }: { glyph: string; label: string; value: string; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      title={`${label} — click to cycle`}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] transition-colors ${
        active
          ? "border-accent-border bg-accent-soft text-accent"
          : "border-border bg-surface text-text-muted hover:bg-surface-warm hover:text-text-secondary"
      }`}
    >
      <span>{glyph}</span>
      <span className="uppercase tracking-wider">{label}</span>
      <span className={`ml-0.5 rounded px-1 ${active ? "bg-accent text-background" : "bg-surface-strong text-text-muted"}`}>
        {value}
      </span>
    </button>
  );
  const cycleFramework = () => {
    const idx = FRAMEWORKS.findIndex((f) => f.id === fwLens.framework);
    fwLens.setFramework(FRAMEWORKS[(idx + 1) % FRAMEWORKS.length].id);
  };
  const cycleLens = () => {
    const idx = LENSES.findIndex((l) => l.id === fwLens.lens);
    fwLens.setLens(LENSES[(idx + 1) % LENSES.length].id);
  };
  // The composer's "Council" pill is the action button — this strip is
  // for persistent per-domain settings only. Silence unused-var warnings.
  void council; void setCouncil;
  // Returns the pills as a fragment so they participate in the parent
  // composer toolbar's flex-wrap layout (no wrapper div). Framework
  // and Lens are global (always shown). Web / Save / Serendipity /
  // Auto are per-domain so they only render when a domain is selected.
  return (
    <>
      <Cycle glyph="◆" label="Framework" value={fw?.label ?? "OFF"} active={fwLens.framework !== "none"} onClick={cycleFramework} />
      <Cycle glyph="◇" label="Lens" value={ln?.label ?? "OFF"} active={fwLens.lens !== "none"} onClick={cycleLens} />
      {domain && (
        <>
          <Toggle
            glyph="○" label="Web" on={web}
            onClick={() => flip("web", web, setWeb)}
            help="When ON, the CLI is allowed to fetch URLs and web-search during replies in this domain. When OFF, replies stay offline (model knowledge only)."
          />
          <Toggle
            glyph="▣" label="Save" on={save}
            onClick={() => flip("save", save, setSave)}
            help="When ON, every reply is appended to <domain>/_log/ as markdown so you can re-read or search history later. When OFF, this turn is ephemeral."
          />
          <Toggle
            glyph="◉" label="Serendipity" on={serendipity}
            onClick={() => flip("serendipity", serendipity, setSeren)}
            help="When ON, the prompt is enriched with a 'consider lateral / off-topic angles' instruction so the reply may surface adjacent ideas. When OFF, strictly on-topic."
          />
          <Toggle
            glyph="◐" label="Auto" on={auto}
            onClick={() => flip("auto", auto, setAuto)}
            help="Auto-Council mode. When ON, every prompt you send here is automatically convened as a council (all panelists answer + chair synthesizes) instead of going to a single model."
          />
        </>
      )}
    </>
  );
}

// Kept for potential reuse but currently unused — the DomainStatusBar
// owns the framework/lens controls now.
// @ts-expect-error noUnusedLocals
function FwLensRow({
  fwLens,
  inline = false,
}: {
  fwLens: ReturnType<typeof useFrameworkLens>;
  inline?: boolean;
}) {
  const fw = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const ln = LENSES.find((l) => l.id === fwLens.lens);
  if (inline) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <CycleChip
          label="◆"
          value={fw?.label ?? "OFF"}
          active={fwLens.framework !== "none"}
          title={`Framework: ${fw?.blurb ?? "(off)"}`}
          onClick={() => {
            const idx = FRAMEWORKS.findIndex((f) => f.id === fwLens.framework);
            fwLens.setFramework(FRAMEWORKS[(idx + 1) % FRAMEWORKS.length].id);
          }}
        />
        <CycleChip
          label="◇"
          value={ln?.label ?? "OFF"}
          active={fwLens.lens !== "none"}
          title={`Lens: ${ln?.blurb ?? "(off)"}`}
          onClick={() => {
            const idx = LENSES.findIndex((l) => l.id === fwLens.lens);
            fwLens.setLens(LENSES[(idx + 1) % LENSES.length].id);
          }}
        />
      </div>
    );
  }
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">defaults</span>

      <CycleChip
        label="◆ Framework"
        value={fw?.label ?? "OFF"}
        active={fwLens.framework !== "none"}
        title={fw?.blurb ?? ""}
        onClick={() => {
          const idx = FRAMEWORKS.findIndex((f) => f.id === fwLens.framework);
          fwLens.setFramework(FRAMEWORKS[(idx + 1) % FRAMEWORKS.length].id);
        }}
      />
      <CycleChip
        label="◇ Lens"
        value={ln?.label ?? "OFF"}
        active={fwLens.lens !== "none"}
        title={ln?.blurb ?? ""}
        onClick={() => {
          const idx = LENSES.findIndex((l) => l.id === fwLens.lens);
          fwLens.setLens(LENSES[(idx + 1) % LENSES.length].id);
        }}
      />
      <span className="ml-auto text-[10px] text-text-muted">
        click chips to cycle · these prepend to every prompt
      </span>
    </div>
  );
}

function CycleChip({
  label,
  value,
  active,
  title,
  onClick,
}: {
  label: string;
  value: string;
  active: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-accent-border bg-accent-soft text-accent"
          : "border-border bg-surface text-text-muted hover:bg-surface-warm"
      }`}
    >
      <span>{label}:</span>
      <span className="font-semibold">{value}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CHAT PANEL

interface ChatMessage {
  role: "user" | "assistant";
  cli?: string;
  content: string;
  ts: number;
  streaming?: boolean;
}

// Council is for "why" / "should I" / steelman / decision questions —
// the kinds of asks where multiple model perspectives + a chair help.
// These hints surface when the council is idle so the user knows what
// it's good at.
function buildCouncilQuickActions(domain: string | null): { glyph: string; label: string; blurb: string; prompt: string }[] {
  const d = domain ? titleCase(domain) : "this domain";
  return [
    {
      glyph: "⚖",
      label: "Decision",
      blurb: "Should I do X or Y?",
      prompt: `I'm trying to decide between two paths in ${d}. Walk me through both with their trade-offs, name the assumptions each makes, and tell me which one wins under what conditions. Then commit to a recommendation.`,
    },
    {
      glyph: "?",
      label: "Why",
      blurb: "Why is this hard?",
      prompt: `Why is my current ${d} situation harder than it looks on paper? What second-order effects, hidden constraints, or psychological frictions am I underestimating?`,
    },
    {
      glyph: "✗",
      label: "Steelman",
      blurb: "Where am I wrong?",
      prompt: `Steelman the strongest case AGAINST my current ${d} plan. Don't be polite — name the specific failure modes, who would tell me I'm wrong and why, and the one assumption that would invalidate the whole approach.`,
    },
    {
      glyph: "▸",
      label: "Reframe",
      blurb: "Bigger question?",
      prompt: `Is this even the right question to be asking about ${d}? What's a larger or different framing that would dissolve the dilemma — or expose a question I should be asking instead?`,
    },
    {
      glyph: "◆",
      label: "Trade-off",
      blurb: "Hidden cost?",
      prompt: `What's the trade-off in my ${d} plan I'm undervaluing? What am I giving up by choosing this path that I haven't priced in yet?`,
    },
    {
      glyph: "●",
      label: "Stakes",
      blurb: "What's at risk?",
      prompt: `If I'm wrong about ${d}, what's the cost? Rank the failure scenarios by impact and reversibility — which mistakes are recoverable, and which are not?`,
    },
  ];
}

function buildQuickActions(domain: string | null): { glyph: string; label: string; prompt: string }[] {
  const d = domain ? titleCase(domain) : "this domain";
  return [
    { glyph: "◆", label: "Status", prompt: `Read state.md for ${d} and summarize where I am right now in 5 bullets.` },
    { glyph: "◇", label: "Next action", prompt: `Given the current ${d} state, what's the single highest-leverage next action I should take this week? Be specific.` },
    { glyph: "▸", label: "Decision", prompt: `Walk me through the most important open decision in ${d} right now — options, trade-offs, and your recommendation.` },
    { glyph: "●", label: "Risks", prompt: `What are the top 3 risks or blind spots in my ${d} plan? Rank by severity.` },
  ];
}

// Full domain home view — shown when a domain is selected but the
// chat hasn't started yet. Surfaces state / decisions / journal /
// session logs / skills as tabs so the user can read the domain
// before asking. Clicking a tab item primes it into the next prompt.
function DomainHome({
  domain,
  vaultPath,
  onInjectContext,
  onPickPrompt,
  onInsertSkill,
  preferredSet,
  onTogglePreferred,
}: {
  domain: string;
  vaultPath: string;
  onInjectContext: (body: string, label: string) => void;
  onPickPrompt: (text: string) => void;
  onInsertSkill: (name: string) => void;
  preferredSet: Set<string>;
  onTogglePreferred: (name: string) => void;
}) {
  type Tab = "chat" | "state" | "decisions" | "journal" | "logs" | "skills";
  // Chat is the default — state is already auto-loaded as context, so
  // we don't dump the user into the state doc on entry.
  const [tab, setTab] = useState<Tab>("chat");
  const [ctx, setCtx] = useState<DomainContextBundle | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => { if (mounted) setCtx(c); })
      .catch(() => { if (mounted) setCtx(null); })
      .finally(() => { if (mounted) setLoading(false); });
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

  // Suppress unused warning — kept for future read-only views.
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
        {loading && <div className="text-sm text-text-muted">loading domain context…</div>}
        {!loading && ctx && (
          <div>
            {tab === "chat" && (
              <ul className="mx-auto flex max-w-2xl flex-col gap-2">
                {buildQuickActions(domain).map((q) => (
                  <li key={q.label}>
                    <button
                      onClick={() => onPickPrompt(q.prompt)}
                      className="block w-full rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-accent-border hover:shadow-md"
                    >
                      <div className="font-mono text-[11px] uppercase tracking-wider text-accent">
                        <span className="mr-1">{q.glyph}</span>{q.label}
                      </div>
                      <div className="mt-1 text-sm leading-relaxed text-text-secondary">
                        {q.prompt}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
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
                  no journal entries yet — they accumulate as you save sessions.
                </div>
              )
            )}
            {tab === "logs" && (
              ctx.recent_logs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                  no past sessions. Start chatting — each "New chat" saves a session to _log/.
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
        <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2">
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

// Skills list — stacked floating cards centered in column. Click a
// row to expand and read the SKILL.md inline; secondary actions
// insert the /skillname or open the folder in Finder.
// Compact agent picker for the no-domain landing. Each available CLI
// is a brand glyph that animates its label out on hover; the active
// agent stays expanded. Clicking sets the chat panel's primary CLI.
// Full-canvas preferences panel for the currently-selected domain.
// Replaces the popover. Every control writes to localStorage on
// click; no save button — picks are immediate. Pickers use brand
// icons for CLIs, prose labels for everything else.
function DomainPrefsPanel({
  domain,
  clis,
  skills,
  preferredSkills,
  onTogglePreferredSkill,
  onChanged,
}: {
  domain: string;
  clis: CliInfo[];
  skills: SkillEntry[];
  preferredSkills: string[];
  onTogglePreferredSkill: (name: string) => void;
  onChanged: () => void;
}) {
  // Read overrides directly so save buttons are unnecessary —
  // bump tick on every write so this component re-renders.
  const [tick, setTick] = useState(0);
  const force = () => { setTick((t) => t + 1); onChanged(); };
  void tick;

  const cliKey = `prevail.domain.${domain}.cli`;
  const modelKey = `prevail.domain.${domain}.model`;
  const fwKey = `prevail.domain.${domain}.framework`;
  const lensKey = `prevail.domain.${domain}.lens`;
  const autoStateKey = `prevail.domain.${domain}.autoState`;

  const pickedCli = lsGet(cliKey);
  const pickedModel = lsGet(modelKey);
  const pickedFw = lsGet(fwKey);
  const pickedLens = lsGet(lensKey);
  const autoState = lsGet(autoStateKey) !== "0";

  function setOverride(key: string, value: string) {
    lsSet(key, value);
    force();
  }

  const cliModels = pickedCli ? (MODELS[pickedCli] ?? []) : [];

  return (
    <div className="mx-auto w-full max-w-4xl px-2 py-2">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            ◆ {titleCase(domain)}
          </div>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">Preferences</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Domain-only overrides. Pickers apply on the next reload of this domain; global defaults still apply when these are unset.
          </p>
        </div>
        <button
          onClick={() => {
            for (const k of [cliKey, modelKey, fwKey, lensKey, autoStateKey, `prevail.domain.${domain}.skills`]) {
              lsSet(k, "");
            }
            force();
          }}
          className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
        >
          reset all
        </button>
      </div>

      {/* CLI picker — brand-icon cards */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">CLI</div>
            <p className="mt-0.5 text-sm text-text-secondary">Which agent runs every prompt in {titleCase(domain)}.</p>
          </div>
          {pickedCli && (
            <button
              onClick={() => setOverride(cliKey, "")}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
            >
              use global
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {clis.map((c) => {
            const picked = pickedCli === c.id;
            const disabled = !c.available;
            return (
              <button
                key={c.id}
                disabled={disabled}
                onClick={() => setOverride(cliKey, c.id)}
                title={disabled ? `${c.label} not installed` : c.label}
                className={`group relative flex flex-col items-center gap-1.5 rounded-lg border-2 px-2 py-3 transition-all ${
                  picked
                    ? "border-accent bg-accent-soft shadow-md ring-2 ring-accent/30"
                    : disabled
                    ? "border-border-subtle bg-background opacity-40"
                    : "border-border bg-background hover:-translate-y-px hover:border-accent-border hover:shadow-sm"
                }`}
              >
                {picked && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-background shadow-sm">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                <ProviderMark vendor={c.id} size={32} />
                <span className={`font-display text-sm font-semibold tracking-tight ${picked ? "text-accent" : "text-text-primary"}`}>
                  {c.label}
                </span>
                {picked && (
                  <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-background">
                    selected
                  </span>
                )}
                {disabled && (
                  <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">not installed</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Model picker — depends on CLI */}
      {pickedCli && cliModels.length > 0 && (
        <section className="mb-6 rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Model</div>
              <p className="mt-0.5 text-sm text-text-secondary">Locked to the CLI you picked above.</p>
            </div>
            {pickedModel && (
              <button
                onClick={() => setOverride(modelKey, "")}
                className="rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
              >
                use cli default
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {cliModels.map((m) => {
              const picked = pickedModel === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setOverride(modelKey, m.id)}
                  className={`flex items-center justify-between gap-3 rounded-md border-2 px-3 py-2 text-left transition-colors ${
                    picked
                      ? "border-accent bg-accent-soft ring-2 ring-accent/20"
                      : "border-border-subtle bg-background hover:border-accent-border"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm ${picked ? "font-semibold text-accent" : "text-text-primary"}`}>{m.label}</span>
                      {picked && (
                        <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-background">
                          selected
                        </span>
                      )}
                    </div>
                    {m.blurb && <div className="mt-0.5 text-[11px] text-text-muted">{m.blurb}</div>}
                  </div>
                  {picked && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-background">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Framework + Lens — two columns side-by-side */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2">
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
      </section>

      {/* Skills — star-toggle list with avatars */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Skills</div>
            <p className="mt-0.5 text-sm text-text-secondary">
              Pinned skills auto-attach to every new chat in {titleCase(domain)}.
              <span className="ml-2 font-mono text-[10px] text-text-muted">★ pinned · ☆ tap to pin</span>
            </p>
          </div>
        </div>
        {skills.length === 0 ? (
          <div className="rounded border border-dashed border-border bg-background p-4 text-sm text-text-muted">
            No skills under <code className="text-accent">{titleCase(domain)}/skills/</code> yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
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
        )}
      </section>

      {/* Behavior toggles */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Behavior</div>
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-semibold text-text-primary">Auto-attach state.md</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {autoState
                ? "Each new chat starts with state.md as a context chip you can remove."
                : "Manual — drag the domain in or use the Context drawer to attach state.md."}
            </div>
          </div>
          <Toggle
            on={autoState}
            onChange={(v) => { lsSet(autoStateKey, v ? "1" : "0"); force(); }}
            label="Auto-attach state.md"
          />
        </div>
      </section>
    </div>
  );
}

function PrefPickerColumn({
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
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
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
              className={`flex items-start gap-2 rounded-md border-2 px-3 py-2 text-left transition-colors ${
                picked
                  ? "border-accent bg-accent-soft ring-2 ring-accent/20"
                  : "border-border-subtle bg-background hover:border-accent-border"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-sm ${picked ? "font-semibold text-accent" : "text-text-primary"}`}>{o.label}</span>
                  {picked && (
                    <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-background">
                      selected
                    </span>
                  )}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">{o.blurb}</div>
              </div>
              {picked && (
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-background">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgentPickerRail({
  clis,
  selected,
  onSelect,
}: {
  clis: CliInfo[];
  selected: string | null;
  onSelect: (cliId: string) => void;
}) {
  if (clis.length === 0) return null;
  return (
    <div className="mt-6 flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-1 shadow-sm">
      {clis.map((c) => {
        const active = c.id === selected;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            title={c.label}
            className={`group flex items-center gap-2 rounded-full px-2 py-1 transition-all ${
              active ? "bg-surface-warm" : "hover:bg-surface-warm"
            }`}
          >
            <ProviderMark vendor={c.id} size={24} />
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

function SkillsList({
  skills,
  onInsert,
  preferredSet,
  onTogglePreferred,
}: {
  skills: SkillEntry[];
  onInsert: (name: string) => void;
  preferredSet?: Set<string>;
  onTogglePreferred?: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  async function toggle(path: string) {
    if (expanded === path) { setExpanded(null); return; }
    setExpanded(path);
    if (!content[path]) {
      setLoading(path);
      try {
        const body = await invoke<string>("read_skill", { path });
        setContent((c) => ({ ...c, [path]: body }));
      } catch (e) {
        setContent((c) => ({ ...c, [path]: `(error reading: ${e})` }));
      } finally {
        setLoading(null);
      }
    }
  }
  async function openFolder(path: string) {
    try { await invoke("open_in_finder", { path }); } catch {}
  }
  return (
    <ul className="mx-auto flex max-w-2xl flex-col gap-2">
      {skills.map((s) => {
        const open = expanded === s.path;
        return (
          <li key={s.path}>
            <div className={`rounded-xl border bg-surface shadow-sm transition-all ${open ? "border-accent-border" : "border-border"}`}>
              <div className="flex w-full items-start gap-2 rounded-t-xl">
                <button
                  onClick={() => toggle(s.path)}
                  className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left hover:bg-surface-warm rounded-tl-xl"
                >
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm font-semibold text-accent">/{s.name}</div>
                    {(() => {
                      const cleaned = (s.description ?? "").replace(/^[>*\-\s]+/, "").trim();
                      if (cleaned.length < 3) return null;
                      return (
                        <div className="mt-0.5 text-sm leading-snug text-text-secondary">{cleaned}</div>
                      );
                    })()}
                  </div>
                  <span className="ml-2 mt-1 text-xs text-text-muted">{open ? "▾" : "▸"}</span>
                </button>
                {onTogglePreferred && (
                  <button
                    onClick={() => onTogglePreferred(s.name)}
                    title={preferredSet?.has(s.name) ? "Unpin — won't auto-attach to new chats" : "Pin — auto-attach to new chats in this domain"}
                    className={`mr-2 mt-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors ${
                      preferredSet?.has(s.name)
                        ? "border-accent-border bg-accent-soft text-accent"
                        : "border-border bg-background text-text-muted hover:border-accent-border hover:text-accent"
                    }`}
                  >
                    {preferredSet?.has(s.name) ? "★" : "☆"}
                  </button>
                )}
              </div>
              {open && (
                <div className="border-t border-border-subtle px-4 py-3">
                  {loading === s.path ? (
                    <div className="text-xs text-text-muted">loading…</div>
                  ) : content[s.path] ? (
                    <div className="max-h-80 overflow-y-auto rounded-md border border-border-subtle bg-background px-3 py-2">
                      <Markdown source={content[s.path]} compact />
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => onInsert(s.name)}
                      className="rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                    >
                      insert /{s.name}
                    </button>
                    <button
                      onClick={() => openFolder(s.path)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                    >
                      <Folder className="h-3 w-3" />
                      open folder
                    </button>
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Side drawer that shows the current domain's state.md, decisions,
// journal, recent session logs, and skills. Loaded on-demand via the
// `domain_context` Rust command. Items can be "used in chat" to
// inject as prompt context.
function DomainContextDrawer({
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
    state: false, decisions: false, journal: false, logs: false, skills: false,
  });
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    const v = parseInt(lsGet("prevail.contextDrawer.width"), 10);
    return Number.isFinite(v) && v > 0 ? v : 320;
  });
  useEffect(() => { lsSet("prevail.contextDrawer.width", String(drawerWidth)); }, [drawerWidth]);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => { if (mounted) { setCtx(c); setErr(null); } })
      .catch((e) => { if (mounted) setErr(String(e)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [vaultPath, domain]);

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
      <aside className="flex shrink-0 flex-col border-l border-border-subtle bg-surface" style={{ width: drawerWidth }}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Context</div>
          <div className="font-display text-base font-semibold">
            <span className="text-accent">◆</span> {titleCase(domain)}
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          title="Hide context"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-text-muted">loading…</div>}
        {err && <div className="m-2 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">{err}</div>}
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
              ) : <div className="text-xs text-text-muted">no state.md found</div>
            } />
            <Section keyName="decisions" title="Decisions" body={
              ctx.decisions ? (
                <>
                  <button
                    onClick={() => onInjectContext(ctx.decisions!, `${titleCase(domain)}/decisions.md`)}
                    className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                  >
                    → use in chat
                  </button>
                  <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {ctx.decisions.length > 1200 ? ctx.decisions.slice(0, 1200) + "\n…" : ctx.decisions}
                  </pre>
                </>
              ) : <div className="text-xs text-text-muted">no decisions.md found</div>
            } />
            <Section keyName="journal" title="Journal" body={
              ctx.journal ? (
                <>
                  <button
                    onClick={() => onInjectContext(ctx.journal!, `${titleCase(domain)}/_journal`)}
                    className="mb-2 rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                  >
                    → use in chat
                  </button>
                  <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                    {ctx.journal.length > 1500 ? ctx.journal.slice(0, 1500) + "\n…" : ctx.journal}
                  </pre>
                </>
              ) : <div className="text-xs text-text-muted">no _journal.md or _journal/ found</div>
            } />
            <Section keyName="logs" title="Session logs" count={ctx.recent_logs.length} body={
              ctx.recent_logs.length === 0 ? (
                <div className="text-xs text-text-muted">no entries in _log/ yet</div>
              ) : (
                <ul className="space-y-1">
                  {ctx.recent_logs.map((l) => (
                    <li key={l.path}>
                      <button
                        onClick={async () => {
                          try {
                            const body = await invoke<string>("read_file", { path: l.path });
                            onInjectContext(body, l.name);
                          } catch (e) { console.error(e); }
                        }}
                        className="w-full rounded border border-border-subtle bg-background px-2 py-1.5 text-left hover:border-accent-border hover:bg-surface-warm"
                      >
                        <div className="font-mono text-[11px] text-text-primary">{l.name}</div>
                        {l.preview && <div className="mt-0.5 line-clamp-2 text-[10px] text-text-muted">{l.preview}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )
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
                          title={preferredSet?.has(s.name) ? "Unpin" : "Pin — auto-attach"}
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
      <div className="border-t border-border-subtle px-4 py-2 font-mono text-[10px] text-text-muted" title={domainPath}>
        {domainPath.split("/").slice(-3).join("/")}
      </div>
      </aside>
    </div>
  );
}

// Drawer section that surfaces a domain's ingested imports without
// the user having to navigate to Settings → Ingestion. Click a row
// to load the first chunk into the chat as primed context, or
// "reveal" to open in Finder. Read-only — toggling for attachment
// happens via the chips above the composer.
function DrawerImportsSection({
  domain,
  onInject,
}: {
  domain: string;
  onInject: (body: string, label: string) => void;
}) {
  const [items, setItems] = useState<{ path: string; name: string; size: number; mtime: number }[]>([]);
  useEffect(() => {
    let mounted = true;
    invoke<{ path: string; name: string; size: number; mtime: number }[]>(
      "ingestion_list_artifacts",
      { domain },
    )
      .then((rows) => { if (mounted) setItems(rows); })
      .catch(() => { if (mounted) setItems([]); });
    return () => { mounted = false; };
  }, [domain]);

  async function vacuum(days: number) {
    if (!window.confirm(`Delete imports older than ${days} days from ${titleCase(domain)}?`)) return;
    try {
      const n = await invoke<number>("ingestion_vacuum_imports", { domain, olderThanDays: days });
      if (n > 0) {
        // Reload the list — easier than diffing.
        const next = await invoke<{ path: string; name: string; size: number; mtime: number }[]>(
          "ingestion_list_artifacts", { domain },
        );
        setItems(next);
      }
    } catch (e) { console.error(e); }
  }
  if (items.length === 0) return null;
  return (
    <div className="border-b border-border-subtle">
      <div className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
          <span className="text-accent">▾</span> Imports
          <span className="text-text-muted">· {items.length}</span>
        </span>
        <button
          onClick={() => void vacuum(90)}
          title="Delete imports older than 90 days"
          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
        >
          vacuum 90d
        </button>
      </div>
      <div className="px-4 pb-2">
        <ul className="space-y-1">
          {items.slice(0, 12).map((it) => (
            <li key={it.path} className="flex items-stretch gap-1">
              <button
                onClick={async () => {
                  try {
                    const body = await invoke<string>("read_file", { path: it.path });
                    onInject(body.slice(0, 6000), it.name);
                  } catch (e) { console.error(e); }
                }}
                className="flex-1 rounded border border-border-subtle bg-background px-2 py-1.5 text-left hover:border-accent-border hover:bg-surface-warm"
              >
                <div className="truncate font-mono text-[11px] text-text-primary">{it.name}</div>
                <div className="font-mono text-[10px] text-text-muted">
                  {(it.size / 1024).toFixed(1)} KB
                </div>
              </button>
              <button
                onClick={() => invoke("open_in_finder", { path: it.path })}
                title="Reveal in Finder"
                className="shrink-0 rounded border border-border-subtle bg-background px-2 font-mono text-[10px] text-text-muted hover:border-accent-border hover:text-accent"
              >
                ↗
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ChatPanel({
  domain,
  domainPath,
  vaultPath,
  clis,
  fwLens,
  onSwitchToCouncil,
  onOpenInFinder,
  activeThreadPath,
  onActiveThreadChange,
  onThreadsChanged,
  onStreamStart,
  onStreamEnd,
  domains,
  domainStats,
  runningDomains,
  onPickDomain,
}: {
  domain: string | null;
  domainPath: string | null;
  vaultPath: string;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
  onSwitchToCouncil: () => void;
  onOpenInFinder: () => void;
  activeThreadPath: string | null;
  onActiveThreadChange: (p: string | null) => void;
  onThreadsChanged: () => void;
  onStreamStart: (s: { sessionId: string; domain: string | null; threadPath: string | null; title: string; startedAt: number }) => void;
  onStreamEnd: (sessionId: string) => void;
  domains: Domain[];
  domainStats: Record<string, number>;
  runningDomains: Set<string>;
  onPickDomain: (name: string) => void;
}) {
  const available = useMemo(() => clis.filter((c) => c.available), [clis]);
  // Per-domain model preference. Keys: prevail.domain.<name>.cli and
  // prevail.domain.<name>.model. When set, override the global default
  // while in that domain. Global default kicks in for no-domain chats
  // or domains without an override.
  const domainCliKey = domain ? `prevail.domain.${domain}.cli` : "";
  const domainModelKey = domain ? `prevail.domain.${domain}.model` : "";
  const [selectedCli, setSelectedCli] = useState<string | null>(() => {
    const domSaved = domain ? lsGet(`prevail.domain.${domain}.cli`) : "";
    return domSaved || lsGet(LS.defaultChatCli) || null;
  });
  // Per-CLI model selection — persisted to localStorage as
  // prevail.model.<cli>. Defaults to first model for that CLI when no
  // saved choice exists.
  const [modelByCli, setModelByCli] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of clis) {
      out[c.id] = lsGet(`prevail.model.${c.id}`) || (MODELS[c.id]?.[0]?.id ?? "");
    }
    return out;
  });
  // When the active domain changes, swap to that domain's preferred
  // (cli, model, framework, lens) if one is set. Falls back to the
  // global default.
  useEffect(() => {
    if (!domain) {
      const globalCli = lsGet(LS.defaultChatCli);
      if (globalCli) setSelectedCli(globalCli);
      // Restore global framework/lens when leaving a domain.
      const globalFw = lsGet(LS.framework, "none");
      const globalLn = lsGet(LS.lens, "none");
      if (globalFw && globalFw !== fwLens.framework) fwLens.setFramework(globalFw);
      if (globalLn && globalLn !== fwLens.lens) fwLens.setLens(globalLn);
      return;
    }
    const domCli = lsGet(`prevail.domain.${domain}.cli`);
    const domModel = lsGet(`prevail.domain.${domain}.model`);
    if (domCli) {
      setSelectedCli(domCli);
      if (domModel) {
        setModelByCli((cur) => ({ ...cur, [domCli]: domModel }));
      }
    }
    const domFw = lsGet(`prevail.domain.${domain}.framework`);
    const domLn = lsGet(`prevail.domain.${domain}.lens`);
    if (domFw) fwLens.setFramework(domFw);
    if (domLn) fwLens.setLens(domLn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);
  // Mirror framework/lens changes into the domain key when in a domain.
  // useFrameworkLens's own effect already writes the global key, so we
  // just extend with a per-domain pin here.
  useEffect(() => {
    if (!domain) return;
    lsSet(`prevail.domain.${domain}.framework`, fwLens.framework);
  }, [domain, fwLens.framework]);
  useEffect(() => {
    if (!domain) return;
    lsSet(`prevail.domain.${domain}.lens`, fwLens.lens);
  }, [domain, fwLens.lens]);
  const selectedModel = selectedCli ? (modelByCli[selectedCli] ?? "") : "";
  const setSelectedModel = (cli: string, m: string) => {
    setModelByCli((cur) => ({ ...cur, [cli]: m }));
    lsSet(`prevail.model.${cli}`, m);
    // If we're in a domain, also save it as the domain's preference
    // so this becomes the default next time the user picks this domain.
    if (domain) {
      lsSet(domainCliKey, cli);
      lsSet(domainModelKey, m);
    }
  };
  // Reset the domain's per-(cli,model) override so global default
  // applies again.
  function clearDomainModelOverride() {
    if (!domain) return;
    lsSet(domainCliKey, "");
    lsSet(domainModelKey, "");
  }
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [modelMenuOpen]);
  const [input, setInput] = useState("");
  // User-level profile (vault/user.md) — auto-included as preamble so
  // the model knows who's asking. Loaded once per vault path.
  const [userMd, setUserMd] = useState<string>("");
  useEffect(() => {
    if (!vaultPath) return;
    invoke<string>("read_user_md", { vault: vaultPath })
      .then(setUserMd)
      .catch(() => setUserMd(""));
  }, [vaultPath]);
  // Domain context drawer — opens to the right showing state.md,
  // decisions, journal, recent logs, skills. Items can be "used in
  // chat" to inject as prompt context.
  const [contextOpen, setContextOpen] = useState(false);
  const [primedContext, setPrimedContext] = useState<{ label: string; body: string }[]>([]);
  function injectContext(body: string, label: string) {
    setPrimedContext((cur) => {
      if (cur.some((c) => c.label === label)) return cur;
      return [...cur, { label, body }];
    });
  }
  // Per-domain preferences popover — explicit view of overrides saved
  // for this domain with reset controls. Implicit auto-save still
  // happens in pickers; this only surfaces + clears the result.
  const [prefsTick, setPrefsTick] = useState(0);
  const hasAnyDomainOverride = useMemo(() => {
    if (!domain) return false;
    return Boolean(
      lsGet(`prevail.domain.${domain}.cli`) ||
      lsGet(`prevail.domain.${domain}.model`) ||
      lsGet(`prevail.domain.${domain}.framework`) ||
      lsGet(`prevail.domain.${domain}.lens`) ||
      lsGet(`prevail.domain.${domain}.skills`)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, prefsTick]);
  // Skills attached to the next send. Decoupled from the textarea so
  // editing the prompt text doesn't affect them, and the user removes
  // them from the pills below — not by editing prompt text.
  const [attachedSkills, setAttachedSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  const [preferredSkills, setPreferredSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  // Persistent domain tab. "chat" shows the transcript; the other
  // tabs replace the transcript with the domain's reference content.
  // Composer stays at the bottom regardless of tab.
  type DomainTab = "chat" | "state" | "decisions" | "journal" | "logs" | "skills" | "prefs";
  const [domainTab, setDomainTab] = useState<DomainTab>("chat");
  const [domainCtx, setDomainCtx] = useState<DomainContextBundle | null>(null);
  useEffect(() => {
    setDomainTab("chat");
    const pref = loadPreferredSkills(domain);
    setPreferredSkills(pref);
    setAttachedSkills(pref);
    if (!domain || !vaultPath) { setDomainCtx(null); return; }
    let mounted = true;
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => { if (mounted) setDomainCtx(c); })
      .catch(() => { if (mounted) setDomainCtx(null); });
    return () => { mounted = false; };
  }, [domain, vaultPath]);
  const togglePreferredSkill = useCallback((name: string) => {
    setPreferredSkills((cur) => {
      const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
      savePreferredSkills(domain, next);
      return next;
    });
    // Mirror into currently attached set so the change is visible
    // immediately in the composer pills.
    setAttachedSkills((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  }, [domain]);
  const preferredSkillsSet = useMemo(() => new Set(preferredSkills), [preferredSkills]);
  function insertSkillSlash(name: string) {
    setAttachedSkills((cur) => (cur.includes(name) ? cur : [...cur, name]));
  }
  function removeAttachedSkill(name: string) {
    setAttachedSkills((cur) => cur.filter((n) => n !== name));
  }
  // Auto-prime the domain's state.md so the AI has context without
  // the user having to click "use in chat" in the drawer. Labels start
  // with "auto:" so they get cleared when the domain switches.
  useEffect(() => {
    if (!domain || !vaultPath) {
      setPrimedContext((cur) => cur.filter((x) => !x.label.startsWith("auto:")));
      return;
    }
    // Per-domain opt-out — when prevail.domain.<name>.autoState === "0"
    // we skip auto-attaching state.md. Default is on.
    if (lsGet(`prevail.domain.${domain}.autoState`) === "0") {
      setPrimedContext((cur) => cur.filter((x) => !x.label.startsWith("auto:")));
      return;
    }
    let mounted = true;
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then((c) => {
        if (!mounted) return;
        const label = `auto: ${titleCase(domain)}/state.md`;
        setPrimedContext((cur) => {
          const cleared = cur.filter((x) => !x.label.startsWith("auto:"));
          if (!c.state) return cleared;
          return [...cleared, { label, body: c.state }];
        });
      })
      .catch(() => {/* ignore */});
    return () => { mounted = false; };
    // prefsTick bumps when popover toggles the autoState pref, so the
    // effect re-runs without needing the user to re-enter the domain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, vaultPath, prefsTick]);
  const [attachments, setAttachments] = useState<string[]>([]);
  // Ingested artifacts for this domain. Auto-fetched on entry so the
  // user can flip a chip to attach them to the next turn without
  // hunting through Finder.
  type DomainImport = {
    path: string;
    name: string;
    size: number;
    mtime: number;
    meta: { source?: string; tier_id?: string; sha256?: string } | null;
  };
  const [domainImports, setDomainImports] = useState<DomainImport[]>([]);
  useEffect(() => {
    if (!domain) { setDomainImports([]); return; }
    let mounted = true;
    invoke<DomainImport[]>("ingestion_list_artifacts", { domain })
      .then((rows) => { if (mounted) setDomainImports(rows); })
      .catch(() => { if (mounted) setDomainImports([]); });
    return () => { mounted = false; };
  }, [domain]);
  // Local recall history — arrow-up cycles backward, arrow-down forward.
  const HISTORY_KEY = `prevail.chat.history.${domain ?? "_root"}`;
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const raw = lsGet(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [histIdx, setHistIdx] = useState<number>(-1);
  useEffect(() => {
    try { lsSet(HISTORY_KEY, JSON.stringify(history.slice(-50))); } catch { /* ignore */ }
  }, [history, HISTORY_KEY]);
  async function pickAttachment() {
    try {
      const picked = await open({ multiple: true, directory: false });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      setAttachments((cur) => [...cur, ...paths.filter((p): p is string => typeof p === "string")]);
      setPlusOpen(false);
    } catch (e) {
      console.error("pickAttachment", e);
    }
  }
  const [plusOpen, setPlusOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const [skillsCache, setSkillsCache] = useState<SkillEntry[]>([]);
  useEffect(() => {
    if (!plusOpen) return;
    const onClick = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [plusOpen]);
  // Pre-fetch skills whenever the domain changes so both the `+`
  // menu and the slash-autocomplete have a populated cache.
  useEffect(() => {
    if (!domain || !vaultPath) {
      setSkillsCache([]);
      return;
    }
    invoke<SkillEntry[]>("scan_skills", { vault: vaultPath })
      .then((s) => setSkillsCache(s.filter((sk) => sk.domain === domain)))
      .catch(() => setSkillsCache([]));
  }, [domain, vaultPath]);
  // Slash autocomplete — detect `/<word>` at the caret position and
  // expose the filtered skills + a completer for the textarea below.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const slashMatch = useMemo(() => {
    const ta = taRef.current;
    if (!ta) return null;
    const caret = ta.selectionStart ?? input.length;
    const before = input.slice(0, caret);
    // Match the trailing /<word> right at the caret.
    const m = before.match(/(^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (!m) return null;
    const start = caret - m[2].length - 1; // index of the `/`
    return { token: m[2], start, end: caret };
  }, [input]);
  const slashCandidates = useMemo(() => {
    if (!slashMatch) return [];
    const q = slashMatch.token.toLowerCase();
    return skillsCache
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [slashMatch, skillsCache]);
  const [slashIdx, setSlashIdx] = useState(0);
  useEffect(() => { setSlashIdx(0); }, [slashMatch?.token]);
  function applySlashCompletion(name: string) {
    if (!slashMatch) return;
    // Remove the /partial from the textarea and add the skill to the
    // attached-skills pill row instead. Keeps the prompt clean.
    const head = input.slice(0, slashMatch.start).replace(/\s$/, "");
    const tail = input.slice(slashMatch.end);
    const next = `${head}${head && tail && !tail.startsWith(" ") ? " " : ""}${tail}`;
    setInput(next);
    insertSkillSlash(name);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(head.length, head.length);
    });
  }
  function attachDomainState() {
    if (!domain || !domainPath) return;
    setAttachments((cur) => [...cur, `${domainPath}/state.md`]);
    setPlusOpen(false);
  }
  function insertSkillRef(skill: SkillEntry) {
    setInput((cur) => `${cur}${cur && !cur.endsWith(" ") ? " " : ""}/${skill.name} `);
    setPlusOpen(false);
  }
  function pushHistory(prompt: string) {
    setHistory((h) => (h[h.length - 1] === prompt ? h : [...h, prompt]));
    setHistIdx(-1);
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Use a ref for the active thread path so async saves don't capture
  // a stale closure value. Without this, every streaming chunk after
  // the first save still saw activeThreadPath=null and created a new
  // file — hence the duplicates the user reported.
  const activeThreadRef = useRef<string | null>(activeThreadPath);
  useEffect(() => { activeThreadRef.current = activeThreadPath; }, [activeThreadPath]);
  // When the auto-save effect adopts a new path mid-stream we stamp
  // the path here. The load-on-change effect below uses this to skip
  // reloading from disk — the in-memory messages are already ahead of
  // what was saved (more chunks have arrived). Reloading would
  // overwrite them and the assistant placeholder loses streaming:true,
  // which is the original cause of the "(empty reply)" symptom.
  const selfSetPathRef = useRef<string | null>(null);
  // Load the thread when activeThreadPath changes.
  useEffect(() => {
    if (!activeThreadPath) { setMessages([]); return; }
    if (selfSetPathRef.current === activeThreadPath) {
      selfSetPathRef.current = null;
      return;
    }
    let cancelled = false;
    invoke<{ meta: ThreadMeta; turns: ThreadTurn[] }>("load_thread", { path: activeThreadPath })
      .then((t) => {
        if (cancelled) return;
        setMessages(t.turns.map((tn) => ({
          role: tn.role,
          cli: tn.cli ?? undefined,
          content: tn.content,
          ts: Date.now(),
        })));
      })
      .catch((e) => console.error("load_thread", e));
    return () => { cancelled = true; };
  }, [activeThreadPath]);
  // Auto-save the thread on every message change (debounced). Reads
  // the ref so each save reuses the existing slug once one exists.
  const saveTimer = useRef<number | null>(null);
  const savePendingRef = useRef<boolean>(false);
  // Extra guard: once a save with slug=null has been DISPATCHED, block
  // any further slug=null dispatches until activeThreadRef is set.
  // savePendingRef alone wasn't enough in practice — duplicates kept
  // appearing, suggesting a race where a second timer fires between
  // the first save dispatching and activeThreadRef being adopted.
  const initialSaveDispatchedRef = useRef<boolean>(false);
  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      if (savePendingRef.current) return; // serialize saves
      const wantSlugNull = !activeThreadRef.current;
      // At most ONE save with slug=null is allowed per ChatPanel
      // instance. We claim the right BEFORE any await so any other
      // timer that fires next sees the claim and bails. Released
      // only on the catch branch below so a transient failure can
      // be retried, but a successful slug=null save never happens
      // twice.
      if (wantSlugNull && initialSaveDispatchedRef.current) {
        console.log("[prevail/save_thread] BLOCK slug=null — already claimed");
        return;
      }
      if (wantSlugNull) initialSaveDispatchedRef.current = true;
      savePendingRef.current = true;
      try {
        const first = messages.find((m) => m.role === "user");
        const title = first ? first.content.slice(0, 60).replace(/\n/g, " ") : "untitled";
        const current = activeThreadRef.current;
        const slug = current ? current.split("/").pop()?.replace(/\.md$/, "") ?? null : null;
        console.log("[prevail/save_thread]", { slug, current, msgCount: messages.length, domain, t: Date.now() });
        const path = await invoke<string>("save_thread", {
          vault: vaultPath,
          domain: domain ?? null,
          slug,
          title,
          turns: messages.map((m) => ({
            role: m.role,
            cli: m.cli ?? null,
            model: null,
            content: m.content,
          })),
        });
        // Adopt the returned path so the NEXT save reuses the same slug.
        if (!activeThreadRef.current) {
          activeThreadRef.current = path;
          selfSetPathRef.current = path;
          onActiveThreadChange(path);
        }
        onThreadsChanged();
      } catch (e) {
        console.error("save_thread", e);
        // If we never got a path back, release the claim so a retry
        // can succeed. Otherwise the user would be stuck with no
        // saved thread until they restart.
        if (!activeThreadRef.current) initialSaveDispatchedRef.current = false;
      } finally {
        savePendingRef.current = false;
      }
    }, 600);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  const sessionRef = useRef(`s-${Date.now()}`);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedCli && available.length > 0) setSelectedCli(available[0].id);
  }, [available, selectedCli]);

  useEffect(() => {
    if (selectedCli) lsSet(LS.defaultChatCli, selectedCli);
  }, [selectedCli]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{ session: string; cli: string; stream: string; data: string }>(
        "chat:chunk",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (e.payload.stream !== "stdout") return;
          if (!mounted) return;
          // Process only the new chunk (not the growing accumulator)
          // to keep stream rendering O(n) instead of O(n²) for long
          // replies. Sycophancy patterns are short so re-scanning the
          // chunk is still cheap.
          const clean = maybeStripSycophancy(stripAnsi(e.payload.data));
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) {
              return [...m.slice(0, -1), { ...last, content: last.content + clean }];
            }
            return m;
          });
        },
      );
      const u2 = await listen<{ session: string; cli: string; code: number }>(
        "chat:done",
        (e) => {
          if (!mounted) return;
          // Always notify the App-level tracker so background streams
          // started in this panel get reconciled even after the user
          // navigates away. The App layer ignores unknown sessions.
          onStreamEnd(e.payload.session);
          if (e.payload.session !== sessionRef.current) return;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) return [...m.slice(0, -1), { ...last, streaming: false }];
            return m;
          });
        },
      );
      unlistenRefs.current = [u1, u2];
    })();
    return () => {
      mounted = false;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Bubble action handlers — shared across both renderers (in-domain
  // and no-domain). Copy uses the Clipboard API; Retry rewinds the
  // transcript to before the last user turn and resends; Edit pops
  // the user message back into the composer for revision.
  const copyToClipboard = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch (e) { console.error(e); }
  }, []);
  const retryFromHere = useCallback((index: number) => {
    // Find the user message that produced this assistant slot.
    let userIdx = index;
    while (userIdx >= 0 && messages[userIdx]?.role !== "user") userIdx--;
    if (userIdx < 0) return;
    const userMsg = messages[userIdx];
    // Drop everything from the user turn onward, then resend it.
    setMessages((m) => m.slice(0, userIdx));
    setInput(userMsg.content);
    // Defer send so React commits the slice + input update first.
    window.setTimeout(() => { void send(); }, 0);
  }, [messages]);
  const editFromHere = useCallback((text: string, index: number) => {
    // Rewind to just before this user message, repopulate the composer.
    setMessages((m) => m.slice(0, index));
    setInput(text);
    // Focus the textarea so the user can edit immediately.
    setTimeout(() => taRef.current?.focus(), 0);
  }, []);

  async function send() {
    if (!input.trim() || !selectedCli) return;
    const visible = input.trim();
    const userMsg: ChatMessage = { role: "user", content: visible, ts: Date.now() };
    const replyMsg: ChatMessage = { role: "assistant", cli: selectedCli, content: "", ts: Date.now(), streaming: true };
    setMessages((m) => [...m, userMsg, replyMsg]);
    // Attach file paths to the prompt so the CLI can read them.
    const attachPreamble = attachments.length > 0
      ? `Attached files (read these as context):\n${attachments.map((p) => `- ${p}`).join("\n")}\n\n`
      : "";
    // Items the user explicitly clicked "use in chat" on (state.md,
    // decisions.md, a session log, etc.) — included verbatim.
    const primedPreamble = primedContext.length > 0
      ? primedContext.map((c) => `--- ${c.label} ---\n${c.body.trim()}\n`).join("\n") + "\n"
      : "";
    const userPreamble = userMd.trim()
      ? `--- About the user (vault/user.md) ---\n${userMd.trim()}\n\n`
      : "";
    const skillsPreamble = attachedSkills.length > 0
      ? `Use the following skills as part of your reply: ${attachedSkills.map((n) => `/${n}`).join(", ")}\n\n`
      : "";
    // Build multi-turn context from prior messages. We pass it as a
    // single text payload because the CLIs spawn fresh each turn and
    // have no shared session. Cap at ~40K characters (~10K tokens) and
    // drop the oldest turns to fit, keeping at least the most recent.
    const history = buildChatContext(messages, 40000);
    const promptText = fwLens.buildPrompt(
      history
        ? `${userPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}You are mid-conversation. Below is the prior turn history; use it as context but do NOT repeat it back to the user.\n\n--- PRIOR TURNS ---\n${history}\n--- END PRIOR TURNS ---\n\nUser's next message: ${visible}`
        : `${userPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}${visible}`
    );
    pushHistory(visible);
    setAttachments([]);
    setAttachedSkills([]);
    setInput("");
    sessionRef.current = `s-${Date.now()}`;
    // Announce the stream so the sidebar can pulse the originating
    // domain even if the user navigates away while it runs.
    onStreamStart({
      sessionId: sessionRef.current,
      domain: domain ?? null,
      threadPath: activeThreadRef.current,
      title: visible.slice(0, 60).replace(/\n/g, " "),
      startedAt: Date.now(),
    });
    try {
      await invoke("chat_send", {
        args: {
          cli: selectedCli,
          model: lsGet(`prevail.model.${selectedCli}`) || null,
          prompt: promptText,
          session_id: sessionRef.current,
          timeout_sec: (() => { const n = parseInt(getPref(PREF.llmPromptTimeoutSec, "300"), 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
        },
      });
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `(error spawning ${selectedCli}: ${e})`, ts: Date.now() }]);
      onStreamEnd(sessionRef.current);
    }
  }

  // Quick-action seed prompts — currently surfaced via DomainHome,
  // not the no-domain landing (which shows the domains dashboard
  // instead). Keep the array allocation alive so DomainHome's
  // onPickPrompt continues to receive prompts.
  void buildQuickActions;

  const selectedCliLabel = selectedCli
    ? (clis.find((c) => c.id === selectedCli)?.label ?? selectedCli)
    : "no model";
  const selectedModelLabel = selectedModel
    ? (MODELS[selectedCli ?? ""]?.find((m) => m.id === selectedModel)?.label ?? selectedModel)
    : "";

  const [dragOver, setDragOver] = useState(false);
  // Resolve a drop payload to a domain name. Custom MIME first, then
  // text/plain "prevail-domain:<name>" sentinel, then any types we know.
  const resolveDroppedDomain = useCallback((dt: DataTransfer): string | null => {
    const direct = dt.getData("application/x-prevail-domain");
    if (direct) return direct;
    const txt = dt.getData("text/plain");
    if (txt && txt.startsWith("prevail-domain:")) return txt.slice("prevail-domain:".length);
    return null;
  }, []);
  const attachDomainAsContext = useCallback(async (name: string) => {
    if (!name || !vaultPath) return;
    try {
      const c = await invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain: name });
      if (c.state) injectContext(c.state, `extra: ${titleCase(name)}/state.md`);
      else injectContext(`(no state.md in ${name})`, `extra: ${titleCase(name)}/state.md`);
    } catch (err) { console.error("attach domain", err); }
  }, [vaultPath, injectContext]);
  // Test hook — expose on window so we can verify the inject flow
  // without dispatching synthetic DragEvents through WebKit. Call
  // window.__prevailAttach('tax') in DevTools to confirm the chip
  // appears in the composer.
  useEffect(() => {
    (window as unknown as { __prevailAttach?: (n: string) => void }).__prevailAttach = (n) => void attachDomainAsContext(n);
    return () => { try { delete (window as unknown as { __prevailAttach?: unknown }).__prevailAttach; } catch {} };
  }, [attachDomainAsContext]);
  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types);
        const hasCustom = types.includes("application/x-prevail-domain");
        const hasText = types.includes("text/plain");
        if (hasCustom || hasText) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        // Ignore leaves that bubble from descendants.
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={async (e) => {
        setDragOver(false);
        const name = resolveDroppedDomain(e.dataTransfer);
        if (!name) return;
        e.preventDefault();
        void attachDomainAsContext(name);
      }}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent-soft/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 font-mono text-sm uppercase tracking-wider text-accent shadow-xl">
            ⊕ drop to add as context
          </div>
        </div>
      )}
      {/* Header — domain title + persistent tab strip + actions. The
          tabs stay visible whether you're on the chat transcript or
          a domain content view, so you can flip between them mid
          conversation. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-6 py-2.5">
        {domain ? (
          <>
            <span className="text-accent">◆</span>
            <span className="font-display text-lg font-semibold">{titleCase(domain)}</span>
            {domainPath && (
              <button
                onClick={onOpenInFinder}
                title="Open domain folder in Finder"
                className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent"
              >
                <Folder className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setDomainTab("prefs")}
              title={hasAnyDomainOverride ? "Domain preferences (overrides active)" : "Domain preferences"}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                hasAnyDomainOverride
                  ? "text-accent hover:bg-accent-soft"
                  : "text-text-muted hover:bg-surface-warm hover:text-accent"
              }`}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </button>
            {/* Tab strip — persistent. State auto-loaded so the tab
                count badges reflect real content (1 if state exists,
                etc.). Click a non-Chat tab to view that doc; Chat
                returns you to the transcript. */}
            <nav className="ml-3 flex items-center gap-0.5 text-[11px] font-medium uppercase tracking-wider">
              {([
                { id: "chat", label: "Chat", count: undefined },
                { id: "state", label: "State", count: domainCtx?.state ? 1 : 0 },
                { id: "decisions", label: "Decisions", count: domainCtx?.decisions ? 1 : 0 },
                { id: "journal", label: "Journal", count: domainCtx?.journal ? 1 : 0 },
                { id: "logs", label: "Sessions", count: domainCtx?.recent_logs?.length ?? 0 },
                { id: "skills", label: "Skills", count: domainCtx?.skills?.length ?? 0 },
                { id: "prefs", label: "Prefs", count: undefined },
              ] as { id: DomainTab; label: string; count?: number }[]).map((t) => {
                const active = domainTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setDomainTab(t.id)}
                    className={`relative -mb-2.5 flex items-center gap-1 px-2 pb-3 pt-2 transition-colors ${
                      active ? "text-accent" : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {t.label}
                    {t.count !== undefined && (
                      <span className={`rounded-full px-1.5 py-0 font-mono text-[10px] ${active ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
                        {t.count}
                      </span>
                    )}
                    {active && <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-accent" />}
                  </button>
                );
              })}
            </nav>
          </>
        ) : (
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
            Chat
          </span>
        )}
        <div className="flex-1" />
        {messages.length > 0 && (
          <button
            onClick={async () => {
              // Persist the session before clearing so nothing is lost.
              if (messages.length > 0 && vaultPath) {
                try {
                  const first = messages.find((m) => m.role === "user");
                  const title = first ? first.content.slice(0, 80).replace(/\n/g, " ") : "session";
                  await invoke<string>("save_session", {
                    vault: vaultPath,
                    domain: domain ?? null,
                    title,
                    turns: messages.map((m) => ({
                      role: m.role,
                      cli: m.cli ?? null,
                      model: null,
                      content: m.content,
                    })),
                  });
                } catch (e) {
                  console.error("save_session failed", e);
                }
              }
              setMessages([]);
              setInput("");
              setAttachments([]);
              setPrimedContext([]);
            }}
            title="Save & clear — the session is appended to _log/"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:bg-accent-soft hover:text-accent"
          >
            <Plus className="h-3 w-3" />
            New chat
          </button>
        )}
        {domain && (
          <button
            onClick={() => setContextOpen((v) => !v)}
            title="Show domain state, decisions, journal, logs, skills"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
              contextOpen
                ? "border-accent-border bg-accent-soft text-accent"
                : "border-border bg-surface text-text-muted hover:border-accent-border hover:bg-accent-soft hover:text-accent"
            }`}
          >
            <BookOpen className="h-3 w-3" />
            Context{(() => {
              // Count only items the user actively added — auto-loaded
              // state.md is implicit and shouldn't pad this badge.
              const added = primedContext.filter((c) => !c.label.startsWith("auto:")).length;
              return added > 0 ? ` · ${added}` : "";
            })()}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !domain && (
          <div className="flex h-full flex-col items-center px-6 py-10">
            <img src="/logo.png" alt="" className="h-14 w-14 rounded-2xl opacity-90" />
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight">
              What should we work on?
            </h2>
            <p className="mt-2 max-w-md text-center text-sm text-text-muted">
              Start chatting, or pick a domain to ground the conversation in its state and history.
            </p>
            <AgentPickerRail
              clis={available}
              selected={selectedCli}
              onSelect={(id) => setSelectedCli(id)}
            />

            {domains.length > 0 && (() => {
              // Show pinned first, then ones with the most imports,
              // capped at 4. The full domain list still lives in the
              // sidebar — this landing surface is a quick-pick only.
              const pinnedSet = (() => {
                try { return new Set<string>(JSON.parse(lsGet("prevail.pinnedDomains") || "[]")); }
                catch { return new Set<string>(); }
              })();
              const ranked = [...domains].sort((a, b) => {
                const pa = pinnedSet.has(a.name) ? 1 : 0;
                const pb = pinnedSet.has(b.name) ? 1 : 0;
                if (pa !== pb) return pb - pa;
                const sa = domainStats[a.name] ?? 0;
                const sb = domainStats[b.name] ?? 0;
                if (sa !== sb) return sb - sa;
                return a.name.localeCompare(b.name);
              });
              const featured = ranked.slice(0, 4);
              return (
              <div className="mt-8 w-full max-w-4xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    Jump to · {featured.length} of {domains.length}
                  </div>
                  <span className="font-mono text-[10px] text-text-muted">more in sidebar</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {featured.map((d) => {
                    const Icon = DOMAIN_ICONS[d.name];
                    const importCount = domainStats[d.name] ?? 0;
                    const running = runningDomains.has(d.name);
                    return (
                      <button
                        key={d.name}
                        onClick={() => onPickDomain(d.name)}
                        className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-all hover:-translate-y-px hover:border-accent-border hover:shadow-md"
                      >
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                          {Icon ? <Icon className="h-4 w-4" /> : <span>◆</span>}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-sm font-semibold tracking-tight text-text-primary">
                              {titleCase(d.name)}
                            </span>
                            {running && (
                              <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-warn" title="A reply is streaming here" />
                            )}
                          </div>
                          {d.state_preview && (
                            <div className="mt-0.5 line-clamp-2 text-[11px] text-text-secondary">
                              {d.state_preview}
                            </div>
                          )}
                          <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-text-muted">
                            {importCount > 0 && (
                              <span className="rounded bg-accent-soft px-1.5 py-0 text-accent">
                                {importCount} import{importCount === 1 ? "" : "s"}
                              </span>
                            )}
                            {d.has_state ? "state.md" : "no state.md yet"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {domains.length === 0 && (
              <div className="mt-8 w-full max-w-2xl rounded-xl border border-dashed border-border bg-surface p-8 text-center">
                <p className="text-sm text-text-muted">
                  No domains yet. Create one in the sidebar to start grounding conversations in real life areas.
                </p>
              </div>
            )}
          </div>
        )}
        {domain && domainTab === "chat" && messages.length === 0 && (
          <DomainHome
            domain={domain}
            vaultPath={vaultPath}
            onInjectContext={(body, label) => injectContext(body, label)}
            onPickPrompt={(text) => setInput(text)}
            onInsertSkill={(name) => insertSkillSlash(name)}
            preferredSet={preferredSkillsSet}
            onTogglePreferred={togglePreferredSkill}
          />
        )}
        {domain && domainTab === "chat" && messages.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            {messages.map((m, i) => (
              <ChatBubble
                key={i}
                msg={m}
                onCopy={copyToClipboard}
                onRetry={m.role === "assistant" ? () => retryFromHere(i) : undefined}
                onEdit={m.role === "user" ? (text) => editFromHere(text, i) : undefined}
              />
            ))}
          </div>
        )}
        {domain && domainTab !== "chat" && (
          <div className="mx-auto w-full max-w-3xl px-6 py-6">
            {!domainCtx && domainTab !== "prefs" && <div className="text-sm text-text-muted">loading…</div>}
            {domainCtx && domainTab === "state" && (domainCtx.state ? <Markdown source={domainCtx.state} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no <code className="text-accent">state.md</code> in this domain.</div>)}
            {domainCtx && domainTab === "decisions" && (domainCtx.decisions ? <Markdown source={domainCtx.decisions} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no <code className="text-accent">decisions.md</code> yet.</div>)}
            {domainCtx && domainTab === "journal" && (domainCtx.journal ? <Markdown source={domainCtx.journal} compact /> : <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no journal entries yet.</div>)}
            {domainCtx && domainTab === "logs" && (
              domainCtx.recent_logs.length === 0
                ? <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">no past sessions.</div>
                : (
                  <ul className="flex flex-col gap-2">
                    {domainCtx.recent_logs.map((l) => (
                      <li key={l.path}>
                        <button
                          onClick={async () => {
                            try {
                              const body = await invoke<string>("read_file", { path: l.path });
                              injectContext(body, l.name);
                              setDomainTab("chat");
                            } catch (e) { console.error(e); }
                          }}
                          className="block w-full rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm hover:-translate-y-px hover:border-accent-border hover:shadow-md"
                        >
                          <div className="font-mono text-sm text-text-primary">{l.name}</div>
                          {l.preview && <div className="mt-1 line-clamp-2 text-xs text-text-muted">{l.preview}</div>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
            )}
            {domainCtx && domainTab === "skills" && (
              <SkillsList
                skills={domainCtx.skills}
                onInsert={(name) => { insertSkillSlash(name); setDomainTab("chat"); }}
                preferredSet={preferredSkillsSet}
                onTogglePreferred={togglePreferredSkill}
              />
            )}
            {domainTab === "prefs" && domain && (
              <DomainPrefsPanel
                domain={domain}
                clis={clis}
                skills={domainCtx?.skills ?? []}
                preferredSkills={preferredSkills}
                onTogglePreferredSkill={togglePreferredSkill}
                onChanged={() => setPrefsTick((t) => t + 1)}
              />
            )}
          </div>
        )}
        {!domain && messages.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            {messages.map((m, i) => (
              <ChatBubble
                key={i}
                msg={m}
                onCopy={copyToClipboard}
                onRetry={m.role === "assistant" ? () => retryFromHere(i) : undefined}
                onEdit={m.role === "user" ? (text) => editFromHere(text, i) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Codex-style composer — full width to match Council. The reply
          transcript above stays in a centered max-w-3xl column for
          readability; only the composer goes edge-to-edge. */}
      <div className="shrink-0 px-6 pb-6 pt-2">
        <div className="relative rounded-2xl border border-border bg-surface p-3 shadow-sm">
          {/* Context pills — auto-loaded + dragged-in domains */}
          {primedContext.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2">
              {primedContext.map((c, i) => (
                <span
                  key={c.label}
                  className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft py-0.5 pl-2 pr-1 font-mono text-[11px] text-accent"
                  title={c.body.slice(0, 200)}
                >
                  <BookOpen className="h-3 w-3" />
                  {c.label}
                  <button
                    onClick={() => setPrimedContext((cur) => cur.filter((_, j) => j !== i))}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove from context"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* Slash-command popover for skills */}
          {slashMatch && slashCandidates.length > 0 && (
            <div className="absolute bottom-full left-3 z-40 mb-1 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
              <div className="border-b border-border-subtle bg-surface-warm px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Skills · enter to insert
              </div>
              {slashCandidates.map((s, i) => (
                <button
                  key={s.path}
                  onMouseDown={(e) => { e.preventDefault(); applySlashCompletion(s.name); }}
                  className={`flex w-full items-start gap-2 px-3 py-1.5 text-left ${
                    i === slashIdx ? "bg-accent-soft" : "hover:bg-surface-warm"
                  }`}
                >
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <div className="min-w-0">
                    <div className={`font-mono text-xs ${i === slashIdx ? "text-accent" : "text-text-primary"}`}>
                      /{s.name}
                    </div>
                    {s.description && <div className="line-clamp-1 text-[10px] text-text-muted">{s.description}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setHistIdx(-1); }}
            onDragOver={(e) => {
              const types = Array.from(e.dataTransfer.types);
              if (types.includes("application/x-prevail-domain") || types.includes("text/plain")) {
                // Suppress native text-insertion so the parent drop
                // handler runs and the dropped domain becomes a context
                // chip instead of inline text in the prompt.
                const t = e.dataTransfer.getData("text/plain");
                if (t && !t.startsWith("prevail-domain:") && !types.includes("application/x-prevail-domain")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(e) => {
              let name = e.dataTransfer.getData("application/x-prevail-domain");
              if (!name) {
                const t = e.dataTransfer.getData("text/plain");
                if (t && t.startsWith("prevail-domain:")) name = t.slice("prevail-domain:".length);
              }
              if (!name) return;
              // Stop the native text drop AND prevent bubbling so the
              // parent attaches it once (avoid double-attach).
              e.preventDefault();
              e.stopPropagation();
              void attachDomainAsContext(name);
            }}
            onPaste={async (e) => {
              if (lsGet("prevail.pref.autoConvertLongPaste") !== "1") return;
              const txt = e.clipboardData.getData("text/plain");
              if (txt.length < 5000) return;
              e.preventDefault();
              try {
                const path = await invoke<string>("write_paste_attachment", { vault: vaultPath, body: txt });
                setAttachments((cur) => (cur.includes(path) ? cur : [...cur, path]));
              } catch (err) { console.error("write_paste_attachment", err); }
            }}
            onKeyDown={(e) => {
              // If slash popover open, route arrow keys + enter/tab to it.
              if (slashMatch && slashCandidates.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIdx((i) => (i + 1) % slashCandidates.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIdx((i) => (i - 1 + slashCandidates.length) % slashCandidates.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  applySlashCompletion(slashCandidates[slashIdx].name);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  // Insert a space after the `/` to break the match.
                  setInput((cur) => cur + " ");
                  return;
                }
              }
              const wantCmd = getPref(PREF.sendKey, "enter") === "cmd-enter";
              const cmd = e.metaKey || e.ctrlKey;
              const fires = e.key === "Enter" && !e.shiftKey && !e.altKey && (wantCmd ? cmd : !cmd);
              if (fires) {
                e.preventDefault();
                send();
                return;
              }
              // Arrow-up / arrow-down recall — only when the textarea
              // is at the very start (so we don't fight normal
              // line-up navigation inside multi-line drafts).
              const ta = e.currentTarget;
              const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
              if (e.key === "ArrowUp" && atStart && history.length > 0) {
                e.preventDefault();
                const next = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
                setHistIdx(next);
                setInput(history[next] ?? "");
              } else if (e.key === "ArrowDown" && histIdx !== -1) {
                e.preventDefault();
                const next = histIdx + 1;
                if (next >= history.length) {
                  setHistIdx(-1);
                  setInput("");
                } else {
                  setHistIdx(next);
                  setInput(history[next] ?? "");
                }
              }
            }}
            placeholder={history.length > 0 ? "ask anything · enter to send · ↑ history · / skills" : "ask anything · enter to send · / skills · shift+enter for newline"}
            rows={2}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {/* Domain imports — chips for files in this domain's
              imports/ folder. Click to toggle attach. Auto-fetched
              when the domain changes. */}
          {domainImports.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                imports
              </span>
              {domainImports.slice(0, 8).map((it) => {
                const on = attachments.includes(it.path);
                const src = it.meta?.source ?? "manual";
                return (
                  <button
                    key={it.path}
                    onClick={() => setAttachments((cur) =>
                      cur.includes(it.path)
                        ? cur.filter((p) => p !== it.path)
                        : [...cur, it.path]
                    )}
                    title={`${it.path} · ${(it.size / 1024).toFixed(1)} KB · ${src}`}
                    className={`inline-flex items-center gap-1 rounded-md py-0.5 pl-1.5 pr-2 font-mono text-[11px] transition-colors ${
                      on
                        ? "border border-accent-border bg-accent-soft text-accent"
                        : "border border-dashed border-border bg-background text-text-secondary hover:border-accent-border hover:text-accent"
                    }`}
                  >
                    <FileText className="h-3 w-3" />
                    {it.name.length > 28 ? it.name.slice(0, 14) + "…" + it.name.slice(-12) : it.name}
                  </button>
                );
              })}
              {domainImports.length > 8 && (
                <span className="font-mono text-[10px] text-text-muted">+{domainImports.length - 8} more</span>
              )}
            </div>
          )}
          {/* Attached skills — separate from textarea text. Removing
              text in the input doesn't affect these; remove a skill
              by hovering its pill and clicking ×. */}
          {attachedSkills.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2">
              {attachedSkills.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft py-0.5 pl-1.5 pr-1 font-mono text-[11px] text-accent"
                  title="Attached skill — included as `/name` reference in the prompt"
                >
                  <Sparkles className="h-3 w-3" />
                  /{name}
                  <button
                    onClick={() => removeAttachedSkill(name)}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title={`Remove /${name}`}
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* Suggested skills — match the prompt's words against skill
              names and the first non-empty line of each SKILL.md. Only
              fires when the prompt is at least 8 chars to avoid noise. */}
          {(() => {
            if (input.trim().length < 8) return null;
            const lower = input.toLowerCase();
            const tokens = new Set(lower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
            const attached = new Set(attachedSkills);
            const matches = skillsCache.filter((s) => {
              if (attached.has(s.name)) return false;
              const name = s.name.toLowerCase();
              if (tokens.has(name)) return true;
              const desc = (s.description ?? "").toLowerCase();
              for (const t of tokens) {
                if (t.length >= 4 && (name.includes(t) || desc.includes(t))) return true;
              }
              return false;
            }).slice(0, 3);
            if (matches.length === 0) return null;
            return (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2">
                <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">suggested</span>
                {matches.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => insertSkillSlash(s.name)}
                    title={s.description ?? `Attach /${s.name}`}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background py-0.5 pl-1.5 pr-2 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent"
                  >
                    <Sparkles className="h-3 w-3" />
                    /{s.name}
                  </button>
                ))}
              </div>
            );
          })()}
          {/* Attachment pills */}
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 px-2">
              {attachments.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-2 pr-1 font-mono text-[11px] text-text-secondary">
                  <Folder className="h-3 w-3 text-text-muted" />
                  {p.split("/").pop()}
                  <button
                    onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove attachment"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* Single inline toolbar: + then the per-domain toggles,
              then a spacer, then model picker / council / send. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <div className="relative" ref={plusMenuRef}>
              <button
                onClick={() => setPlusOpen((v) => !v)}
                title="Add file · attach domain state · use a skill"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-text-muted hover:bg-surface-warm hover:text-accent"
              >
                <Plus className="h-4 w-4" />
              </button>
              {plusOpen && (
                <div className="absolute bottom-full left-0 z-40 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <button
                    onClick={pickAttachment}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-warm"
                  >
                    <Paperclip className="h-4 w-4 text-text-muted" />
                    Add files
                  </button>
                  {domain && domainPath && (
                    <button
                      onClick={attachDomainState}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-warm"
                    >
                      <PrevailLogo size={16} />
                      Attach {titleCase(domain)} state
                    </button>
                  )}
                  <div className="border-t border-border-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Skills · {skillsCache.length}
                  </div>
                  {skillsCache.length === 0 && (
                    <div className="px-3 py-2 text-xs text-text-muted">
                      no skills under <code className="text-accent">{titleCase(domain ?? "—")}/skills/</code>
                    </div>
                  )}
                  <div className="max-h-48 overflow-y-auto">
                    {skillsCache.map((s) => (
                      <button
                        key={s.path}
                        onClick={() => insertSkillRef(s)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-warm"
                      >
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-text-primary">/{s.name}</div>
                          {s.description && (
                            <div className="truncate text-[10px] text-text-muted">{s.description}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DomainStatusBar domain={domain} fwLens={fwLens} />
            <div className="flex-1" />

            {/* Model picker pill — Codex-style. Click opens cascading
                provider→model menu. */}
            <div className="relative" ref={modelMenuRef}>
              <button
                onClick={() => setModelMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 transition-colors hover:bg-surface-warm"
                title="Pick model"
              >
                {selectedCli && <ProviderMark vendor={selectedCli} size={18} />}
                <span className="font-mono text-xs text-text-primary">
                  {selectedCliLabel}
                </span>
                {selectedModelLabel && (
                  <span className="font-mono text-xs text-text-muted">· {selectedModelLabel}</span>
                )}
                <svg className="h-3 w-3 text-text-muted" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {modelMenuOpen && (
                <div className="absolute bottom-full right-0 z-40 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Model
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {clis.map((c) => {
                      const cliModels = MODELS[c.id] ?? [];
                      if (cliModels.length === 0) return null;
                      return (
                        <div key={c.id} className={c.available ? "" : "opacity-40"}>
                          <div className="flex items-center gap-2 bg-surface-warm/60 px-3 py-1">
                            <ProviderMark vendor={c.id} size={14} />
                            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                              {c.label}
                            </span>
                            {!c.available && (
                              <span className="ml-auto font-mono text-[10px] text-text-muted">not installed</span>
                            )}
                          </div>
                          {cliModels.map((m) => {
                            const isActive = selectedCli === c.id && selectedModel === m.id;
                            return (
                              <button
                                key={m.id}
                                onClick={() => {
                                  if (!c.available) return;
                                  setSelectedCli(c.id);
                                  setSelectedModel(c.id, m.id);
                                  setModelMenuOpen(false);
                                }}
                                disabled={!c.available}
                                className={`flex w-full items-center justify-between px-4 py-1.5 text-left transition-colors ${
                                  isActive ? "bg-accent-soft" : "hover:bg-surface-warm"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className={`font-mono text-xs ${isActive ? "text-accent" : "text-text-primary"}`}>
                                    {m.label}
                                  </div>
                                  {m.blurb && (
                                    <div className="text-[10px] text-text-muted">{m.blurb}</div>
                                  )}
                                </div>
                                {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={3} />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  {/* Domain default management — only shown when in a
                      domain. Setting a model already auto-saves; this
                      lets the user clear the override. */}
                  {domain && (
                    <div className="flex items-center justify-between gap-2 border-t border-border-subtle bg-surface-warm/60 px-3 py-2 font-mono text-[10px] text-text-muted">
                      <span>
                        {lsGet(domainCliKey)
                          ? <>default for <span className="text-accent">{titleCase(domain)}</span>: {selectedCli} · {selectedModel || "—"}</>
                          : <>using global default · pick a model to set one for <span className="text-accent">{titleCase(domain)}</span></>}
                      </span>
                      {lsGet(domainCliKey) && (
                        <button
                          onClick={() => {
                            clearDomainModelOverride();
                            setModelMenuOpen(false);
                          }}
                          className="rounded border border-border bg-background px-1.5 py-0.5 hover:border-accent-border hover:text-accent"
                        >
                          reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={onSwitchToCouncil}
              title="Switch to Council mode"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-text-secondary hover:border-accent-border hover:bg-accent-soft hover:text-accent"
            >
              <Scale className="h-3.5 w-3.5" />
              Council
            </button>

            {(() => {
              const last = messages[messages.length - 1];
              const streaming = !!(last && last.streaming);
              if (streaming) {
                return (
                  <button
                    onClick={async () => {
                      try {
                        await invoke("abort_sessions", { prefix: sessionRef.current });
                      } catch (e) { console.error("abort chat", e); }
                      // Force-finish the streaming bubble so the UI unwinds.
                      setMessages((m) => {
                        const lst = m[m.length - 1];
                        if (lst && lst.streaming) {
                          return [...m.slice(0, -1), {
                            ...lst,
                            streaming: false,
                            content: lst.content ? lst.content + "\n\n(aborted)" : "(aborted by user)",
                          }];
                        }
                        return m;
                      });
                    }}
                    title="Stop the reply"
                    className="inline-flex items-center gap-1.5 rounded-full border border-err bg-err/10 px-4 py-1.5 text-sm font-semibold text-err hover:bg-err hover:text-background"
                  >
                    ■ Stop
                  </button>
                );
              }
              return (
                <button
                  onClick={send}
                  disabled={!input.trim() || !selectedCli}
                  title="Send (enter)"
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-background shadow-sm transition-all hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
                >
                  Send
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              );
            })()}
          </div>
        </div>
      </div>
      </div>
      {contextOpen && domain && domainPath && (
        <DomainContextDrawer
          domain={domain}
          vaultPath={vaultPath}
          domainPath={domainPath}
          onClose={() => setContextOpen(false)}
          onInjectContext={(body, label) => injectContext(body, label)}
          onInsertSkill={(name) => insertSkillSlash(name)}
          preferredSet={preferredSkillsSet}
          onTogglePreferred={togglePreferredSkill}
        />
      )}
    </div>
  );
}

function ChatBubble({
  msg,
  onCopy,
  onRetry,
  onEdit,
}: {
  msg: ChatMessage;
  onCopy?: (text: string) => void;
  onRetry?: () => void;
  onEdit?: (text: string) => void;
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

  if (msg.role === "user") {
    // Right-aligned card with accent tint + tail. Hover reveals
    // Copy + Edit actions in a thin tray below the bubble.
    return (
      <div className="group mb-6 flex flex-col items-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md border border-accent-border/50 bg-accent-soft px-4 py-3 text-[15px] leading-relaxed text-text-primary shadow-sm">
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
    : vendor;
  const empty = !msg.content && !msg.streaming;
  return (
    <div className="group mb-8 flex items-start gap-3">
      <ProviderMark vendor={vendor} size={32} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-secondary">
          <span className="font-display font-semibold tracking-tight">{vendorName}</span>
          {msg.streaming && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
              <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {msg.content ? "writing" : "thinking"}
            </span>
          )}
        </div>
        <div className={`rounded-2xl rounded-tl-md border px-4 py-3 text-[15px] leading-relaxed shadow-sm ${
          empty
            ? "border-warn/40 bg-warn/5"
            : "border-border-subtle bg-surface"
        }`}>
          {msg.content ? (
            <Markdown source={msg.content} />
          ) : msg.streaming ? (
            <ThinkingDots />
          ) : (
            // Empty-reply fallback — explain + offer Retry instead of
            // dead "(empty reply)" text.
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="font-mono text-[11px] uppercase tracking-wider text-warn">
                  No output
                </div>
                <p className="mt-1 text-sm text-text-secondary">
                  {vendorName} finished without producing any text. This usually means
                  the model rejected the prompt, hit a quota, or returned an error.
                </p>
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
          </div>
        )}
      </div>
    </div>
  );
}

// Animated three-dot indicator shown while a CLI is spinning up and
// hasn't streamed its first token yet. Replaces the dead "…" feel
// with something that obviously "ticks".
function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
      <span className="ml-1.5 text-xs text-text-muted">thinking</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// COUNCIL PANEL

interface PanelistReply {
  cli: string;
  content: string;
  streaming: boolean;
  startedAt: number;
}

// One panelist slot = a (CLI, model) pair. Multiple slots can share the
// same CLI but different models (e.g. Opus 4.7 + Sonnet 4.6 side by
// side). Slot key encodes both so the reply map keeps them separate.
interface PanelistSlot {
  key: string;          // "<cli>::<model>"
  cli: string;
  cliLabel: string;
  model: string;        // empty string = CLI default
  modelLabel: string;
  blurb?: string;
}

function CouncilPanel({
  domain,
  domainPath,
  vaultPath: _vaultPath,
  clis,
  fwLens,
  onOpenInFinder,
  onSwitchToChat,
  onThreadsChanged,
}: {
  domain: string | null;
  domainPath: string | null;
  vaultPath: string;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
  onOpenInFinder: () => void;
  onSwitchToChat: () => void;
  onThreadsChanged?: () => void;
}) {
  // All possible (cli, model) panelist slots across ALL providers —
  // even ones not installed are listed (greyed out) so the user knows
  // what's possible. Same provider can appear multiple times with
  // different models (e.g. Opus 4.7 AND Sonnet 4.6 both on panel).
  const allSlots = useMemo<PanelistSlot[]>(() => {
    const out: PanelistSlot[] = [];
    for (const c of clis) {
      const models = MODELS[c.id] ?? [{ id: "", label: "default" } as ModelPick];
      for (const m of models) {
        out.push({
          key: `${c.id}::${m.id}`,
          cli: c.id,
          cliLabel: c.label,
          model: m.id,
          modelLabel: m.label,
          blurb: m.blurb,
        });
      }
    }
    return out;
  }, [clis]);

  // Selected panelists default to first model of each AVAILABLE CLI.
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(() => new Set());
  // Per-slot verification status — "verified" once a one-shot ping
  // succeeds with this exact (cli, model). Persisted in localStorage
  // so repeated app launches don't keep re-pinging.
  type VerifyStatus = "unknown" | "verifying" | "ok" | "failed";
  const VERIFY_KEY = "prevail.council.verifySlots";
  const [verifyStatus, setVerifyStatus] = useState<Record<string, VerifyStatus>>(() => {
    try {
      const raw = lsGet(VERIFY_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw) as Record<string, "ok" | "failed">;
      // Only restore "ok" results; failures get re-tried next session.
      const out: Record<string, VerifyStatus> = {};
      for (const k of Object.keys(obj)) if (obj[k] === "ok") out[k] = "ok";
      return out;
    } catch { return {}; }
  });
  const [verifyError, setVerifyError] = useState<Record<string, string>>({});
  function persistVerify(next: Record<string, VerifyStatus>) {
    const trimmed: Record<string, "ok"> = {};
    for (const k of Object.keys(next)) if (next[k] === "ok") trimmed[k] = "ok";
    try { lsSet(VERIFY_KEY, JSON.stringify(trimmed)); } catch {}
  }
  async function verifySlot(slot: PanelistSlot) {
    setVerifyStatus((s) => ({ ...s, [slot.key]: "verifying" }));
    try {
      await invoke<string>("verify_cli_model", {
        args: { cli: slot.cli, model: slot.model || null },
      });
      setVerifyStatus((s) => {
        const next = { ...s, [slot.key]: "ok" as VerifyStatus };
        persistVerify(next);
        return next;
      });
      setVerifyError((e) => { const { [slot.key]: _, ...rest } = e; return rest; });
    } catch (e) {
      const msg = String(e).slice(0, 200);
      setVerifyStatus((s) => ({ ...s, [slot.key]: "failed" }));
      setVerifyError((er) => ({ ...er, [slot.key]: msg }));
    }
  }
  // @ts-expect-error queued for v0.2.42 "verify all" button
  async function verifyAllSelected() {
    for (const s of panelistSlotsAll()) {
      if (verifyStatus[s.key] === "ok") continue;
      await verifySlot(s);
    }
  }
  function panelistSlotsAll() {
    return allSlots.filter((s) => selectedSlots.has(s.key));
  }
  useEffect(() => {
    setSelectedSlots((cur) => {
      if (cur.size > 0) return cur;
      const seen = new Set<string>();
      const def = new Set<string>();
      for (const s of allSlots) {
        const cli = clis.find((c) => c.id === s.cli);
        if (!cli?.available) continue;
        if (seen.has(s.cli)) continue;
        seen.add(s.cli);
        def.add(s.key);
      }
      return def;
    });
  }, [allSlots, clis]);
  const toggleSlot = (key: string) => {
    setSelectedSlots((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const panelistSlots = useMemo(
    () => allSlots.filter((s) => selectedSlots.has(s.key)),
    [allSlots, selectedSlots],
  );
  // Auto-verify any panelist slot that hasn't been verified yet (or
  // failed last time). Triggers when slots are selected/changed.
  // Persisted "ok" results in localStorage skip the re-check.
  useEffect(() => {
    for (const s of panelistSlots) {
      const cur = verifyStatus[s.key] ?? "unknown";
      if (cur === "unknown") {
        // Stagger so we don't hammer all CLIs simultaneously.
        const delay = Math.random() * 500;
        setTimeout(() => { verifySlot(s); }, delay);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelistSlots]);

  // Chair is a single (cli, model) pair — defaults to first selected
  // panelist's CLI with its first model, or whatever's saved.
  const [chairSlot, setChairSlot] = useState<string>("");
  useEffect(() => {
    if (chairSlot) return;
    const savedCli = lsGet(LS.defaultChairCli);
    if (savedCli) {
      const match = allSlots.find((s) => s.cli === savedCli);
      if (match) {
        setChairSlot(match.key);
        return;
      }
    }
    if (panelistSlots.length > 0) setChairSlot(panelistSlots[0].key);
    else if (allSlots.length > 0) setChairSlot(allSlots[0].key);
  }, [allSlots, panelistSlots, chairSlot]);

  useEffect(() => {
    const s = allSlots.find((x) => x.key === chairSlot);
    if (s) lsSet(LS.defaultChairCli, s.cli);
  }, [chairSlot, allSlots]);

  const chairSlotObj = useMemo(
    () => allSlots.find((s) => s.key === chairSlot) ?? null,
    [allSlots, chairSlot],
  );

  // Context drawer + primed extras (state.md, decisions, dragged-in
  // domains). Same machinery as Chat — gets prepended to the convened
  // prompt so panelists and the chair both see it.
  const [contextOpen, setContextOpen] = useState(false);
  const [primedContext, setPrimedContext] = useState<{ label: string; body: string }[]>([]);
  function injectContext(body: string, label: string) {
    setPrimedContext((cur) => {
      if (cur.some((c) => c.label === label)) return cur;
      return [...cur, { label, body }];
    });
  }
  // Skills attached to the next convene — same model as Chat.
  const [attachedSkills, setAttachedSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  const [preferredSkills, setPreferredSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  useEffect(() => {
    const pref = loadPreferredSkills(domain);
    setPreferredSkills(pref);
    setAttachedSkills(pref);
  }, [domain]);
  const togglePreferredSkill = useCallback((name: string) => {
    setPreferredSkills((cur) => {
      const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
      savePreferredSkills(domain, next);
      return next;
    });
    setAttachedSkills((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  }, [domain]);
  const preferredSkillsSet = useMemo(() => new Set(preferredSkills), [preferredSkills]);
  function insertSkillSlash(name: string) {
    setAttachedSkills((cur) => (cur.includes(name) ? cur : [...cur, name]));
    setContextOpen(false);
  }
  function removeAttachedSkill(name: string) {
    setAttachedSkills((cur) => cur.filter((n) => n !== name));
  }
  // Auto-prime the domain's state.md whenever the domain changes.
  useEffect(() => {
    if (!domain || !_vaultPath) {
      setPrimedContext((cur) => cur.filter((x) => !x.label.startsWith("auto:")));
      return;
    }
    let mounted = true;
    invoke<DomainContextBundle>("domain_context", { vault: _vaultPath, domain })
      .then((c) => {
        if (!mounted) return;
        const label = `auto: ${titleCase(domain)}/state.md`;
        setPrimedContext((cur) => {
          const cleared = cur.filter((x) => !x.label.startsWith("auto:"));
          if (!c.state) return cleared;
          return [...cleared, { label, body: c.state }];
        });
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [domain, _vaultPath]);
  const [prompt, setPrompt] = useState("");
  // Snapshot of the prompt at the moment the council was convened.
  // Composer `prompt` clears after submit so the textarea is empty for
  // the next question; this preserves the question text shown above
  // the responses in the transcript.
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [phase, setPhase] = useState<"idle" | "panelists" | "synthesizing" | "done">("idle");
  const [replies, setReplies] = useState<Record<string, PanelistReply>>({});
  const [verdict, setVerdict] = useState<string>("");
  const sessionRef = useRef<string>("");
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{ session: string; cli: string; stream: string; data: string }>(
        "chat:chunk",
        (e) => {
          if (!mounted) return;
          if (!e.payload.session.startsWith(sessionRef.current)) return;
          if (e.payload.stream !== "stdout") return;
          if (e.payload.session.endsWith(":chair")) {
            setVerdict((v) => v + stripAnsi(e.payload.data));
            return;
          }
          const slotMatch = e.payload.session.match(/:slot:(.+)$/);
          if (!slotMatch) return;
          const slotKey = slotMatch[1];
          const clean = maybeStripSycophancy(stripAnsi(e.payload.data));
          setReplies((r) => {
            const existing = r[slotKey] ?? { cli: e.payload.cli, content: "", streaming: true, startedAt: Date.now() };
            return { ...r, [slotKey]: { ...existing, content: existing.content + clean } };
          });
        },
      );
      const u2 = await listen<{ session: string; cli: string; code: number }>(
        "chat:done",
        (e) => {
          if (!mounted) return;
          if (!e.payload.session.startsWith(sessionRef.current)) return;
          if (e.payload.session.endsWith(":chair")) {
            setPhase("done");
            return;
          }
          const slotMatch = e.payload.session.match(/:slot:(.+)$/);
          if (!slotMatch) return;
          const slotKey = slotMatch[1];
          setReplies((r) => {
            const existing = r[slotKey];
            if (!existing) return r;
            return { ...r, [slotKey]: { ...existing, streaming: false } };
          });
        },
      );
      unlistenRefs.current = [u1, u2];
    })();
    return () => {
      mounted = false;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, []);

  const allPanelistsDone = useMemo(
    () => panelistSlots.length > 0 && panelistSlots.every((s) => replies[s.key] && !replies[s.key].streaming),
    [panelistSlots, replies],
  );

  const triggerChair = useCallback(async () => {
    if (!chairSlotObj) return;
    const synthesisPrompt = buildSynthesisPrompt(prompt, replies, panelistSlots);
    setPhase("synthesizing");
    try {
      await invoke("chat_send", {
        args: {
          cli: chairSlotObj.cli,
          model: chairSlotObj.model || null,
          prompt: synthesisPrompt,
          session_id: `${sessionRef.current}:chair`,
        },
      });
    } catch (e) {
      setVerdict(`(chair error: ${e})`);
      setPhase("done");
    }
  }, [chairSlotObj, prompt, replies, panelistSlots]);

  useEffect(() => {
    if (phase === "panelists" && allPanelistsDone) triggerChair();
  }, [phase, allPanelistsDone, triggerChair]);

  // Persist the council session as a thread once the verdict lands.
  // Mirrors ChatPanel's auto-save but fires only on phase === "done"
  // so the file represents the complete deliberation rather than
  // intermediate in-flight state.
  const councilSavedRef = useRef(false);
  useEffect(() => {
    if (phase !== "done") { councilSavedRef.current = false; return; }
    if (councilSavedRef.current) return;
    if (!_vaultPath || !submittedPrompt) return;
    councilSavedRef.current = true;
    const turns: { role: string; cli: string | null; model: string | null; content: string }[] = [
      { role: "user", cli: null, model: null, content: submittedPrompt },
    ];
    for (const s of panelistSlots) {
      const r = replies[s.key];
      if (!r || !r.content.trim()) continue;
      turns.push({
        role: "assistant",
        cli: s.cli,
        model: s.model || null,
        content: `### ${s.cliLabel} · ${s.modelLabel}\n\n${r.content.trim()}`,
      });
    }
    if (verdict.trim()) {
      turns.push({
        role: "assistant",
        cli: chairSlotObj?.cli ?? null,
        model: chairSlotObj?.model || null,
        content: `### Council verdict\n\n${verdict.trim()}`,
      });
    }
    const title = `Council · ${submittedPrompt.slice(0, 50).replace(/\n/g, " ")}`;
    invoke<string>("save_thread", {
      vault: _vaultPath,
      domain: domain ?? null,
      slug: null,
      title,
      turns,
    })
      .then(() => onThreadsChanged?.())
      .catch((e) => console.error("save_thread (council)", e));
  }, [phase, submittedPrompt, replies, verdict, panelistSlots, chairSlotObj, _vaultPath, domain, onThreadsChanged]);

  async function convene() {
    if (!prompt.trim() || panelistSlots.length === 0) return;
    sessionRef.current = `council-${Date.now()}`;
    setReplies({});
    setVerdict("");
    setPhase("panelists");
    const trimmed = prompt.trim();
    setSubmittedPrompt(trimmed);
    // user.md preamble — load fresh per convene so edits propagate
    // without app restart.
    let userMd = "";
    try { userMd = await invoke<string>("read_user_md", { vault: _vaultPath }); } catch {}
    const userPreamble = userMd.trim()
      ? `--- About the user (vault/user.md) ---\n${userMd.trim()}\n\n`
      : "";
    const primedPreamble = primedContext.length > 0
      ? primedContext.map((c) => `--- ${c.label} ---\n${c.body.trim()}\n`).join("\n") + "\n"
      : "";
    const skillsPreamble = attachedSkills.length > 0
      ? `Use the following skills as part of your reply: ${attachedSkills.map((n) => `/${n}`).join(", ")}\n\n`
      : "";
    const enrichedPrompt = fwLens.buildPrompt(`${userPreamble}${primedPreamble}${skillsPreamble}${trimmed}`);
    setPrompt("");
    setAttachedSkills([]);
    for (const s of panelistSlots) {
      try {
        await invoke("chat_send", {
          args: {
            cli: s.cli,
            model: s.model || null,
            prompt: enrichedPrompt,
            session_id: `${sessionRef.current}:slot:${s.key}`,
          },
        });
      } catch (e) {
        setReplies((r) => ({
          ...r,
          [s.key]: { cli: s.cli, content: `(error spawning: ${e})`, streaming: false, startedAt: Date.now() },
        }));
      }
    }
  }

  // Cascading menus for the composer toolbar — one for adding a
  // panelist (provider → model), one for picking the chair.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [chairMenuOpen, setChairMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const chairMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen && !chairMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
      if (chairMenuRef.current && !chairMenuRef.current.contains(e.target as Node)) {
        setChairMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [addMenuOpen, chairMenuOpen]);

  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types);
        if (types.includes("application/x-prevail-domain") || types.includes("text/plain")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={async (e) => {
        setDragOver(false);
        let name = e.dataTransfer.getData("application/x-prevail-domain");
        if (!name) {
          const t = e.dataTransfer.getData("text/plain");
          if (t.startsWith("prevail-domain:")) name = t.slice("prevail-domain:".length);
        }
        if (!name || !_vaultPath) return;
        e.preventDefault();
        try {
          const c = await invoke<DomainContextBundle>("domain_context", { vault: _vaultPath, domain: name });
          if (c.state) injectContext(c.state, `extra: ${titleCase(name)}/state.md`);
        } catch (err) { console.error("drop domain", err); }
      }}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent-soft/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 font-mono text-sm uppercase tracking-wider text-accent shadow-xl">
            ⊕ drop to add as context
          </div>
        </div>
      )}
      {/* Minimal header — same shape as Chat. Domain + Finder on left. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-6 py-3">
        {domain ? (
          <>
            <span className="text-accent">◆</span>
            <span className="font-display text-lg font-semibold">{titleCase(domain)}</span>
            {domainPath && (
              <button
                onClick={onOpenInFinder}
                title="Open in Finder"
                className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:bg-surface-warm hover:text-accent"
              >
                <Folder className="h-3 w-3" />
                Finder
              </button>
            )}
          </>
        ) : (
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Council</span>
        )}
        <div className="flex-1" />
        {domain && (
          <button
            onClick={() => setContextOpen((v) => !v)}
            title="Show domain state, decisions, journal, logs, skills"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
              contextOpen
                ? "border-accent-border bg-accent-soft text-accent"
                : "border-border bg-surface text-text-muted hover:border-accent-border hover:bg-accent-soft hover:text-accent"
            }`}
          >
            <BookOpen className="h-3 w-3" />
            Context{(() => {
              // Count only items the user actively added — auto-loaded
              // state.md is implicit and shouldn't pad this badge.
              const added = primedContext.filter((c) => !c.label.startsWith("auto:")).length;
              return added > 0 ? ` · ${added}` : "";
            })()}
          </button>
        )}
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {panelistSlots.length} on panel
        </span>
      </div>

      {/* Hero / transcript area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {phase === "idle" && (
          <div className="flex h-full flex-col items-center justify-start px-6 py-10">
            <img src="/logo.png" alt="" className="h-14 w-14 rounded-2xl opacity-90" />
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight">
              <Brand /> Council
            </h2>
            <p className="mt-2 max-w-md text-center text-sm text-text-muted">
              {panelistSlots.length === 0 ? (
                <>Add panelists below, then ask the council.</>
              ) : (
                <>
                  {panelistSlots.length} model{panelistSlots.length === 1 ? "" : "s"} on panel · chair:{" "}
                  <span className="text-accent">
                    {chairSlotObj ? `${chairSlotObj.cliLabel.toLowerCase()} · ${chairSlotObj.modelLabel}` : "—"}
                  </span>
                </>
              )}
            </p>

            <p className="mt-6 max-w-xl text-center text-sm leading-relaxed text-text-secondary">
              Council is best for <span className="text-accent">why</span>, <span className="text-accent">should I</span>, and decision-level questions where you want multiple model perspectives + a chair-synthesized verdict — not quick lookups.
            </p>

            <ul className="mt-6 flex w-full max-w-2xl flex-col gap-2">
              {buildCouncilQuickActions(domain).map((q) => (
                <li key={q.label}>
                  <button
                    onClick={() => setPrompt(q.prompt)}
                    className="block w-full rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-accent-border hover:shadow-md"
                  >
                    <div className="flex items-baseline gap-2 font-mono text-[11px] uppercase tracking-wider text-accent">
                      <span>{q.glyph}</span> {q.label}
                      <span className="ml-1 text-text-secondary normal-case">— {q.blurb}</span>
                    </div>
                    <div className="mt-1 text-sm leading-relaxed text-text-secondary">
                      {q.prompt}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase !== "idle" && (
          <div className="px-6 py-6">
            <div className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm">
              <span className="text-accent">$</span> {submittedPrompt || prompt}
            </div>

            <div className="space-y-4">
              {panelistSlots.map((s) => {
                const r = replies[s.key];
                return (
                  <div key={s.key} className="overflow-hidden rounded-lg border border-border bg-surface">
                    <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-warm px-4 py-2 font-mono text-xs">
                      <span className="flex items-center gap-2">
                        <ProviderMark vendor={s.cli} size={18} />
                        <span className="text-text-primary">{s.cliLabel.toLowerCase()}</span>
                        <span className="text-text-muted">· {s.modelLabel}</span>
                      </span>
                      <span className="text-text-muted">
                        {!r && "queued"}
                        {r?.streaming && <span className="pulse-soft text-accent">streaming</span>}
                        {r && !r.streaming && <span className="text-ok">✓ done</span>}
                      </span>
                    </div>
                    <div className="px-5 py-4">
                      {r?.content ? (
                        <Markdown source={r.content} />
                      ) : (
                        <ThinkingDots />
                      )}
                      {r?.streaming && r?.content && <span className="cursor-blink text-accent">▌</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {(phase === "synthesizing" || phase === "done") && (
              <div className="mt-8 rounded-lg border border-accent-border bg-accent-soft p-6">
                <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-accent">
                  <Crown className="h-3.5 w-3.5" />
                  <span>
                    verdict · synthesized by{" "}
                    {chairSlotObj ? `${chairSlotObj.cliLabel.toLowerCase()} · ${chairSlotObj.modelLabel}` : "—"}
                  </span>
                  {phase === "synthesizing" && <span className="pulse-soft">streaming</span>}
                </div>
                <div className="mt-3">
                  {verdict ? (
                    <Markdown source={verdict} />
                  ) : (
                    <ThinkingDots />
                  )}
                  {phase === "synthesizing" && verdict && <span className="cursor-blink text-accent">▌</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Codex-style composer — textarea + panelist pills + chair pill */}
      <div className="shrink-0 px-6 pb-6 pt-2">
        <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
          {/* Context pills — auto-primed + dragged-in domains */}
          {primedContext.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2">
              {primedContext.map((c, i) => (
                <span
                  key={c.label}
                  className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft py-0.5 pl-2 pr-1 font-mono text-[11px] text-accent"
                  title={c.body.slice(0, 200)}
                >
                  <BookOpen className="h-3 w-3" />
                  {c.label}
                  <button
                    onClick={() => setPrimedContext((cur) => cur.filter((_, j) => j !== i))}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove from context"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          {/* Attached skills */}
          {attachedSkills.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2">
              {attachedSkills.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft py-0.5 pl-1.5 pr-1 font-mono text-[11px] text-accent"
                >
                  <Sparkles className="h-3 w-3" />
                  /{name}
                  <button
                    onClick={() => removeAttachedSkill(name)}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title={`Remove /${name}`}
                  >×</button>
                </span>
              ))}
            </div>
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              const wantCmd = getPref(PREF.sendKey, "enter") === "cmd-enter";
              const cmd = e.metaKey || e.ctrlKey;
              const fires = e.key === "Enter" && !e.shiftKey && !e.altKey && (wantCmd ? cmd : !cmd);
              if (fires) {
                e.preventDefault();
                convene();
              }
            }}
            placeholder="ask the council · enter to convene · shift+enter for newline"
            rows={2}
            disabled={phase === "panelists" || phase === "synthesizing"}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />

          {/* Panelist pills row — each with a verification badge */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {panelistSlots.map((s) => {
              const st = verifyStatus[s.key] ?? "unknown";
              const tip = verifyError[s.key]
                ? `Failed: ${verifyError[s.key]}\n\nClick the dot to re-verify.`
                : st === "ok"
                ? "Verified — model is ready"
                : st === "verifying"
                ? "Verifying…"
                : "Click the dot to verify this model";
              return (
                <span
                  key={s.key}
                  title={s.blurb}
                  className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-1.5 ${
                    st === "failed" ? "border-err bg-err/10" : "border-border bg-background"
                  }`}
                >
                  <ProviderMark vendor={s.cli} size={16} />
                  <span className="font-mono text-[11px] text-text-primary">{s.modelLabel}</span>
                  <button
                    onClick={() => verifySlot(s)}
                    title={tip}
                    className={`ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] ${
                      st === "ok"
                        ? "bg-ok text-background"
                        : st === "failed"
                        ? "bg-err text-background"
                        : st === "verifying"
                        ? "bg-warn text-background"
                        : "border border-border-strong text-text-muted hover:border-accent-border hover:text-accent"
                    }`}
                  >
                    {st === "ok" ? "✓" : st === "failed" ? "✗" : st === "verifying" ? "…" : "?"}
                  </button>
                  <button
                    onClick={() => toggleSlot(s.key)}
                    className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                    title="Remove from panel"
                  >
                    ×
                  </button>
                </span>
              );
            })}

            {/* + add panelist */}
            <div className="relative" ref={addMenuRef}>
              <button
                onClick={() => setAddMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-background px-2 py-0.5 font-mono text-[11px] text-text-muted hover:border-accent-border hover:text-accent"
              >
                <Plus className="h-3 w-3" /> add
              </button>
              {addMenuOpen && (
                <div className="absolute bottom-full left-0 z-40 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Add panelist
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {clis.map((c) => {
                      const cliModels = MODELS[c.id] ?? [];
                      if (cliModels.length === 0) return null;
                      return (
                        <div key={c.id} className={c.available ? "" : "opacity-40"}>
                          <div className="flex items-center gap-2 bg-surface-warm/60 px-3 py-1">
                            <ProviderMark vendor={c.id} size={14} />
                            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                              {c.label}
                            </span>
                            {!c.available && (
                              <span className="ml-auto font-mono text-[10px] text-text-muted">not installed</span>
                            )}
                          </div>
                          {cliModels.map((m) => {
                            const slotKey = `${c.id}::${m.id}`;
                            const onPanel = selectedSlots.has(slotKey);
                            return (
                              <button
                                key={m.id}
                                onClick={() => {
                                  if (!c.available) return;
                                  toggleSlot(slotKey);
                                }}
                                disabled={!c.available}
                                className={`flex w-full items-center justify-between px-4 py-1.5 text-left transition-colors ${
                                  onPanel ? "bg-accent-soft" : "hover:bg-surface-warm"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className={`font-mono text-xs ${onPanel ? "text-accent" : "text-text-primary"}`}>
                                    {m.label}
                                  </div>
                                  {m.blurb && <div className="text-[10px] text-text-muted">{m.blurb}</div>}
                                </div>
                                {onPanel && <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={3} />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Single inline toolbar: toggles · spacer · chair · chat · send */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2">
            <DomainStatusBar domain={domain} fwLens={fwLens} />
            <div className="flex-1" />

            {/* Chair pill */}
            <div className="relative" ref={chairMenuRef}>
              <button
                onClick={() => setChairMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1"
                title="Chair (writes the verdict)"
              >
                <Crown className="h-3 w-3 text-accent" />
                {chairSlotObj && <ProviderMark vendor={chairSlotObj.cli} size={16} />}
                <span className="font-mono text-[11px] text-text-primary">
                  {chairSlotObj ? chairSlotObj.modelLabel : "no chair"}
                </span>
                <svg className="h-3 w-3 text-text-muted" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {chairMenuOpen && (
                <div className="absolute bottom-full right-0 z-40 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Chair
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {clis.map((c) => {
                      const cliModels = MODELS[c.id] ?? [];
                      if (cliModels.length === 0) return null;
                      return (
                        <div key={c.id} className={c.available ? "" : "opacity-40"}>
                          <div className="flex items-center gap-2 bg-surface-warm/60 px-3 py-1">
                            <ProviderMark vendor={c.id} size={14} />
                            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                              {c.label}
                            </span>
                          </div>
                          {cliModels.map((m) => {
                            const slotKey = `${c.id}::${m.id}`;
                            const isChair = chairSlot === slotKey;
                            return (
                              <button
                                key={m.id}
                                onClick={() => {
                                  if (!c.available) return;
                                  setChairSlot(slotKey);
                                  setChairMenuOpen(false);
                                }}
                                disabled={!c.available}
                                className={`flex w-full items-center justify-between px-4 py-1.5 text-left transition-colors ${
                                  isChair ? "bg-accent-soft" : "hover:bg-surface-warm"
                                }`}
                              >
                                <span className={`font-mono text-xs ${isChair ? "text-accent" : "text-text-primary"}`}>
                                  {m.label}
                                </span>
                                {isChair && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={3} />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={onSwitchToChat}
              title="Back to single-model conversation"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 font-mono text-xs text-text-secondary hover:border-accent-border hover:bg-accent-soft hover:text-accent"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </button>
            {(phase === "panelists" || phase === "synthesizing") ? (
              <button
                onClick={async () => {
                  try {
                    await invoke("abort_sessions", { prefix: sessionRef.current });
                  } catch (e) { console.error("abort", e); }
                  // Mark EVERY selected slot as aborted — including
                  // ones that never reached the streaming state
                  // ("queued" / "thinking" cards). Bug fix: previously
                  // we only iterated existing reply keys, which left
                  // never-started panelists hanging in the UI.
                  setReplies((r) => {
                    const next = { ...r };
                    for (const s of panelistSlots) {
                      const existing = next[s.key];
                      if (!existing) {
                        next[s.key] = {
                          cli: s.cli,
                          content: "(aborted before starting)",
                          streaming: false,
                          startedAt: Date.now(),
                        };
                      } else if (existing.streaming) {
                        next[s.key] = {
                          ...existing,
                          streaming: false,
                          content: existing.content
                            ? existing.content + "\n\n(aborted)"
                            : "(aborted)",
                        };
                      }
                    }
                    return next;
                  });
                  setPhase("done");
                  setVerdict((v) => v ? v + "\n\n(aborted)" : "(aborted by user)");
                }}
                title="Stop the council mid-run"
                className="inline-flex items-center gap-1.5 rounded-full border border-err bg-err/10 px-4 py-1.5 text-sm font-semibold text-err hover:bg-err hover:text-background"
              >
                ■ Stop
              </button>
            ) : (
              <button
                onClick={convene}
                disabled={!prompt.trim() || panelistSlots.length === 0}
                title="Convene the council (enter)"
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-background shadow-sm transition-all hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
              >
                <Scale className="h-3.5 w-3.5" />
                Convene
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
      {contextOpen && domain && _vaultPath && (
        <DomainContextDrawer
          domain={domain}
          vaultPath={_vaultPath}
          domainPath={domainPath ?? ""}
          onClose={() => setContextOpen(false)}
          onInjectContext={(body, label) => injectContext(body, label)}
          onInsertSkill={(name) => insertSkillSlash(name)}
          preferredSet={preferredSkillsSet}
          onTogglePreferred={togglePreferredSkill}
        />
      )}
    </div>
  );
}

function buildSynthesisPrompt(
  question: string,
  replies: Record<string, PanelistReply>,
  panelists: PanelistSlot[],
): string {
  const parts: string[] = [
    "You are the chair of a council. The following AI models were each asked the same question. Synthesize a single decisive verdict that captures the consensus, names the key points of disagreement, and recommends a concrete action.",
    "",
    "QUESTION:",
    question,
    "",
    "PANELIST REPLIES:",
  ];
  for (const s of panelists) {
    const r = replies[s.key];
    if (!r) continue;
    parts.push("");
    parts.push(`--- ${s.cliLabel} · ${s.modelLabel} ---`);
    parts.push(r.content.trim());
  }
  parts.push("");
  parts.push("WRITE: A 3-paragraph verdict. Paragraph 1: consensus + what to do. Paragraph 2: where panelists disagreed and which framing wins. Paragraph 3: one concrete next action.");
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// BENCHMARK PANEL — leaderboard + drill-down

function parseRunLabel(label: string): { vendor: string; model: string; ts?: string } {
  const l = label.toLowerCase();
  let vendor = "other";
  if (l.includes("claude") || l.includes("opus") || l.includes("sonnet") || l.includes("haiku")) vendor = "claude";
  else if (l.includes("gpt") || l.includes("codex") || l.includes("o1") || l.includes("o3")) vendor = "codex";
  else if (l.includes("gemini") || l.includes("antigravity") || l.includes("agy")) vendor = "antigravity";
  else if (l.includes("ollama") || l.includes("llama") || l.includes("mistral") || l.includes("qwen")) vendor = "ollama";

  const tsMatch = label.match(/\d{4}-\d{2}-\d{2}[T_]\d{2}[-:]?\d{2}/);
  const ts = tsMatch ? tsMatch[0] : undefined;
  const model = label.replace(tsMatch?.[0] ?? "", "").replace(/[-_]+$/g, "").trim() || label;
  return { vendor, model, ts };
}

function VendorBadge({ vendor }: { vendor: string }) {
  return <ProviderMark vendor={vendor} size={28} />;
}

function ScoreBar({ value, max, color = "var(--color-accent)" }: { value: number | null; max: number; color?: string }) {
  const pct = value === null ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-strong">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// Visible CLI kinds for benchmark runs — must match the prevail CLI's
// internal `kind` identifiers. Antigravity = google's `agy` CLI.
const BENCH_CLI_OPTIONS = [
  { id: "claude",      label: "Claude" },
  { id: "codex",       label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "ollama",      label: "Ollama" },
] as const;

function NewBenchmarkModal({
  vaultPath,
  onClose,
  onDone,
}: {
  vaultPath: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [cli, setCli] = useState<string>(() => lsGet(LS.defaultChatCli) || "claude");
  const [model, setModel] = useState<string>(() => {
    const def = lsGet(LS.defaultChatCli) || "claude";
    return lsGet(`prevail.model.${def}`) || (MODELS[def]?.[0]?.id ?? "");
  });
  const [council, setCouncil] = useState(false);
  const [domain, setDomain] = useState<string>("");
  const [phase, setPhase] = useState<"idle" | "running" | "scoring" | "done" | "error">("idle");
  const [log, setLog] = useState<string>("");
  const [runExitCode, setRunExitCode] = useState<number | null>(null);
  const sessionRef = useRef(`bench-${Date.now()}`);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (MODELS[cli] && !MODELS[cli].some((m) => m.id === model)) {
      setModel(MODELS[cli][0]?.id ?? "");
    }
  }, [cli, model]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{ session: string; stream: string; data: string }>(
        "benchmark:chunk",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
          setLog((l) => l + e.payload.data);
        },
      );
      const u2 = await listen<{ session: string; code: number | null; phase?: string }>(
        "benchmark:done",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
          const done_phase = e.payload.phase ?? "run";
          if (done_phase === "run") {
            setRunExitCode(e.payload.code);
            if (e.payload.code === 0) {
              // chain into scoring automatically
              kickScore();
            } else {
              setPhase("error");
            }
          } else {
            setPhase(e.payload.code === 0 ? "done" : "error");
            if (e.payload.code === 0) onDone();
          }
        },
      );
      unlistenRefs.current = [u1, u2];
    })();
    return () => {
      mounted = false;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  async function kickScore() {
    setPhase("scoring");
    setLog((l) => l + "\n— scoring run —\n");
    const scoreSession = `${sessionRef.current}-score`;
    sessionRef.current = scoreSession;
    try {
      await invoke("benchmark_score", {
        args: { session_id: scoreSession, vault: vaultPath },
      });
    } catch (e) {
      setLog((l) => l + `\n(score error: ${e})\n`);
      setPhase("error");
    }
  }

  async function start() {
    setLog("");
    setRunExitCode(null);
    setPhase("running");
    sessionRef.current = `bench-${Date.now()}`;
    try {
      await invoke("benchmark_start", {
        args: {
          session_id: sessionRef.current,
          vault: vaultPath,
          cli,
          model: model || null,
          council,
          domain: domain.trim() || null,
        },
      });
    } catch (e) {
      setLog((l) => l + `\n(spawn error: ${e})\n`);
      setPhase("error");
    }
  }

  const busy = phase === "running" || phase === "scoring";
  const cliModels = MODELS[cli] ?? [];

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h3 className="font-display text-xl font-semibold">Run new benchmark</h3>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-warm disabled:opacity-40"
          >
            {busy ? "running…" : "close"}
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-text-muted">Mode</label>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setCouncil(false)}
                disabled={busy}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  !council ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                }`}
              >
                Single model
              </button>
              <button
                onClick={() => setCouncil(true)}
                disabled={busy}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  council ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                }`}
              >
                <Scale className="h-3.5 w-3.5" /> Council
              </button>
            </div>
          </div>

          {!council && (
            <>
              <div>
                <label className="font-mono text-xs uppercase tracking-wider text-text-muted">CLI</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {BENCH_CLI_OPTIONS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCli(c.id)}
                      disabled={busy}
                      className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
                        cli === c.id ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              {cliModels.length > 0 && (
                <div>
                  <label className="font-mono text-xs uppercase tracking-wider text-text-muted">Model</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {cliModels.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setModel(m.id)}
                        disabled={busy}
                        className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
                          model === m.id ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <label className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Domain filter <span className="ml-1 text-text-muted/70">(optional)</span>
            </label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={busy}
              placeholder="e.g. tax — leave blank to run all"
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
            />
          </div>

          {phase !== "idle" && (
            <div>
              <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-text-muted">
                <span className={busy ? "pulse-soft text-accent" : runExitCode === 0 && phase === "done" ? "text-ok" : phase === "error" ? "text-err" : "text-text-muted"}>
                  ●
                </span>
                {phase === "running" && "running benchmark…"}
                {phase === "scoring" && "scoring run…"}
                {phase === "done" && "done · leaderboard refreshed"}
                {phase === "error" && "errored — check log"}
              </div>
              <pre
                ref={logRef}
                className="max-h-64 overflow-y-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary"
              >
                {log || "(no output yet)"}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-5 py-3">
          <span className="font-mono text-[11px] text-text-muted">
            shells out to <code className="text-accent">prevail bench run --canonical</code>
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-40"
            >
              Close
            </button>
            <button
              onClick={start}
              disabled={busy || (!council && !cli)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {phase === "idle" ? "Start run" : busy ? "Running…" : "Run again"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BenchmarkPanel({ vaultPath }: { vaultPath: string }) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    invoke<BenchmarkRun[]>("benchmark_runs", { vault: vaultPath })
      .then((r) => {
        setRuns(r);
        setErr(null);
      })
      .catch((e) => setErr(String(e)));
  }, [vaultPath]);

  async function loadRun(runDir: string) {
    setLoadingDetail(true);
    setExpandedQ(null);
    try {
      const detail = await invoke<RunDetail>("benchmark_run_detail", { runDir });
      setSelected(detail);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoadingDetail(false);
    }
  }

  const parsed = useMemo(
    () => runs.map((r) => ({ ...r, parsed: parseRunLabel(r.label) })),
    [runs],
  );
  const vendors = useMemo(() => {
    const set = new Set(parsed.map((r) => r.parsed.vendor));
    return Array.from(set).sort();
  }, [parsed]);
  const filteredRuns = useMemo(
    () => vendorFilter === "all" ? parsed : parsed.filter((r) => r.parsed.vendor === vendorFilter),
    [parsed, vendorFilter],
  );
  const sortedRuns = useMemo(
    () => [...filteredRuns].sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1)),
    [filteredRuns],
  );

  return (
    <div className="flex h-full">
      <div className="flex w-[28rem] shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="space-y-3 border-b border-border-subtle px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              <span className="text-accent">◈</span> Leaderboard · {runs.length} run{runs.length === 1 ? "" : "s"}
            </div>
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] text-background hover:bg-accent-hover"
              title="Run a new benchmark"
            >
              <Sparkles className="h-3 w-3" />
              Run new
            </button>
          </div>
          {/* Vendor filter chips */}
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setVendorFilter("all")}
              className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                vendorFilter === "all"
                  ? "border-accent-border bg-accent-soft text-accent"
                  : "border-border bg-background text-text-muted hover:bg-surface-warm"
              }`}
            >
              all
            </button>
            {vendors.map((v) => (
              <button
                key={v}
                onClick={() => setVendorFilter(v)}
                className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                  vendorFilter === v
                    ? "border-accent-border bg-accent-soft text-accent"
                    : "border-border bg-background text-text-muted hover:bg-surface-warm"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {err && <div className="m-2 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">{err}</div>}
          {runs.length === 0 && !err && (
            <div className="p-4 text-xs text-text-muted">
              No scored runs in <code className="text-accent">{vaultPath}/benchmark/runs/</code> yet.
              Hit <span className="text-accent">Run new</span> to kick one off.
            </div>
          )}
          {sortedRuns.map((r, idx) => {
            const active = selected?.score.runDir === r.run_dir;
            return (
              <button
                key={r.label}
                onClick={() => loadRun(r.run_dir)}
                className={`mb-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-accent-soft" : "hover:bg-surface-warm"
                }`}
              >
                <span className="w-5 shrink-0 text-center font-mono text-[10px] text-text-muted">
                  {idx + 1}
                </span>
                <VendorBadge vendor={r.parsed.vendor} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-text-primary">{r.parsed.model || r.label}</div>
                  <div className="mt-1.5">
                    <ScoreBar value={r.judge_avg} max={10} />
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono">
                  <div className="text-sm font-semibold text-accent">
                    {r.judge_avg !== null ? r.judge_avg.toFixed(1) : "—"}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {r.keyword_avg !== null ? Math.round(r.keyword_avg) + "%" : "—"} kw
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {showNewModal && (
        <NewBenchmarkModal
          vaultPath={vaultPath}
          onClose={() => setShowNewModal(false)}
          onDone={() => {
            invoke<BenchmarkRun[]>("benchmark_runs", { vault: vaultPath })
              .then(setRuns)
              .catch((e) => setErr(String(e)));
          }}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {!selected && !loadingDetail && (
          <div className="flex h-full items-center justify-center text-text-muted">
            <div className="text-center">
              <Sparkles className="mx-auto h-8 w-8 opacity-50" />
              <p className="mt-4 text-sm">Pick a run on the left to drill in.</p>
            </div>
          </div>
        )}
        {loadingDetail && <div className="p-6 text-sm text-text-muted">loading run…</div>}
        {selected && !loadingDetail && (
          <div className="px-6 py-6">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">run</div>
            <h2 className="mt-2 font-display text-2xl font-semibold">{selected.score.label}</h2>
            <div className="mt-3 flex gap-6 font-mono text-sm">
              <div>
                <span className="text-text-muted">judge: </span>
                <span className="text-accent">{selected.score.judge_avg !== null ? selected.score.judge_avg.toFixed(1) : "—"}</span>
                <span className="text-text-muted"> / 10</span>
              </div>
              <div>
                <span className="text-text-muted">keyword: </span>
                <span className="text-text-primary">{selected.score.keyword_avg !== null ? Math.round(selected.score.keyword_avg) + "%" : "—"}</span>
              </div>
              <div>
                <span className="text-text-muted">questions: </span>
                <span className="text-text-primary">{selected.score.questionScores.length}</span>
              </div>
            </div>

            <div className="mt-8 space-y-2">
              {selected.score.questionScores.map((q) => {
                const expanded = expandedQ === q.id;
                const record = selected.records.find((r) => r.id === q.id);
                return (
                  <div key={q.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                    <button
                      onClick={() => setExpandedQ(expanded ? null : q.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm"
                    >
                      <span className="text-text-muted">{expanded ? "▾" : "▸"}</span>
                      <span className="w-28 shrink-0 truncate font-mono text-sm text-text-primary">{q.id}</span>
                      <div className="min-w-0 flex-1">
                        <ScoreBar value={q.judge_score} max={10} />
                      </div>
                      <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                        <span className="text-text-muted">{q.keyword_score !== null ? Math.round(q.keyword_score) + "%" : "—"}</span>
                        <span className="w-10 text-right text-accent">{q.judge_score !== null ? q.judge_score : "—"}/10</span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="space-y-3 border-t border-border-subtle px-6 py-4 text-sm">
                        <div>
                          <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">question</div>
                          <div className="whitespace-pre-wrap text-text-primary">{record?.prompt ?? "(prompt not in records)"}</div>
                        </div>
                        {record?.expected_decision && (
                          <div>
                            <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">expected decision</div>
                            <div className="whitespace-pre-wrap text-ok">{record.expected_decision}</div>
                          </div>
                        )}
                        <div>
                          <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">model said</div>
                          <div className="whitespace-pre-wrap text-text-primary">{record?.reply ?? "(no reply)"}</div>
                        </div>
                        <div className="flex gap-6 font-mono text-xs">
                          <div>
                            <span className="text-ok">✓ hit: </span>
                            <span className="text-text-secondary">{q.keyword_hits.join(", ") || "(none)"}</span>
                          </div>
                          <div>
                            <span className="text-warn">✗ miss: </span>
                            <span className="text-text-secondary">{q.keyword_misses.join(", ") || "(none)"}</span>
                          </div>
                        </div>
                        {q.judge_rationale && (
                          <div>
                            <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">judge rationale ({q.judge_score}/10)</div>
                            <div className="whitespace-pre-wrap text-text-secondary">{q.judge_rationale}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SETTINGS PANEL — vault, theme, defaults, about

function SettingsPanel({
  appearance,
  vaultPath,
  onChangeVault,
  clis,
  onBack,
  onStartChatWith,
}: {
  appearance: ReturnType<typeof useAppearance>;
  vaultPath: string;
  onChangeVault: () => void;
  clis: CliInfo[];
  onBack?: () => void;
  onStartChatWith?: (cliId: string, modelId?: string) => void;
}) {
  type Section = "general" | "agents" | "user" | "vault" | "appearance" | "defaults" | "frameworks" | "skills" | "tools" | "ingestion" | "shortcuts" | "about";
  const [section, setSection] = useState<Section>("general");

  const items: Array<{ id: Section; label: string; icon: typeof Folder }> = [
    { id: "general", label: "General", icon: SettingsIcon },
    { id: "agents", label: "Agents", icon: Sparkles },
    { id: "user", label: "About me", icon: Users },
    { id: "vault", label: "Vault", icon: Folder },
    { id: "appearance", label: "Appearance", icon: Sparkles },
    { id: "defaults", label: "Defaults", icon: SettingsIcon },
    { id: "frameworks", label: "Frameworks", icon: Scale },
    { id: "skills", label: "Skills", icon: Sparkles },
    { id: "tools", label: "Integrations", icon: Wrench },
    { id: "ingestion", label: "Ingestion", icon: Network },
    { id: "shortcuts", label: "Shortcuts", icon: SettingsIcon },
    { id: "about", label: "About", icon: Github },
  ];

  return (
    <div className="flex h-full">
      {/* Sidebar nav — Codex-style with Back to app at top */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-surface px-2 py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-3 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to app
          </button>
        )}
        <div className="mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Settings
        </div>
        {items.map((it) => {
          const Icon = it.icon;
          const active = section === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setSection(it.id)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                active
                  ? "bg-accent-soft text-accent"
                  : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
              }`}
            >
              <Icon className="h-4 w-4" />
              {it.label}
            </button>
          );
        })}
      </aside>

      {/* Main pane */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className={`mx-auto ${section === "frameworks" ? "max-w-6xl" : "max-w-3xl"} px-8 py-10`}>
          {section === "general" && <GeneralSection />}
          {section === "agents" && <AgentsSection clis={clis} onStartChatWith={onStartChatWith} />}
          {section === "user" && <UserProfileSection vaultPath={vaultPath} />}
          {section === "vault" && <VaultSettings vaultPath={vaultPath} onChange={onChangeVault} />}
          {section === "appearance" && <AppearanceSection appearance={appearance} />}
          {section === "defaults" && (
            <>
              <SettingsHeader title="Defaults" subtitle="Pre-select the model + reasoning shape Prevail uses across new chats and councils." />
              <DefaultsForm clis={clis} />
            </>
          )}
          {section === "frameworks" && <FrameworksSection />}
          {section === "skills" && <SkillsSection vaultPath={vaultPath} />}
          {section === "tools" && (
            <>
              <SettingsHeader title="Integrations" subtitle="Bridges and gateways. Your vault stays local; these surfaces let you reach it from elsewhere." />
              <div className="mt-6 grid gap-4">
                <TelegramCard />
                <WhatsAppCard />
                <McpCard />
              </div>
            </>
          )}
          {section === "ingestion" && <IngestionSection />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

function AgentsSection({
  clis,
  onStartChatWith,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
}) {
  const detected = clis.filter((c) => c.available);
  const missing = clis.filter((c) => !c.available);
  return (
    <>
      <SettingsHeader
        title="Agents"
        subtitle="CLIs Prevail can route prompts to. Each agent is detected from your machine — Prevail doesn't install or update them."
      />
      {detected.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            Detected · {detected.length}
          </div>
          <div className="flex flex-col gap-3">
            {detected.map((c) => (
              <AgentCard key={c.id} cli={c} onStartChat={onStartChatWith} />
            ))}
          </div>
        </section>
      )}
      {missing.length > 0 && (
        <section>
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            Not installed · {missing.length}
          </div>
          <div className="flex flex-col gap-3">
            {missing.map((c) => (
              <AgentCard key={c.id} cli={c} onStartChat={onStartChatWith} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

type ModelVerifyStatus = "unknown" | "verifying" | "ok" | "failed";

// Council uses the same localStorage key/shape — share the dict so
// verification results carry across the Agents page and Council UI.
const AGENT_VERIFY_KEY = "prevail.council.verifySlots";
function loadVerifyMap(): Record<string, "ok"> {
  try {
    const raw = lsGet(AGENT_VERIFY_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, "ok">;
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}
function saveVerifyMap(m: Record<string, "ok">) {
  try { lsSet(AGENT_VERIFY_KEY, JSON.stringify(m)); } catch {}
}

function AgentCard({
  cli,
  onStartChat,
}: {
  cli: CliInfo;
  onStartChat?: (cliId: string, modelId?: string) => void;
}) {
  const brand = VENDOR_BRAND[cli.id] ?? VENDOR_BRAND.other;
  const models = MODELS[cli.id] ?? [];
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Record<string, ModelVerifyStatus>>(() => {
    const map = loadVerifyMap();
    const out: Record<string, ModelVerifyStatus> = {};
    for (const m of models) {
      const key = `${cli.id}:${m.id}`;
      if (map[key] === "ok") out[m.id] = "ok";
    }
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function verifyModel(modelId: string) {
    setStatus((s) => ({ ...s, [modelId]: "verifying" }));
    try {
      await invoke<string>("verify_cli_model", {
        args: { cli: cli.id, model: modelId || null },
      });
      setStatus((s) => {
        const next = { ...s, [modelId]: "ok" as ModelVerifyStatus };
        const map = loadVerifyMap();
        map[`${cli.id}:${modelId}`] = "ok";
        saveVerifyMap(map);
        return next;
      });
      setErrors((e) => { const { [modelId]: _, ...rest } = e; return rest; });
    } catch (e) {
      setStatus((s) => ({ ...s, [modelId]: "failed" }));
      setErrors((er) => ({ ...er, [modelId]: String(e).slice(0, 200) }));
    }
  }

  function verifyAll() {
    for (const m of models) {
      if (status[m.id] === "ok" || status[m.id] === "verifying") continue;
      void verifyModel(m.id);
    }
  }

  // Auto-run verification when the card is opened the first time
  // and there are unverified models in the list.
  useEffect(() => {
    if (!open) return;
    const unverified = models.some((m) => status[m.id] !== "ok");
    if (unverified) verifyAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function StatusGlyph({ s }: { s: ModelVerifyStatus | undefined }) {
    if (s === "ok") return <span className="text-accent" title="Verified">✓</span>;
    if (s === "verifying") return <span className="text-text-muted animate-pulse" title="Verifying…">◐</span>;
    if (s === "failed") return <span className="text-warn" title="Failed verification">✗</span>;
    return <span className="text-text-muted/60" title="Not yet verified">○</span>;
  }

  return (
    <div className={`rounded-xl border bg-surface shadow-sm transition-colors ${open ? "border-accent-border" : "border-border"}`}>
      <div className="flex items-center gap-4 p-4">
        <ProviderMark vendor={cli.id} size={44} />
        <button
          onClick={() => cli.available && setOpen((v) => !v)}
          disabled={!cli.available || models.length === 0}
          className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-default"
        >
          {cli.available && models.length > 0 && (
            <span className="mt-1.5 text-[11px] text-text-muted">{open ? "▾" : "▸"}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="font-display text-lg font-semibold tracking-tight">{cli.label}</div>
              <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
                cli.available
                  ? "border border-accent-border bg-accent-soft text-accent"
                  : "border border-border bg-background text-text-muted"
              }`}>
                {cli.available ? "Detected" : "Not installed"}
              </span>
              {cli.available && models.length > 0 && (
                <span className="font-mono text-[10px] text-text-muted">
                  · {models.filter((m) => status[m.id] === "ok").length}/{models.length} verified
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-text-muted">
              {cli.available
                ? (cli.version ?? `\`${cli.bin}\` in PATH`)
                : `Install \`${cli.bin}\` to enable`}
              <span className="ml-2 text-text-muted/60">· {brand.name}</span>
            </div>
          </div>
        </button>
        <button
          onClick={() => cli.available && onStartChat?.(cli.id)}
          disabled={!cli.available}
          className={`shrink-0 rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
            cli.available
              ? "border-accent-border bg-accent-soft text-accent hover:bg-accent hover:text-background"
              : "cursor-not-allowed border-border bg-background text-text-muted/60"
          }`}
        >
          Start chat
        </button>
      </div>

      {open && cli.available && models.length > 0 && (
        <div className="border-t border-border-subtle px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Models · {models.length}
            </div>
            <button
              onClick={verifyAll}
              className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
            >
              re-verify all
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {models.map((m) => {
              const s = status[m.id];
              const err = errors[m.id];
              return (
                <div key={m.id} className="flex items-start gap-3 rounded-md border border-border-subtle bg-background px-3 py-2">
                  <div className="mt-0.5 w-3 shrink-0 text-center text-[12px] leading-none">
                    <StatusGlyph s={s} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-sm text-text-primary">{m.label}</span>
                      {m.blurb && <span className="text-[11px] text-text-muted">{m.blurb}</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-text-muted/80">
                      <code className="text-accent">{m.id}</code>
                      {s === "failed" && err && (
                        <span className="ml-2 text-warn">· {err}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => verifyModel(m.id)}
                      disabled={s === "verifying"}
                      className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40"
                    >
                      {s === "verifying" ? "testing…" : s === "ok" ? "re-test" : "test"}
                    </button>
                    <button
                      onClick={() => onStartChat?.(cli.id, m.id)}
                      className={`rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${
                        s === "ok"
                          ? "border-accent-border bg-accent-soft text-accent hover:bg-accent hover:text-background"
                          : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                      }`}
                    >
                      chat
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1 max-w-2xl text-sm text-text-secondary">{subtitle}</p>}
    </div>
  );
}

// ─── General preferences storage ──────────────────────────────────────
// Read/write small boolean + string prefs to localStorage with sensible
// defaults. Exported helpers used at call sites (textarea, chat chunk
// handlers, etc.) to read live.
const PREF = {
  sendKey: "prevail.pref.sendKey",                  // "enter" | "cmd-enter"
  desktopNotif: "prevail.pref.desktopNotif",        // "1" | "0"
  soundOnDone: "prevail.pref.soundOnDone",          // "1" | "0"
  autoConvertLongPaste: "prevail.pref.autoConvertLongPaste", // "1" | "0"
  stripSycophancy: "prevail.pref.stripSycophancy",  // "1" | "0"
  alwaysShowContextUsage: "prevail.pref.alwaysShowContextUsage", // "1" | "0"
  dontCollapseToolCalls: "prevail.pref.dontCollapseToolCalls",   // "1" | "0"
  // System — hard caps on CLI runs so a stuck process doesn't hang
  // the UI forever. Read by send() and passed to the Rust spawner.
  llmPromptTimeoutSec: "prevail.pref.llmPromptTimeoutSec",   // integer seconds
  streamStallTimeoutSec: "prevail.pref.streamStallTimeoutSec", // integer seconds — no chunks for this long → kill
};
function getPref(key: string, fallback: string): string {
  const v = lsGet(key);
  return v === "" ? fallback : v;
}
function setPref(key: string, v: string): void { lsSet(key, v); }

function GeneralSection() {
  const [sendKey, setSendKeyState] = useState(() => getPref(PREF.sendKey, "enter"));
  const [desktopNotif, setDesktopNotif] = useState(() => getPref(PREF.desktopNotif, "0") === "1");
  const [soundDone, setSoundDone] = useState(() => getPref(PREF.soundOnDone, "0") === "1");
  const [autoConvert, setAutoConvert] = useState(() => getPref(PREF.autoConvertLongPaste, "1") === "1");
  const [stripSyc, setStripSyc] = useState(() => getPref(PREF.stripSycophancy, "0") === "1");
  const [promptTimeout, setPromptTimeout] = useState<string>(() => getPref(PREF.llmPromptTimeoutSec, "300"));

  const Row = ({
    title, desc, control,
  }: { title: string; desc: string; control: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  const Switch = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <Toggle on={on} onChange={onChange} />
  );

  return (
    <>
      <SettingsHeader
        title="General"
        subtitle="App-wide behavior preferences."
      />
      <div className="rounded-lg border border-border bg-surface px-5">
        <Row
          title="Send messages with"
          desc="Choose which key combination sends messages. Use Shift+Enter for new lines either way."
          control={
            <select
              value={sendKey}
              onChange={(e) => { setSendKeyState(e.target.value); setPref(PREF.sendKey, e.target.value); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
            >
              <option value="enter">Enter</option>
              <option value="cmd-enter">⌘ + Enter</option>
            </select>
          }
        />
        <Row
          title="Desktop notifications"
          desc="Get notified when a CLI finishes streaming a reply (Chat and Council)."
          control={<Switch on={desktopNotif} onChange={(v) => { setDesktopNotif(v); setPref(PREF.desktopNotif, v ? "1" : "0"); }} />}
        />
        <Row
          title="Sound effects"
          desc="Play a soft chime when a reply finishes."
          control={<Switch on={soundDone} onChange={(v) => { setSoundDone(v); setPref(PREF.soundOnDone, v ? "1" : "0"); }} />}
        />
        <Row
          title="Auto-convert long paste"
          desc="When you paste more than 5000 characters, treat it as a file attachment instead of inline prompt text."
          control={<Switch on={autoConvert} onChange={(v) => { setAutoConvert(v); setPref(PREF.autoConvertLongPaste, v ? "1" : "0"); }} />}
        />
        <Row
          title={`Strip "You're absolutely right!" sycophancy`}
          desc="Filters fluff openers from streamed replies before they hit the screen. Has no effect on saved logs."
          control={<Switch on={stripSyc} onChange={(v) => { setStripSyc(v); setPref(PREF.stripSycophancy, v ? "1" : "0"); }} />}
        />
        <Row
          title="LLM prompt timeout"
          desc="Hard cap on a single CLI call. The child process gets killed and the reply is finalized if it runs longer."
          control={
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={10}
                max={3600}
                value={promptTimeout}
                onChange={(e) => { setPromptTimeout(e.target.value); setPref(PREF.llmPromptTimeoutSec, e.target.value); }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none"
              />
              <span className="font-mono text-xs text-text-muted">s</span>
            </div>
          }
        />
      </div>
    </>
  );
}

function UserProfileSection({ vaultPath }: { vaultPath: string }) {
  const [body, setBody] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    invoke<string>("read_user_md", { vault: vaultPath })
      .then((s) => { setBody(s); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [vaultPath]);
  async function save() {
    setSaving(true);
    try {
      await invoke("write_user_md", { vault: vaultPath, body });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <SettingsHeader
        title="About me"
        subtitle="A persistent profile that gets prepended to every prompt. Captures who you are, your preferences, and recurring details so models don't have to re-ask. Lives at vault/user.md."
      />
      <div className="rounded-lg border border-border bg-surface">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={loaded
            ? "# About me\n\n- Role: ...\n- Working on: ...\n- Always assume: ...\n- Never assume: ..."
            : "loading…"}
          rows={18}
          className="w-full resize-y rounded-lg bg-transparent p-4 font-mono text-sm leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-4 py-2">
          <span className="font-mono text-[10px] text-text-muted">
            {body.length.toLocaleString()} chars · auto-included as preamble
            {savedAt && ` · saved ${Math.round((Date.now() - savedAt) / 1000)}s ago`}
          </span>
          <button
            onClick={save}
            disabled={saving || !loaded}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
          >
            {saving ? "saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}

function VaultSettings({ vaultPath, onChange }: { vaultPath: string; onChange: () => void }) {
  return (
    <>
      <SettingsHeader title="Vault" subtitle="Where Prevail reads + writes your domain folders. Each child folder with a state.md becomes a life domain." />
      <SettingRow label="Vault folder" desc="Currently selected workspace.">
        <button
          onClick={onChange}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm"
        >
          <Folder className="h-3.5 w-3.5" />
          Change
        </button>
      </SettingRow>
      <div className="mt-1 rounded-lg border border-border bg-surface p-4 font-mono text-xs text-text-primary">
        {vaultPath}
      </div>
    </>
  );
}

function FrameworksSection() {
  const fwLens = useFrameworkLens();
  const activeFramework = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const activeLens = LENSES.find((l) => l.id === fwLens.lens);
  return (
    <>
      <SettingsHeader
        title="Frameworks & Lenses"
        subtitle="The bracketed preamble Prevail prepends to every prompt. Framework shapes structure; lens shapes perspective."
      />

      {/* Two columns: Frameworks (left) · Lenses (right) — each
          column is independent and uses the full width of its half. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PreambleColumn
          glyph="◆"
          title="Frameworks"
          tagline="Structure — how the answer is shaped."
          options={FRAMEWORKS}
          active={activeFramework}
          selectedId={fwLens.framework}
          onSelect={fwLens.setFramework}
        />
        <PreambleColumn
          glyph="◇"
          title="Lenses"
          tagline="Perspective — the angle the answer comes from."
          options={LENSES}
          active={activeLens}
          selectedId={fwLens.lens}
          onSelect={fwLens.setLens}
        />
      </div>

      <p className="mt-6 rounded border border-border-subtle bg-surface px-3 py-2 text-xs text-text-muted">
        Custom frameworks + lenses are queued — for now these are the same set the prevail CLI ships with, sync'd from
        <code className="ml-1 text-accent">src/framework.ts</code> and <code className="text-accent">src/lens.ts</code>.
      </p>
    </>
  );
}

type PreambleOption = { id: string; label: string; blurb: string; instruction?: string };

function PreambleColumn({
  glyph,
  title,
  options,
  active,
  selectedId,
  onSelect,
}: {
  glyph: string;
  title: string;
  tagline?: string;
  options: readonly PreambleOption[];
  active: PreambleOption | undefined;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {/* Column header */}
      <div className="mb-3 flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
        <span className="text-accent">{glyph}</span> {title}
        <span>· {options.length}</span>
      </div>

      {/* Active summary */}
      <div className="mb-4 rounded-lg border border-accent-border bg-accent-soft p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Active</div>
        <div className="mt-1 font-display text-2xl font-semibold tracking-tight">{active?.label ?? "—"}</div>
        <p className="mt-1.5 text-sm text-text-secondary">{active?.blurb}</p>
      </div>

      {/* Option list */}
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <PreambleCard
            key={o.id}
            option={o}
            on={selectedId === o.id}
            onSelect={() => onSelect(o.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PreambleCard({
  option,
  on,
  onSelect,
}: {
  option: PreambleOption;
  on: boolean;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`rounded-lg border transition-colors ${
        on ? "border-accent-border bg-accent-soft" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span className="mt-0.5 text-[11px] text-text-muted">{open ? "▾" : "▸"}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`font-mono text-sm font-semibold ${on ? "text-accent" : "text-text-primary"}`}>
                {option.label}
              </span>
              <span className="text-xs text-text-muted">{option.blurb}</span>
            </div>
          </div>
        </button>
        <button
          onClick={onSelect}
          disabled={on}
          className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
            on
              ? "border-accent-border bg-accent text-background"
              : "border-border bg-background text-text-secondary hover:bg-surface-warm"
          }`}
        >
          {on ? "active" : "set default"}
        </button>
      </div>
      {open && (
        <div className="border-t border-border-subtle px-3 py-2">
          {option.instruction ? (
            <pre className="whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
              {option.instruction}
            </pre>
          ) : (
            <p className="text-xs italic text-text-muted">no preamble — uses the model's default response shape</p>
          )}
        </div>
      )}
    </div>
  );
}

interface SkillEntry {
  domain: string;
  name: string;
  path: string;
  description: string | null;
}

// Stable color picker for the first-letter skill avatars. Same skill
// name always lands on the same swatch so the grid feels consistent.
const SKILL_AVATAR_PALETTE = [
  { bg: "#ef6c4a", fg: "#ffffff" }, // orange
  { bg: "#3b82f6", fg: "#ffffff" }, // blue
  { bg: "#6366f1", fg: "#ffffff" }, // indigo
  { bg: "#8b5cf6", fg: "#ffffff" }, // violet
  { bg: "#a855f7", fg: "#ffffff" }, // purple
  { bg: "#ec4899", fg: "#ffffff" }, // pink
  { bg: "#10b981", fg: "#ffffff" }, // emerald
  { bg: "#14b8a6", fg: "#ffffff" }, // teal
  { bg: "#f59e0b", fg: "#1a1a1a" }, // amber
  { bg: "#0ea5e9", fg: "#ffffff" }, // sky
];

function pickSkillColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h) + name.charCodeAt(i);
    h |= 0;
  }
  return SKILL_AVATAR_PALETTE[Math.abs(h) % SKILL_AVATAR_PALETTE.length];
}

function SkillsSection({ vaultPath }: { vaultPath: string }) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    invoke<SkillEntry[]>("scan_skills", { vault: vaultPath })
      .then((s) => { if (mounted) setSkills(s); })
      .catch(() => { if (mounted) setSkills([]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [vaultPath]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.domain.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q));
  }, [skills, filter]);

  async function openSkill(p: string) {
    try { await invoke("open_in_finder", { path: p }); } catch {}
  }
  async function rescan() {
    setLoading(true);
    try {
      const s = await invoke<SkillEntry[]>("scan_skills", { vault: vaultPath });
      setSkills(s);
    } catch { /* ignore */ }
    setLoading(false);
  }

  return (
    <>
      <SettingsHeader
        title="Skills"
        subtitle="Drop a folder under any domain's skills/ directory to expose it here. The first non-empty line of SKILL.md or README.md becomes the description."
      />

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        {/* Toolbar: title · count · refresh · search */}
        <div className="mb-4 flex items-center gap-3">
          <h3 className="font-display text-xl font-semibold tracking-tight">My Skills</h3>
          <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-secondary">{skills.length}</span>
          <button
            onClick={rescan}
            title="Re-scan vault"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            ↻
          </button>
          <div className="flex-1" />
          <div className="relative w-64">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted">⌕</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search skills…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm focus:border-accent-border focus:outline-none"
            />
          </div>
        </div>

        {/* Path bar */}
        <div className="mb-4 flex items-center gap-2 rounded-md bg-background px-3 py-2 font-mono text-[11px] text-text-secondary">
          <Folder className="h-3.5 w-3.5 text-text-muted" />
          <span className="truncate" title={vaultPath}>{vaultPath}</span>
        </div>

        {loading && <div className="py-6 text-center text-sm text-text-muted">scanning…</div>}
        {!loading && skills.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-text-muted opacity-50" />
            <p className="mt-3 text-sm text-text-muted">
              No skills found. Try creating <code className="text-accent">{"<domain>/skills/<skill-name>/"}</code> with a SKILL.md.
            </p>
          </div>
        )}
        {!loading && filtered.length === 0 && skills.length > 0 && (
          <div className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-text-muted">
            No skills match <code className="text-accent">{filter}</code>.
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <ul className="flex flex-col gap-1">
            {filtered.map((s) => {
              const cleaned = (s.description ?? "").replace(/^[>*\-\s]+/, "").trim();
              const color = pickSkillColor(s.name);
              const initial = (s.name || "·").charAt(0).toUpperCase();
              return (
                <li key={s.path}>
                  <button
                    onClick={() => openSkill(s.path)}
                    title={s.path}
                    className="group flex w-full items-start gap-4 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-warm"
                  >
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg font-display text-xl font-bold ring-1 ring-black/5"
                      style={{ background: color.bg, color: color.fg }}
                    >
                      {initial}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-display text-base font-semibold tracking-tight text-text-primary">{s.name}</span>
                        <span className="rounded-md border border-border-subtle bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                          {titleCase(s.domain)}
                        </span>
                      </div>
                      {cleaned && (
                        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-secondary">
                          {cleaned}
                        </p>
                      )}
                    </div>
                    <Folder className="mt-1.5 h-4 w-4 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// INGESTION SECTION — UI surface for the triple-tier engine
//   Tier A: MCP subprocess registry (start/stop/status)
//   Tier B: Composio managed gateway (API key + start)
//   Tier C: Playwright headed browser automation (per-portal run)
//
// All three speak to commands defined in src-tauri/src/ingestion/.
// Status is polled every 4s while the section is mounted.

interface IngestionTierStatus {
  id: string;
  label: string;
  state: string;
  active: boolean;
  running: number;
  last_error: string | null;
}
interface IngestionMcpServer {
  name: string;
  command: string;
  args: string[];
  running: boolean;
  pid: number | null;
}

interface IngestionArtifact {
  tier_id: string;
  domain: string;
  source: string;
  path: string;
  sha256: string;
  size: number;
  original: string;
  ts: number;
}

function IngestionSection() {
  const [tiers, setTiers] = useState<IngestionTierStatus[]>([]);
  const [mcp, setMcp] = useState<IngestionMcpServer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<IngestionArtifact[]>([]);

  async function refresh() {
    try {
      const [t, m] = await Promise.all([
        invoke<IngestionTierStatus[]>("ingestion_status"),
        invoke<IngestionMcpServer[]>("ingestion_mcp_list"),
      ]);
      setTiers(t);
      setMcp(m);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    let unl: UnlistenFn | null = null;
    (async () => {
      unl = await listen<IngestionArtifact>(
        "ingestion:artifact",
        (e) => setArtifacts((cur) => [e.payload, ...cur].slice(0, 50)),
      );
    })();
    return () => { window.clearInterval(id); if (unl) unl(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openMcpConfig() {
    try {
      const p = await invoke<string>("ingestion_mcp_config_init");
      await invoke("open_in_finder", { path: p });
    } catch (e) { console.error(e); }
  }
  async function reloadMcp() {
    try {
      await invoke("ingestion_mcp_reload");
      await refresh();
    } catch (e) { console.error(e); }
  }

  return (
    <>
      <SettingsHeader
        title="Ingestion"
        subtitle="Triple-tier data engine. Pull artifacts from MCP servers, the Composio gateway, or a headed browser into the right domain folder — without leaving the app."
      />
      {err && (
        <div className="mb-4 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>
      )}

      <div className="space-y-6">
        {tiers.map((t) => (
          <IngestionTierCard
            key={t.id}
            tier={t}
            mcp={t.id === "tier_a_mcp" ? mcp : undefined}
            onRefresh={refresh}
            onOpenMcpConfig={openMcpConfig}
            onReloadMcp={reloadMcp}
          />
        ))}
        {tiers.length === 0 && (
          <div className="rounded border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
            Loading tier status…
          </div>
        )}

        <IngestionBrowserRunner />

        <IngestionAuditPanel />

        {artifacts.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="font-display text-base font-semibold tracking-tight">Recent artifacts</div>
              <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-secondary">{artifacts.length}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {artifacts.map((a, i) => (
                <li key={`${a.path}_${i}`} className="flex items-center gap-3 rounded-md border border-border-subtle bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-sm text-text-primary">{a.original}</span>
                      <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] text-accent">{a.domain}</span>
                      <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] text-text-secondary">{a.source}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
                      {a.path} · {a.sha256.slice(0, 12)}… · {(a.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    onClick={() => invoke("open_in_finder", { path: a.path })}
                    className="shrink-0 rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                  >
                    reveal
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function IngestionTierCard({
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
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-base font-semibold tracking-tight">{tier.label}</div>
          <div className="mt-0.5 font-mono text-[11px] text-text-muted">{tier.state}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
          tier.active
            ? tier.running > 0
              ? "border border-accent-border bg-accent-soft text-accent"
              : "border border-border bg-background text-text-secondary"
            : "border border-border bg-background text-text-muted"
        }`}>
          {tier.running > 0 ? `running · ${tier.running}` : tier.active ? "ready" : "inactive"}
        </span>
      </div>
      {tier.last_error && (
        <div className="mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {tier.last_error}
        </div>
      )}

      {/* Tier A — MCP server list */}
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

      {/* Tier B — Composio key input + start */}
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

      {/* Tier C — described inline; run UI is in IngestionBrowserRunner below */}
      {tier.id === "tier_c_browser" && (
        <p className="mt-3 text-xs text-text-muted">
          Run a portal automation below. Browser opens in headed mode with a persistent profile per (domain, portal). Downloads are intercepted into the domain's <code className="text-accent">imports/</code> folder.
        </p>
      )}
    </div>
  );
}

// Post-login automation step the Tier C engine executes. The shape
// mirrors the Rust PostLoginAction enum (serde tag = "type").
type IngestionAction =
  | { type: "goto"; url: string; wait_until?: string }
  | { type: "click"; selector: string; timeout_sec?: number }
  | { type: "wait_for"; selector: string; timeout_sec?: number }
  | { type: "select_option"; selector: string; value: string }
  | { type: "download_all_links"; selector: string; max?: number }
  | { type: "sleep"; seconds: number };

interface PortalRecipe {
  id: string;
  label: string;
  domain_hint: string;
  start_url: string;
  success_url_contains: string | null;
  notes: string | null;
  actions?: IngestionAction[];
}

// Audit log surface. Reads the appended JSON lines from
// ~/Library/Application Support/Prevail/ingestion.log via Tauri.
// Collapsed by default to avoid noise; expand on click. Each ingest
// row offers a "reveal" button when the path still exists on disk.
interface IngestionAuditEntry {
  type: string;
  tier_id?: string;
  source?: string;
  domain?: string;
  sha256?: string;
  size?: number;
  ts?: number;
  path?: string;
  older_than_days?: number;
}
function IngestionAuditPanel() {
  const [entries, setEntries] = useState<IngestionAuditEntry[]>([]);
  const [open, setOpen] = useState(false);

  async function refresh() {
    try {
      const r = await invoke<IngestionAuditEntry[]>("ingestion_audit_tail", { limit: 200 });
      setEntries(r.reverse());
    } catch { /* empty log is fine */ }
  }
  useEffect(() => { void refresh(); }, []);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <button
        onClick={() => { setOpen((v) => !v); if (!open) void refresh(); }}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{open ? "▾" : "▸"}</span>
          <div className="font-display text-base font-semibold tracking-tight">Audit log</div>
          <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-secondary">{entries.length}</span>
        </div>
        <span className="font-mono text-[10px] text-text-muted">~/Library/Application Support/Prevail/ingestion.log</span>
      </button>
      {open && (
        <ul className="mt-4 max-h-72 overflow-y-auto flex flex-col gap-1">
          {entries.length === 0 && (
            <li className="text-xs text-text-muted">No entries yet — captured ingests will appear here.</li>
          )}
          {entries.map((e, i) => {
            const t = e.ts ? new Date(e.ts * 1000).toLocaleString() : "";
            return (
              <li key={`${e.path ?? "_"}_${i}`} className="flex items-center gap-3 rounded border border-border-subtle bg-background px-3 py-1.5">
                <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                  e.type === "vacuum"
                    ? "border border-warn/40 bg-warn/10 text-warn"
                    : "border border-accent-border bg-accent-soft text-accent"
                }`}>
                  {e.type}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    {e.domain && <span className="font-mono text-text-primary">{e.domain}</span>}
                    {e.source && <span className="font-mono text-text-secondary">· {e.source}</span>}
                    {e.tier_id && <span className="font-mono text-text-muted">· {e.tier_id}</span>}
                    {e.older_than_days != null && <span className="font-mono text-text-muted">· &gt;{e.older_than_days}d</span>}
                  </div>
                  {e.path && (
                    <div className="truncate font-mono text-[10px] text-text-muted">{e.path}</div>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[10px] text-text-muted">{t}</span>
                {e.path && (
                  <button
                    onClick={() => invoke("open_in_finder", { path: e.path })}
                    className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                  >
                    reveal
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Editable list of post-login automation steps for Tier C. Lets the
// user add / remove / reorder / tweak actions inline without
// touching JSON. Each step renders the fields its action type
// needs and nothing else. Reorder via ↑↓ buttons; delete via ×.
function RecipeActionEditor({
  actions,
  onChange,
}: {
  actions: IngestionAction[];
  onChange: (next: IngestionAction[]) => void;
}) {
  type ActionType = IngestionAction["type"];

  function update(i: number, patch: Partial<IngestionAction>) {
    const next = actions.slice();
    next[i] = { ...next[i], ...patch } as IngestionAction;
    onChange(next);
  }
  function remove(i: number) {
    onChange(actions.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= actions.length) return;
    const next = actions.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function add(type: ActionType) {
    let a: IngestionAction;
    switch (type) {
      case "goto":               a = { type: "goto", url: "" }; break;
      case "click":              a = { type: "click", selector: "" }; break;
      case "wait_for":           a = { type: "wait_for", selector: "" }; break;
      case "select_option":      a = { type: "select_option", selector: "", value: "" }; break;
      case "download_all_links": a = { type: "download_all_links", selector: "" }; break;
      case "sleep":              a = { type: "sleep", seconds: 2 }; break;
    }
    onChange([...actions, a]);
  }

  return (
    <div className="mt-2 rounded-md border border-border-subtle bg-background px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
          Post-login steps
          <span className="rounded-full bg-surface-warm px-1.5 py-0 text-[9px] text-text-secondary">{actions.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            value=""
            onChange={(e) => { if (e.target.value) { add(e.target.value as ActionType); e.target.value = ""; } }}
            className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary focus:border-accent-border focus:outline-none"
          >
            <option value="">+ add step</option>
            <option value="goto">goto url</option>
            <option value="click">click selector</option>
            <option value="wait_for">wait for selector</option>
            <option value="select_option">select option</option>
            <option value="download_all_links">download all links</option>
            <option value="sleep">sleep</option>
          </select>
        </div>
      </div>

      {actions.length === 0 ? (
        <p className="mt-1 text-xs text-text-muted">
          No automation. Runner stops after login; trigger downloads manually in the headed window.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1.5">
          {actions.map((a, i) => (
            <li key={i} className="flex items-start gap-2 rounded border border-border-subtle bg-surface px-2 py-1.5">
              <div className="mt-0.5 flex shrink-0 flex-col items-center gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-[10px] text-text-muted hover:text-accent disabled:opacity-30">▲</button>
                <button onClick={() => move(i, 1)} disabled={i === actions.length - 1} className="text-[10px] text-text-muted hover:text-accent disabled:opacity-30">▼</button>
              </div>
              <span className="mt-0.5 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
                {a.type.replace(/_/g, " ")}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {a.type === "goto" && (
                  <input
                    value={a.url}
                    onChange={(e) => update(i, { url: e.target.value } as Partial<IngestionAction>)}
                    placeholder="https://..."
                    className="rounded border border-border-subtle bg-background px-2 py-0.5 font-mono text-[11px] focus:border-accent-border focus:outline-none"
                  />
                )}
                {(a.type === "click" || a.type === "wait_for" || a.type === "select_option" || a.type === "download_all_links") && (
                  <input
                    value={(a as { selector: string }).selector}
                    onChange={(e) => update(i, { selector: e.target.value } as Partial<IngestionAction>)}
                    placeholder="CSS selector, e.g. a[href*='.pdf']"
                    className="rounded border border-border-subtle bg-background px-2 py-0.5 font-mono text-[11px] focus:border-accent-border focus:outline-none"
                  />
                )}
                {a.type === "select_option" && (
                  <input
                    value={a.value}
                    onChange={(e) => update(i, { value: e.target.value } as Partial<IngestionAction>)}
                    placeholder="option value"
                    className="rounded border border-border-subtle bg-background px-2 py-0.5 font-mono text-[11px] focus:border-accent-border focus:outline-none"
                  />
                )}
                {a.type === "download_all_links" && (
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={a.max ?? ""}
                    onChange={(e) => update(i, { max: e.target.value ? parseInt(e.target.value, 10) : undefined } as Partial<IngestionAction>)}
                    placeholder="max downloads (optional)"
                    className="rounded border border-border-subtle bg-background px-2 py-0.5 font-mono text-[11px] focus:border-accent-border focus:outline-none"
                  />
                )}
                {a.type === "sleep" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={a.seconds}
                      onChange={(e) => update(i, { seconds: parseInt(e.target.value, 10) || 1 } as Partial<IngestionAction>)}
                      className="w-20 rounded border border-border-subtle bg-background px-2 py-0.5 font-mono text-[11px] focus:border-accent-border focus:outline-none"
                    />
                    <span className="font-mono text-[10px] text-text-muted">seconds</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => remove(i)}
                title="Remove step"
                className="shrink-0 rounded border border-border bg-background px-1.5 py-0 font-mono text-[12px] text-text-muted hover:border-warn hover:text-warn"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function IngestionBrowserRunner() {
  const [domain, setDomain] = useState("");
  const [portal, setPortal] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [successUrl, setSuccessUrl] = useState("");
  const [timeoutSec, setTimeoutSec] = useState<string>("90");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<PortalRecipe[]>([]);
  const [pickedRecipe, setPickedRecipe] = useState<string>("");
  // Editable working copy of the actions list. Initialized from the
  // picked recipe; mutations stay local until "save as recipe" is
  // clicked. Lets the user tweak a bundled recipe without diverging
  // its source file.
  const [draftActions, setDraftActions] = useState<IngestionAction[]>([]);

  useEffect(() => {
    invoke<PortalRecipe[]>("ingestion_browser_recipes")
      .then(setRecipes)
      .catch(() => setRecipes([]));
  }, []);

  function applyRecipe(id: string) {
    setPickedRecipe(id);
    const r = recipes.find((x) => x.id === id);
    if (!r) {
      setDraftActions([]);
      return;
    }
    setPortal(r.id);
    setDomain(r.domain_hint);
    setStartUrl(r.start_url);
    setSuccessUrl(r.success_url_contains ?? "");
    setDraftActions(r.actions ?? []);
  }

  useEffect(() => {
    let unl: UnlistenFn | null = null;
    (async () => {
      unl = await listen<{ line: string; stream?: string }>(
        "ingestion:browser",
        (e) => {
          const line = e.payload.line ?? "";
          setLog((cur) => [...cur.slice(-300), line]);
        },
      );
    })();
    return () => { if (unl) unl(); };
  }, []);

  async function run() {
    if (!domain.trim() || !portal.trim() || !startUrl.trim()) return;
    setBusy(true);
    setLog([]);
    try {
      // The draft list reflects the user's current edits, NOT the
      // bundled recipe — so tweaks they made stick for this run.
      await invoke("ingestion_browser_run", {
        req: {
          domain: domain.trim(),
          portal: portal.trim(),
          start_url: startUrl.trim(),
          mfa_timeout_sec: parseInt(timeoutSec, 10) || 90,
          success_url_contains: successUrl.trim() || null,
          success_selector: null,
          actions: draftActions,
        },
      });
    } catch (e) {
      setLog((cur) => [...cur, `error: ${e}`]);
    }
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="font-display text-base font-semibold tracking-tight">Run portal automation</div>
      <p className="mt-0.5 text-xs text-text-muted">
        Opens a headed Chromium for the chosen portal. Complete MFA in the window; downloads land in the domain's <code className="text-accent">imports/</code>.
      </p>
      {recipes.length > 0 && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Recipe</label>
            <select
              value={pickedRecipe}
              onChange={(e) => applyRecipe(e.target.value)}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-accent-border focus:outline-none"
            >
              <option value="">— start from blank —</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>{r.label} · {r.domain_hint}</option>
              ))}
            </select>
          </div>
          <RecipeActionEditor actions={draftActions} onChange={setDraftActions} />
          {pickedRecipe && (() => {
            const r = recipes.find((x) => x.id === pickedRecipe);
            return r?.notes
              ? <p className="mt-1 text-[11px] italic text-text-muted">{r.notes}</p>
              : null;
          })()}
        </>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="domain (e.g. wealth)" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none" />
        <input value={portal} onChange={(e) => setPortal(e.target.value)} placeholder="portal slug (e.g. fidelity)" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none" />
        <input value={startUrl} onChange={(e) => setStartUrl(e.target.value)} placeholder="https://login.example.com" className="col-span-2 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs focus:border-accent-border focus:outline-none" />
        <input value={successUrl} onChange={(e) => setSuccessUrl(e.target.value)} placeholder="login success URL fragment (optional)" className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs focus:border-accent-border focus:outline-none" />
        <div className="flex items-center gap-2">
          <input type="number" min={10} max={600} value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />
          <span className="font-mono text-xs text-text-muted">s MFA timeout</span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={run}
          disabled={busy || !domain.trim() || !portal.trim() || !startUrl.trim()}
          className="rounded-md bg-accent px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-background hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "launching…" : "Run automation"}
        </button>
        <button
          onClick={async () => {
            if (!portal.trim() || !startUrl.trim()) return;
            try {
              await invoke("ingestion_recipe_save", {
                recipe: {
                  id: portal.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                  label: portal.trim(),
                  domain_hint: domain.trim() || "wealth",
                  start_url: startUrl.trim(),
                  success_url_contains: successUrl.trim() || null,
                  notes: null,
                  actions: draftActions,
                },
              });
              const r = await invoke<PortalRecipe[]>("ingestion_browser_recipes");
              setRecipes(r);
            } catch (e) { console.error(e); }
          }}
          disabled={!portal.trim() || !startUrl.trim()}
          className="rounded border border-border bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
        >
          save as recipe
        </button>
        <button
          onClick={async () => {
            const recipeJson = {
              id: (portal.trim() || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              label: portal.trim() || "Untitled",
              domain_hint: domain.trim() || "wealth",
              start_url: startUrl.trim(),
              success_url_contains: successUrl.trim() || null,
              notes: null,
              actions: draftActions,
            };
            try {
              await navigator.clipboard.writeText(JSON.stringify(recipeJson, null, 2));
              setLog((cur) => [...cur, "recipe copied to clipboard"]);
            } catch (e) { console.error(e); }
          }}
          className="rounded border border-border bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          title="Copy current draft as JSON"
        >
          export json
        </button>
        <button
          onClick={async () => {
            const pasted = window.prompt("Paste recipe JSON:");
            if (!pasted) return;
            try {
              const r = JSON.parse(pasted);
              if (typeof r.id !== "string" || typeof r.start_url !== "string") {
                throw new Error("recipe must have id + start_url");
              }
              await invoke("ingestion_recipe_save", { recipe: {
                id: r.id, label: r.label ?? r.id, domain_hint: r.domain_hint ?? "wealth",
                start_url: r.start_url, success_url_contains: r.success_url_contains ?? null,
                notes: r.notes ?? null, actions: Array.isArray(r.actions) ? r.actions : [],
              }});
              const all = await invoke<PortalRecipe[]>("ingestion_browser_recipes");
              setRecipes(all);
              applyRecipe(r.id);
              setLog((cur) => [...cur, `imported recipe ${r.id}`]);
            } catch (e) {
              setLog((cur) => [...cur, `import failed: ${e}`]);
            }
          }}
          className="rounded border border-border bg-background px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          title="Paste recipe JSON to import"
        >
          import json
        </button>
        <span className="font-mono text-[10px] text-text-muted">
          requires <code className="text-accent">node</code> + <code className="text-accent">playwright-core</code>
        </span>
      </div>
      {log.length > 0 && (
        <pre className="mt-4 max-h-64 overflow-auto rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[10px] leading-relaxed text-text-secondary">
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}

// Read-only reference of every keyboard shortcut wired into the app.
// Helps discoverability — most users won't find ⌘P or ⌘B by accident.
function ShortcutsSection() {
  type Entry = { keys: string[]; label: string; desc: string };
  const groups: Array<{ name: string; entries: Entry[] }> = [
    {
      name: "Navigation",
      entries: [
        { keys: ["⌘", "K"], label: "New chat", desc: "Drops the current domain + thread, lands on the no-domain dashboard." },
        { keys: ["⌘", "P"], label: "Quick switcher", desc: "Fuzzy finder over every domain and every saved thread." },
        { keys: ["⌘", "B"], label: "Toggle sidebar", desc: "Collapses or expands the domain rail." },
        { keys: ["⌘", ","], label: "Open Settings", desc: "Jumps to the settings panel from anywhere." },
      ],
    },
    {
      name: "Composer",
      entries: [
        { keys: ["↵"], label: "Send (Enter mode)", desc: "Default. Switch to ⌘+↵ in Settings → General → Send messages with." },
        { keys: ["⇧", "↵"], label: "New line", desc: "Insert a hard newline without sending." },
        { keys: ["↑"], label: "Recall last prompt", desc: "Walk backward through this domain's prompt history." },
        { keys: ["↓"], label: "Recall next prompt", desc: "Walk forward; ↓ past the newest clears the composer." },
        { keys: ["/"], label: "Skill autocomplete", desc: "Type / and a few letters to fuzzy-match a skill in this domain." },
      ],
    },
    {
      name: "Thread rail",
      entries: [
        { keys: ["double-click"], label: "Rename", desc: "Edit the thread's title inline. ↵ to confirm." },
        { keys: ["+"], label: "New thread", desc: "Creates an empty thread file immediately — rename it before typing." },
      ],
    },
  ];

  const Key = ({ children }: { children: React.ReactNode }) => (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[11px] font-medium text-text-primary shadow-sm">
      {children}
    </kbd>
  );

  return (
    <>
      <SettingsHeader title="Shortcuts" subtitle="Keyboard surface for common actions. Most are global — they work even while you're typing." />
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.name} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {g.name}
            </div>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {g.entries.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text-primary">{e.label}</div>
                    <div className="mt-0.5 text-xs text-text-secondary">{e.desc}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {e.keys.map((k, j) => (
                      <Fragment key={j}>
                        <Key>{k}</Key>
                        {j < e.keys.length - 1 && e.keys.length > 1 && k.length === 1 && e.keys[j+1].length === 1 && (
                          <span className="text-[11px] text-text-muted">+</span>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function AboutSection() {
  const [checking, setChecking] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [includePre, setIncludePre] = useState<boolean>(() => lsGet("prevail.about.includePrerelease") === "1");
  useEffect(() => { lsSet("prevail.about.includePrerelease", includePre ? "1" : "0"); }, [includePre]);

  async function checkForUpdates() {
    setChecking(true);
    setCheckErr(null);
    setLatest(null);
    try {
      const r = await fetch("https://api.github.com/repos/fru-dev3/prevail-desktop/releases?per_page=10");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const releases = await r.json() as Array<{ tag_name: string; prerelease: boolean; html_url: string }>;
      const eligible = releases.filter((rel) => includePre || !rel.prerelease);
      const top = eligible[0];
      if (!top) throw new Error("no releases found");
      setLatest(top.tag_name);
      // Open the release page so the user can grab the DMG.
      try { await invoke("open_in_finder", { path: top.html_url }); } catch {}
    } catch (e) {
      setCheckErr(String(e).slice(0, 200));
    } finally {
      setChecking(false);
    }
  }

  function Row({ label, href }: { label: string; href: string }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="flex w-full items-center justify-between gap-4 border-b border-border-subtle px-1 py-3 text-left text-sm text-text-primary last:border-0 hover:text-accent"
      >
        <span>{label}</span>
        <span className="text-text-muted">›</span>
      </a>
    );
  }

  const cmp = latest ? compareSemver(latest.replace(/^v/, ""), APP_VERSION) : 0;
  const upToDate = latest && cmp <= 0;
  const newer = latest && cmp > 0;

  return (
    <>
      <SettingsHeader title="About" />
      <div className="flex flex-col items-center text-center">
        <img src="/logo.png" alt="Prevail" className="h-20 w-20 rounded-3xl shadow-md" />
        <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight">
          <Brand className="[letter-spacing:0.12em]" />
        </h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          One desktop. Your AI council, grounded in your domains.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <span className="rounded-full bg-surface-warm px-3 py-1 font-mono text-xs text-text-secondary">v{APP_VERSION}</span>
          <a
            href="https://github.com/fru-dev3/prevail-desktop"
            target="_blank"
            rel="noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-warm text-text-secondary hover:text-accent"
            title="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <button
          onClick={checkForUpdates}
          disabled={checking}
          className="w-full rounded-xl bg-text-primary px-4 py-3 font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>
        {latest && (
          <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            upToDate
              ? "border-accent-border bg-accent-soft text-accent"
              : "border-warn/40 bg-warn/10 text-warn"
          }`}>
            {upToDate
              ? `You're on the latest release (${latest}).`
              : newer
              ? `Newer release available: ${latest}. The release page opened in your browser.`
              : `Latest: ${latest}`}
          </div>
        )}
        {checkErr && (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{checkErr}</div>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-sm text-text-secondary">Include prerelease / dev builds</div>
          <Toggle on={includePre} onChange={setIncludePre} label="Include prerelease builds" />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface px-5 py-2 shadow-sm">
        <Row label="Help & documentation" href="https://github.com/fru-dev3/prevail-desktop#readme" />
        <Row label="Update log" href="https://github.com/fru-dev3/prevail-desktop/releases" />
        <Row label="Report an issue" href="https://github.com/fru-dev3/prevail-desktop/issues/new" />
        <Row label="Prevail CLI" href="https://github.com/fru-dev3/prevail" />
        <Row label="Official website" href="https://prevail.sh" />
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 px-1 text-[11px] text-text-muted">
        <span>MIT licensed · Tauri 2 · React 19 · Tailwind 4</span>
        <span>Local-first · Vault stays on this Mac</span>
      </div>
    </>
  );
}

// Tiny semver compare — returns -1 / 0 / +1 for left vs right.
// "0.2.62" vs "0.2.62" → 0; "0.2.62" vs "0.2.59" → +1.
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

// Reusable row: label on left, control on right. Hermes pattern.
function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// APPEARANCE SECTION — Color Mode toggle + 6 theme palette cards
// Modeled after the Hermes desktop Appearance pane.

function AppearanceSection({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  return (
    <section className="mt-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Appearance</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Mode controls brightness; theme controls the accent palette and surface styling.
          </p>
        </div>
      </div>

      {/* Color Mode segmented control */}
      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Color Mode</div>
            <div className="mt-1 text-sm text-text-secondary">
              Pick a fixed mode or let Prevail follow your system setting.
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center rounded-md border border-border bg-background p-1 text-xs">
            {[
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "System", icon: Monitor },
            ].map((m) => {
              const Icon = m.icon;
              const active = appearance.mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => appearance.setMode(m.id as Mode)}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-accent text-background shadow-sm"
                      : "text-text-secondary hover:bg-surface-warm"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Theme palette cards */}
      <div className="mt-6">
        <div className="mb-1 font-medium">Theme</div>
        <p className="mb-4 text-sm text-text-secondary">
          Desktop palettes. The selected mode is applied on top.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PALETTES.map((p) => (
            <PaletteCard
              key={p.id}
              palette={p}
              active={appearance.palette === p.id}
              onSelect={() => appearance.setPalette(p.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PaletteCard({
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
      {/* Preview card — solid swatch of the palette */}
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

function DefaultsForm({ clis }: { clis: CliInfo[] }) {
  // Framework + Lens live in the dedicated Settings → Frameworks tab.
  // Removed from Defaults to stop the duplication confusion.
  const firstAvailable = useMemo(() => clis.find((c) => c.available)?.id ?? "", [clis]);
  const [defaultChatCli, setDefaultChatCli] = useState(() => lsGet(LS.defaultChatCli) || firstAvailable);
  const [defaultChairCli, setDefaultChairCli] = useState(() => lsGet(LS.defaultChairCli) || firstAvailable);

  useEffect(() => { lsSet(LS.defaultChatCli, defaultChatCli); }, [defaultChatCli]);
  useEffect(() => { lsSet(LS.defaultChairCli, defaultChairCli); }, [defaultChairCli]);
  // Adopt the first available CLI as default once detection finishes
  // and no explicit pick has been saved yet.
  useEffect(() => {
    if (!defaultChatCli && firstAvailable) setDefaultChatCli(firstAvailable);
    if (!defaultChairCli && firstAvailable) setDefaultChairCli(firstAvailable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAvailable]);

  return (
    <div className="space-y-6">
      {/* CLI + chair as visual chip pickers */}
      <div className="flex flex-col gap-4">
        <CliPickerCard
          label="Default chat CLI"
          hint="Opens when you click a domain"
          clis={clis}
          value={defaultChatCli}
          onChange={setDefaultChatCli}
        />
        <CliPickerCard
          label="Default council chair"
          hint="Writes the verdict after panelists answer"
          clis={clis}
          value={defaultChairCli}
          onChange={setDefaultChairCli}
        />
      </div>

      {/* Per-CLI model quickpicks */}
      <div>
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
          Model · per CLI
        </div>
        <div className="flex flex-col gap-4">
          {clis.filter((c) => MODELS[c.id]).map((c) => (
            <ModelPickerCard key={c.id} cli={c} />
          ))}
        </div>
      </div>

      {/* Framework + Lens used to live here as small chip rows, but
          they're already set in Settings → Frameworks (the dedicated
          full-width two-column layout with descriptions). Removed
          here to stop the duplication confusion. */}
    </div>
  );
}

function CliPickerCard({
  label, hint, clis, value, onChange,
}: {
  label: string;
  hint: string;
  clis: CliInfo[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
      <p className="mt-0.5 text-xs text-text-muted/80">{hint}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {clis.map((c) => {
          const picked = value === c.id;
          const disabled = !c.available;
          return (
            <button
              key={c.id}
              disabled={disabled}
              onClick={() => onChange(c.id)}
              title={disabled ? `${c.label} not installed` : c.label}
              className={`group relative flex flex-col items-center gap-1.5 rounded-lg border-2 px-2 py-2.5 transition-all ${
                picked
                  ? "border-accent bg-accent-soft shadow-md ring-2 ring-accent/30"
                  : disabled
                  ? "border-border-subtle bg-background opacity-40"
                  : "border-border bg-background hover:-translate-y-px hover:border-accent-border hover:shadow-sm"
              }`}
            >
              {picked && (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-background shadow-sm">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              )}
              <ProviderMark vendor={c.id} size={28} />
              <span className={`font-display text-xs font-semibold tracking-tight ${picked ? "text-accent" : "text-text-primary"}`}>
                {c.label}
              </span>
              {picked && (
                <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-background">
                  selected
                </span>
              )}
              {disabled && (
                <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">not installed</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelPickerCard({ cli }: { cli: CliInfo }) {
  const key = `prevail.model.${cli.id}`;
  const models = MODELS[cli.id] ?? [];
  const [picked, setPicked] = useState(() => lsGet(key) || models[0]?.id || "");
  useEffect(() => { lsSet(key, picked); }, [key, picked]);
  const current = models.find((m) => m.id === picked);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="font-mono text-xs uppercase tracking-wider text-text-muted">
          {cli.label.toLowerCase()}
        </div>
        {!cli.available && (
          <span className="rounded bg-surface-strong px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
            not installed
          </span>
        )}
      </div>
      <div className="mt-3 grid gap-2">
        {models.map((m) => {
          const on = picked === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setPicked(m.id)}
              className={`group flex items-center justify-between rounded-md border-2 px-3 py-2 text-left transition-colors ${
                on
                  ? "border-accent bg-accent-soft ring-2 ring-accent/20"
                  : "border-border bg-background hover:bg-surface-warm"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-sm ${on ? "font-semibold text-accent" : "text-text-primary"}`}>
                    {m.label}
                  </span>
                  {on && (
                    <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-background">
                      selected
                    </span>
                  )}
                </div>
                {m.blurb && (
                  <div className="text-[11px] text-text-muted">{m.blurb}</div>
                )}
              </div>
              {on && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-background">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {current && (
        <div className="mt-3 truncate font-mono text-[10px] text-text-muted">
          → passed as --model {current.id}
        </div>
      )}
    </div>
  );
}

// FrameworkPickerCard was deleted with v0.2.92 — the chip-row UI
// it provided lived only in Settings → Defaults as a duplicate of
// the dedicated Settings → Frameworks page. The full two-column
// FrameworksSection is now the single source of truth.

// ─────────────────────────────────────────────────────────────────────
// Integration cards (Telegram / WhatsApp / MCP / Briefings) are now
// rendered directly inside Settings → Integrations. Old ToolsPanel
// wrapper removed.

function TelegramCard() {
  const [token, setToken] = useState(lsGet(LS.telegramToken));
  const [chatId, setChatId] = useState(lsGet(LS.telegramChatId));
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" });

  useEffect(() => { lsSet(LS.telegramToken, token); }, [token]);
  useEffect(() => { lsSet(LS.telegramChatId, chatId); }, [chatId]);

  async function testSend() {
    if (!token || !chatId) {
      setStatus({ kind: "err", msg: "fill in token + chat ID first" });
      return;
    }
    setStatus({ kind: "idle", msg: "sending…" });
    try {
      const r = await invoke<{ ok: boolean; description?: string }>("telegram_send", {
        token, chatId, text: "◆ Prevail desktop · test message ✓",
      });
      if (r.ok) {
        setStatus({ kind: "ok", msg: "delivered ✓" });
      } else {
        setStatus({ kind: "err", msg: r.description ?? "send failed" });
      }
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#229ED9]/15 text-[#229ED9]">
          <Send className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">Telegram bridge</h3>
          <p className="text-xs text-text-muted">Push verdicts + briefings to a Telegram chat via a bot.</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-text-muted">Bot token</div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABC-XYZ…"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </label>
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-text-muted">Chat ID</div>
          <input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-1001234567890"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </label>
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={testSend}
            disabled={!token || !chatId}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
          >
            <Send className="h-3.5 w-3.5" />
            Send test message
          </button>
          {status.kind === "ok" && (
            <span className="text-xs text-ok"><Check className="mr-1 inline h-3 w-3" />{status.msg}</span>
          )}
          {status.kind === "err" && (
            <span className="text-xs text-warn">{status.msg}</span>
          )}
        </div>
        <p className="text-xs text-text-muted">
          New to Telegram bots?{" "}
          <a href="https://core.telegram.org/bots/features#botfather" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Create one via @BotFather
          </a>, then add it to your chat and use{" "}
          <a href="https://api.telegram.org/bot{TOKEN}/getUpdates" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            getUpdates
          </a>{" "}
          to find your chat ID.
        </p>
      </div>
    </div>
  );
}

function WhatsAppCard() {
  const [number, setNumber] = useState(lsGet(LS.whatsappNumber));
  useEffect(() => { lsSet(LS.whatsappNumber, number); }, [number]);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#25D366]/15 text-[#25D366]">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">
            WhatsApp <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">soon</span>
          </h3>
          <p className="text-xs text-text-muted">Same idea as Telegram, via WhatsApp Cloud API. Setup pending Meta business approval.</p>
        </div>
      </div>
      <div className="mt-4">
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-text-muted">Your number (E.164)</div>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+14155552671"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </label>
        <p className="mt-3 text-xs text-text-muted">
          We'll email you when WhatsApp Cloud API hookup ships. Until then, this is just stored locally for when it's ready.
        </p>
      </div>
    </div>
  );
}

function McpCard() {
  const [enabled, setEnabled] = useState(lsGet(LS.mcpEnabled) === "1");
  useEffect(() => { lsSet(LS.mcpEnabled, enabled ? "1" : ""); }, [enabled]);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ai/15 text-ai">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">
            MCP server <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">preview</span>
          </h3>
          <p className="text-xs text-text-muted">Expose your vault to Claude Desktop or any MCP client over localhost.</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-background p-3">
        <div>
          <div className="text-sm">MCP server</div>
          <div className="text-xs text-text-muted">
            {enabled ? "Listening on localhost:7842" : "Off"}
          </div>
        </div>
        <Toggle on={enabled} onChange={setEnabled} label="Enable MCP server" />
      </div>
      <p className="mt-3 text-xs text-text-muted">
        For full MCP coverage right now, run the <Brand /> CLI's <code className="text-accent">mcp-server</code> command — it ships read-only by default and is parent-process verified.
      </p>
    </div>
  );
}

// BriefingsCard removed — landing back in v0.3 when wired up.
