import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen, isBrowser, setWebToken, type UnlistenFn } from "./bridge";
import { open, save, confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrevailLogo } from "./PrevailLogo";

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
const APP_VERSION = "0.4.2";

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
      className={`inline-flex h-5 w-9 shrink-0 items-center overflow-hidden rounded-full px-0.5 transition-colors disabled:opacity-50 ${
        on ? "bg-accent" : "bg-surface-strong"
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-200 ${
          on ? "translate-x-4" : "translate-x-0"
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
    // gpt-5.5 is the ONLY model Codex accepts on a ChatGPT-login
    // account — every gpt-5 / gpt-5-codex / gpt-5-mini / o-series
    // variant returns 400 "model not supported when using Codex with a
    // ChatGPT account". Verified empirically against `codex exec`.
    // The "@<effort>" suffix is parsed in cli_args() (lib.rs) into
    // `-c model_reasoning_effort=<effort>`; minimal effort 400s, so
    // only default / medium / high are offered. All three are tested
    // working.
    { id: "gpt-5.5",        label: "GPT-5.5",          blurb: "flagship · fast (default)" },
    { id: "gpt-5.5@medium", label: "GPT-5.5 (medium)", blurb: "balanced reasoning" },
    { id: "gpt-5.5@high",   label: "GPT-5.5 (high)",   blurb: "max reasoning · slower" },
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
  openrouter: [
    { id: "anthropic/claude-opus-4.1",       label: "Claude Opus 4.1",   blurb: "via OpenRouter" },
    { id: "anthropic/claude-sonnet-4.5",     label: "Claude Sonnet 4.5", blurb: "via OpenRouter" },
    { id: "openai/gpt-5.1",                  label: "GPT-5.1",           blurb: "via OpenRouter" },
    { id: "google/gemini-2.5-pro",           label: "Gemini 2.5 Pro",    blurb: "via OpenRouter" },
    { id: "x-ai/grok-4",                     label: "Grok 4",            blurb: "via OpenRouter" },
    { id: "deepseek/deepseek-chat",          label: "DeepSeek",          blurb: "via OpenRouter" },
    { id: "qwen/qwen-2.5-72b-instruct",      label: "Qwen 2.5 72B",      blurb: "via OpenRouter" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B",   blurb: "via OpenRouter" },
  ],
};

// Models a ChatGPT-login Codex account rejects (verified). A previously
// saved pick like "gpt-5-codex" persists in localStorage and keeps
// failing even after we trim the dropdown — so heal it on launch.
const DEAD_MODELS = new Set([
  "gpt-5-codex", "gpt-5", "gpt-5-high", "gpt-5-mini", "gpt-5.1",
  "gpt-5.5-codex", "gpt-4o", "o3", "o4-mini",
]);

// One-time migration: reset any stale per-CLI model pick that's no longer
// in MODELS, and replace any known-dead model id (global or per-domain)
// with the working gpt-5.5. Safe + idempotent.
function migrateModelPrefs() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^prevail\.(model\.|domain\..+\.model$)/.test(k)) keys.push(k);
    }
    for (const cli of Object.keys(MODELS)) {
      const ids = new Set(MODELS[cli].map((m) => m.id));
      const cur = lsGet(`prevail.model.${cli}`);
      if (cur && !ids.has(cur)) lsSet(`prevail.model.${cli}`, MODELS[cli][0].id);
    }
    for (const k of keys) {
      const v = lsGet(k);
      if (v && DEAD_MODELS.has(v)) lsSet(k, "gpt-5.5");
    }
  } catch {
    /* localStorage unavailable — ignore */
  }
}
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Award,
  BookOpen,
  Brain,
  Briefcase,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Crown,
  Download,
  Eye,
  FileText,

  Folder,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Github,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  Paperclip,
  PenLine,
  Pin,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
  Send,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Sun,
  Mail,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Target,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  X,
  AlertTriangle,
  Circle,
  ChevronLeft,
  Trash2,
  Activity,
  Coins,
  Cpu,
  Layers,
  Landmark,
  Lightbulb,
  Plug,
  ThumbsUp,
  ThumbsDown,
  ShieldCheck,
  Cloud,
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
  mail: Mail,
  email: Mail,
  inbox: Mail,
};

function domainIcon(name: string): LucideIcon | null {
  return DOMAIN_ICONS[name.toLowerCase()] ?? null;
}

// Friendly one-line descriptions for the domain cards — plain, warm, no jargon.
// Shown as the card subtitle; falls back to a generic line for unknown domains.
const DOMAIN_BLURBS: Record<string, string> = {
  wealth: "Your money, savings, and the path to financial freedom.",
  finance: "Your money, savings, and the path to financial freedom.",
  health: "Your energy, fitness, and long-term wellbeing.",
  fitness: "Your energy, fitness, and long-term wellbeing.",
  tax: "Filings, deadlines, and keeping more of what you earn.",
  taxes: "Filings, deadlines, and keeping more of what you earn.",
  career: "Your work, growth, and where you're headed next.",
  work: "Your work, growth, and where you're headed next.",
  business: "Your ventures, clients, and what you're building.",
  insurance: "Coverage, renewals, and protecting what matters.",
  estate: "Your legacy, documents, and looking after your people.",
  calendar: "What's coming up, and making time for what counts.",
  schedule: "What's coming up, and making time for what counts.",
  benefits: "Perks, plans, and everything your employer offers.",
  brand: "Your name, your voice, and how the world sees you.",
  content: "Ideas, posts, and the things you create.",
  "real-estate": "Property, home, and the roof over your head.",
  realestate: "Property, home, and the roof over your head.",
  home: "Your space, your projects, and daily life at home.",
  records: "Important documents, kept safe and easy to find.",
  vision: "The big picture: where you're going, and why.",
  social: "Friends, connections, and staying in touch.",
  family: "The people closest to you, and staying connected.",
  learning: "Skills, courses, and growing your mind.",
  learn: "Skills, courses, and growing your mind.",
  intel: "Research, signals, and staying in the know.",
  intelligence: "Research, signals, and staying in the know.",
  explore: "Curiosities, trips, and things worth discovering.",
  travel: "Curiosities, trips, and things worth discovering.",
  chief: "Your command center for today's priorities and what matters now.",
  mail: "Your inbox: important threads handled, noise filtered, nothing dropped.",
  email: "Your inbox: important threads handled, noise filtered, nothing dropped.",
  inbox: "Your inbox: important threads handled, noise filtered, nothing dropped.",
};

function domainBlurb(name: string): string {
  return DOMAIN_BLURBS[name.toLowerCase()] ?? "A space to track and work on this part of your life.";
}

// ─────────────────────────────────────────────────────────────────────
// Provider brand marks. Real SVG glyphs from simple-icons (MIT) for
// Anthropic/Claude and Ollama. OpenAI's mark isn't in simple-icons due
// to trademark policy, so we render a faithful version. Antigravity is
// Google's CLI, so we render the multicolor "G" wordmark.

import {
  siClaude as siClaudeRaw,
  siOllama as siOllamaRaw,
  siGmail, siGooglecalendar, siGoogledrive, siGooglesheets, siDropbox, siNotion,
  siDiscord, siGithub, siGitlab, siLinear, siStripe, siShopify, siCoinbase,
  siTelegram, siWhatsapp, siReddit, siYoutube, siSpotify, siZoom, siAirtable,
  siTrello, siAsana, siTodoist, siHubspot, siQuickbooks, siCalendly, siObsidian,
  siWise, siRobinhood, siStrava, siFitbit,
  // Model-provider brand marks (Settings → Models, direct-provider roadmap).
  siAnthropic, siGooglegemini, siHuggingface, siX as siXRaw, siDeepseek, siQwen, siMinimax,
} from "simple-icons";

const siClaude = siClaudeRaw as { path: string };
const siOllama = siOllamaRaw as { path: string };

// A simple-icons brand mark (real SVG path + brand hex).
type Brand = { path: string; hex: string; title: string };

// `hex` = icon-tile background (true brand color). `accent` = a
// display-safe variant used for text/borders that must stay legible on
// both light and dark surfaces (white/black brand marks would vanish).
const VENDOR_BRAND: Record<string, { hex: string; accent: string; name: string }> = {
  claude:      { hex: "#cc785c", accent: "#cc785c", name: "Anthropic Claude" },
  codex:       { hex: "#10a37f", accent: "#10a37f", name: "OpenAI Codex" },
  antigravity: { hex: "#ffffff", accent: "#4285f4", name: "Google Antigravity" },
  ollama:      { hex: "#0a0a0a", accent: "#6b7280", name: "Ollama (local)" },
  lmstudio:    { hex: "#4f46e5", accent: "#6366f1", name: "LM Studio (local)" },
  mlx:         { hex: "#1f2937", accent: "#9ca3af", name: "MLX (local)" },
  openrouter:  { hex: "#6566f1", accent: "#6566f1", name: "OpenRouter" },
  other:       { hex: "#6b7280", accent: "#6b7280", name: "—" },
};

// Brand accent for a vendor, safe for text/border use. Returns the hex
// plus a low-alpha tint suitable for a subtle bubble background.
function vendorAccent(vendor: string): { accent: string; tint: string } {
  const v = VENDOR_BRAND[vendor] ?? VENDOR_BRAND.other;
  return { accent: v.accent, tint: `${v.accent}14` }; // 14 ≈ 8% alpha
}

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
    case "lmstudio":
      // No official simple-icons glyph; use a clean monogram on the brand tile.
      inner = <span className="font-mono font-semibold text-white" style={{ fontSize: Math.round(size * 0.34) }}>LM</span>;
      break;
    case "mlx":
      inner = <span className="font-mono font-semibold text-white" style={{ fontSize: Math.round(size * 0.3) }}>MLX</span>;
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

// ── Context Score (mirrors engine.rs ContextScore / ContextScore.json) ──
interface ScoreDimension {
  score: number;
  detail: string;
}
interface ScoreBreakdown {
  coverage: ScoreDimension;
  density: ScoreDimension;
  freshness: ScoreDimension;
  structure: ScoreDimension;
  activity: ScoreDimension;
  config_completeness: ScoreDimension;
}
interface MissingItem {
  label: string;
  severity: string; // info | warn | critical
  kind: string;
}
interface RelevanceItem {
  id: string;
  label: string;
  present: boolean;
  stale: boolean;
  severity: string; // info | warn | critical
  detail: string;
  recommend: string;
}
interface DomainRelevance {
  matched: string;
  score: number;
  detail: string;
  items: RelevanceItem[];
}
interface ContextScore {
  domain: string;
  score: number;
  breakdown: ScoreBreakdown;
  relevance: DomainRelevance | null;
  missing: MissingItem[];
  freshness_secs: number;
  assessment: string | null;
  audit_source: string | null;
  computed_at: string;
  audited_at: number | null;
}
interface LifeReadiness {
  life_readiness: number | null;
  domains: ContextScore[];
  computed_at: string | null;
}

// ── Onboarding (mirrors engine.rs / OnboardingRecommendation.json) ──
interface ProposedDomain {
  name: string;
  label: string;
  emoji: string;
  summary: string;
  reason: string;
  recommended: boolean;
  starterGoals?: string[];
  suggestedSkills?: string[];
}
interface OnboardingRecommendation {
  domains: ProposedDomain[];
  rationale: string;
  generated_at: string;
}

// ── Domain manifest config (subset mirrors DomainManifest.json config) ──
// Only the fields the desktop reads/writes for per-domain prefs. Kept
// lenient so the engine can carry extra fields without breaking us.
interface ManifestConfig {
  cli?: string;
  model?: string;
  framework?: string | null;
  lens?: string | null;
  skills?: string[];
  autoState?: boolean;
}
// Per-domain privacy block (mirrors DomainManifest.json privacy).
interface ManifestPrivacy {
  localOnly?: boolean;
}
// Per-domain sandbox block (mirrors DomainManifest.json sandbox).
interface ManifestSandbox {
  mode?: string; // "open" | "locked"
}
// Per-domain routing block (mirrors DomainManifest.json routing).
interface ManifestRouting {
  keywords?: string[];
  channels?: string[];
  default?: boolean;
}
interface DomainManifest {
  config?: ManifestConfig;
  privacy?: ManifestPrivacy;
  sandbox?: ManifestSandbox;
  routing?: ManifestRouting;
  [k: string]: unknown;
}

// ── Backup (mirrors engine.rs / BackupResult.json) ──
interface BackupResult {
  ok: boolean;
  archive_path: string | null;
  scope: "vault" | "domain";
  domains: string[];
  file_count: number;
  bytes: number;
  created_at: string;
  error?: string | null;
}

// The ~6 onboarding questions. Free-form answers are bundled into a single
// JSON document ({ answers: { ... } }) sent to `engine_onboard_recommend`.
const ONBOARDING_QUESTIONS: {
  id: string;
  prompt: string;
  placeholder: string;
}[] = [
  { id: "focus", prompt: "What are you focused on right now?", placeholder: "building ventures, getting healthier, managing money…" },
  { id: "roles", prompt: "What roles or hats do you wear?", placeholder: "founder, parent, investor, creator…" },
  { id: "money", prompt: "How do you want to handle money & wealth?", placeholder: "track net worth, taxes, investing, real estate…" },
  { id: "health", prompt: "Anything around health, fitness, or wellbeing?", placeholder: "fitness goals, sleep, mental health… (leave blank to skip)" },
  { id: "work", prompt: "What does your work or business look like?", placeholder: "company, clients, content, career…" },
  { id: "other", prompt: "Anything else you'd like a domain for?", placeholder: "learning, relationships, travel, side projects…" },
];

function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// The six dimensions, in display order, with friendly labels. Frozen to
// match the engine's ScoreBreakdown shape.
const SCORE_DIMENSIONS: { key: keyof ScoreBreakdown; label: string }[] = [
  { key: "coverage", label: "Coverage" },
  { key: "density", label: "Density" },
  { key: "freshness", label: "Freshness" },
  { key: "structure", label: "Structure" },
  { key: "activity", label: "Activity" },
  { key: "config_completeness", label: "Config" },
];

// Color thresholds: green >=75, amber 50-74, red <50. Returns a CSS color.
function scoreColor(score: number): string {
  if (score >= 75) return "var(--color-ok, #2e9e5b)";
  if (score >= 50) return "var(--color-warn, #c98a2b)";
  return "var(--color-danger, #d24b4b)";
}
// Human freshness from seconds.
function formatFreshness(secs: number): string {
  if (secs < 0) return "unknown";
  const d = Math.floor(secs / 86400);
  if (d >= 1) return d === 1 ? "1 day ago" : `${d} days ago`;
  const h = Math.floor(secs / 3600);
  if (h >= 1) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const m = Math.floor(secs / 60);
  if (m >= 1) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  return "just now";
}
function formatAuditedAt(ms: number | null): string {
  if (!ms) return "never audited";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "unknown";
  }
}
const SEVERITY_ORDER: Record<string, number> = { critical: 0, warn: 1, info: 2 };
const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  warn: "Warnings",
  info: "Suggestions",
};

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
// Which view the Chat surface shows for the active domain. Lifted to App so the
// top bar can own the Insights / Preferences toggles (and the domain header
// shrinks to just the title). "chat" = the conversation; the rest are domain
// sub-views rendered in place of the transcript.
type DomainTab = "chat" | "context" | "insights" | "state" | "decisions" | "journal" | "logs" | "skills" | "prefs";
const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
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

// ── Bunker Mode (app-wide local-only trust mode) ──
// The backend (bunker.rs) is the source of truth and enforces at the execution
// layer; this mirror lets deeply-nested components (the composer, model pickers,
// send/convene) read the flag synchronously without prop-threading through the
// 12k-line tree. Kept in sync from bunker_status on mount and on every toggle.
// Default ON: absent flag ⇒ locked down. (matches bunker.rs default)
const BUNKER_LS = "prevail.pref.bunkerMode";
function isBunkerOn(): boolean {
  return lsGet(BUNKER_LS, "1") !== "0";
}
// Providers that serve models from this machine only — mirror bunker.rs LOCAL_CLIS.
const LOCAL_CLI_IDS = new Set(["ollama", "lmstudio", "mlx"]);
function isLocalCli(id: string): boolean {
  return LOCAL_CLI_IDS.has(id.toLowerCase());
}
// Bunker Mode auto-switch target: the local provider to fall back to when a
// cloud CLI is selected. First *available* local CLI, or null if none is
// installed/running. Mirrors bunker.rs `preferred_local_cli` (Ollama today;
// LM Studio / MLX detection is a recorded deferred refinement).
function preferredLocalCli(clis: { id: string; available: boolean }[]): string | null {
  return clis.find((c) => isLocalCli(c.id) && c.available)?.id ?? null;
}

// The always-visible Bunker Mode status bar. Never disappears while the app
// runs, so the user always knows whether anything can leave their machine.
function BunkerRibbon({ enabled }: { enabled: boolean }) {
  // High-contrast in BOTH modes: a clear tinted bar (not a translucent wash that
  // disappears over warm/cream themes) with dark text in light mode and light
  // text in dark mode. Legibility is non-negotiable for an always-on trust bar.
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center gap-2 border-t px-4 py-1 text-[11px] ${
        enabled
          ? "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      }`}
      title={
        enabled
          ? "Bunker Mode: your data stays on this device. No requests leave your machine."
          : "Cloud Connected: cloud models, web search, and external services are enabled."
      }
    >
      {enabled ? <ShieldCheck className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
      <span className="font-mono font-semibold uppercase tracking-[0.18em]">
        {enabled ? "Bunker Mode" : "Cloud Connected"}
      </span>
      <span className="opacity-90">
        ·{" "}
        {enabled
          ? "Local models only • Network disabled"
          : "Cloud models and web access enabled"}
      </span>
      {/* Version — inside the ribbon so it inherits the high-contrast ribbon
          text color (the old standalone pill was invisible over the dark bar). */}
      <span className="pointer-events-none absolute right-3 select-none font-mono text-[10px] tracking-wider opacity-70">
        v{APP_VERSION}
      </span>
    </div>
  );
}

// A7: live "bridge running" chips in the app footer — so you always know a
// Telegram bridge or the WebUI is serving your vault, from anywhere in the app
// (not just buried in Settings). Polls every 4s; renders nothing when idle.
function BridgeStatusChips() {
  const [tg, setTg] = useState(false);
  const [web, setWeb] = useState(false);
  useEffect(() => {
    if (isBrowser()) return; // these bridges are a desktop-host concern
    let alive = true;
    async function poll() {
      try { const t = await invoke<{ running: boolean }>("telegram_bridge_status"); if (alive) setTg(!!t.running); } catch { /* ignore */ }
      try { const w = await invoke<{ running: boolean }>("webui_status"); if (alive) setWeb(!!w.running); } catch { /* ignore */ }
    }
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  if (!tg && !web) return null;
  const Chip = ({ Icon, label, title }: { Icon: LucideIcon; label: string; title: string }) => (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/30 bg-emerald-900/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300"
    >
      <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
  return (
    <div className="pointer-events-none absolute bottom-1 left-2 z-20 flex items-center gap-1.5">
      {web && <Chip Icon={Monitor} label="WebUI" title="WebUI is live — reachable in your browser (Settings → Remote)" />}
      {tg && <Chip Icon={MessagesSquare} label="Telegram" title="Telegram bridge is live — messages route to your domains" />}
    </div>
  );
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
// the total stays under `maxChars`. Empty-content messages (the streaming
// placeholder for an in-flight reply) are excluded automatically.
//
// IMPORTANT: callers pass the PRIOR conversation — at send() time React's
// state update for the just-typed user turn + its placeholder has not yet
// committed, so `msgs` does NOT contain them. We must therefore keep every
// prior turn (filtering only empties). A previous version sliced off the
// last two entries on the assumption the new pair was already present, which
// silently dropped the most-recent completed exchange — so a follow-up that
// referenced it (e.g. "was he any good?") reached the model with no context,
// most visibly when switching models mid-thread. (feedback v0.4.1 B1)
function buildChatContext(
  msgs: { role: "user" | "assistant"; cli?: string; content: string }[],
  maxChars: number,
): string {
  const sliced = msgs.filter((m) => m.content.trim().length > 0);
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
// Safety: scrub obvious secrets (API keys, bearer tokens, key=value secrets)
// before persisting to the intent ledger, when Redact Secrets is enabled.
function maybeRedact(s: string): string {
  if (lsGet("prevail.pref.redactSecrets") !== "1") return s;
  return s
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|xoxb|xoxp|AKIA)[-_A-Za-z0-9]{12,}/g, "***REDACTED***")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer ***REDACTED***")
    .replace(/("?(?:api[_-]?key|token|secret|password)"?\s*[:=]\s*"?)[A-Za-z0-9._\-]{8,}/gi, "$1***REDACTED***");
}
function maybeStripSycophancy(s: string): string {
  if (lsGet("prevail.pref.stripSycophancy") !== "1") return s;
  return s.replace(SYCOPHANCY_RE, "");
}

// Pull a concise, human-readable error out of a CLI's noisy stderr.
// CLIs emit a startup banner (version, workdir, model, session id…) plus
// the actual failure. We want only the failure. Codex emits structured
// `ERROR: {json}` lines whose `.error.message` is the useful part; other
// CLIs print a plain error line. Falls back to the last non-empty line.
function extractCliError(stderr?: string): string | null {
  if (!stderr) return null;
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  // Prefer an explicit ERROR line; parse JSON payload when present.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^ERROR[:\s]/i.test(line) || /\berror\b/i.test(line)) {
      const braceAt = line.indexOf("{");
      if (braceAt !== -1) {
        try {
          const obj = JSON.parse(line.slice(braceAt));
          const msg = obj?.error?.message ?? obj?.message;
          if (typeof msg === "string" && msg) return msg;
        } catch { /* fall through to raw line */ }
      }
      return line.replace(/^ERROR[:\s]+/i, "");
    }
  }
  // No explicit error marker — surface the last line of output.
  return lines[lines.length - 1];
}

// ─────────────────────────────────────────────────────────────────────
// Brand — official Prevail logo, byte-identical to the site

// PrevailLogo (animated 3D mark) is imported from ./PrevailLogo.

function Brand({ className = "", fill = false }: { className?: string; fill?: boolean }) {
  if (fill) {
    // Flexbox justify-between spreads the letters edge-to-edge across
    // whatever width the parent provides. No letter-spacing math.
    return (
      <span className={`flex w-full items-center justify-between ${className}`}>
        <span>P</span>
        <span>R</span>
        {/* The logo mark stands in for the "E". Sized ~1.1em so the round mark
            reads at the same visual weight as the letters. */}
        <span className="inline-flex shrink-0 items-center" style={{ marginInline: "-0.04em" }} aria-label="E">
          <PrevailLogo size={26} src="/logo-512.png" animated={false} />
        </span>
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
  { id: "vault",     name: "Vault",     blurb: "Cream + gold — focused, warm",                       swatch: { bg: "#faf8f1", surface: "#ffffff", accent: "#a8862d", ai: "#60a8c0" } },
  { id: "midnight",  name: "Midnight",  blurb: "Deep blue-violet with cool accents",                  swatch: { bg: "#0a0d1f", surface: "#131730", accent: "#818cf8", ai: "#60a8c0" } },
  { id: "ember",     name: "Ember",     blurb: "Warm crimson and bronze — forge vibes",               swatch: { bg: "#1a0a06", surface: "#2a130c", accent: "#ef6c4a", ai: "#60a8c0" } },
  { id: "mono",      name: "Mono",      blurb: "Clean grayscale — minimal and focused",               swatch: { bg: "#f7f7f8", surface: "#ffffff", accent: "#18181b", ai: "#60a8c0" } },
  { id: "cyberpunk", name: "Cyberpunk", blurb: "Neon green on black — matrix terminal",               swatch: { bg: "#030a06", surface: "#08130c", accent: "#22ff77", ai: "#60a8c0" } },
  { id: "slate",     name: "Slate",     blurb: "Cool slate blue — focused developer theme",           swatch: { bg: "#0c1220", surface: "#131b2e", accent: "#38bdf8", ai: "#60a8c0" } },
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
// Onboarding flow — shown when the vault has zero domains (or via the
// "Set up domains" button). Three steps:
//   1. answer ~6 questions  → engine_onboard_recommend (answers on stdin)
//   2. pick from a checkbox list of recommended domains
//   3. engine_onboard_apply (picks on stdin) → caller refreshes scan_vault
function OnboardingModal({
  vaultPath,
  onClose,
  onApplied,
}: {
  vaultPath: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  type Step = "questions" | "review" | "applying";
  const [step, setStep] = useState<Step>("questions");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [rec, setRec] = useState<OnboardingRecommendation | null>(null);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestRecommendation() {
    setBusy(true);
    setError(null);
    try {
      const answersJson = JSON.stringify({ answers });
      const value = await invoke<OnboardingRecommendation>("engine_onboard_recommend", {
        vault: vaultPath,
        answersJson,
      });
      setRec(value);
      // Pre-select the recommended set.
      setPicks(new Set(value.domains.filter((d) => d.recommended).map((d) => d.name)));
      setStep("review");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

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
      setError(String(e));
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

  const answeredCount = ONBOARDING_QUESTIONS.filter((q) => (answers[q.id] ?? "").trim()).length;

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

          {step === "questions" && (
            <>
              <p className="mb-4 text-sm text-text-secondary">
                A few quick questions. Prevail proposes a starter set of life domains
                from your answers — you pick what to keep. Leave any blank to skip.
              </p>
              <div className="flex flex-col gap-4">
                {ONBOARDING_QUESTIONS.map((q) => (
                  <label key={q.id} className="block">
                    <span className="mb-1 block text-sm font-medium text-text-primary">{q.prompt}</span>
                    <textarea
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers((cur) => ({ ...cur, [q.id]: e.target.value }))}
                      placeholder={q.placeholder}
                      rows={2}
                      className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            </>
          )}

          {step === "review" && rec && (
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
                {rec.domains.map((d) => {
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
          {step === "questions" ? (
            <>
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                {answeredCount}/{ONBOARDING_QUESTIONS.length} answered
              </span>
              <button
                onClick={requestRecommendation}
                disabled={busy || answeredCount === 0}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Recommend domains
              </button>
            </>
          ) : step === "review" ? (
            <>
              <button
                onClick={() => setStep("questions")}
                disabled={busy}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40"
              >
                Back
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

// ─────────────────────────────────────────────────────────────────────
// App root — vault picker, sidebar, tabs

// Deterministic per-domain accent color — turns the monochrome card grid
// into a colorful, scannable board. Muted, on-brand palette.
const DOMAIN_PALETTE = [
  "#cc785c", "#2d7fe4", "#5fae74", "#c4a35a", "#a78bfa", "#e0823d",
  "#3fa6a0", "#c44e8a", "#7c83ff", "#6b8e23", "#d2674f", "#b8860b",
];
function domainColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DOMAIN_PALETTE[h % DOMAIN_PALETTE.length];
}
// Browser login screen for the WebUI. Authenticates against the bridge
// server's /api/login, stores the token, then lets the real app mount.
function WebLogin({ onAuthed }: { onAuthed: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function login() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, pass }) });
      if (!res.ok) { setErr("Invalid username or password"); return; }
      const j = (await res.json()) as { token?: string };
      if (!j.token) { setErr("Login failed"); return; }
      setWebToken(j.token);
      onAuthed();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background px-6">
      <PrevailLogo size={64} src="/logo-512.png" animated={false} />
      <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">Prevail — Web</h1>
      <p className="mt-1 text-sm text-text-muted">Sign in to your remote agent.</p>
      <div className="mt-6 w-full max-w-xs space-y-2">
        <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Username" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void login(); }} placeholder="Password" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
        <button onClick={login} disabled={busy || !user || !pass} className="w-full rounded-md bg-accent py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
        {err && <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}
      </div>
    </div>
  );
}

export default function App() {
  const appearance = useAppearance();
  // WebUI login gate — in a browser tab the app must authenticate to the
  // bridge server before any invoke works. On the desktop this is always true.
  const [webAuthed, setWebAuthed] = useState(() => !isBrowser() || !!sessionStorage.getItem("prevail.web.token"));
  const [vaultPath, setVaultPath] = useState<string | null>(() =>
    localStorage.getItem(LS.vault),
  );
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  // Threads — backed by <vault>/<domain>/_threads/<slug>.md files.
  // Active thread defines what's loaded into the chat transcript.
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [activeThreadPath, setActiveThreadPath] = useState<string | null>(null);
  // Bumped on every thread pick so the chat panel returns to the chat view even
  // when the same thread is re-clicked (e.g. to escape the Preferences view).
  const [chatViewNonce, setChatViewNonce] = useState(0);
  // Per-domain import counts shown as a tiny badge in the sidebar.
  // Refreshed when ingestion:artifact fires (any tier writes a file)
  // or when the domain list changes.
  const [domainStats, setDomainStats] = useState<Record<string, number>>({});
  const domainsRef = useRef<Domain[]>([]);
  useEffect(() => { domainsRef.current = domains; }, [domains]);
  // Heal stale/unsupported model picks (e.g. gpt-5-codex → gpt-5.5) once on launch.
  useEffect(() => { migrateModelPrefs(); }, []);
  // If localStorage was wiped (e.g. webview cache clear) but we remembered a
  // vault on disk, restore it so the user isn't bounced back to first-launch.
  useEffect(() => {
    if (vaultPath) return;
    (async () => {
      try {
        const bp = await invoke<string | null>("bootstrap_vault");
        if (bp) { setVaultPath(bp); lsSet(LS.vault, bp); }
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // Onboarding flow — opt-in only, opened manually via "Set up domains".
  // It never auto-appears (the old auto-open raced the scan and popped over
  // a populated vault). The dismissed flag is retained so manual closes are
  // tracked even though nothing auto-reopens.
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [, setOnboardDismissed] = useState(false);
  // Tracks whether the first scan_vault for the current vault has resolved.
  const [, setDomainsLoaded] = useState(false);
  // Reusable vault re-scan (used by onboarding apply + archive/restore).
  const refreshDomains = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const d = await invoke<Domain[]>("scan_vault", { path: vaultPath });
      setDomains(d);
      setVaultError(null);
      setDomainsLoaded(true);
      void refreshDomainStats(d.map((x) => x.name));
    } catch (e) {
      console.error("refreshDomains", e);
    }
  }, [vaultPath, refreshDomainStats]);
  // WebUI host bridge: when running as the DESKTOP host (not a browser tab),
  // execute proxied invokes from web clients and forward events to them. This
  // is what lets the same UI run in a browser with zero duplicate code — the
  // host window is the executor (webview-proxy). No-op in a browser tab.
  useEffect(() => {
    if (isBrowser()) return;
    let unlistens: UnlistenFn[] = [];
    (async () => {
      unlistens.push(await listen<{ id: number; cmd: string; args: Record<string, unknown> }>("webui:invoke", async (e) => {
        const { id, cmd, args } = e.payload;
        try {
          const data = await invoke(cmd, args);
          await invoke("webui_resolve", { id, ok: true, data });
        } catch (err) {
          await invoke("webui_resolve", { id, ok: false, error: String(err) });
        }
      }));
      // Forward the event channels the UI listens to → web clients.
      const channels = ["chat:chunk", "chat:done", "engine-chat:line", "engine-chat:done", "benchmark:chunk", "benchmark:done", "ingestion:artifact", "ingestion:browser", "tg:message_in", "tg:message_out"];
      for (const ch of channels) {
        unlistens.push(await listen<unknown>(ch, (e) => { void invoke("webui_event", { event: ch, payload: e.payload }); }));
      }
    })();
    return () => { unlistens.forEach((u) => u()); unlistens = []; };
  }, []);
  // Self-learning: start/stop the background distillation daemon based on the
  // Memory & Context prefs once a vault is known (mirrors how the Telegram
  // bridge starts on demand). Re-runs when the vault changes.
  useEffect(() => {
    if (!vaultPath) return;
    // The distillation daemon is owned by the desktop host, not a browser tab.
    if (isBrowser()) return;
    const on = getPref(PREF.persistentMemory, "1") === "1" && getPref(PREF.autoCompression, "1") === "1";
    if (on) {
      invoke("distill_start", { cfg: distillCfgFromPrefs(vaultPath) }).catch((e) => console.error("distill_start", e));
    } else {
      invoke("distill_stop").catch(() => {});
    }
  }, [vaultPath]);
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
  // Domains whose background run finished while you were looking elsewhere.
  // The live amber pulse vanishes the instant a stream ends; this keeps a
  // steady "ready" marker on the domain until you actually open it, so a
  // finished run is never silently lost when several are in flight at once.
  const [finishedDomains, setFinishedDomains] = useState<Record<string, number>>({});
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
          // Leave a persistent "ready" marker on the domain you weren't watching.
          if (ended.domain) {
            const dom = ended.domain;
            setFinishedDomains((m) => ({ ...m, [dom]: Date.now() }));
          }
        }
      }
      return cur.filter((x) => x.sessionId !== sessionId);
    });
  }, []);
  const runningDomains = useMemo(() => new Set(runningStreams.map((s) => s.domain ?? "")), [runningStreams]);
  const runningThreadPaths = useMemo(() => new Set(runningStreams.map((s) => s.threadPath ?? "").filter(Boolean)), [runningStreams]);
  // Opening a domain clears its "ready" marker — you've now seen it.
  useEffect(() => {
    if (!selectedDomain) return;
    setFinishedDomains((m) => {
      if (!(selectedDomain in m)) return m;
      const next = { ...m };
      delete next[selectedDomain];
      return next;
    });
  }, [selectedDomain]);
  // A domain shows "ready" only when it's done AND not currently re-running.
  const finishedDomainSet = useMemo(
    () => new Set(Object.keys(finishedDomains).filter((d) => !runningDomains.has(d))),
    [finishedDomains, runningDomains],
  );
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
  // Lifted from ChatPanel so the top bar owns the domain Insights / Preferences
  // toggles. ChatPanel receives these as props and renders the matching view.
  const [domainTab, setDomainTab] = useState<DomainTab>("chat");
  // Bunker Mode: backend is the source of truth; mirror it into localStorage on
  // mount so synchronous reads (isBunkerOn) everywhere stay correct, and into
  // React state so the persistent ribbon re-renders on toggle.
  const [bunkerEnabled, setBunkerEnabled] = useState<boolean>(isBunkerOn);
  const [bunkerLocalOk, setBunkerLocalOk] = useState<boolean>(true); // assume ok until checked
  useEffect(() => {
    invoke<{ enabled: boolean; local_available: boolean }>("bunker_status")
      .then((s) => {
        const on = !!s.enabled;
        lsSet(BUNKER_LS, on ? "1" : "0");
        setBunkerEnabled(on);
        setBunkerLocalOk(!!s.local_available);
      })
      .catch(() => {});
  }, []);
  // Called by the Privacy & Connectivity section after a confirmed toggle.
  const applyBunker = useCallback((on: boolean) => {
    lsSet(BUNKER_LS, on ? "1" : "0");
    setBunkerEnabled(on);
  }, []);
  // A domain can launch a scoped benchmark; it dispatches this event and we
  // jump to the Benchmark page pre-scoped to that domain.
  const [benchScope, setBenchScope] = useState<string | null>(null);
  useEffect(() => {
    const onBench = (e: Event) => {
      const d = (e as CustomEvent<string>).detail || null;
      setBenchScope(d);
      setTab("benchmark");
    };
    window.addEventListener("prevail:benchmark-domain", onBench as EventListener);
    return () => window.removeEventListener("prevail:benchmark-domain", onBench as EventListener);
  }, []);
  // I4: a high-stakes quick-action (Decision / Risks) routes to the Council. The
  // card dispatches this event; we switch the domain + Council tab and seed the
  // question so the user just picks panelists and convenes.
  const [councilSeed, setCouncilSeed] = useState<string | null>(null);
  useEffect(() => {
    const onSeed = (e: Event) => {
      const detail = (e as CustomEvent<{ domain?: string; prompt: string }>).detail;
      if (!detail?.prompt) return;
      if (detail.domain) setSelectedDomain(detail.domain);
      setCouncilSeed(detail.prompt);
      setTab("council");
    };
    window.addEventListener("prevail:council-seed", onSeed as EventListener);
    return () => window.removeEventListener("prevail:council-seed", onSeed as EventListener);
  }, []);
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

  // Re-detectable so saving a provider key (OpenRouter) or starting a local
  // server can refresh the picker without a reload. Returns the fresh list.
  const refreshClis = useCallback(async (): Promise<CliInfo[]> => {
    try {
      const list = await invoke<CliInfo[]>("detect_clis");
      setClis(list);
      return list;
    } catch {
      return [];
    }
  }, []);
  useEffect(() => {
    void refreshClis();
  }, [refreshClis]);

  useEffect(() => {
    if (!vaultPath) return;
    // In a browser tab, wait until authenticated — otherwise the scan fires a
    // pre-login invoke that 401s and leaves a stale "unauthorized" error. The
    // webAuthed dep re-runs this once sign-in completes.
    if (isBrowser() && !webAuthed) return;
    let cancelled = false;
    let attempts = 0;
    setDomainsLoaded(false);
    const tryScan = async () => {
      while (!cancelled && attempts < 5) {
        try {
          const d = await invoke<Domain[]>("scan_vault", { path: vaultPath });
          if (cancelled) return;
          setDomains(d);
          setVaultError(null);
          setDomainsLoaded(true);
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
  }, [vaultPath, webAuthed]);

  // Onboarding auto-open REMOVED. It raced the vault scan (firing while
  // domains were still loading) and popped a modal over an already-populated
  // vault, then never auto-closed. Onboarding is now opt-in only via the
  // explicit "Set up domains" control; it never auto-appears.

  async function pickVault() {
    // The native folder picker (tauri-plugin-dialog) only exists in the
    // desktop runtime; calling it in a browser throws "Cannot read properties
    // of undefined (reading 'invoke')". In the WebUI the browser inherits the
    // desktop's vault automatically (bootstrap_vault), so this path is a
    // fallback — guide the user to the desktop instead of crashing. (B4)
    if (isBrowser()) {
      window.alert(
        "Pick your vault from the Prevail desktop app on this Mac — a browser can't open a native folder picker. The web view then syncs to it automatically.",
      );
      return;
    }
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setVaultPath(dir);
      lsSet(LS.vault, dir);
      void invoke("remember_vault", { path: dir }).catch(() => {});
      setSelectedDomain(null);
    }
  }

  // Import the bundled sample vault (fully-populated demo domains) so the
  // user can explore every feature without creating anything.
  async function loadSample() {
    try {
      const path = await invoke<string>("import_sample_vault");
      setVaultPath(path);
      lsSet(LS.vault, path);
      setSelectedDomain(null);
    } catch (e) {
      console.error("import_sample_vault failed", e);
    }
  }

  if (isBrowser() && !webAuthed) return <WebLogin onAuthed={() => setWebAuthed(true)} />;
  if (!vaultPath) return <VaultWizard onPick={pickVault} onLoadSample={loadSample} />;

  if (tab === "settings") {
    return (
      <div className="relative flex h-screen flex-col bg-background text-text-primary">
        <SettingsPanel
          appearance={appearance}
          vaultPath={vaultPath}
          onChangeVault={pickVault}
          clis={clis}
          onRefreshClis={refreshClis}
          bunkerEnabled={bunkerEnabled}
          onBunkerChange={applyBunker}
          onSetupDomains={() => { setOnboardDismissed(false); setOnboardOpen(true); }}
          onBack={() => setTab("chat")}
          onStartChatWith={(cliId, modelId) => {
            lsSet(LS.defaultChatCli, cliId);
            if (modelId) lsSet(`prevail.model.${cliId}`, modelId);
            setSelectedDomain("");
            setTab("chat");
          }}
        />
        <BunkerRibbon enabled={bunkerEnabled} />
      </div>
    );
  }

  return (
    <div className="relative flex h-screen flex-col bg-background text-text-primary">
      {/* Full-width title bar — the macOS traffic lights live in the top-left
          here, in a consistent strip that spans the whole window, so they never
          overflow a collapsed sidebar rail. Draggable. */}
      <div data-tauri-drag-region className="h-9 shrink-0" />
      {bunkerEnabled && !bunkerLocalOk && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-600/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Bunker Mode needs a local model provider, but none was detected.</span>
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="font-medium underline">Install Ollama ›</a>
        </div>
      )}
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
          finishedDomains={finishedDomainSet}
          domainStats={domainStats}
          railWidth={domainRailWidth}
          onOpenOnboarding={() => { setOnboardDismissed(false); setOnboardOpen(true); }}
          onDomainsChanged={() => void refreshDomains()}
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

        {/* Threads rail — visible on every tab so the domain's conversation
            history stays one click away and the left chrome doesn't vanish
            when you switch to Benchmark. Picking a thread on Benchmark jumps
            back to Chat with that thread open. */}
        {(
          <>
            <ThreadsRail
              threads={threads}
              activePath={activeThreadPath}
              selectedDomain={selectedDomain}
              vaultPath={vaultPath}
              onPick={(p) => { setActiveThreadPath(p); setChatViewNonce((n) => n + 1); if (tab === "benchmark") setTab("chat"); }}
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
                  onClick={() => {
                    setTab(t.id);
                    // The Chat tab is also the way back from a domain sub-view
                    // (Insights / Preferences / Context) to the conversation.
                    if (t.id === "chat") setDomainTab("chat");
                  }}
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
            {/* Domain actions — lifted up here so the domain header is just the
                title. Insights / Preferences toggle the Chat sub-view (jumping
                to Chat first if you're on Council/Benchmark); archive lives in
                the overflow menu. Only shown when a real domain is active. */}
            {selectedDomain && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setTab("chat"); setDomainTab(tab === "chat" && domainTab === "insights" ? "chat" : "insights"); }}
                  title="Insights — what to work on, your tasks, and recent intents"
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                    tab === "chat" && domainTab === "insights"
                      ? "bg-accent-soft text-accent"
                      : "text-text-muted hover:bg-surface-warm hover:text-accent"
                  }`}
                >
                  <Lightbulb className="h-4 w-4" /> Insights
                </button>
                <button
                  onClick={() => { setTab("chat"); setDomainTab(tab === "chat" && domainTab === "prefs" ? "chat" : "prefs"); }}
                  title="Domain preferences"
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                    tab === "chat" && domainTab === "prefs"
                      ? "bg-accent-soft text-accent"
                      : "text-text-muted hover:bg-surface-warm hover:text-accent"
                  }`}
                >
                  <SettingsIcon className="h-4 w-4" /> Preferences
                </button>
                <DomainActionsMenu
                  domain={selectedDomain}
                  vaultPath={vaultPath}
                  label="Archive"
                  onArchived={(name) => {
                    if (selectedDomain === name) setSelectedDomain("");
                    void refreshDomains();
                  }}
                />
              </div>
            )}
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
                activeThreadPath={activeThreadPath}
                chatViewNonce={chatViewNonce}
                onActiveThreadChange={setActiveThreadPath}
                onThreadsChanged={() => void refreshThreads()}
                onStreamStart={markStreamStart}
                onStreamEnd={markStreamEnd}
                domains={domains}
                domainStats={domainStats}
                runningDomains={runningDomains}
                finishedDomains={finishedDomainSet}
                onPickDomain={(name) => setSelectedDomain(name)}
                domainTab={domainTab}
                setDomainTab={setDomainTab}
              />
            )}
            {tab === "council" && (
              <CouncilPanel
                domain={selectedDomain}
                domainPath={selectedDomainPath}
                vaultPath={vaultPath}
                clis={clis}
                fwLens={fwLens}
                activeThreadPath={activeThreadPath}
                onActiveThreadChange={setActiveThreadPath}
                onOpenInFinder={() => openInFinder(selectedDomainPath)}
                onSwitchToChat={() => setTab("chat")}
                onThreadsChanged={() => void refreshThreads()}
                seedPrompt={councilSeed}
                onSeedConsumed={() => setCouncilSeed(null)}
              />
            )}
            {tab === "benchmark" && (
              // Per-domain benchmark, full screen — scoped to whatever domain
              // you're in. Remounts (via key) when you switch domains so it
              // re-scopes cleanly. The global "benchmark everything" run lives
              // separately in the configuration page.
              <BenchmarkPanel
                key={selectedDomain || benchScope || "all"}
                vaultPath={vaultPath}
                initialDomain={selectedDomain || benchScope}
              />
            )}
          </div>
        </main>
      </div>
      <BunkerRibbon enabled={bunkerEnabled} />
      {/* A7: live bridge/WebUI chips — bottom-left, follow you across the app */}
      <BridgeStatusChips />
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
      {onboardOpen && (
        <OnboardingModal
          vaultPath={vaultPath}
          onClose={() => { setOnboardOpen(false); setOnboardDismissed(true); }}
          onApplied={() => void refreshDomains()}
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
  finishedDomains,
  domainStats,
  railWidth,
  onOpenOnboarding,
  onDomainsChanged,
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
  finishedDomains: Set<string>;
  domainStats: Record<string, number>;
  railWidth: number;
  onOpenOnboarding: () => void;
  onDomainsChanged: () => void;
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
  const railFilter = ""; // domain filter input removed from the sidebar
  // App-wide aggregate score (mean of every domain's context score) — the
  // single "how ready is my whole life-OS" number, pinned bottom-left.
  const [lifeScore, setLifeScore] = useState<{ value: number; count: number } | null>(null);
  useEffect(() => {
    let on = true;
    invoke<LifeReadiness>("engine_score_all", { vault: vaultPath })
      .then((lr) => {
        if (on && lr && lr.life_readiness !== null) {
          setLifeScore({ value: lr.life_readiness, count: lr.domains.length });
        }
      })
      .catch(() => {});
    return () => { on = false; };
  }, [vaultPath, domains.length]);
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

  // Archived domains — fetched from the engine. Shown in a collapsible
  // group at the bottom of the rail, each with a Restore action.
  const [archived, setArchived] = useState<string[]>([]);
  const [archivedOpen, setArchivedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.archivedOpen") === "1");
  useEffect(() => { lsSet("prevail.sidebar.archivedOpen", archivedOpen ? "1" : "0"); }, [archivedOpen]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const refreshArchived = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<string[]>("engine_list_archived", { vault: vaultPath });
      setArchived(list);
    } catch {
      // Engine may not support archiving yet — keep the group hidden.
      setArchived([]);
    }
  }, [vaultPath]);
  // Refresh when the active domain set changes (e.g. after archive/restore).
  useEffect(() => { void refreshArchived(); }, [refreshArchived, domains.length]);

  async function restoreDomain(name: string) {
    setRestoring(name);
    try {
      await invoke("engine_vault_restore", { vault: vaultPath, domain: name });
      await refreshArchived();
      onDomainsChanged();
    } catch (e) {
      console.error("restore domain", e);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <aside
      className="flex shrink-0 flex-col border-r border-border-subtle bg-surface"
      style={{ width: collapsed ? 56 : railWidth }}
    >
      {/* The Prevail mark on its own row, full width, with the sidebar toggle on
          the far right. The macOS traffic lights are handled by the full-width
          title bar above this whole layout, so the sidebar starts clean here. */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 pb-3 pt-1"
      >
        {collapsed ? (
          <div className="mx-auto flex flex-col items-center gap-2">
            <PrevailLogo size={30} src="/logo-512.png" animated={false} />
            <button
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-text-primary"
            >
              <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <>
            <Brand fill className="min-w-0 flex-1 font-sans text-xl font-extrabold text-text-primary" />
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-text-primary"
            >
              <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>

      {/* Domain list (icon rail when collapsed, full list when expanded) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* General — the home for chats not tied to any domain. Selecting it
            unbinds the chat from domain context; its threads live in the vault
            root _threads/. New threads are created via the threads rail's +. */}
        <div className={collapsed ? "flex justify-center p-2" : "px-2 pt-2"}>
          <button
            onClick={() => {
              setSelectedDomain("");
              if (tab === "settings") setTab("chat");
            }}
            title="General — chats not tied to any domain"
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
            <MessagesSquare className="h-4 w-4" />
            {!collapsed && "General"}
          </button>
        </div>
        {!collapsed && (
          <div className="mb-1 px-3 pt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
            Domains
          </div>
        )}
        {vaultError && !collapsed && (
          <div className="mx-2 my-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{vaultError}</div>
        )}
        {domains.length === 0 && !vaultError && !collapsed && (
          <div className="px-3 py-3">
            <div className="mb-2 text-xs text-text-muted">
              no domains yet. let Prevail recommend a starter set, or create one manually below.
            </div>
            <button
              onClick={onOpenOnboarding}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Set up domains
            </button>
          </div>
        )}
        {/* "Set up domains" moved to Settings → Vault to declutter the sidebar. */}
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
                  className="group/h flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary"
                >
                  <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
                  <span>{label}</span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted/70">{count}</span>
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
                className="group flex items-center gap-1 pl-2.5"
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
                  {runningDomains.has(d.name) ? (
                    <span className="pulse-soft inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="A reply is streaming in this domain" />
                  ) : finishedDomains.has(d.name) ? (
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: "var(--color-ok, #2e9e5b)",
                        boxShadow: "0 0 0 3px color-mix(in srgb, var(--color-ok, #2e9e5b) 28%, transparent)",
                      }}
                      title="Just finished — open to view"
                    />
                  ) : null}
                </button>
                <button
                  onClick={() => togglePin(d.name)}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-accent ${
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  title={isPinned ? "Unpin" : "Pin to top"}
                >
                  <Pin className={`h-3 w-3 ${isPinned ? "fill-accent text-accent" : ""}`} />
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

        {/* Archived domains — collapsible. Hidden from the active list;
            restore brings them back into the vault scan. */}
        {!collapsed && archived.length > 0 && (
          <div className="mt-3 px-2">
            <button
              onClick={() => setArchivedOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary"
            >
              {archivedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Archive className="h-3 w-3" />
              Archived
              <span className="ml-auto rounded-full bg-surface-strong px-1.5 text-[9px] text-text-muted">{archived.length}</span>
            </button>
            {archivedOpen && (
              <ul className="mt-1 space-y-0.5">
                {archived.map((name) => (
                  <li
                    key={name}
                    className="group flex items-center gap-2 rounded-md px-2 py-1 text-text-muted"
                  >
                    <Archive className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate text-xs">{titleCase(name)}</span>
                    <button
                      onClick={() => restoreDomain(name)}
                      disabled={restoring === name}
                      title={`Restore ${titleCase(name)}`}
                      className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted opacity-0 hover:border-accent-border hover:text-accent group-hover:opacity-100 disabled:opacity-100"
                    >
                      {restoring === name ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* App-wide readiness — the aggregate of every domain's score. */}
      {lifeScore && (
        <button
          onClick={() => setTab("settings")}
          title={`Life readiness — mean context score across ${lifeScore.count} domain${lifeScore.count === 1 ? "" : "s"}. Click for settings.`}
          className={`flex items-center border-t border-border-subtle transition-colors hover:bg-surface-warm ${
            collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2"
          }`}
        >
          <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
            <svg viewBox="0 0 36 36" className="h-7 w-7 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-border, #2a2a2a)" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15" fill="none"
                stroke={scoreColor(lifeScore.value)} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${(lifeScore.value / 100) * 94.2} 94.2`}
              />
            </svg>
            <span className="absolute font-mono text-[9px] font-semibold" style={{ color: scoreColor(lifeScore.value) }}>
              {lifeScore.value}
            </span>
          </span>
          {!collapsed && (
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">Life readiness</span>
              <span className="text-xs text-text-secondary">{lifeScore.count} domain{lifeScore.count === 1 ? "" : "s"} scored</span>
            </span>
          )}
        </button>
      )}

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
          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
        >
          <PanelRightOpen className="h-4 w-4" />
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
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
          Threads · {selectedDomain ? titleCase(selectedDomain) : "General"}
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
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            <PanelRightClose className="h-4 w-4" />
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
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const ok = await tauriConfirm(`Delete "${t.title}"?`, { title: "Delete thread", kind: "warning" });
                            if (ok) deleteThread(t.path);
                          } catch (err) { console.error("confirm delete", err); }
                        }}
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

// One floating life-domain chip: parallaxes with the cursor (via shared
// springs) and gently bobs. Icons only — never emojis.
function FloatingChip({
  chip,
  sx,
  sy,
  reduce,
}: {
  chip: { Icon: LucideIcon; t: string; x: string; y: string; d: number; depth: number };
  sx: ReturnType<typeof useSpring>;
  sy: ReturnType<typeof useSpring>;
  reduce: boolean;
}) {
  const tx = useTransform(sx, (v: number) => v * chip.depth);
  const ty = useTransform(sy, (v: number) => v * chip.depth);
  const { Icon } = chip;
  return (
    <motion.div className="absolute" style={{ left: chip.x, top: chip.y, x: reduce ? 0 : tx, y: reduce ? 0 : ty }}>
      <motion.div
        className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={reduce ? { opacity: 0.9, scale: 1 } : { opacity: 0.92, scale: 1, y: [0, -9, 0] }}
        transition={
          reduce
            ? { duration: 0.4, delay: 0.4 }
            : {
                opacity: { delay: 0.7 + chip.d * 0.15, duration: 0.6 },
                scale: { delay: 0.7 + chip.d * 0.15, duration: 0.6 },
                y: { duration: 4 + chip.d, repeat: Infinity, ease: "easeInOut", delay: chip.d },
              }
        }
      >
        <Icon className="h-3.5 w-3.5 text-accent" />
        {chip.t}
      </motion.div>
    </motion.div>
  );
}

function VaultWizard({ onPick, onLoadSample }: { onPick: () => void; onLoadSample: () => void }) {
  // Staggered entrance for the center column.
  const container = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.12 } } };
  const item = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 120, damping: 16 } },
  };
  const reduce = useReducedMotion();
  // Pointer parallax — shared springs the chips read from for depth.
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
            Welcome to <Brand />.
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

        <motion.p variants={item} className="mx-auto mt-5 max-w-2xl whitespace-nowrap text-[15px] text-text-secondary">
          Your life in <span className="font-medium text-text-primary">domains</span> — scored, private, <span className="font-medium text-accent">local-first</span>.
        </motion.p>

        {/* feature pills */}
        <motion.div variants={item} className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {[
            { Icon: Shield, t: "Local-first · no cloud" },
            { Icon: TrendingUp, t: "Context Score" },
            { Icon: Users, t: "Multi-model council" },
          ].map(({ Icon, t }) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-soft px-3 py-1 font-mono text-[11px] text-accent">
              <Icon className="h-3 w-3" />{t}
            </span>
          ))}
        </motion.div>

        {/* CTA — point to a vault, or import bundled sample data */}
        <motion.div variants={item} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <motion.button
            onClick={onPick}
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-2.5 rounded-xl bg-accent px-7 py-3.5 text-[15px] font-semibold text-background shadow-lg transition-colors hover:bg-accent-hover"
          >
            <Folder className="h-4 w-4" /> Pick your vault folder
          </motion.button>
          <motion.button
            onClick={onLoadSample}
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-2.5 rounded-xl border border-accent-border bg-accent-soft px-7 py-3.5 text-[15px] font-semibold text-accent transition-colors hover:bg-accent hover:text-background"
          >
            <Sparkles className="h-4 w-4" /> Load sample data
          </motion.button>
        </motion.div>

        <motion.div variants={item} className="mt-5 text-xs text-text-muted">
          Sample data drops in a fully-populated vault so you can explore every feature.
          <span className="mx-2 opacity-40">·</span>
          <span className="font-mono">v{APP_VERSION} · stays on your Mac</span>
        </motion.div>
      </motion.div>
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
  // U5: compact pills so the composer toolbar stops wrapping to two rows. The
  // accent fill already signals ON, so the separate ON/OFF badge was redundant
  // width — dropped. State + full description stay in the tooltip.
  const Toggle = ({
    glyph, label, on, onClick, help,
  }: { glyph: string; label: string; on: boolean; onClick: () => void; help: string }) => (
    <button
      onClick={onClick}
      title={`${label}: ${on ? "ON" : "OFF"}\n${help}`}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[10px] transition-colors ${
        on
          ? "border-accent-border bg-accent-soft text-accent"
          : "border-border bg-surface text-text-muted hover:bg-surface-warm hover:text-text-secondary"
      }`}
    >
      <span>{glyph}</span>
      <span className="uppercase tracking-wider">{label}</span>
    </button>
  );
  // Cycle keeps its value (◆ STRATEGIST) since that's the useful part; the
  // glyph + tooltip identify which control it is, so the word label is dropped.
  // Framework/Lens pill. When OFF it shows what it IS (the label, e.g.
  // "Framework"); when active it shows the chosen value (e.g. "Strategist") with
  // a tiny label prefix so it's always obvious which control it is.
  const Cycle = ({
    glyph, label, value, active, onClick,
  }: { glyph: string; label: string; value: string; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      title={`${label}: ${value} — click to cycle`}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[10px] transition-colors ${
        active
          ? "border-accent-border bg-accent-soft text-accent"
          : "border-border bg-surface text-text-muted hover:bg-surface-warm hover:text-text-secondary"
      }`}
    >
      <span>{glyph}</span>
      {active ? (
        <span className="tracking-wider">
          <span className="opacity-60">{label}:</span> <span className="uppercase">{value}</span>
        </span>
      ) : (
        <span className="uppercase tracking-wider">{label}</span>
      )}
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
  // Model id that produced an assistant turn (e.g. "claude-opus-4-8").
  // Persisted with the thread so a conversation records WHICH model
  // answered — needed to replay/rebuild an intent against a better model.
  model?: string;
  content: string;
  ts: number;
  streaming?: boolean;
  // Captured stderr from the CLI. Surfaced in the "No output" panel so
  // the real failure reason (e.g. "model not supported on ChatGPT
  // account", quota, auth) is visible instead of a generic message.
  stderr?: string;
  // Token / cost accounting from the engine's `usage` ChatEvent, when the
  // reply came through the unified engine chat path (Track D5). Null on
  // replies that came through the native chat_send path.
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
  // I9: the framework + lens in effect when this turn was sent, so each message
  // records HOW it was produced (not just which model). Shown in the bubble.
  framework?: string;
  lens?: string;
}

// Mirrors fd-apps-prevail-cli/docs/schemas/ChatEvent.json — a single
// NDJSON event on the `prevail chat --json` stream. Consumers MUST
// tolerate unknown `type` values for forward compatibility, so `type`
// stays a bare string and every payload field is optional.
interface ChatEvent {
  type: string; // start | user | delta | assistant | tool | usage | done | error
  thread?: string;
  ts?: number;
  domain?: string;
  role?: "user" | "assistant" | "system" | "tool";
  text?: string;
  tool?: { name?: string; input?: unknown; output?: unknown };
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
  engine?: string;
  error?: string;
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

// I4: high-stakes cards (Decision, Risks) are flagged `council: true` so a click
// routes to the multi-model Council instead of a single-model chat — a decision
// or a risk audit benefits from independent panelists + a synthesized verdict.
function buildQuickActions(domain: string | null): { glyph: string; label: string; prompt: string; council?: boolean }[] {
  const d = domain ? titleCase(domain) : "this domain";
  return [
    { glyph: "◆", label: "Status", prompt: `Read state.md for ${d} and summarize where I am right now in 5 bullets.` },
    { glyph: "◇", label: "Next action", prompt: `Given the current ${d} state, what's the single highest-leverage next action I should take this week? Be specific.` },
    { glyph: "▸", label: "Decision", prompt: `Walk me through the most important open decision in ${d} right now — options, trade-offs, and your recommendation.`, council: true },
    { glyph: "●", label: "Risks", prompt: `What are the top 3 risks or blind spots in my ${d} plan? Rank by severity.`, council: true },
  ];
}

// Full domain home view — shown when a domain is selected but the
// chat hasn't started yet. Surfaces state / decisions / journal /
// session logs / skills as tabs so the user can read the domain
// before asking. Clicking a tab item primes it into the next prompt.
// Proactive surfacing for a domain — questions worth asking + suggested next
// actions, generated from the vault (cached). Click one to seed the composer.
interface SurfaceResult { questions: string[]; actions: string[]; generated_at: number; stale: boolean }
interface DomainTask { text: string; done: boolean; due?: string | null }
function TasksPanel({ vaultPath, domain, nonce }: { vaultPath: string; domain: string; nonce: number }) {
  const [tasks, setTasks] = useState<DomainTask[]>([]);
  const [adding, setAdding] = useState("");
  useEffect(() => {
    invoke<DomainTask[]>("tasks_read", { vault: vaultPath, domain }).then(setTasks).catch(() => {});
  }, [vaultPath, domain, nonce]);
  async function persist(next: DomainTask[]) {
    setTasks(next);
    try { await invoke("tasks_set", { vault: vaultPath, domain, tasks: next }); } catch (e) { console.error("tasks_set", e); }
  }
  if (tasks.length === 0 && !adding) {
    return (
      <div className="mb-4">
        <button onClick={() => setAdding(" ")} className="font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-accent">+ add a goal / task for {titleCase(domain)}</button>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Tasks · {titleCase(domain)}</div>
      <div className="flex flex-col gap-1">
        {tasks.map((t, i) => (
          <label key={i} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={t.done} onChange={() => persist(tasks.map((x, j) => j === i ? { ...x, done: !x.done } : x))} />
            <span className={t.done ? "text-text-muted line-through" : "text-text-primary"}>{t.text}</span>
            {t.due && !t.done && (() => {
              const today = new Date().toISOString().slice(0, 10);
              const overdue = t.due < today, due = t.due === today;
              return <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${overdue ? "bg-warn/15 text-warn" : due ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>{overdue ? "overdue" : due ? "today" : t.due}</span>;
            })()}
            <button onClick={() => persist(tasks.filter((_, j) => j !== i))} className="ml-auto text-text-muted/50 hover:text-warn">✕</button>
          </label>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={adding} placeholder="add a task…  (optional due: @2026-04-15)" onChange={(e) => setAdding(e.target.value)}
          onKeyDown={async (e) => { if (e.key === "Enter" && adding.trim()) { const txt = adding.trim(); setAdding(""); try { const next = await invoke<DomainTask[]>("tasks_add", { vault: vaultPath, domain, text: txt }); setTasks(next); } catch (err) { console.error("tasks_add", err); } } }}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-accent-border focus:outline-none" />
      </div>
    </div>
  );
}

// I8 + I6: domain-level Insights — aggregates the proactive "For You" surface
// (questions + suggested next steps), the per-domain task list, and the recent
// intents ledger in one place, independent of any single thread. This is where
// "what should I work on?" and "what have I been asking?" live for a domain.
function InsightsPanel({ vaultPath, domain, onSeed }: { vaultPath: string; domain: string; onSeed: (t: string) => void }) {
  const [taskNonce, setTaskNonce] = useState(0);
  const [intents, setIntents] = useState<{ message?: string; cli?: string; model?: string; ts?: number }[]>([]);
  useEffect(() => {
    invoke<{ message?: string; cli?: string; model?: string; ts?: number }[]>("intents_read", { vault: vaultPath, domain, limit: 15 })
      .then(setIntents)
      .catch(() => setIntents([]));
  }, [vaultPath, domain, taskNonce]);
  return (
    <div className="flex flex-col gap-6">
      <SurfacePanel
        vaultPath={vaultPath}
        domain={domain}
        onPick={onSeed}
        onAddTask={async (t) => { try { await invoke("tasks_add", { vault: vaultPath, domain, text: t }); setTaskNonce((n) => n + 1); } catch (e) { console.error("tasks_add", e); } }}
      />
      <TasksPanel vaultPath={vaultPath} domain={domain} nonce={taskNonce} />
      {/* I6: the intents ledger, finally visible. */}
      <div>
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Recent intents</div>
        <p className="mb-2 text-xs leading-relaxed text-text-secondary">
          Every question you send is logged as an intent — the exact ask plus the settings in effect — so a future, better model can replay it. These stay on your machine. Click one to ask it again.
        </p>
        {intents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-text-muted">No intents captured yet — ask something in chat.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {intents.map((it, i) => (
              <li key={i}>
                <button
                  onClick={() => onSeed(String(it.message ?? ""))}
                  className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-left hover:-translate-y-px hover:border-accent-border hover:shadow-sm"
                >
                  <div className="line-clamp-2 text-sm text-text-primary">{String(it.message ?? "(no text)")}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-text-muted">
                    {it.cli ?? ""}{it.model ? ` · ${it.model}` : ""}{it.ts ? ` · ${formatFreshness((Date.now() - it.ts) / 1000)}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SurfacePanel({ vaultPath, domain, onPick, onAddTask }: { vaultPath: string; domain: string; onPick: (t: string) => void; onAddTask: (t: string) => void }) {
  const [data, setData] = useState<SurfaceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  // Dismissed insights stay hidden (persisted per domain).
  const DISMISS_KEY = `prevail.surface.dismissed.${domain}`;
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(lsGet(DISMISS_KEY) || "[]")); } catch { return new Set(); }
  });
  const dismiss = (item: string) => setDismissed((d) => { const n = new Set(d); n.add(item); lsSet(DISMISS_KEY, JSON.stringify([...n])); return n; });
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const load = useCallback(async (force: boolean) => {
    // Off when persistent memory is disabled (it's the proactive layer).
    if (getPref(PREF.persistentMemory, "1") !== "1") return;
    setLoading(true); setErr("");
    try {
      const r = await invoke<SurfaceResult>("domain_surface", {
        vault: vaultPath,
        domain,
        provider: getPref(PREF.memoryProvider, "claude"),
        model: getPref(PREF.distillModel, "claude-haiku-4-5"),
        force,
      });
      setData(r);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, [vaultPath, domain]);
  useEffect(() => { void load(false); }, [load]);

  if (getPref(PREF.persistentMemory, "1") !== "1") return null;
  const hasContent = data && (data.questions.length > 0 || data.actions.length > 0);
  if (!hasContent && !loading && !err) return null;

  return (
    <div className="mb-4 rounded-xl border border-accent-border/40 bg-accent-soft/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">For you · {titleCase(domain)}</span>
        <button onClick={() => void load(true)} disabled={loading}
          className="ml-auto font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-accent disabled:opacity-40">
          {loading ? "thinking…" : "refresh"}
        </button>
      </div>
      {err && <div className="text-xs text-text-muted">{/Bunker/i.test(err)
        ? "Bunker Mode is on. Start a local model (Ollama) and insights will surface on-device."
        : `Couldn't surface insights (${err.slice(0, 80)}). Needs a working agent.`}</div>}
      {hasContent && (() => {
        const questions = data!.questions.filter((q) => !dismissed.has(q));
        const actions = data!.actions.filter((a) => !dismissed.has(a));
        if (questions.length === 0 && actions.length === 0) {
          return <div className="py-2 text-xs text-text-muted">All caught up — nothing surfaced right now. <button onClick={() => void load(true)} className="text-accent hover:underline">Refresh</button> for more.</div>;
        }
        return (
          <div className="flex flex-col gap-4">
            {questions.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  <Lightbulb className="h-3 w-3" /> Questions worth asking
                </div>
                <div className="flex flex-col gap-2">
                  {questions.map((q, i) => (
                    <div key={i} className="group flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-3 transition-colors hover:border-accent-border">
                      <p className="min-w-0 flex-1 text-sm leading-snug text-text-primary">{q}</p>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => onPick(q)} title="Ask this in chat" className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-background hover:bg-accent-hover">Ask <ArrowRight className="h-2.5 w-2.5" /></button>
                        <button onClick={() => dismiss(q)} title="Dismiss" className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-warn"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {actions.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  <ArrowRight className="h-3 w-3" /> Suggested next steps
                </div>
                <div className="flex flex-col gap-2">
                  {actions.map((a, i) => (
                    <div key={i} className="group flex items-start gap-3 rounded-lg border border-border-subtle bg-surface p-3 transition-colors hover:border-accent-border">
                      <p className="min-w-0 flex-1 text-sm leading-snug text-text-primary">{a}</p>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => { onAddTask(a); setSaved((s) => new Set(s).add(a)); }} title="Save as task" className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${saved.has(a) ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>
                          {saved.has(a) ? <><Check className="h-2.5 w-2.5" /> Saved</> : <><Plus className="h-2.5 w-2.5" /> Task</>}
                        </button>
                        <button onClick={() => onPick(a)} title="Work on this in chat" className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-background hover:bg-accent-hover">Do <ArrowRight className="h-2.5 w-2.5" /></button>
                        <button onClick={() => dismiss(a)} title="Dismiss" className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-warn"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

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
  const [taskNonce, setTaskNonce] = useState(0); // bump to reload the tasks panel
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
              <div className="w-full">
                <SurfacePanel vaultPath={vaultPath} domain={domain} onPick={onPickPrompt}
                  onAddTask={async (t) => { try { await invoke("tasks_add", { vault: vaultPath, domain, text: t }); setTaskNonce((n) => n + 1); } catch (e) { console.error("tasks_add", e); } }} />
                <TasksPanel vaultPath={vaultPath} domain={domain} nonce={taskNonce} />
                <ul className="flex flex-col gap-2">
                {buildQuickActions(domain).map((q) => (
                  <li key={q.label}>
                    <button
                      onClick={() => q.council
                        ? window.dispatchEvent(new CustomEvent("prevail:council-seed", { detail: { domain, prompt: q.prompt } }))
                        : onPickPrompt(q.prompt)}
                      className="block w-full rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-accent-border hover:shadow-md"
                    >
                      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-accent">
                        <span><span className="mr-1">{q.glyph}</span>{q.label}</span>
                        {q.council && <span className="rounded-full border border-accent-border bg-accent-soft px-1.5 py-0 text-[9px] normal-case tracking-normal">→ Council</span>}
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
// Shared emphasis for section headers ("CLI", "Model", "Framework", "Lens",
// "Skills", "Behavior", …). Bigger, bolder, high-contrast so each section
// reads as a clear divider instead of a faint murmur. Used everywhere a
// settings/prefs section is titled, for one consistent treatment.
const SECTION_LABEL =
  "font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary";

// agent stays expanded. Clicking sets the chat panel's primary CLI.
// Full-canvas preferences panel for the currently-selected domain.
// Replaces the popover. Every control writes to localStorage on
// click; no save button — picks are immediate. Pickers use brand
// icons for CLIs, prose labels for everything else.
function DomainPrefsPanel({
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

  const cliModels = pickedCli ? (MODELS[pickedCli] ?? []) : [];

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

      {/* CLI picker — brand-icon cards */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">CLI</div>
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
        {/* U4: list rows (not big icon cards), keeping the provider icon. */}
        <div className="flex flex-col gap-1.5">
          {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
            const picked = pickedCli === c.id;
            const disabled = !c.available;
            return (
              <button
                key={c.id}
                disabled={disabled}
                onClick={() => setOverride(cliKey, c.id)}
                title={disabled ? `${c.label} not installed` : c.label}
                className={`group flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
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
                {picked && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-background">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
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
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Model</div>
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
                  className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                    picked
                      ? "border-accent bg-accent-soft"
                      : "border-border-subtle bg-background hover:border-accent-border"
                  }`}
                >
                  <span className={`shrink-0 font-mono text-sm ${picked ? "font-semibold text-accent" : "text-text-primary"}`}>{m.label}</span>
                  {m.blurb && <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{m.blurb}</span>}
                  {picked && (
                    <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-background">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
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
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Skills</div>
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
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Behavior</div>
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
            onChange={(v) => { lsSet(autoStateKey, v ? "1" : "0"); persistManifest({ autoState: v }); force(); }}
            label="Auto-attach state.md"
          />
        </div>
      </section>

      {/* Privacy — local-only (Ollama) pin → manifest.privacy.localOnly */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Privacy</div>
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="text-sm font-semibold text-text-primary">Local-only (Ollama)</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {localOnly
                ? "Every prompt in this domain is forced through a local model — nothing leaves your machine."
                : "Off — prompts use the domain's configured CLI, which may call a cloud model."}
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
      </section>

      {/* Sandbox — open | locked → manifest.sandbox.mode */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Sandbox</div>
            <p className="mt-0.5 text-sm text-text-secondary">
              {sandboxMode === "locked"
                ? "Locked — agents can read this domain but cannot write files or run shell side-effects."
                : "Open — agents can read and write within this domain's folder."}
            </p>
          </div>
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
      </section>

      {/* Channels / routing — domain name is always matched (A6); the input
          holds extra keywords → manifest.routing.keywords = [domain, ...extras] */}
      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Channels &amp; routing</div>
        <p className="mb-3 text-sm text-text-secondary">
          When a bridge (e.g. Telegram) receives a message, these keywords route it to {titleCase(domain)}.
          The domain name always matches; add extras below. Saved to the domain manifest.
        </p>
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-xs text-accent" title="Always matched — the domain name is a built-in keyword">
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
      {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
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

// I7: create a reusable skill from the UI — the "build skills over time" path.
// A skill is just a named, reusable prompt the model runs on demand (slash
// `/name` in chat). Seeded from the composer's "Save as skill" or written here.
function NewSkillForm({ vaultPath, domain, seed, onCreated }: { vaultPath: string; domain: string; seed?: string | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // Open + pre-fill when a "Save as skill" seed arrives from the composer.
  useEffect(() => {
    if (seed != null) { setOpen(true); setBody(seed); }
  }, [seed]);
  async function create() {
    setErr("");
    if (!name.trim() || !body.trim()) { setErr("Give the skill a name and a body."); return; }
    setSaving(true);
    try {
      await invoke("skill_create", { vault: vaultPath, domain, name: name.trim(), body: body.trim() });
      setName(""); setBody(""); setOpen(false);
      onCreated();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }
  if (!open) {
    return (
      <div className="mb-3 flex w-full items-center justify-between">
        <p className="text-xs text-text-muted">Skills are reusable prompts Prevail runs on demand (<span className="font-mono text-accent">/name</span> in chat). Pin your favorites to auto-attach.</p>
        <button onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:bg-accent-soft hover:text-accent">
          <Sparkles className="h-3 w-3" /> New skill
        </button>
      </div>
    );
  }
  return (
    <div className="mb-3 w-full rounded-xl border border-accent-border bg-surface p-4">
      <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">New skill · {titleCase(domain)}</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Skill name (e.g. Weekly review)"
        className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="What should this skill do? Write it as a prompt the model will follow."
        className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none"
      />
      {err && <div className="mb-2 text-xs text-warn">{err}</div>}
      <div className="flex items-center gap-2">
        <button onClick={create} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create skill
        </button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-warm">Cancel</button>
      </div>
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
    <ul className="flex w-full flex-col gap-2">
      {skills.map((s) => {
        const open = expanded === s.path;
        return (
          <li key={s.path}>
            <div className={`rounded-lg border bg-surface transition-colors ${open ? "border-accent-border" : "border-border-subtle"}`}>
              {/* Single-line row — same dimensions as every other settings list. */}
              <div className="flex w-full items-center gap-2">
                <button
                  onClick={() => toggle(s.path)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm rounded-l-lg"
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-accent" />
                  <span className="shrink-0 font-mono text-sm font-semibold text-accent">/{s.name}</span>
                  {(() => {
                    const cleaned = (s.description ?? "").replace(/^[>*\-\s]+/, "").trim();
                    if (cleaned.length < 3) return null;
                    return <span className="truncate text-xs text-text-muted">{cleaned}</span>;
                  })()}
                  <span className="ml-auto shrink-0 text-xs text-text-muted">{open ? "▾" : "▸"}</span>
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
          <div className="flex items-center gap-2 font-display text-base font-semibold">
            {(() => {
              const I = domainIcon(domain);
              return I ? <I className="h-4 w-4 text-accent" /> : <span className="text-accent">◆</span>;
            })()}
            {titleCase(domain)}
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
    const ok = await tauriConfirm(`Delete imports older than ${days} days from ${titleCase(domain)}?`, { title: "Prune imports", kind: "warning" }).catch(() => false);
    if (!ok) return;
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

// Domain actions menu — "Back up" and "Archive" for a single domain.
// Used in the domain header. Backs up via engine_vault_backup(domainOpt),
// archives via engine_vault_archive. Archive never deletes data; it just
// flips the manifest flag and hides the domain from the active sidebar.
function DomainActionsMenu({
  domain,
  vaultPath,
  onArchived,
  label,
}: {
  domain: string;
  vaultPath: string;
  onArchived: (name: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "backup" | "archive">(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmArchive(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function backup() {
    setBusy("backup");
    setNote(null);
    try {
      const res = await invoke<BackupResult>("engine_vault_backup", {
        vault: vaultPath,
        domainOpt: domain,
      });
      const files = res.file_count ?? 0;
      setNote(
        res.ok
          ? `Backed up ${files} file${files === 1 ? "" : "s"} (${bytesHuman(res.bytes ?? 0)})`
          : `Backup failed: ${res.error ?? "unknown error"}`,
      );
    } catch (e) {
      setNote(`Backup failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    setBusy("archive");
    setNote(null);
    try {
      await invoke("engine_vault_archive", { vault: vaultPath, domain });
      setOpen(false);
      setConfirmArchive(false);
      onArchived(domain);
    } catch (e) {
      setNote(`Archive failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Back up / Archive domain"
        className={`flex items-center gap-1.5 rounded text-text-muted transition-colors hover:bg-surface-warm hover:text-accent ${
          label ? "px-2.5 py-1.5 text-[13px]" : "h-6 w-6 justify-center"
        }`}
      >
        <Archive className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-40 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-xl">
          <button
            onClick={backup}
            disabled={busy !== null}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-warm disabled:opacity-50"
          >
            {busy === "backup" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Back up this domain
          </button>
          {!confirmArchive ? (
            <button
              onClick={() => setConfirmArchive(true)}
              disabled={busy !== null}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-warm disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive domain…
            </button>
          ) : (
            <div className="rounded-md border border-border-subtle bg-background p-2">
              <div className="mb-1.5 text-xs text-text-secondary">
                Hide <span className="font-semibold">{titleCase(domain)}</span> from the active list? Nothing is deleted — restore it any time.
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={archive}
                  disabled={busy !== null}
                  className="flex items-center gap-1 rounded bg-warn px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-background hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "archive" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                  archive
                </button>
                <button
                  onClick={() => setConfirmArchive(false)}
                  disabled={busy !== null}
                  className="rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:bg-surface-warm"
                >
                  cancel
                </button>
              </div>
            </div>
          )}
          {note && <div className="mt-1 px-2 py-1 text-[11px] text-text-muted">{note}</div>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Usage dashboard (P4.7 Phase 4) — reads the aggregated <vault>/usage
// summary written by usage_append at each turn close and renders totals
// plus breakdowns by CLI, model, and domain, with a per-day activity
// strip. Surfaced on the no-domain landing; renders nothing until there's
// at least one captured turn, so new vaults stay clean.

interface UsageBucket {
  key: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}
interface UsageSummary {
  total_turns: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  by_cli: UsageBucket[];
  by_model: UsageBucket[];
  by_domain: UsageBucket[];
  by_day: UsageBucket[];
}

function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}
function fmtCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function UsageBreakdown({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: LucideIcon;
  rows: UsageBucket[];
}) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.turns));
  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="flex flex-col gap-2">
        {rows.slice(0, 6).map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <div className="w-24 shrink-0 truncate font-mono text-[11px] text-text-secondary" title={r.key}>
              {r.key}
            </div>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-warm">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: `${(r.turns / max) * 100}%` }}
              />
            </div>
            <div className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-secondary">
              {r.turns}
            </div>
            <div className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-muted">
              {fmtCost(r.cost_usd)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageDashboard({ vault, nonce }: { vault: string; nonce?: number }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await invoke<UsageSummary>("usage_summary", { vault });
        if (alive) setSummary(s);
      } catch (e) {
        console.error("usage_summary failed", e);
      }
    })();
    return () => { alive = false; };
  }, [vault, nonce]);

  if (!summary || summary.total_turns === 0) return null;

  const stats: { label: string; value: string; icon: LucideIcon }[] = [
    { label: "Turns", value: summary.total_turns.toLocaleString(), icon: MessagesSquare },
    {
      label: "Tokens",
      value: compactNum(summary.total_input_tokens + summary.total_output_tokens),
      icon: TrendingUp,
    },
    { label: "Cost", value: fmtCost(summary.total_cost_usd), icon: Coins },
  ];
  // Per-day activity strip — last 14 days of recorded turns.
  const days = summary.by_day.slice(-14);
  const dayMax = Math.max(1, ...days.map((d) => d.turns));

  return (
    <div className="mt-10 w-full max-w-4xl">
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
        <Activity className="h-3.5 w-3.5" />
        Usage
      </div>

      {/* hero totals */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border-subtle bg-surface p-4">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </div>
            <div className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-text-primary">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* per-day activity strip */}
      {days.length > 1 && (
        <div className="mt-3 rounded-xl border border-border-subtle bg-surface p-4">
          <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
            Activity · last {days.length} day{days.length === 1 ? "" : "s"}
          </div>
          <div className="flex h-16 items-end gap-1">
            {days.map((d) => (
              <div
                key={d.key}
                className="flex-1 rounded-t bg-accent/70 transition-colors hover:bg-accent"
                style={{ height: `${Math.max(6, (d.turns / dayMax) * 100)}%` }}
                title={`${d.key} · ${d.turns} turn${d.turns === 1 ? "" : "s"} · ${fmtCost(d.cost_usd)}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* breakdowns */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <UsageBreakdown title="By agent" icon={Cpu} rows={summary.by_cli} />
        <UsageBreakdown title="By model" icon={Layers} rows={summary.by_model} />
        <UsageBreakdown title="By domain" icon={Users} rows={summary.by_domain} />
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
  activeThreadPath,
  chatViewNonce,
  onActiveThreadChange,
  onThreadsChanged,
  onStreamStart,
  onStreamEnd,
  domains,
  domainStats,
  runningDomains,
  finishedDomains,
  onPickDomain,
  domainTab,
  setDomainTab,
}: {
  domain: string | null;
  domainPath: string | null;
  vaultPath: string;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
  onSwitchToCouncil: () => void;
  activeThreadPath: string | null;
  chatViewNonce: number;
  onActiveThreadChange: (p: string | null) => void;
  onThreadsChanged: () => void;
  onStreamStart: (s: { sessionId: string; domain: string | null; threadPath: string | null; title: string; startedAt: number }) => void;
  onStreamEnd: (sessionId: string) => void;
  domains: Domain[];
  domainStats: Record<string, number>;
  runningDomains: Set<string>;
  finishedDomains: Set<string>;
  onPickDomain: (name: string) => void;
  domainTab: DomainTab;
  setDomainTab: (t: DomainTab) => void;
}) {
  const available = useMemo(() => clis.filter((c) => c.available), [clis]);

  // ── Unified engine chat (Track D5) ────────────────────────────────
  // When the `prevail` CLI is present we prefer driving the conversation
  // through `engine_chat`, which streams a typed ChatEvent NDJSON stream
  // (start/user/delta/assistant/usage/done/error) and threads through the
  // domain manifest's configured engine, privacy (localOnly) and skills.
  // When it's absent we fall back to the native chat_send path below.
  // This is purely additive — neither path is removed.
  const [engineAvailable, setEngineAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    // Probe once: if `prevail domains` answers, the CLI is installed and
    // the engine chat path is usable. Any error (CLI missing, bad vault)
    // leaves us on the native path.
    (async () => {
      try {
        await invoke("engine_domains", { vault: vaultPath });
        if (alive) setEngineAvailable(true);
      } catch {
        if (alive) setEngineAvailable(false);
      }
    })();
    return () => { alive = false; };
  }, [vaultPath]);
  // Per-domain "local only" privacy pin (mirrors manifest.privacy.localOnly).
  // Persisted by the manifest editor; read here so engine chat can force a
  // local engine for this turn.
  // Bumped by the domain Preferences panel whenever a picker changes, so the
  // composer re-reads the domain's CLI/model/framework/lens overrides live.
  const [prefsTick, setPrefsTick] = useState(0);
  // Bunker Mode forces local-only regardless of the per-domain pin.
  const localOnly = isBunkerOn() || (domain ? lsGet(`prevail.domain.${domain}.localOnly`) === "1" : false);

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
    // Domain override when set, else fall back to the global default — so both
    // picking an override AND clearing it ("Use global") propagate live.
    const domCli = lsGet(`prevail.domain.${domain}.cli`);
    const effectiveCli = domCli || lsGet(LS.defaultChatCli) || null;
    if (effectiveCli) setSelectedCli(effectiveCli);
    const domModel = lsGet(`prevail.domain.${domain}.model`);
    if (domModel && effectiveCli) {
      setModelByCli((cur) => ({ ...cur, [effectiveCli]: domModel }));
    }
    const domFw = lsGet(`prevail.domain.${domain}.framework`);
    const domLn = lsGet(`prevail.domain.${domain}.lens`);
    fwLens.setFramework(domFw || lsGet(LS.framework, "none"));
    fwLens.setLens(domLn || lsGet(LS.lens, "none"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, prefsTick]);
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
  // Distilled long-term memory for this domain — prepended to prompts like
  // user.md so the assistant remembers across sessions (self-learning loop).
  const [memoryMd, setMemoryMd] = useState<string>("");
  useEffect(() => {
    if (!vaultPath) { setMemoryMd(""); return; }
    invoke<string>("read_memory_md", { vault: vaultPath, domain: domain ?? null })
      .then(setMemoryMd)
      .catch(() => setMemoryMd(""));
  }, [vaultPath, domain, chatViewNonce]);
  // Domain context column — a persistent right column showing state.md,
  // decisions, journal, recent logs, skills. Collapsible; state persisted.
  // Items can be "used in chat" to inject as prompt context.
  const [contextOpen, setContextOpen] = useState<boolean>(() => lsGet("prevail.contextOpen") === "1");
  useEffect(() => { lsSet("prevail.contextOpen", contextOpen ? "1" : "0"); }, [contextOpen]);
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
  // Skills attached to the next send. Decoupled from the textarea so
  // editing the prompt text doesn't affect them, and the user removes
  // them from the pills below — not by editing prompt text.
  const [attachedSkills, setAttachedSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  const [preferredSkills, setPreferredSkills] = useState<string[]>(() => loadPreferredSkills(domain));
  // domainTab is lifted to App (the top bar owns the Insights/Preferences
  // toggles); it arrives as a prop. "chat" shows the transcript; the other
  // tabs replace the transcript with the domain's reference content. The
  // composer stays at the bottom regardless of tab.
  const [domainCtx, setDomainCtx] = useState<DomainContextBundle | null>(null);
  // Context score for the active domain. Cached in state per-domain; the
  // header badge and Context tab both read from here. Loaded (cheap,
  // no-audit) on domain open; the Re-scan button forces an audit.
  const [ctxScore, setCtxScore] = useState<ContextScore | null>(null);
  const [ctxScoreLoading, setCtxScoreLoading] = useState(false);
  const [ctxScoreRescanning, setCtxScoreRescanning] = useState(false);
  const [ctxScoreError, setCtxScoreError] = useState<string | null>(null);
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
  // Re-pull the domain bundle (e.g. after creating a skill) without a remount.
  const refreshDomainCtx = useCallback(() => {
    if (!domain || !vaultPath) return;
    invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain })
      .then(setDomainCtx)
      .catch(() => {});
  }, [domain, vaultPath]);
  // I7: "Save as skill" — the composer dispatches this with the typed prompt;
  // we jump to the Skills tab and pre-fill the new-skill form.
  const [newSkillSeed, setNewSkillSeed] = useState<string | null>(null);
  useEffect(() => {
    const onNewSkill = (e: Event) => {
      const body = (e as CustomEvent<string>).detail ?? "";
      setNewSkillSeed(body);
      setDomainTab("skills");
    };
    window.addEventListener("prevail:new-skill", onNewSkill as EventListener);
    return () => window.removeEventListener("prevail:new-skill", onNewSkill as EventListener);
  }, []);
  // Load the (cached / heuristic) context score when a domain opens.
  useEffect(() => {
    setCtxScore(null);
    setCtxScoreError(null);
    if (!domain || !vaultPath) return;
    let mounted = true;
    setCtxScoreLoading(true);
    invoke<ContextScore>("engine_score", { vault: vaultPath, domain, audit: false })
      .then((s) => { if (mounted) setCtxScore(s); })
      .catch((e) => { if (mounted) setCtxScoreError(String(e)); })
      .finally(() => { if (mounted) setCtxScoreLoading(false); });
    return () => { mounted = false; };
  }, [domain, vaultPath]);
  const rescanContextScore = useCallback(() => {
    if (!domain || !vaultPath) return;
    setCtxScoreRescanning(true);
    setCtxScoreError(null);
    invoke<ContextScore>("engine_score", { vault: vaultPath, domain, audit: true })
      .then((s) => setCtxScore(s))
      .catch((e) => setCtxScoreError(String(e)))
      .finally(() => setCtxScoreRescanning(false));
  }, [domain, vaultPath]);
  // Aggregate "Life Readiness" — averaged across all domains. Loaded on
  // the no-domain landing. Re-fetched when a re-scan finishes so the
  // headline number stays roughly current.
  const [lifeReadiness, setLifeReadiness] = useState<LifeReadiness | null>(null);
  useEffect(() => {
    if (domain || !vaultPath) return;
    let mounted = true;
    invoke<LifeReadiness>("engine_score_all", { vault: vaultPath })
      .then((lr) => { if (mounted) setLifeReadiness(lr); })
      .catch(() => { if (mounted) setLifeReadiness(null); });
    return () => { mounted = false; };
  }, [domain, vaultPath, ctxScoreRescanning]);
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
  // Any thread pick returns to the chat view — even re-clicking the active
  // thread (which doesn't change activeThreadPath), so you can always escape
  // the Preferences view by clicking a thread. Skips the initial mount.
  const chatViewMounted = useRef(false);
  useEffect(() => {
    if (chatViewMounted.current) setDomainTab("chat");
    else chatViewMounted.current = true;
  }, [chatViewNonce]);
  // Load the thread when activeThreadPath changes.
  useEffect(() => {
    // Picking a thread (or starting a new one) always returns to the chat view,
    // even if Preferences was open — otherwise the click appears to do nothing.
    setDomainTab("chat");
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
            model: m.model ?? null,
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
  // The slug=null save guard above is one-shot PER ChatPanel INSTANCE, but the
  // panel persists across domain switches — so without this, only the first-ever
  // chat saved and later new-domain chats silently never created a thread. When
  // the active thread clears (new domain, "New chat", domain switch), release the
  // guard so the next fresh conversation can create its own thread.
  useEffect(() => {
    if (!activeThreadPath) {
      initialSaveDispatchedRef.current = false;
      savePendingRef.current = false;
    }
  }, [activeThreadPath]);
  const sessionRef = useRef(`s-${Date.now()}`);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // P4.7 Phase 3 — capture real chat usage. We snapshot the turn's meta
  // (vault/domain/thread/cli/model) at send time so the mount-once 'done'
  // listeners (which have stale closures) can persist an accurate record
  // when the turn closes. One turn streams at a time, so a single pending
  // slot is sufficient; it's cleared after the matching 'done' to avoid
  // double-counting the same turn.
  const pendingUsageRef = useRef<{
    session: string;
    vault: string;
    domain: string | null;
    thread: string | null;
    cli: string | null;
    model: string | null;
    intent: string;
  } | null>(null);
  // Self-learning: accumulate the RAW, unprocessed assistant stream for the
  // current turn (before ANSI/sycophancy stripping) so the intent ledger
  // records the model's true output, not just the displayed text.
  const rawReplyRef = useRef<string>("");
  const persistUsage = useCallback(
    (session: string, ok: boolean, usage?: ChatMessage["usage"]) => {
      const p = pendingUsageRef.current;
      if (!p || p.session !== session) return;
      pendingUsageRef.current = null; // persist a turn exactly once
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      invoke("usage_append", {
        vault: p.vault,
        record: {
          ts: now.getTime(),
          day,
          domain: p.domain,
          thread: p.thread,
          cli: p.cli || "unknown",
          model: p.model,
          input_tokens: usage?.input_tokens ?? null,
          output_tokens: usage?.output_tokens ?? null,
          cost_usd: usage?.cost_usd ?? null,
          ok,
        },
      }).catch((e) => console.error("usage_append failed", e));

      // Self-learning: append the RAW reply to the intent ledger, paired
      // with the intent by session, so the turn is fully reconstructable.
      const raw = maybeRedact(rawReplyRef.current);
      rawReplyRef.current = "";
      invoke("intent_append", {
        vault: p.vault,
        domain: p.domain,
        record: {
          kind: "reply",
          ts: now.getTime(),
          day,
          session: p.session,
          domain: p.domain,
          thread: p.thread,
          cli: p.cli,
          model: p.model,
          ok,
          raw,
          usage: usage ?? null,
        },
      }).catch((e) => console.error("intent_append (reply) failed", e));

      // Auto-journal: one distilled line per completed turn, so the journal
      // builds itself from every conversation (model + intent snippet).
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const snippet = p.intent.replace(/\s+/g, " ").slice(0, 100);
      const modelTag = p.model || p.cli || "?";
      const status = ok ? "" : " · ✗ failed";
      invoke("journal_append", {
        vault: p.vault,
        domain: p.domain,
        entry: `- ${day} ${hh}:${mm} · [${modelTag}] ${snippet}${status}`,
      }).catch((e) => console.error("journal_append failed", e));
    },
    [],
  );

  useEffect(() => {
    if (!selectedCli && available.length > 0) setSelectedCli(available[0].id);
  }, [available, selectedCli]);

  // Bunker Mode auto-switch: if the persisted/selected CLI is a cloud one (a
  // stale default from before Bunker was enabled), switch the picker to an
  // available local provider so what's highlighted matches what will actually
  // run. Re-evaluates whenever the bunker flag, selection, or CLI list changes.
  const bunkerOn = isBunkerOn();
  useEffect(() => {
    if (!bunkerOn || !selectedCli || isLocalCli(selectedCli)) return;
    const local = preferredLocalCli(clis);
    if (local) setSelectedCli(local);
  }, [bunkerOn, selectedCli, clis]);

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
          if (!mounted) return;
          // Capture stderr so a failing CLI's real error (model
          // rejected, quota, auth) can be surfaced in the "No output"
          // panel instead of a generic message.
          if (e.payload.stream === "stderr") {
            const errChunk = stripAnsi(e.payload.data);
            setMessages((m) => {
              const last = m[m.length - 1];
              if (last && last.streaming) {
                return [...m.slice(0, -1), { ...last, stderr: (last.stderr ?? "") + errChunk }];
              }
              return m;
            });
            return;
          }
          // Self-learning: keep the RAW chunk verbatim (pre-strip) for the
          // intent ledger before we clean it for display.
          rawReplyRef.current += e.payload.data;
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
          // Capture usage for native-path turns (no token accounting, but
          // the turn still counts). code===0 (or null timeout) → ok.
          persistUsage(e.payload.session, e.payload.code === 0);
          if (e.payload.session !== sessionRef.current) return;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) return [...m.slice(0, -1), { ...last, streaming: false }];
            return m;
          });
        },
      );
      // ── Unified engine chat stream (Track D5) ────────────────────
      // `engine_chat` emits a ChatEvent NDJSON stream wrapped as
      // { session, data: <ChatEvent> } on `engine-chat:line`, closing
      // with `engine-chat:done`. We render into the SAME `messages`
      // state and reuse the existing chat bubble rendering, so this is
      // purely an alternate producer for the assistant reply.
      const u3 = await listen<{ session: string; stream?: string; data: ChatEvent | string }>(
        "engine-chat:line",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
          // stderr lines arrive as raw strings — capture them on the
          // streaming assistant bubble so failures surface like the
          // native path's "No output" panel.
          if (e.payload.stream === "stderr" || typeof e.payload.data === "string") {
            const errChunk = stripAnsi(String(e.payload.data));
            setMessages((m) => {
              const last = m[m.length - 1];
              if (last && last.streaming) {
                return [...m.slice(0, -1), { ...last, stderr: (last.stderr ?? "") + errChunk + "\n" }];
              }
              return m;
            });
            return;
          }
          const ev = e.payload.data as ChatEvent;
          switch (ev.type) {
            case "start":
            case "user":
              // 'start' opens the turn; 'user' echoes the prompt we
              // already optimistically rendered. Nothing to append.
              break;
            case "delta": {
              // Incremental text chunk — append to the streaming bubble.
              rawReplyRef.current += ev.text ?? ""; // raw, for the intent ledger
              const clean = maybeStripSycophancy(stripAnsi(ev.text ?? ""));
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  return [...m.slice(0, -1), { ...last, content: last.content + clean }];
                }
                return m;
              });
              break;
            }
            case "assistant": {
              // Finalized reply. If we streamed deltas the content is
              // already there; otherwise (engine emitted only a final
              // assistant event) set it now. Either way keep streaming
              // true until 'done' so the spinner persists.
              const full = maybeStripSycophancy(stripAnsi(ev.text ?? ""));
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  // Prefer the longer of accumulated deltas vs final text
                  // so we don't truncate a stream that already arrived.
                  const content = last.content.length >= full.length ? last.content : full;
                  return [...m.slice(0, -1), { ...last, content }];
                }
                return m;
              });
              break;
            }
            case "usage": {
              // Token / cost accounting — stash on the streaming bubble.
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  return [...m.slice(0, -1), { ...last, usage: ev.usage }];
                }
                return m;
              });
              break;
            }
            case "error": {
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) {
                  return [...m.slice(0, -1), { ...last, stderr: (last.stderr ?? "") + (ev.error ?? "engine error") + "\n" }];
                }
                return m;
              });
              break;
            }
            case "done":
              // 'done' on the stream closes the turn; the dedicated
              // engine-chat:done event below flips streaming off.
              break;
            default:
              // Unknown event type — tolerate per the schema's forward-
              // compat requirement. No-op.
              break;
          }
        },
      );
      const u4 = await listen<{ session: string; code: number }>(
        "engine-chat:done",
        (e) => {
          if (!mounted) return;
          onStreamEnd(e.payload.session);
          // Capture usage for engine-path turns — pull the token/cost
          // accounting off the streaming bubble before we flip it closed.
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) {
              persistUsage(e.payload.session, e.payload.code === 0, last.usage);
              return [...m.slice(0, -1), { ...last, streaming: false }];
            }
            persistUsage(e.payload.session, e.payload.code === 0);
            return m;
          });
        },
      );
      unlistenRefs.current = [u1, u2, u3, u4];
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
    setDomainTab("chat"); // sending always shows the chat, even from Preferences
    // Bunker Mode: auto-switch a (stale) cloud selection to an available local
    // provider instead of letting the backend hard-block. If nothing local is
    // installed/running, surface the canonical guidance and bail. The backend
    // resolves this too (the real guarantee); doing it here keeps the bubble,
    // model pick, and usage capture honest about which provider actually ran.
    let chatCli = selectedCli;
    if (isBunkerOn() && !isLocalCli(chatCli)) {
      const local = preferredLocalCli(clis);
      if (!local) {
        setMessages((m) => [...m, { role: "user", content: input.trim(), ts: Date.now() }, { role: "assistant", content: "Bunker Mode is on, so replies stay on this device — but no local model provider (Ollama) was detected. Install or start Ollama, or leave Bunker Mode in Settings → Privacy & Connectivity.", ts: Date.now() }]);
        setInput("");
        return;
      }
      chatCli = local;
    }
    const chatModel = lsGet(`prevail.model.${chatCli}`) || null;
    const visible = input.trim();
    const userMsg: ChatMessage = { role: "user", content: visible, ts: Date.now() };
    const replyMsg: ChatMessage = { role: "assistant", cli: chatCli, model: chatModel || undefined, framework: fwLens.framework ?? undefined, lens: fwLens.lens ?? undefined, content: "", ts: Date.now(), streaming: true };
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
    const userPreamble = (getPref(PREF.userProfile, "1") === "1" && userMd.trim())
      ? `--- About the user (vault/user.md) ---\n${userMd.trim().slice(0, Number(getPref(PREF.profileBudgetChars, "2000")))}\n\n`
      : "";
    // Self-learning: prepend the distilled long-term memory for this domain.
    const memoryPreamble = (getPref(PREF.persistentMemory, "1") === "1" && memoryMd.trim())
      ? `--- Long-term memory (${domain ?? "General"}) ---\n${memoryMd.trim().slice(0, Number(getPref(PREF.memoryBudgetChars, "4000")))}\n\n`
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
        ? `${userPreamble}${memoryPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}You are mid-conversation. Below is the prior turn history; use it as context but do NOT repeat it back to the user.\n\n--- PRIOR TURNS ---\n${history}\n--- END PRIOR TURNS ---\n\nUser's next message: ${visible}`
        : `${userPreamble}${memoryPreamble}${attachPreamble}${primedPreamble}${skillsPreamble}${visible}`
    );
    pushHistory(visible);
    setAttachments([]);
    setAttachedSkills([]);
    setInput("");
    sessionRef.current = `s-${Date.now()}`;
    rawReplyRef.current = ""; // fresh raw-output buffer for this turn
    const turnModel = chatModel;
    // Snapshot this turn's meta for usage capture (P4.7 Phase 3). Read at
    // 'done' regardless of which path (engine vs native) serves the reply.
    pendingUsageRef.current = {
      session: sessionRef.current,
      vault: vaultPath,
      domain: domain ?? null,
      thread: activeThreadRef.current,
      cli: chatCli ?? null,
      model: turnModel,
      intent: visible,
    };
    // ── Self-learning: record the INTENT immediately, the instant the user
    // sends — BEFORE the async model call — so a chat is never lost even on
    // a crash/quit mid-reply. Captures the exact prompt sent + every
    // preference in effect, so a future better model can replay it. The
    // matching raw reply is appended on completion (persistUsage).
    const prefs = {
      framework: fwLens.framework ?? null,
      lens: fwLens.lens ?? null,
      localOnly: localOnly,
      web: isBunkerOn() ? false : (domain ? getDomainToggle(domain, "web", false) : false),
      serendipity: domain ? getDomainToggle(domain, "serendipity", false) : false,
      auto: domain ? getDomainToggle(domain, "auto", false) : false,
      council: domain ? getDomainToggle(domain, "council", false) : false,
      skills: attachedSkills,
      attachments,
      primedContext: primedContext.map((c) => c.label),
    };
    invoke("intent_append", {
      vault: vaultPath,
      domain: domain ?? null,
      record: {
        kind: "intent",
        ts: Date.now(),
        session: sessionRef.current,
        domain: domain ?? null,
        thread: activeThreadRef.current,
        cli: chatCli ?? null,
        model: turnModel,
        message: maybeRedact(visible), // what the user typed
        prompt: maybeRedact(promptText), // the exact, fully-assembled prompt sent to the model
        prefs,
      },
    }).catch((e) => console.error("intent_append (intent) failed", e));
    // Announce the stream so the sidebar can pulse the originating
    // domain even if the user navigates away while it runs.
    onStreamStart({
      sessionId: sessionRef.current,
      domain: domain ?? null,
      threadPath: activeThreadRef.current,
      title: visible.slice(0, 60).replace(/\n/g, " "),
      startedAt: Date.now(),
    });
    // Engine chat: the installed `prevail` CLI is now v2-aware (detects domains
    // by soul.md / reads _state.md — VAULT-SPEC-v2 stages 3–4), so the engine
    // path grounds replies in the domain's real state again. Falls back to the
    // native chat_send path when the CLI isn't present.
    const ENGINE_CHAT_ENABLED = true;
    const useEngine = ENGINE_CHAT_ENABLED && engineAvailable && !!domain;
    // Engine-only providers (no spawnable binary): OpenRouter is an HTTP gateway;
    // LM Studio / MLX are local HTTP servers the engine reaches via the ollama
    // provider path. In the no-domain General space the engine path isn't used,
    // so guide the user to a domain rather than failing on a missing binary.
    const ENGINE_ONLY = new Set(["openrouter", "lmstudio", "mlx"]);
    if (chatCli && ENGINE_ONLY.has(chatCli) && !useEngine) {
      const label = chatCli === "openrouter" ? "OpenRouter" : chatCli === "lmstudio" ? "LM Studio" : "MLX";
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `${label} runs through the engine, which needs a domain. Pick a domain (left sidebar) to chat with ${label} — or use an installed CLI here in General.`, ts: Date.now() }]);
      onStreamEnd(sessionRef.current);
      return;
    }
    try {
      if (useEngine) {
        await invoke("engine_chat", {
          session: sessionRef.current,
          vault: vaultPath,
          domain,
          message: promptText,
          cli: chatCli || null,
          model: chatModel,
          localOnly,
        });
      } else {
        await invoke("chat_send", {
          args: {
            cli: chatCli,
            model: chatModel,
            prompt: promptText,
            session_id: sessionRef.current,
            timeout_sec: (() => { const n = parseInt(getPref(PREF.llmPromptTimeoutSec, "300"), 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
          },
        });
      }
    } catch (e) {
      // If the engine path failed to even spawn, fall back to the native
      // path once so a transient engine issue doesn't drop the turn — but only
      // for providers with a real spawnable binary (engine-only providers like
      // LM Studio / MLX / OpenRouter have none, so the native path can't serve
      // them and would just echo "unknown cli").
      if (useEngine && chatCli && !ENGINE_ONLY.has(chatCli)) {
        try {
          await invoke("chat_send", {
            args: {
              cli: chatCli,
              model: chatModel,
              prompt: promptText,
              session_id: sessionRef.current,
              timeout_sec: (() => { const n = parseInt(getPref(PREF.llmPromptTimeoutSec, "300"), 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
            },
          });
          return;
        } catch { /* fall through to error rendering */ }
      }
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `(error spawning ${chatCli}: ${e})`, ts: Date.now() }]);
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
  // A8: drag a domain in as context. Default is the LIGHT state summary
  // (state.md only) to keep the window small; hold Shift to pull the FULL,
  // heavy context (state + decisions + journal). Same behavior in chat & council.
  const attachDomainAsContext = useCallback(async (name: string, mode: "light" | "full" = "light") => {
    if (!name || !vaultPath) return;
    try {
      const c = await invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain: name });
      if (mode === "full") {
        const parts = [
          c.state && `## state.md\n${c.state}`,
          c.decisions && `## decisions\n${c.decisions}`,
          c.journal && `## journal\n${c.journal}`,
        ].filter(Boolean);
        const body = parts.length ? parts.join("\n\n") : `(no context files in ${name})`;
        injectContext(body, `extra (full): ${titleCase(name)}`);
      } else if (c.state) {
        injectContext(c.state, `extra: ${titleCase(name)}/state.md`);
      } else {
        injectContext(`(no state.md in ${name})`, `extra: ${titleCase(name)}/state.md`);
      }
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
        void attachDomainAsContext(name, e.shiftKey ? "full" : "light");
      }}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent-soft/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 text-center font-mono text-sm uppercase tracking-wider text-accent shadow-xl">
            ⊕ drop to add as context
            <div className="mt-1 text-[10px] normal-case tracking-normal text-accent/70">state summary · hold ⇧ for full context</div>
          </div>
        </div>
      )}
      {/* Header — just the domain identity now. Insights / Preferences /
          archive moved up to the top tab bar; the score badge opens the
          context view. When no domain is active there's no header at all —
          the empty state owns the canvas. */}
      {domain && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2">
          {(() => {
            const I = domainIcon(domain);
            return I ? <I className="h-5 w-5 shrink-0 text-accent" /> : <span className="text-accent">◆</span>;
          })()}
          <span className="shrink-0 font-display text-lg font-semibold">{titleCase(domain)}</span>
          <span className="hidden min-w-0 flex-1 truncate text-sm text-text-muted md:inline">{domainBlurb(domain)}</span>
          <div className="ml-auto shrink-0">
            <ContextScoreBadge
              score={ctxScore}
              onClick={() => setDomainTab(domainTab === "context" ? "chat" : "context")}
            />
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !domain && (
          <div className="flex h-full flex-col items-center px-6 py-10">
            <PrevailLogo size={72} src="/logo-512.png" />
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight">
              What should we work on?
            </h2>
            <p className="mt-2 max-w-md text-center text-sm text-text-muted">
              Start chatting, or pick a domain to ground the conversation in its state and history.
            </p>
            {lifeReadiness && lifeReadiness.life_readiness !== null && (
              <div
                className="mt-6 flex items-center gap-3 rounded-full border px-4 py-2"
                style={{ borderColor: scoreColor(lifeReadiness.life_readiness) }}
                title={`Life Readiness · average context score across ${lifeReadiness.domains.length} domain${lifeReadiness.domains.length === 1 ? "" : "s"}`}
              >
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
                  Life Readiness
                </span>
                <span
                  className="font-display text-2xl font-bold leading-none"
                  style={{ color: scoreColor(lifeReadiness.life_readiness) }}
                >
                  {lifeReadiness.life_readiness}
                </span>
                <span className="font-mono text-[11px] text-text-muted">
                  / 100 · {lifeReadiness.domains.length} domain{lifeReadiness.domains.length === 1 ? "" : "s"}
                </span>
              </div>
            )}
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
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
                    Jump to · {featured.length} of {domains.length}
                  </div>
                  <span className="font-mono text-[10px] text-text-muted">more in sidebar</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {featured.map((d, i) => {
                    const Icon = DOMAIN_ICONS[d.name];
                    const importCount = domainStats[d.name] ?? 0;
                    const running = runningDomains.has(d.name);
                    const color = domainColor(d.name);
                    return (
                      <motion.button
                        key={d.name}
                        onClick={() => onPickDomain(d.name)}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.04 * i, type: "spring", stiffness: 140, damping: 18 }}
                        whileHover={{ y: -3 }}
                        whileTap={{ scale: 0.99 }}
                        className="group relative flex h-44 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface p-5 text-left transition-all duration-200 hover:border-border hover:shadow-[0_10px_34px_-12px_rgba(0,0,0,0.18)]"
                      >
                        {/* oversized watermark glyph — editorial fill, no text clutter */}
                        {Icon && (
                          <Icon
                            aria-hidden
                            className="pointer-events-none absolute -bottom-6 -right-5 h-28 w-28 transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-3"
                            style={{ color, opacity: 0.06 }}
                          />
                        )}
                        {/* faint accent wash, reveals on hover */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-25"
                          style={{ background: color }}
                        />

                        {/* top: accent glyph + reveal chevron */}
                        <div className="flex items-center justify-between">
                          <span style={{ color }}>
                            {Icon ? <Icon className="h-[18px] w-[18px]" /> : <span className="font-mono text-sm">◆</span>}
                          </span>
                          <span className="flex items-center gap-2">
                            {running ? (
                              <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-warn" title="A reply is streaming here" />
                            ) : finishedDomains.has(d.name) ? (
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{
                                  background: "var(--color-ok, #2e9e5b)",
                                  boxShadow: "0 0 0 3px color-mix(in srgb, var(--color-ok, #2e9e5b) 28%, transparent)",
                                }}
                                title="Just finished — open to view"
                              />
                            ) : null}
                            <ChevronRight
                              className="h-4 w-4 -translate-x-1 text-text-muted opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                            />
                          </span>
                        </div>

                        {/* name anchored at the bottom with a growing accent hairline */}
                        <div className="relative mt-auto">
                          <div className="font-display text-lg font-semibold leading-tight tracking-tight text-text-primary">
                            {titleCase(d.name)}
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-text-secondary/85">
                            {domainBlurb(d.name)}
                          </p>
                          <div className="mt-2.5 flex items-center gap-2.5">
                            <span className="h-px w-7 rounded-full transition-all duration-300 group-hover:w-12" style={{ background: color }} />
                            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                              {importCount > 0 ? `${importCount} import${importCount === 1 ? "" : "s"}` : d.has_state ? "open" : "needs state"}
                            </span>
                          </div>
                        </div>
                      </motion.button>
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

            <UsageDashboard vault={vaultPath} nonce={chatViewNonce} />
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
          <div className="w-full px-6 py-6">
            {domainTab === "context" && (
              <ContextScorePanel
                score={ctxScore}
                loading={ctxScoreLoading}
                rescanning={ctxScoreRescanning}
                error={ctxScoreError}
                onRescan={rescanContextScore}
              />
            )}
            {domainTab === "insights" && domain && (
              <InsightsPanel
                vaultPath={vaultPath}
                domain={domain}
                onSeed={(t) => { setInput(t); setDomainTab("chat"); }}
              />
            )}
            {!domainCtx && domainTab !== "prefs" && domainTab !== "context" && domainTab !== "insights" && <div className="text-sm text-text-muted">loading…</div>}
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
            {domainCtx && domainTab === "skills" && domain && (
              <>
                <NewSkillForm
                  vaultPath={vaultPath}
                  domain={domain}
                  seed={newSkillSeed}
                  onCreated={() => { setNewSkillSeed(null); refreshDomainCtx(); }}
                />
                <SkillsList
                  skills={domainCtx.skills}
                  onInsert={(name) => { insertSkillSlash(name); setDomainTab("chat"); }}
                  preferredSet={preferredSkillsSet}
                  onTogglePreferred={togglePreferredSkill}
                />
              </>
            )}
            {domainTab === "prefs" && domain && (
              <DomainPrefsPanel
                domain={domain}
                vaultPath={vaultPath}
                clis={clis}
                skills={domainCtx?.skills ?? []}
                preferredSkills={preferredSkills}
                onTogglePreferredSkill={togglePreferredSkill}
                onChanged={() => setPrefsTick((t) => t + 1)}
                onBack={() => setDomainTab("chat")}
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
              void attachDomainAsContext(name, e.shiftKey ? "full" : "light");
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
                      <PrevailLogo size={16} src="/logo-512.png" animated={false} />
                      Attach {titleCase(domain)} state
                    </button>
                  )}
                  {/* I7: turn the prompt you're writing into a reusable skill. */}
                  {domain && input.trim() && (
                    <button
                      onClick={() => { window.dispatchEvent(new CustomEvent("prevail:new-skill", { detail: input.trim() })); setPlusOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-warm"
                    >
                      <Sparkles className="h-4 w-4 text-text-muted" />
                      Save prompt as skill
                    </button>
                  )}
                  <div className="border-t border-border-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Skills · {skillsCache.length}
                  </div>
                  {skillsCache.length === 0 && (
                    <div className="px-3 py-2 text-xs text-text-muted">
                      no skills under <code className="text-accent">{titleCase(domain ?? "—")}/_skills/</code>
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
                // Anchor left: the picker button sits on the left of the
                // composer toolbar, so opening rightward keeps the menu on
                // screen. (right-0 ran it off the window's left edge at
                // non-maximized widths, hiding the left-aligned model names.)
                <div className="absolute bottom-full left-0 z-40 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    Model
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
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
      {domain && domainPath && (contextOpen ? (
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
      ) : (
        <button
          onClick={() => setContextOpen(true)}
          title="Show context"
          className="flex w-9 shrink-0 items-center justify-center border-l border-border-subtle bg-surface py-3 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

// Resolve a human label for a model id (e.g. "claude-opus-4-8" → "Opus 4.8").
function modelLabel(cli?: string, id?: string): string {
  if (!id) return "";
  const m = cli ? MODELS[cli]?.find((x) => x.id === id) : undefined;
  return m?.label ?? id;
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
    : vendor === "lmstudio" ? "LM Studio"
    : vendor === "mlx" ? "MLX"
    : vendor;
  const empty = !msg.content && !msg.streaming;
  // Per-provider brand color for the name + bubble accent so each
  // model's turns are visually distinguishable at a glance.
  const { accent, tint } = vendorAccent(vendor);
  // The real failure reason from the CLI's stderr, if any.
  const cliError = empty ? extractCliError(msg.stderr) : null;
  // Brand styling only on normal replies — error bubbles keep the warn
  // palette so failures still read as failures.
  const bubbleStyle: React.CSSProperties = empty
    ? {}
    : { borderLeftColor: accent, borderLeftWidth: 3, background: tint };
  return (
    <div className="group mb-8 flex items-start gap-3">
      <ProviderMark vendor={vendor} size={32} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-secondary">
          <span className="font-display font-semibold tracking-tight" style={{ color: accent }}>{vendorName}</span>
          {/* I9: which model + how it was shaped (framework/lens) — so each turn
              is self-describing, not a mystery. */}
          {msg.role === "assistant" && msg.model && (
            <span className="font-mono text-[10px] lowercase text-text-muted" title={`Model: ${msg.model}`}>{modelLabel(msg.cli, msg.model)}</span>
          )}
          {msg.role === "assistant" && msg.framework && (
            <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Reasoning framework in effect">{msg.framework}</span>
          )}
          {msg.role === "assistant" && msg.lens && (
            <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted" title="Lens in effect">{msg.lens}</span>
          )}
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
          </div>
        )}
      </div>
    </div>
  );
}

// Animated three-dot indicator shown while a CLI is spinning up and
// hasn't streamed its first token yet. Replaces the dead "…" feel
// with something that obviously "ticks".
// I9: the status word used to be a random whimsical verb ("Puzzling",
// "Ruminating") that rotated every 2.4s — which read as if it meant something
// about the model's state when it didn't. Replaced with an HONEST progression
// keyed to elapsed wait time, so it actually conveys "this is taking a while".
function useThinkingWord() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (secs < 4) return "Thinking";
  if (secs < 12) return "Still thinking";
  if (secs < 30) return "Working on it";
  return "Taking a while";
}
function ThinkingWord() {
  return <>{useThinkingWord()}</>;
}
function ThinkingDots() {
  const word = useThinkingWord();
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
      <span className="thinking-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
      <span className="ml-1.5 text-xs text-text-muted">{word}…</span>
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
  stderr?: string;
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
  activeThreadPath,
  onActiveThreadChange,
  onOpenInFinder,
  onSwitchToChat,
  onThreadsChanged,
  seedPrompt,
  onSeedConsumed,
}: {
  domain: string | null;
  domainPath: string | null;
  vaultPath: string;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
  activeThreadPath: string | null;
  onActiveThreadChange: (path: string | null) => void;
  onOpenInFinder: () => void;
  onSwitchToChat: () => void;
  onThreadsChanged?: () => void;
  seedPrompt?: string | null;
  onSeedConsumed?: () => void;
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
      // Seed from the configured default council panel (Settings → Council),
      // which stores exact slot keys (`${cli}::${model}`) — so a panel can hold
      // several models from the same provider. Only keep slots that still exist
      // and whose provider is available. If nothing's configured, default to one
      // slot per available CLI.
      const configured = readCouncilMembers();
      const def = new Set<string>();
      for (const key of configured) {
        const slot = allSlots.find((s) => s.key === key);
        const cli = slot && clis.find((c) => c.id === slot.cli);
        if (slot && cli?.available) def.add(key);
      }
      if (def.size === 0) {
        const seen = new Set<string>();
        for (const s of allSlots) {
          const cli = clis.find((c) => c.id === s.cli);
          if (!cli?.available || seen.has(s.cli)) continue;
          seen.add(s.cli);
          def.add(s.key);
        }
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
    // Prefer the configured chair SLOT (a specific model); fall back to the
    // legacy chair-by-CLI, then the first panelist.
    const savedSlot = readCouncilChair();
    if (savedSlot && allSlots.some((s) => s.key === savedSlot)) {
      setChairSlot(savedSlot);
      return;
    }
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
    if (s) { lsSet(COUNCIL_CHAIR_KEY, s.key); lsSet(LS.defaultChairCli, s.cli); }
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
  // I4: a Decision/Risks card from the domain home routes here with a seeded
  // question — drop it into the composer so the user just picks panelists and
  // convenes. Consumed once so it doesn't re-fire on re-render.
  useEffect(() => {
    if (seedPrompt) {
      setPrompt(seedPrompt);
      onSeedConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);
  // Snapshot of the prompt at the moment the council was convened.
  // Composer `prompt` clears after submit so the textarea is empty for
  // the next question; this preserves the question text shown above
  // the responses in the transcript.
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [phase, setPhase] = useState<"idle" | "panelists" | "synthesizing" | "done">("idle");
  const [replies, setReplies] = useState<Record<string, PanelistReply>>({});
  const [verdict, setVerdict] = useState<string>("");
  // The decision-log id for the verdict currently on screen, so the user can
  // attach a thumbs up/down (decision_feedback) to it. (feedback v0.4.1 I5)
  const [verdictDecisionId, setVerdictDecisionId] = useState<string | null>(null);
  const [verdictRating, setVerdictRating] = useState<"up" | "down" | null>(null);
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
          if (e.payload.session.endsWith(":chair")) {
            if (e.payload.stream !== "stdout") return;
            setVerdict((v) => v + stripAnsi(e.payload.data));
            return;
          }
          const slotMatch = e.payload.session.match(/:slot:(.+)$/);
          if (!slotMatch) return;
          const slotKey = slotMatch[1];
          // Capture stderr so a panelist that errored shows its real
          // failure reason instead of a silent empty card.
          if (e.payload.stream === "stderr") {
            const errChunk = stripAnsi(e.payload.data);
            setReplies((r) => {
              const existing = r[slotKey] ?? { cli: e.payload.cli, content: "", streaming: true, startedAt: Date.now() };
              return { ...r, [slotKey]: { ...existing, stderr: (existing.stderr ?? "") + errChunk } };
            });
            return;
          }
          if (e.payload.stream !== "stdout") return;
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
  // Accumulated prior turns for the active council thread, so convenes
  // continue a multi-turn conversation instead of spawning a new thread.
  const [councilTurns, setCouncilTurns] = useState<ThreadTurn[]>([]);
  const councilThreadRef = useRef<string | null>(activeThreadPath);
  const councilSelfSetRef = useRef<string | null>(null);
  // Load (or clear) the council transcript when the active thread changes.
  useEffect(() => {
    councilThreadRef.current = activeThreadPath ?? null;
    // We just saved this convene and adopted its own path — keep the result on
    // screen (don't clear the replies/verdict the user is reading).
    if (activeThreadPath && councilSelfSetRef.current === activeThreadPath) {
      councilSelfSetRef.current = null;
      return;
    }
    // Genuine thread switch (+ New, a different thread, or cleared on domain
    // change): clear the live convene state so the panel reflects the SELECTED
    // thread, not the previous convene's question/replies/verdict.
    setReplies({});
    setVerdict("");
    setSubmittedPrompt("");
    setPhase("idle");
    if (!activeThreadPath) { setCouncilTurns([]); return; }
    let cancelled = false;
    invoke<{ meta: ThreadMeta; turns: ThreadTurn[] }>("load_thread", { path: activeThreadPath })
      .then((t) => { if (!cancelled) setCouncilTurns(t.turns ?? []); })
      .catch((e) => console.error("load_thread (council)", e));
    return () => { cancelled = true; };
  }, [activeThreadPath]);

  const councilSavedRef = useRef(false);
  useEffect(() => {
    if (phase !== "done") { councilSavedRef.current = false; return; }
    if (councilSavedRef.current) return;
    if (!_vaultPath || !submittedPrompt) return;
    councilSavedRef.current = true;
    // Start from whatever is already in this thread so each convene
    // appends rather than replaces.
    const prior = councilTurns;
    const fresh: ThreadTurn[] = [
      { role: "user", cli: null, model: null, content: submittedPrompt },
    ];
    for (const s of panelistSlots) {
      const r = replies[s.key];
      if (!r || !r.content.trim()) continue;
      fresh.push({
        role: "assistant",
        cli: s.cli,
        model: s.model || null,
        content: `### ${s.cliLabel} · ${s.modelLabel}\n\n${r.content.trim()}`,
      });
    }
    if (verdict.trim()) {
      fresh.push({
        role: "assistant",
        cli: chairSlotObj?.cli ?? null,
        model: chairSlotObj?.model || null,
        content: `### Council verdict\n\n${verdict.trim()}`,
      });
    }
    const allTurns = [...prior, ...fresh];
    // Self-learning: record the verdict as a durable DECISION so the domain
    // learns from it — feeds _state derivation, scoring, and the Insights
    // surface, and can carry a thumbs up/down. (feedback v0.4.1 I1/I5)
    if (verdict.trim()) {
      const decisionId = `d-${Date.now()}`;
      setVerdictDecisionId(decisionId);
      setVerdictRating(null);
      invoke("decision_append", {
        vault: _vaultPath,
        domain: domain ?? null,
        record: {
          id: decisionId,
          kind: "council",
          ts: Date.now(),
          domain: domain ?? null,
          thread: councilThreadRef.current,
          prompt: submittedPrompt,
          verdict: verdict.trim(),
          chair: chairSlotObj ? { cli: chairSlotObj.cli, model: chairSlotObj.model || null } : null,
          panelists: panelistSlots.map((s) => ({ cli: s.cli, model: s.model || null })),
        },
      }).catch((e) => console.error("decision_append (council)", e));
    }
    // Reuse the existing thread's slug when continuing; else create new.
    const cur = councilThreadRef.current;
    const slug = cur ? cur.split("/").pop()?.replace(/\.md$/, "") ?? null : null;
    // Title comes from the FIRST user turn of the conversation.
    const firstUser = (prior.find((t) => t.role === "user")?.content ?? submittedPrompt);
    const title = `Council · ${firstUser.slice(0, 50).replace(/\n/g, " ")}`;
    invoke<string>("save_thread", {
      vault: _vaultPath,
      domain: domain ?? null,
      slug,
      title,
      turns: allTurns,
    })
      .then((path) => {
        setCouncilTurns(allTurns);
        if (!councilThreadRef.current) {
          councilThreadRef.current = path;
          councilSelfSetRef.current = path;
          onActiveThreadChange(path);
        }
        onThreadsChanged?.();
      })
      .catch((e) => console.error("save_thread (council)", e));
  }, [phase, submittedPrompt, replies, verdict, panelistSlots, chairSlotObj, _vaultPath, domain, councilTurns, onActiveThreadChange, onThreadsChanged]);

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
    const userPreamble = (getPref(PREF.userProfile, "1") === "1" && userMd.trim())
      ? `--- About the user (vault/user.md) ---\n${userMd.trim().slice(0, Number(getPref(PREF.profileBudgetChars, "2000")))}\n\n`
      : "";
    // Self-learning: prepend distilled long-term memory to the council too.
    let memoryMd = "";
    try { memoryMd = await invoke<string>("read_memory_md", { vault: _vaultPath, domain: domain ?? null }); } catch {}
    const memoryPreamble = (getPref(PREF.persistentMemory, "1") === "1" && memoryMd.trim())
      ? `--- Long-term memory (${domain ?? "General"}) ---\n${memoryMd.trim().slice(0, Number(getPref(PREF.memoryBudgetChars, "4000")))}\n\n`
      : "";
    const primedPreamble = primedContext.length > 0
      ? primedContext.map((c) => `--- ${c.label} ---\n${c.body.trim()}\n`).join("\n") + "\n"
      : "";
    const skillsPreamble = attachedSkills.length > 0
      ? `Use the following skills as part of your reply: ${attachedSkills.map((n) => `/${n}`).join(", ")}\n\n`
      : "";
    // Continuation: feed prior council turns (questions + chair verdicts)
    // so this convene builds on the conversation so far.
    const histItems = councilTurns.filter(
      (t) => t.role === "user" || t.content.startsWith("### Council verdict"),
    );
    const historyPreamble = histItems.length
      ? "--- Conversation so far ---\n" +
        histItems
          .map((t) =>
            t.role === "user"
              ? `User: ${t.content}`
              : `Council verdict: ${t.content.replace(/^### Council verdict\n\n/, "")}`,
          )
          .join("\n\n")
          .slice(0, 6000) +
        "\n\n--- New question (continue the conversation) ---\n"
      : "";
    const enrichedPrompt = fwLens.buildPrompt(`${userPreamble}${memoryPreamble}${primedPreamble}${historyPreamble}${skillsPreamble}${trimmed}`);
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
        // A8: same light/heavy behavior as Chat — default state summary, hold
        // Shift for the full context bundle.
        const full = e.shiftKey;
        try {
          const c = await invoke<DomainContextBundle>("domain_context", { vault: _vaultPath, domain: name });
          if (full) {
            const parts = [
              c.state && `## state.md\n${c.state}`,
              c.decisions && `## decisions\n${c.decisions}`,
              c.journal && `## journal\n${c.journal}`,
            ].filter(Boolean);
            injectContext(parts.length ? parts.join("\n\n") : `(no context files in ${name})`, `extra (full): ${titleCase(name)}`);
          } else if (c.state) {
            injectContext(c.state, `extra: ${titleCase(name)}/state.md`);
          }
        } catch (err) { console.error("drop domain", err); }
      }}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent-soft/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-8 py-6 text-center font-mono text-sm uppercase tracking-wider text-accent shadow-xl">
            ⊕ drop to add as context
            <div className="mt-1 text-[10px] normal-case tracking-normal text-accent/70">state summary · hold ⇧ for full context</div>
          </div>
        </div>
      )}
      {/* Minimal header — same shape as Chat. Domain + Finder on left. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-6 py-3">
        {domain ? (
          <>
            {(() => {
              const I = domainIcon(domain);
              return I ? <I className="h-5 w-5 text-accent" /> : <span className="text-accent">◆</span>;
            })()}
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
        {/* Context is a collapse/expand sidebar (right edge), never a labeled
            button — see the rail at the end of this panel. */}
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {panelistSlots.length} on panel
        </span>
      </div>

      {/* Hero / transcript area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Prior council turns — multi-turn continuation history */}
        {councilTurns.length > 0 && (
          <div className="mx-auto max-w-3xl space-y-4 px-6 pt-6">
            {councilTurns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="rounded-2xl border border-border-subtle bg-surface px-4 py-3 font-mono text-sm text-text-primary">
                  <span className="text-accent">$ </span>
                  {t.content}
                </div>
              ) : t.content.startsWith("### Council verdict") ? (
                <div key={i} className="rounded-2xl border border-accent-border bg-accent-soft px-4 py-3">
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">Council verdict</div>
                  <div className="text-sm leading-relaxed text-text-secondary">
                    <Markdown source={t.content.replace(/^### Council verdict\n\n/, "")} />
                  </div>
                </div>
              ) : null,
            )}
            {phase !== "idle" && (
              <div className="pb-1 pt-1 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                — continuing —
              </div>
            )}
          </div>
        )}
        {councilTurns.length === 0 && phase === "idle" && (
          <div className="flex h-full flex-col items-center justify-start px-6 py-6">
            <img src="/logo.png" alt="" className="h-10 w-10 rounded-2xl opacity-90" />
            <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
              <Brand /> Council
            </h2>
            <p className="mt-1.5 max-w-md text-center text-[13px] text-text-muted">
              {panelistSlots.length === 0 ? (
                <>Add panelists below, then ask the council.</>
              ) : (
                <>
                  {panelistSlots.length} model{panelistSlots.length === 1 ? "" : "s"} on panel · chair:{" "}
                  <span className="text-accent">
                    {chairSlotObj ? `${chairSlotObj.cliLabel.toLowerCase()} · ${chairSlotObj.modelLabel}` : "—"}
                  </span>
                  {" "}· best for <span className="text-accent">why</span> / <span className="text-accent">should-I</span> decisions, not quick lookups.
                </>
              )}
            </p>

            {/* Compact starter rows — one line each (glyph · label · the short
                question). Clicking loads the full prompt into the composer, so
                the body text doesn't need to sit here as a wall. */}
            <ul className="mt-5 flex w-full max-w-2xl flex-col gap-1.5">
              {buildCouncilQuickActions(domain).map((q) => (
                <li key={q.label}>
                  <button
                    onClick={() => setPrompt(q.prompt)}
                    title={q.prompt}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-4 py-2.5 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
                  >
                    <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-accent">{q.glyph} {q.label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{q.blurb}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
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
                const cardAccent = vendorAccent(s.cli);
                const cardErrored = !!r && !r.streaming && !r.content;
                const cardError = cardErrored ? extractCliError(r.stderr) : null;
                return (
                  <div
                    key={s.key}
                    className="overflow-hidden rounded-lg border border-border bg-surface"
                    style={{ borderLeftColor: cardAccent.accent, borderLeftWidth: 3 }}
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-warm px-4 py-2 font-mono text-xs">
                      <span className="flex items-center gap-2">
                        <ProviderMark vendor={s.cli} size={18} />
                        <span style={{ color: cardAccent.accent }}>{s.cliLabel.toLowerCase()}</span>
                        <span className="text-text-muted">· {s.modelLabel}</span>
                      </span>
                      <span className="text-text-muted">
                        {!r && "queued"}
                        {r?.streaming && <span className="pulse-soft text-accent">streaming</span>}
                        {r && !r.streaming && !cardErrored && <span className="text-ok">✓ done</span>}
                        {cardErrored && <span className="text-warn">⚠ no output</span>}
                      </span>
                    </div>
                    <div className="px-5 py-4">
                      {r?.content ? (
                        <Markdown source={r.content} />
                      ) : cardErrored ? (
                        cardError ? (
                          <pre className="whitespace-pre-wrap rounded-md bg-warn/10 px-2 py-1.5 font-mono text-[11px] leading-snug text-warn">{cardError}</pre>
                        ) : (
                          <p className="text-sm text-text-secondary">{s.cliLabel} produced no output (model rejected the prompt, hit a quota, or errored).</p>
                        )
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
                {/* Verdict feedback — thumbs up/down trains which model + lens +
                    framework produce verdicts the user trusts. (v0.4.1 I5) */}
                {phase === "done" && verdict && verdictDecisionId && (
                  <div className="mt-4 flex items-center gap-2 border-t border-accent-border/40 pt-3 text-xs text-text-muted">
                    <span>Was this verdict useful?</span>
                    <button
                      title="Good verdict"
                      onClick={() => {
                        const next = verdictRating === "up" ? null : "up";
                        setVerdictRating(next);
                        invoke("decision_feedback", { vault: _vaultPath, domain: domain ?? null, id: verdictDecisionId, rating: next ?? "clear", note: null }).catch((e) => console.error("decision_feedback", e));
                      }}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${verdictRating === "up" ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-strong"}`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      title="Not useful"
                      onClick={() => {
                        const next = verdictRating === "down" ? null : "down";
                        setVerdictRating(next);
                        invoke("decision_feedback", { vault: _vaultPath, domain: domain ?? null, id: verdictDecisionId, rating: next ?? "clear", note: null }).catch((e) => console.error("decision_feedback", e));
                      }}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${verdictRating === "down" ? "border-red-400 bg-red-500/10 text-red-500" : "border-border hover:bg-surface-strong"}`}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </button>
                    {verdictRating && <span className="text-text-muted">· saved</span>}
                  </div>
                )}
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
                    {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
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
                    {clis.filter((c) => !isBunkerOn() || isLocalCli(c.id)).map((c) => {
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
      {domain && _vaultPath && (contextOpen ? (
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
      ) : (
        // Collapsed: a thin chevron rail to expand the context sidebar — no
        // labeled button, just the collapse/expand affordance.
        <button
          onClick={() => setContextOpen(true)}
          title="Show context"
          className="flex w-9 shrink-0 items-center justify-center border-l border-border-subtle bg-surface py-3 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      ))}
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

function ScoreBar({ value, max, color = "var(--color-accent)" }: { value: number | null; max: number; color?: string }) {
  const pct = value === null ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-strong">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// Small color-coded Context Score pill for the domain header. Click jumps
// to the Context tab. Tooltip shows freshness + audit recency.
function ContextScoreBadge({
  score,
  onClick,
}: {
  score: ContextScore | null;
  onClick?: () => void;
}) {
  if (!score) return null;
  const color = scoreColor(score.score);
  const tip = `Context score ${score.score} out of 100 · updated ${formatFreshness(
    score.freshness_secs,
  )}${score.audited_at ? ` · audited ${formatAuditedAt(score.audited_at)}` : " · heuristic"} · click to review & rescan`;
  return (
    <button
      onClick={onClick}
      title={tip}
      className="group inline-flex cursor-pointer items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide transition-colors hover:bg-surface-warm"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span style={{ color }}>{score.score}<span className="opacity-50">/100</span></span>
      </span>
      {/* Edit affordance is hidden until hover, so the header stays calm. */}
      <Pencil
        className="h-2.5 w-2.5 max-w-0 overflow-hidden text-text-muted opacity-0 transition-all duration-150 group-hover:ml-1.5 group-hover:max-w-[14px] group-hover:opacity-100"
        style={{ color }}
      />
    </button>
  );
}

// Full Context tab: big score ring, the six dimensions as ScoreBars, the
// what's-missing list grouped by severity, the LLM assessment + last
// audited, and a Re-scan button (forces a fresh audit).
function ContextScorePanel({
  score,
  loading,
  rescanning,
  error,
  onRescan,
}: {
  score: ContextScore | null;
  loading: boolean;
  rescanning: boolean;
  error: string | null;
  onRescan: () => void;
}) {
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

      {/* Domain fit — the domain-intelligent relevance checklist. Only present
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

// Visible CLI kinds for benchmark runs — must match the prevail CLI's
// internal `kind` identifiers. Antigravity = google's `agy` CLI.
const BENCH_CLI_OPTIONS = [
  { id: "claude",      label: "Claude" },
  { id: "codex",       label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "ollama",      label: "Ollama" },
] as const;

// ─────────────────────────────────────────────────────────────────────
// BENCHMARK PAGE — run (multi-model, per-domain or global), results
// (by-model leaderboard + model×domain effectiveness matrix), and a
// questions manager. Replaces the old leaderboard+popup. No modals.

interface BenchQuestion {
  id: string;
  domain: string;
  prompt: string;
  context: string;
  notes: string;
  council: boolean;
  expected_decision: string;
  expected_verdict_keywords: string[];
  path: string;
}
interface MatrixDomainCell {
  judge_avg: number | null;
  keyword_avg: number | null;
  count: number;
}
interface MatrixRow {
  label: string;
  run_dir: string;
  judge_avg: number | null;
  keyword_avg: number | null;
  per_domain: Record<string, MatrixDomainCell>;
}

type BenchJobStatus = "queued" | "running" | "scoring" | "done" | "error";
interface BenchJob {
  key: string;
  cli: string;
  model: string;
  label: string;
  status: BenchJobStatus;
  note?: string;
}

const MODEL_SEP = "::";

function BenchmarkPanel({
  vaultPath,
  initialDomain,
}: {
  vaultPath: string;
  initialDomain?: string | null;
}) {
  const [view, setView] = useState<"run" | "results" | "questions">(
    initialDomain ? "run" : "results",
  );

  // Data
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [questions, setQuestions] = useState<BenchQuestion[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    invoke<BenchmarkRun[]>("benchmark_runs", { vault: vaultPath }).then(setRuns).catch((e) => setErr(String(e)));
    invoke<MatrixRow[]>("benchmark_matrix", { vault: vaultPath }).then(setMatrix).catch(() => {});
    invoke<BenchQuestion[]>("benchmark_questions", { vault: vaultPath }).then(setQuestions).catch(() => {});
  }, [vaultPath]);
  useEffect(() => { refresh(); }, [refresh]);

  // Domains available to scope/filter by (union of question domains).
  const allDomains = useMemo(() => {
    const s = new Set<string>();
    for (const q of questions) s.add(q.domain);
    for (const m of matrix) for (const d of Object.keys(m.per_domain)) s.add(d);
    return Array.from(s).sort();
  }, [questions, matrix]);

  // ── Run config ──────────────────────────────────────────────────
  const [mode, setMode] = useState<"single" | "council">("single");
  const [selModels, setSelModels] = useState<Set<string>>(() => new Set([`claude${MODEL_SEP}opus`]));
  const [scope, setScope] = useState<Set<string>>(
    () => new Set(initialDomain ? [initialDomain.toLowerCase()] : []),
  );
  const [jobs, setJobs] = useState<BenchJob[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const toggleModel = (cli: string, model: string) => {
    const k = `${cli}${MODEL_SEP}${model}`;
    setSelModels((cur) => {
      const next = new Set(cur);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };
  const toggleScope = (d: string) =>
    setScope((cur) => {
      const next = new Set(cur);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  // Wait for a specific benchmark:done event (matched by session + phase).
  const waitForDone = useCallback((session: string, phase: string) => {
    return new Promise<number | null>((resolve) => {
      let unlisten: UnlistenFn | null = null;
      let chunkUn: UnlistenFn | null = null;
      listen<{ session: string; code: number | null; phase: string }>("benchmark:done", (e) => {
        if (e.payload.session === session && e.payload.phase === phase) {
          unlisten?.();
          chunkUn?.();
          resolve(e.payload.code);
        }
      }).then((u) => { unlisten = u; });
      listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
        if (e.payload.session === session) setLog((l) => (l + e.payload.data).slice(-8000));
      }).then((u) => { chunkUn = u; });
    });
  }, []);

  async function runBenchmark() {
    const scopeStr = Array.from(scope).join(",");
    const plannedJobs: BenchJob[] =
      mode === "council"
        ? [{ key: "council", cli: "", model: "", label: "Council", status: "queued" }]
        : Array.from(selModels).map((k) => {
            const [cli, model] = k.split(MODEL_SEP);
            const ml = MODELS[cli]?.find((m) => m.id === model)?.label ?? model;
            return { key: k, cli, model, label: `${titleCase(cli)} · ${ml}`, status: "queued" as BenchJobStatus };
          });
    if (plannedJobs.length === 0) { setErr("Pick at least one model to run."); return; }
    setErr(null);
    setRunning(true);
    setLog("");
    setJobs(plannedJobs);
    const setJob = (key: string, patch: Partial<BenchJob>) =>
      setJobs((cur) => cur.map((j) => (j.key === key ? { ...j, ...patch } : j)));

    // Run one job: start the model, wait for it, mark scoring.
    const runOne = async (job: BenchJob) => {
      setJob(job.key, { status: "running" });
      const session = `bench-${job.key.replace(/[^a-z0-9]/gi, "")}-${Date.now()}`;
      try {
        await invoke("benchmark_start", {
          args: {
            session_id: session,
            vault: vaultPath,
            cli: job.cli || "claude",
            model: job.model || null,
            council: mode === "council",
            domain: scopeStr || null,
          },
        });
        const code = await waitForDone(session, "run");
        if (code !== 0 && code !== null) { setJob(job.key, { status: "error", note: `exit ${code}` }); return; }
        setJob(job.key, { status: "scoring" });
      } catch (e) {
        setJob(job.key, { status: "error", note: String(e) });
      }
    };

    try {
      // Different CLIs are independent processes → run them concurrently. A
      // single CLI's models stay sequential so we don't fire two requests at
      // the same subscription at once (rate limits / contention).
      const byCli = new Map<string, BenchJob[]>();
      for (const job of plannedJobs) {
        const g = byCli.get(job.cli) ?? [];
        g.push(job);
        byCli.set(job.cli, g);
      }
      await Promise.all(
        Array.from(byCli.values()).map(async (group) => {
          for (const job of group) await runOne(job);
        }),
      );
      // Score every new (unscored) run in one robust pass.
      const scoreSession = `bench-score-${Date.now()}`;
      await invoke("benchmark_score", { args: { session_id: scoreSession, vault: vaultPath, all: true } });
      await waitForDone(scoreSession, "score");
      setJobs((cur) => cur.map((j) => (j.status === "scoring" || j.status === "running" ? { ...j, status: "done" } : j)));
      refresh();
      setView("results");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sub-nav — a segmented control, deliberately a different shape from
          the underline top tab bar so the two rows don't read as twins. */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="inline-flex items-center gap-0.5 rounded-xl border border-border-subtle bg-surface-warm/60 p-1">
          {([
            ["run", "Run", Sparkles],
            ["results", "Results", TrendingUp],
            ["questions", "Questions", FileText],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${
                view === id
                  ? "bg-surface text-accent shadow-sm ring-1 ring-black/5"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        {initialDomain && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1 font-mono text-[11px] text-text-muted">
            <Target className="h-3 w-3 text-accent" />
            scoped to <span className="font-semibold text-accent">{titleCase(initialDomain)}</span>
          </span>
        )}
      </div>

      {err && <div className="mx-4 mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "run" && (
          <BenchRunConfig
            mode={mode} setMode={setMode}
            selModels={selModels} toggleModel={toggleModel}
            allDomains={allDomains} scope={scope} toggleScope={toggleScope}
            questionCount={questions.length}
            running={running} jobs={jobs} log={log} logRef={logRef}
            onRun={runBenchmark}
          />
        )}
        {view === "results" && (
          <BenchResults runs={runs} matrix={matrix} allDomains={allDomains} vaultPath={vaultPath} />
        )}
        {view === "questions" && (
          <BenchQuestions
            vaultPath={vaultPath} questions={questions} allDomains={allDomains}
            onChanged={refresh}
          />
        )}
      </div>
    </div>
  );
}

function BenchRunConfig({
  mode, setMode, selModels, toggleModel, allDomains, scope, toggleScope,
  questionCount, running, jobs, log, logRef, onRun,
}: {
  mode: "single" | "council";
  setMode: (m: "single" | "council") => void;
  selModels: Set<string>;
  toggleModel: (cli: string, model: string) => void;
  allDomains: string[];
  scope: Set<string>;
  toggleScope: (d: string) => void;
  questionCount: number;
  running: boolean;
  jobs: BenchJob[];
  log: string;
  logRef: React.RefObject<HTMLPreElement | null>;
  onRun: () => void;
}) {
  const selCount = mode === "council" ? 1 : selModels.size;
  // Collapsible provider groups. Smart default: open the providers that
  // already have a model on the panel, collapse the rest — so you land
  // focused on what's selected, not a wall of every model.
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() =>
    new Set(
      BENCH_CLI_OPTIONS
        .filter((c) => !(MODELS[c.id] ?? []).some((m) => selModels.has(`${c.id}${MODEL_SEP}${m.id}`)))
        .map((c) => c.id),
    ),
  );
  const toggleProvider = (id: string) =>
    setCollapsedProviders((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  return (
    <div className="w-full space-y-7 px-6 py-6">
      {/* Mode */}
      <section>
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Mode</div>
        <div className="flex gap-2">
          <button
            onClick={() => setMode("single")}
            className={`rounded-md border px-3 py-1.5 text-sm ${mode === "single" ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-secondary hover:bg-surface-warm"}`}
          >
            Models (compare)
          </button>
          <button
            onClick={() => setMode("council")}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${mode === "council" ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-secondary hover:bg-surface-warm"}`}
          >
            <Scale className="h-3.5 w-3.5" /> Council
          </button>
        </div>
      </section>

      {/* Models (multi-select) — hidden in council mode */}
      {mode === "single" && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Models</span>
            <span className="font-mono text-[10px] text-text-muted">{selModels.size} selected — runs head-to-head</span>
          </div>
          {/* Provider groups, each a spaced stack of standalone model cards —
              same gap-3 separated-card rhythm as the Installed CLIs page.
              Multi-select: the circle fills with a check when a model is on
              the panel. */}
          <div className="space-y-4">
            {BENCH_CLI_OPTIONS.map((c) => {
              const models = MODELS[c.id] ?? [];
              const selectedHere = models.filter((m) => selModels.has(`${c.id}${MODEL_SEP}${m.id}`)).length;
              const collapsed = collapsedProviders.has(c.id);
              return (
                <div key={c.id}>
                  <button
                    onClick={() => toggleProvider(c.id)}
                    className="mb-2 flex w-full items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-accent"
                  >
                    {collapsed ? <ChevronRight className="h-4 w-4 text-text-muted" /> : <ChevronDown className="h-4 w-4 text-text-muted" />}
                    <ProviderMark vendor={c.id} size={20} />
                    <span className="font-display text-sm font-semibold tracking-tight">{c.label}</span>
                    {selectedHere > 0 && (
                      <span className="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-background">
                        {selectedHere} on panel
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-text-muted">{models.length} model{models.length === 1 ? "" : "s"}</span>
                  </button>
                  {!collapsed && (
                    <div className="flex flex-col gap-2">
                      {models.map((m) => {
                        const on = selModels.has(`${c.id}${MODEL_SEP}${m.id}`);
                        return (
                          <button
                            key={m.id}
                            onClick={() => toggleModel(c.id, m.id)}
                            className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${on ? "border-accent bg-accent-soft" : "border-border-subtle bg-surface hover:border-accent-border"}`}
                          >
                            <span className={`shrink-0 font-mono text-sm ${on ? "font-semibold text-accent" : "text-text-primary"}`}>{m.label}</span>
                            {m.blurb && <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{m.blurb}</span>}
                            <span className={`ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${on ? "bg-accent text-background" : "border border-border"}`}>
                              {on && <Check className="h-3 w-3" strokeWidth={3} />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Domain scope */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Domain scope</span>
          <span className="font-mono text-[10px] text-text-muted">{scope.size === 0 ? "all domains" : `${scope.size} selected`}</span>
        </div>
        {allDomains.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-xs text-text-muted">
            No questions yet — add some in the <span className="text-accent">Questions</span> tab first.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => scope.forEach((d) => toggleScope(d))}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${scope.size === 0 ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-muted hover:bg-surface-warm"}`}
            >
              All
            </button>
            {allDomains.map((d) => {
              const on = scope.has(d);
              const Icon = domainIcon(d);
              return (
                <button
                  key={d}
                  onClick={() => toggleScope(d)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] ${on ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background text-text-muted hover:bg-surface-warm"}`}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {titleCase(d)}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Run */}
      <section className="flex items-center gap-3">
        <button
          onClick={onRun}
          disabled={running || questionCount === 0 || selCount === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "Running…" : mode === "council" ? "Run council benchmark" : `Run ${selCount} model${selCount === 1 ? "" : "s"}`}
        </button>
        <span className="text-xs text-text-muted">
          {questionCount} question{questionCount === 1 ? "" : "s"}
          {scope.size > 0 ? ` · scoped` : ""} · different CLIs run in parallel · auto-scored
        </span>
      </section>

      {/* Live job status */}
      {jobs.length > 0 && (
        <section className="space-y-2">
          {jobs.map((j) => (
            <div key={j.key} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
              <BenchStatusDot status={j.status} />
              <span className="flex-1 text-sm text-text-primary">{j.label}</span>
              <span className="font-mono text-[11px] text-text-muted">{j.note ?? j.status}</span>
            </div>
          ))}
          {log && (
            <pre ref={logRef} className="max-h-40 overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-[10px] leading-relaxed text-text-muted">
              {log}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}

function BenchStatusDot({ status }: { status: BenchJobStatus }) {
  if (status === "running" || status === "scoring")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />;
  if (status === "done") return <Check className="h-3.5 w-3.5 text-ok" />;
  if (status === "error") return <AlertTriangle className="h-3.5 w-3.5 text-danger" />;
  return <Circle className="h-3.5 w-3.5 text-text-muted" />;
}

function BenchResults({
  runs, matrix, allDomains, vaultPath,
}: {
  runs: BenchmarkRun[];
  matrix: MatrixRow[];
  allDomains: string[];
  vaultPath: string;
}) {
  const [resultsView, setResultsView] = useState<"model" | "matrix">("model");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedQ, setExpandedQ] = useState<string | null>(null);

  async function loadRun(runDir: string) {
    setLoadingDetail(true);
    setExpandedQ(null);
    try {
      setSelected(await invoke<RunDetail>("benchmark_run_detail", { runDir }));
    } catch { /* ignore */ } finally {
      setLoadingDetail(false);
    }
  }

  // By-model leaderboard, optionally showing a single domain's score.
  const leaderboard = useMemo(() => {
    const rows = runs.map((r) => {
      const parsed = parseRunLabel(r.label);
      const mrow = matrix.find((m) => m.run_dir === r.run_dir);
      const cell = domainFilter !== "all" ? mrow?.per_domain[domainFilter] : null;
      const judge = domainFilter === "all" ? r.judge_avg : cell?.judge_avg ?? null;
      const kw = domainFilter === "all" ? r.keyword_avg : cell?.keyword_avg ?? null;
      return { ...r, parsed, judge, kw, present: domainFilter === "all" || !!cell };
    });
    return rows
      .filter((r) => r.present)
      .sort((a, b) => (b.judge ?? -1) - (a.judge ?? -1));
  }, [runs, matrix, domainFilter]);

  if (selected) {
    return (
      <div className="px-6 py-6">
        <button
          onClick={() => setSelected(null)}
          className="mb-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:text-accent"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Results
        </button>
        <h2 className="font-display text-2xl font-semibold">{selected.score.label}</h2>
        <div className="mt-3 flex gap-6 font-mono text-sm">
          <div><span className="text-text-muted">judge: </span><span className="text-accent">{selected.score.judge_avg?.toFixed(1) ?? "—"}</span><span className="text-text-muted"> / 10</span></div>
          <div><span className="text-text-muted">keyword: </span><span className="text-text-primary">{selected.score.keyword_avg !== null ? Math.round(selected.score.keyword_avg) + "%" : "—"}</span></div>
          <div><span className="text-text-muted">questions: </span><span className="text-text-primary">{selected.score.questionScores.length}</span></div>
        </div>
        <div className="mt-8 space-y-2">
          {selected.score.questionScores.map((q) => {
            const expanded = expandedQ === q.id;
            const record = selected.records.find((r) => r.id === q.id);
            return (
              <div key={q.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                <button onClick={() => setExpandedQ(expanded ? null : q.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm">
                  <span className="text-text-muted">{expanded ? "▾" : "▸"}</span>
                  <span className="w-28 shrink-0 truncate font-mono text-sm text-text-primary">{q.id}</span>
                  <span className="rounded bg-surface-warm px-1.5 py-0 font-mono text-[10px] text-text-muted">{q.domain}</span>
                  <div className="min-w-0 flex-1"><ScoreBar value={q.judge_score} max={10} /></div>
                  <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                    <span className="text-text-muted">{q.keyword_score !== null ? Math.round(q.keyword_score) + "%" : "—"}</span>
                    <span className="w-10 text-right text-accent">{q.judge_score ?? "—"}/10</span>
                  </span>
                </button>
                {expanded && (
                  <div className="space-y-3 border-t border-border-subtle px-6 py-4 text-sm">
                    <div><div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">question</div><div className="whitespace-pre-wrap text-text-primary">{record?.prompt ?? "(n/a)"}</div></div>
                    {record?.expected_decision && <div><div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">expected decision</div><div className="whitespace-pre-wrap text-ok">{record.expected_decision}</div></div>}
                    <div><div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">model said</div><div className="whitespace-pre-wrap text-text-primary">{record?.reply ?? "(no reply)"}</div></div>
                    {q.judge_rationale && <div><div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">judge ({q.judge_score}/10)</div><div className="whitespace-pre-wrap text-text-secondary">{q.judge_rationale}</div></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-border p-0.5">
          {([["model", "By model"], ["matrix", "Model × domain"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setResultsView(id)}
              className={`rounded px-2.5 py-1 text-xs ${resultsView === id ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text-primary"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {resultsView === "model" && allDomains.length > 0 && (
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary"
          >
            <option value="all">all domains</option>
            {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
        )}
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-text-muted">{runs.length} run{runs.length === 1 ? "" : "s"}</span>
      </div>

      {runs.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          No scored runs yet. Head to <span className="text-accent">Run</span> to kick one off.
        </div>
      )}

      {resultsView === "model" && runs.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border">
          {loadingDetail && <div className="p-3 text-xs text-text-muted">loading…</div>}
          {leaderboard.map((r, i) => (
            <button
              key={r.label}
              onClick={() => loadRun(r.run_dir)}
              className="flex w-full items-center gap-3 border-b border-border-subtle px-3 py-2.5 text-left last:border-0 hover:bg-surface-warm"
            >
              <span className="w-5 text-center font-mono text-[11px] text-text-muted">{i + 1}</span>
              <ProviderMark vendor={r.parsed.vendor} size={22} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">{r.parsed.model || r.label}</span>
              <div className="hidden w-40 sm:block"><ScoreBar value={r.judge} max={10} color={scoreColor((r.judge ?? 0) * 10)} /></div>
              <span className="w-14 text-right font-mono text-sm font-semibold text-accent">{r.judge?.toFixed(1) ?? "—"}</span>
              <span className="w-12 text-right font-mono text-[11px] text-text-muted">{r.kw !== null ? Math.round(r.kw) + "%" : "—"}</span>
            </button>
          ))}
        </div>
      )}

      {resultsView === "matrix" && runs.length > 0 && (
        <BenchMatrix matrix={matrix} allDomains={allDomains} onPick={loadRun} />
      )}
      {/* vaultPath kept for future per-run actions */}
      <span className="hidden">{vaultPath}</span>
    </div>
  );
}

// Model × domain pivot — rows are runs (models), columns are domains, cells
// are judge averages. Best cell per column is highlighted so "which model
// wins which domain" reads at a glance.
function BenchMatrix({
  matrix, allDomains, onPick,
}: {
  matrix: MatrixRow[];
  allDomains: string[];
  onPick: (runDir: string) => void;
}) {
  const bestPerDomain = useMemo(() => {
    const best: Record<string, number> = {};
    for (const d of allDomains) {
      let b = -1;
      for (const m of matrix) {
        const v = m.per_domain[d]?.judge_avg;
        if (v != null && v > b) b = v;
      }
      best[d] = b;
    }
    return best;
  }, [matrix, allDomains]);

  const rows = useMemo(
    () => [...matrix].sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1)),
    [matrix],
  );

  if (allDomains.length === 0) return <div className="text-sm text-text-muted">No domain data yet.</div>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="sticky left-0 bg-surface px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-text-muted">Model</th>
            {allDomains.map((d) => (
              <th key={d} className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">{titleCase(d)}</th>
            ))}
            <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-accent">Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const parsed = parseRunLabel(m.label);
            return (
              <tr key={m.run_dir} className="border-b border-border-subtle last:border-0 hover:bg-surface-warm">
                <td className="sticky left-0 bg-background px-3 py-2">
                  <button onClick={() => onPick(m.run_dir)} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <ProviderMark vendor={parsed.vendor} size={16} />
                    <span className="font-mono text-xs text-text-primary">{parsed.model || m.label}</span>
                  </button>
                </td>
                {allDomains.map((d) => {
                  const cell = m.per_domain[d];
                  const v = cell?.judge_avg ?? null;
                  const isBest = v != null && v === bestPerDomain[d] && v >= 0;
                  return (
                    <td key={d} className="px-3 py-2 text-center font-mono text-xs">
                      {v == null ? (
                        <span className="text-text-muted/40">—</span>
                      ) : (
                        <span
                          className={isBest ? "rounded px-1.5 py-0.5 font-semibold" : ""}
                          style={isBest ? { background: "var(--color-ok, #2e9e5b)", color: "#fff" } : { color: scoreColor(v * 10) }}
                        >
                          {v.toFixed(1)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center font-mono text-xs font-semibold text-accent">{m.judge_avg?.toFixed(1) ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BenchQuestions({
  vaultPath, questions, allDomains, onChanged,
}: {
  vaultPath: string;
  questions: BenchQuestion[];
  allDomains: string[];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<BenchQuestion | "new" | null>(null);
  const blank: BenchQuestion = { id: "", domain: "", prompt: "", context: "", notes: "", council: false, expected_decision: "", expected_verdict_keywords: [], path: "" };
  const [draft, setDraft] = useState<BenchQuestion>(blank);
  const [saving, setSaving] = useState(false);

  const shown = filter === "all" ? questions : questions.filter((q) => q.domain === filter);

  const openEditor = (q: BenchQuestion | "new") => {
    setEditing(q);
    setDraft(q === "new" ? blank : { ...q });
  };

  async function save() {
    if (!draft.domain.trim() || !draft.prompt.trim()) return;
    setSaving(true);
    try {
      await invoke("benchmark_save_question", {
        vault: vaultPath,
        q: {
          id: draft.id || null,
          domain: draft.domain.trim().toLowerCase(),
          prompt: draft.prompt,
          context: draft.context,
          notes: draft.notes,
          council: draft.council,
          expected_decision: draft.expected_decision,
          expected_verdict_keywords: draft.expected_verdict_keywords,
        },
      });
      setEditing(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  async function remove(q: BenchQuestion) {
    const ok = await tauriConfirm(`Delete benchmark question "${q.id}"?`, { title: "Delete question", kind: "warning" });
    if (!ok) return;
    await invoke("benchmark_delete_question", { path: q.path });
    if (editing !== "new" && editing && editing.id === q.id) setEditing(null);
    onChanged();
  }

  if (editing) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
        <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:text-accent">
          <ChevronLeft className="h-3.5 w-3.5" /> Questions
        </button>
        <h2 className="font-display text-xl font-semibold">{editing === "new" ? "New question" : draft.id}</h2>
        <Field label="Domain">
          <input value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} list="bench-domains" placeholder="wealth" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <datalist id="bench-domains">{allDomains.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Prompt — the question as you'd ask it">
          <textarea value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Context — facts the model needs (numbers, dates)">
          <textarea value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected decision — your real ground-truth answer">
          <input value={draft.expected_decision} onChange={(e) => setDraft({ ...draft, expected_decision: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected keywords — comma-separated, for the mechanical floor">
          <input
            value={draft.expected_verdict_keywords.join(", ")}
            onChange={(e) => setDraft({ ...draft, expected_verdict_keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="liquidity, 6 month floor, diversify"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Notes — what you actually decided, and why">
          <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={draft.council} onChange={(e) => setDraft({ ...draft, council: e.target.checked })} />
          Run via council (multi-model panel) by default
        </label>
        <div className="flex items-center gap-2 pt-2">
          <button onClick={save} disabled={saving || !draft.domain.trim() || !draft.prompt.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
          {editing !== "new" && (
            <button onClick={() => remove(draft)} className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger hover:bg-danger/10">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex items-center gap-3">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
          <option value="all">all domains</option>
          {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => openEditor("new")} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] text-background hover:bg-accent-hover">
          <Plus className="h-3 w-3" /> New question
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          No questions{filter !== "all" ? ` in ${titleCase(filter)}` : ""} yet. Hit <span className="text-accent">New question</span> to add one.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((q) => (
            <button key={q.id} onClick={() => openEditor(q)} className="flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3 text-left last:border-0 hover:bg-surface-warm">
              <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{q.domain}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text-primary">{q.prompt || <span className="text-text-muted">(empty prompt)</span>}</div>
                {q.expected_decision && <div className="mt-0.5 truncate text-[11px] text-ok">→ {q.expected_decision}</div>}
              </div>
              {q.council && <Scale className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      {children}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SETTINGS PANEL — vault, theme, defaults, about

function SettingsPanel({
  appearance,
  vaultPath,
  onChangeVault,
  clis,
  onRefreshClis,
  onBack,
  onStartChatWith,
  bunkerEnabled,
  onBunkerChange,
  onSetupDomains,
}: {
  appearance: ReturnType<typeof useAppearance>;
  vaultPath: string;
  onChangeVault: () => void;
  clis: CliInfo[];
  onRefreshClis: () => Promise<CliInfo[]>;
  onBack?: () => void;
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  bunkerEnabled: boolean;
  onBunkerChange: (on: boolean) => void;
  onSetupDomains?: () => void;
}) {
  type Section = "general" | "models" | "privacy" | "connectors" | "user" | "memory" | "safety" | "council" | "gateway" | "mcp" | "remote" | "vault" | "appearance" | "frameworks" | "skills" | "shortcuts" | "about";
  const [section, setSection] = useState<Section>("general");

  // Grouped settings nav — the flat 19-item list was hard to scan and mixed
  // unrelated concerns (e.g. General vs Defaults overlap). Organized into
  // labeled sections so related settings sit together and the redundancy reads
  // as intentional structure.
  type NavItem = { id: Section; label: string; icon: typeof Folder };
  const navGroups: Array<{ heading: string; items: NavItem[] }> = [
    { heading: "Models & AI", items: [
      { id: "models", label: "Models", icon: Layers },
      { id: "council", label: "Council", icon: Scale },
      { id: "frameworks", label: "Frameworks", icon: Scale },
      { id: "skills", label: "Skills", icon: Sparkles },
    ]},
    { heading: "Privacy & Safety", items: [
      { id: "privacy", label: "Privacy & Connectivity", icon: ShieldCheck },
      { id: "safety", label: "Safety", icon: Shield },
    ]},
    { heading: "Connect", items: [
      { id: "connectors", label: "Connectors", icon: Plug },
      { id: "gateway", label: "Gateway", icon: MessagesSquare },
      { id: "mcp", label: "MCP", icon: Wrench },
      { id: "remote", label: "Remote (WebUI)", icon: Monitor },
    ]},
    { heading: "You & Vault", items: [
      { id: "user", label: "About me", icon: Users },
      { id: "memory", label: "Memory & Context", icon: Brain },
      { id: "vault", label: "Vault", icon: Folder },
    ]},
    { heading: "App", items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "appearance", label: "Appearance", icon: Sparkles },
      { id: "shortcuts", label: "Shortcuts", icon: SettingsIcon },
      { id: "about", label: "About", icon: Github },
    ]},
  ];

  // Live-bridge counter — used to light up the Integrations row in
  // the nav when one or more routers (currently just Telegram) is
  // running. Polled here so the indicator follows you across pages,
  // even when you're not on Integrations.
  const [liveBridges, setLiveBridges] = useState(0);
  useEffect(() => {
    async function poll() {
      let n = 0;
      try {
        const tg = await invoke<{ running: boolean }>("telegram_bridge_status");
        if (tg.running) n++;
      } catch { /* ignore */ }
      setLiveBridges(n);
    }
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => window.clearInterval(id);
  }, []);

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
        <div className="mb-1 px-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
          Settings
        </div>
        {navGroups.map((group) => (
          <div key={group.heading} className="mb-1.5">
            <div className="mb-0.5 mt-2 px-3 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted/70">
              {group.heading}
            </div>
            {group.items.map((it) => {
              const Icon = it.icon;
              const active = section === it.id;
              const showLive = it.id === "gateway" && liveBridges > 0;
              return (
                <button
                  key={it.id}
                  onClick={() => setSection(it.id)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{it.label}</span>
                  {showLive && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-accent"
                      title={`${liveBridges} bridge${liveBridges === 1 ? "" : "s"} live`}
                    >
                      <span className="pulse-soft inline-block h-1 w-1 rounded-full bg-accent" />
                      live{liveBridges > 1 ? ` ${liveBridges}` : ""}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {/* Main pane */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* Full width — settings use the whole pane, left-aligned, to match
            the rest of the app. Long prose inside sections caps itself
            (subtitles use max-w-2xl) so readability stays intact. */}
        <div className="w-full px-8 py-10">
          {section === "general" && <GeneralSection />}
          {section === "privacy" && <PrivacyConnectivitySection enabled={bunkerEnabled} onChange={onBunkerChange} />}
          {section === "models" && <ModelsSection clis={clis} onStartChatWith={onStartChatWith} onActivated={onRefreshClis} />}
          {section === "user" && <UserProfileSection vaultPath={vaultPath} />}
          {section === "memory" && <MemoryContextSection vaultPath={vaultPath} />}
          {section === "council" && <CouncilSettingsSection clis={clis} />}
          {section === "connectors" && (
            <>
              <ConnectorsSection />
              {/* A2: Ingestion folded in — same concept (getting your data into
                  the vault), one section. */}
              <div className="mt-8 border-t border-border-subtle pt-8">
                <IngestionSection />
              </div>
            </>
          )}
          {section === "safety" && <SafetySection />}
          {section === "gateway" && <GatewaySection />}
          {section === "mcp" && <McpSection vaultPath={vaultPath} />}
          {section === "remote" && <RemoteSection />}
          {section === "vault" && <VaultSettings vaultPath={vaultPath} onChange={onChangeVault} onSetupDomains={onSetupDomains} />}
          {section === "appearance" && <AppearanceSection appearance={appearance} />}
          {section === "frameworks" && <FrameworksSection />}
          {section === "skills" && <SkillsSection vaultPath={vaultPath} />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

// Unified "Models" section — the single home for everything model-related. It
// absorbed the old Agents + Providers pages AND the separate Defaults page:
// each provider expands to its models where you can TEST a model and SET IT AS
// THE DEFAULT, all in one place. No reason to set the default anywhere else.
function ModelsSection({
  clis,
  onStartChatWith,
  onActivated,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  onActivated?: () => Promise<CliInfo[]>;
}) {
  const firstAvailable = useMemo(() => clis.find((c) => c.available)?.id ?? "", [clis]);
  const [defaultChatCli, setDefaultChatCli] = useState(() => lsGet(LS.defaultChatCli) || firstAvailable);
  useEffect(() => { if (defaultChatCli) lsSet(LS.defaultChatCli, defaultChatCli); }, [defaultChatCli]);
  useEffect(() => {
    if (!defaultChatCli && firstAvailable) setDefaultChatCli(firstAvailable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAvailable]);
  return (
    <>
      <SettingsHeader
        title="Models"
        subtitle="Every provider Prevail can use. Expand one to test its models and set the default a new chat opens with. Installed CLIs run locally; API providers unlock hosted models with one key."
      />
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
          <Sparkles className="h-3.5 w-3.5 text-accent" /> Installed CLIs
        </div>
        <AgentsSection
          clis={clis}
          onStartChatWith={onStartChatWith}
          defaultChatCli={defaultChatCli}
          onMakeDefault={setDefaultChatCli}
          embedded
        />
      </section>
      <section className="border-t border-border-subtle pt-8">
        <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
          <Layers className="h-3.5 w-3.5 text-accent" /> API providers
        </div>
        <p className="mb-4 text-xs text-text-muted">Bring your own key — no install. OpenRouter is one key for 200+ hosted models.</p>
        <ProvidersSection onActivated={onActivated} embedded />
      </section>
    </>
  );
}

function AgentsSection({
  clis,
  onStartChatWith,
  embedded,
  defaultChatCli,
  onMakeDefault,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  embedded?: boolean;
  defaultChatCli?: string;
  onMakeDefault?: (cliId: string) => void;
}) {
  const detected = clis.filter((c) => c.available);
  const missing = clis.filter((c) => !c.available);
  return (
    <>
      {!embedded && (
        <SettingsHeader
          title="Agents"
          subtitle="CLIs Prevail can route prompts to. Each agent is detected from your machine — Prevail doesn't install or update them."
        />
      )}
      {detected.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
            Detected · {detected.length}
          </div>
          <div className="flex flex-col gap-3">
            {detected.map((c) => (
              <AgentCard
                key={c.id}
                cli={c}
                onStartChat={onStartChatWith}
                isDefault={defaultChatCli === c.id}
                onMakeDefault={onMakeDefault ? () => onMakeDefault(c.id) : undefined}
              />
            ))}
          </div>
        </section>
      )}
      {missing.length > 0 && (
        <section>
          <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
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

// Terminal command that logs each CLI in. Prevail uses the CLIs already on
// the machine and their own credentials — it can't authenticate them — so
// when a verify fails on auth we point the user at the right login command.
const CLI_LOGIN_CMD: Record<string, string> = {
  claude: "claude",
  codex: "codex login",
  antigravity: "agy login",
};

// When a verify error is an auth failure (CLI installed but not signed in),
// return the login command (or "" if the CLI is unknown). Returns null when
// the error isn't auth-related, so the raw message keeps showing.
function authLoginCmd(cliId: string, raw: string): string | null {
  const isAuth = /\b401\b|invalid authentication|failed to authenticate|unauthorized|not (?:logged|signed) in|please (?:run )?.*login/i.test(raw);
  if (!isAuth) return null;
  return CLI_LOGIN_CMD[cliId] ?? "";
}

function AgentCard({
  cli,
  onStartChat,
  isDefault,
  onMakeDefault,
}: {
  cli: CliInfo;
  onStartChat?: (cliId: string, modelId?: string) => void;
  isDefault?: boolean;
  onMakeDefault?: () => void;
}) {
  const brand = VENDOR_BRAND[cli.id] ?? VENDOR_BRAND.other;
  const models = MODELS[cli.id] ?? [];
  const [open, setOpen] = useState(false);
  // The provider's default model (what a new chat uses). Set right here in
  // Models, so there's no separate Defaults page.
  const modelKey = `prevail.model.${cli.id}`;
  const [defaultModel, setDefaultModel] = useState(() => lsGet(modelKey) || models[0]?.id || "");
  useEffect(() => { if (defaultModel) lsSet(modelKey, defaultModel); }, [modelKey, defaultModel]);
  const setAsDefault = (modelId: string) => { setDefaultModel(modelId); onMakeDefault?.(); };
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
    <div className={`rounded-lg border bg-surface transition-colors ${open ? "border-accent-border" : "border-border-subtle"}`}>
      {/* Single-line header — same row dimensions as every other settings list. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <ProviderMark vendor={cli.id} size={30} />
        <button
          onClick={() => cli.available && setOpen((v) => !v)}
          disabled={!cli.available || models.length === 0}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          {cli.available && models.length > 0 && (
            <span className="shrink-0 text-[11px] text-text-muted">{open ? "▾" : "▸"}</span>
          )}
          <span className="shrink-0 font-display text-sm font-semibold tracking-tight">{cli.label}</span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
            cli.available
              ? "border border-accent-border bg-accent-soft text-accent"
              : "border border-border bg-background text-text-muted"
          }`}>
            {cli.available ? "Detected" : "Not installed"}
          </span>
          {isDefault && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-background">
              <Check className="h-2.5 w-2.5" strokeWidth={3} /> Default
            </span>
          )}
          {cli.available && models.length > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-text-muted">{models.filter((m) => status[m.id] === "ok").length}/{models.length} verified</span>
          )}
          <span className="truncate font-mono text-[10px] text-text-muted/70">
            {cli.available ? (cli.version ?? `${cli.bin} in PATH`) : `install ${cli.bin}`} · {brand.name}
          </span>
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
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
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
                <div key={m.id} className={`flex items-start gap-3 rounded-md border px-3 py-2 ${defaultModel === m.id ? "border-accent-border bg-accent-soft" : "border-border-subtle bg-background"}`}>
                  <div className="mt-0.5 w-3 shrink-0 text-center text-[12px] leading-none">
                    <StatusGlyph s={s} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-sm text-text-primary">{m.label}</span>
                      {defaultModel === m.id && <span className="rounded-full bg-accent px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-background">default</span>}
                      {m.blurb && <span className="text-[11px] text-text-muted">{m.blurb}</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-text-muted/80">
                      <code className="text-accent">{m.id}</code>
                      {s === "failed" && err && (() => {
                        const loginCmd = authLoginCmd(cli.id, err);
                        // Not an auth error → show the raw message as before.
                        if (loginCmd === null) return <span className="ml-2 text-warn">· {err}</span>;
                        // Auth error → actionable hint; raw error on hover.
                        return (
                          <span className="ml-2 text-warn" title={err}>
                            · not signed in — run{" "}
                            {loginCmd
                              ? <code className="text-accent">{loginCmd}</code>
                              : "this CLI's login"}{" "}
                            in a terminal, then re-test
                          </span>
                        );
                      })()}
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
                    {defaultModel === m.id ? (
                      <span className="rounded-md border border-accent-border bg-accent-soft px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-accent">default</span>
                    ) : (
                      <button
                        onClick={() => setAsDefault(m.id)}
                        title="Use this model by default for new chats"
                        className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                      >
                        set default
                      </button>
                    )}
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

// Privacy & Connectivity — the Bunker Mode control surface. The toggle + status
// card here reflect the BACKEND policy (bunker.rs), which is the real source of
// truth and enforcer; this screen never decides anything on its own.
function PrivacyConnectivitySection({ enabled, onChange }: { enabled: boolean; onChange: (on: boolean) => void }) {
  type BunkerStatus = { enabled: boolean; network_blocked: boolean; web_blocked: boolean; cloud_blocked: boolean; local_available: boolean };
  const [status, setStatus] = useState<BunkerStatus | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    invoke<BunkerStatus>("bunker_status").then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function setBunker(on: boolean) {
    setBusy(true);
    try {
      const s = await invoke<BunkerStatus>("bunker_set", { enabled: on });
      setStatus(s);
      onChange(!!s.enabled);
    } catch (e) {
      console.error("bunker_set", e);
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  }

  // Turning OFF requires confirmation; turning ON is immediate.
  function onToggle(next: boolean) {
    if (!next) { setConfirmOff(true); return; }
    void setBunker(true);
  }

  const blocked = (active: boolean) =>
    active ? (
      <Check className="h-4 w-4 shrink-0 text-emerald-600" />
    ) : (
      <X className="h-4 w-4 shrink-0 text-amber-600" />
    );

  return (
    <>
      <SettingsHeader
        title="Privacy & Connectivity"
        subtitle="Bunker Mode is a trust guarantee, not a preference: while it is on, nothing leaves this device — local models only, no network, no cloud AI, no web search."
      />

      {/* Master toggle */}
      <div className="rounded-lg border border-border-subtle bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-medium">
              {enabled ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <Cloud className="h-4 w-4 text-amber-600" />}
              Bunker Mode
              <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${enabled ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                {enabled ? "On" : "Off"}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-sm text-text-secondary">
              Data stays on this device. Network access, cloud AI providers, and web search are disabled.
            </p>
          </div>
          <Toggle on={enabled} disabled={busy} onChange={onToggle} label="Bunker Mode" />
        </div>
      </div>

      {/* Status verification card — reflects actual runtime enforcement state */}
      <div className="mt-4 rounded-lg border border-border-subtle bg-surface p-4">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-text-muted">Bunker Mode Status</div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">{blocked(!!status?.network_blocked)}<span>{status?.network_blocked ? "Network blocked" : "Network allowed"}</span></li>
          <li className="flex items-center gap-2">{blocked(!!status?.web_blocked)}<span>{status?.web_blocked ? "Web search blocked" : "Web search allowed"}</span></li>
          <li className="flex items-center gap-2">{blocked(!!status?.cloud_blocked)}<span>{status?.cloud_blocked ? "Cloud models blocked" : "Cloud models allowed"}</span></li>
          <li className="flex items-center gap-2">
            {status?.local_available ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <X className="h-4 w-4 shrink-0 text-text-muted" />}
            <span>Local model provider {status?.local_available ? "available" : "not detected (install Ollama)"}</span>
          </li>
        </ul>
        <div className={`mt-3 text-xs ${enabled ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
          {enabled
            ? "Verified — your data remains on this device. No requests leave your machine while Bunker Mode is active."
            : "Cloud Connected — cloud models, web search, and external services are available and may transmit data."}
        </div>
      </div>

      {/* Leave-Bunker-Mode confirmation */}
      {confirmOff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmOff(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Leave Bunker Mode?</h3>
            <p className="mt-2 text-sm text-text-secondary">Disabling Bunker Mode allows:</p>
            <ul className="mt-2 space-y-1 text-sm text-text-secondary">
              <li>• Cloud AI providers</li>
              <li>• Internet access</li>
              <li>• Web search</li>
              <li>• External services</li>
            </ul>
            <p className="mt-3 text-sm text-text-secondary">Your data may be transmitted to third-party services depending on which features you use.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmOff(false)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-strong">Cancel</button>
              <button onClick={() => void setBunker(false)} disabled={busy} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">Leave Bunker Mode</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── General preferences storage ──────────────────────────────────────
// Read/write small boolean + string prefs to localStorage with sensible
// defaults. Exported helpers used at call sites (textarea, chat chunk
// handlers, etc.) to read live.
const PREF = {
  sendKey: "prevail.pref.sendKey",                  // "enter" | "cmd-enter"
  desktopNotif: "prevail.pref.desktopNotif",        // "1" | "0"
  closeToTray: "prevail.pref.closeToTray",          // "1" | "0" — hide to tray on window close
  soundOnDone: "prevail.pref.soundOnDone",          // "1" | "0"
  autoConvertLongPaste: "prevail.pref.autoConvertLongPaste", // "1" | "0"
  stripSycophancy: "prevail.pref.stripSycophancy",  // "1" | "0"
  alwaysShowContextUsage: "prevail.pref.alwaysShowContextUsage", // "1" | "0"
  dontCollapseToolCalls: "prevail.pref.dontCollapseToolCalls",   // "1" | "0"
  // System — hard caps on CLI runs so a stuck process doesn't hang
  // the UI forever. Read by send() and passed to the Rust spawner.
  llmPromptTimeoutSec: "prevail.pref.llmPromptTimeoutSec",   // integer seconds
  streamStallTimeoutSec: "prevail.pref.streamStallTimeoutSec", // integer seconds — no chunks for this long → kill
  // Budget — a soft monthly USD cap the user sets, plus the running spend
  // estimate. Display-only until the engine exposes a budget status command.
  budgetMonthlyCapUsd: "prevail.pref.budgetMonthlyCapUsd", // decimal USD, "" = no cap
  budgetSpentUsd: "prevail.pref.budgetSpentUsd",           // decimal USD estimate
  // Memory & Context — the self-learning layer. Persistent memory distills the
  // intent ledger into <vault>/<domain>/_memory.md and prepends it to prompts.
  persistentMemory: "prevail.pref.persistentMemory",       // "1" | "0" — master switch
  userProfile: "prevail.pref.userProfile",                 // "1" | "0" — prepend user.md
  memoryBudgetChars: "prevail.pref.memoryBudgetChars",     // integer chars cap on _memory.md
  profileBudgetChars: "prevail.pref.profileBudgetChars",   // integer chars cap on user.md preamble
  memoryProvider: "prevail.pref.memoryProvider",           // cli used to distill (claude/ollama/…)
  distillModel: "prevail.pref.distillModel",               // cheap model id, e.g. claude-haiku-4-5
  contextEngine: "prevail.pref.contextEngine",             // "compressor" (only one wired)
  autoCompression: "prevail.pref.autoCompression",         // "1" | "0" — run the distill daemon
  compressionThreshold: "prevail.pref.compressionThreshold", // 0..1 of budget before distilling
  compressionTarget: "prevail.pref.compressionTarget",     // 0..1 of budget to compress toward
  protectedRecent: "prevail.pref.protectedRecent",         // keep most-recent N ledger records raw
  distillIntervalSec: "prevail.pref.distillIntervalSec",   // daemon tick cadence
  // Safety — guardrails. Most are read by the engine/ingestion; redactSecrets
  // is enforced desktop-side in the intent-ledger capture path.
  approvalMode: "prevail.pref.approvalMode",               // "manual" | "auto"
  approvalTimeoutSec: "prevail.pref.approvalTimeoutSec",   // seconds before an approval prompt times out
  confirmMcpReloads: "prevail.pref.confirmMcpReloads",     // "1" | "0"
  commandAllowlist: "prevail.pref.commandAllowlist",       // comma-separated allowed commands
  redactSecrets: "prevail.pref.redactSecrets",             // "1" | "0" — scrub secrets from saved content
  allowPrivateUrls: "prevail.pref.allowPrivateUrls",       // "1" | "0"
  fileCheckpoints: "prevail.pref.fileCheckpoints",         // "1" | "0" — snapshot before file edits
  // Remote / WebUI — serve the same UI to a browser via the bridge server.
  webuiPort: "prevail.pref.webuiPort",                     // integer port
  webuiUser: "prevail.pref.webuiUser",                     // login username
  webuiPass: "prevail.pref.webuiPass",                     // login password (local only)
};
function getPref(key: string, fallback: string): string {
  const v = lsGet(key);
  return v === "" ? fallback : v;
}
function setPref(key: string, v: string): void { lsSet(key, v); }

function GeneralSection() {
  const [startOnBoot, setStartOnBoot] = useState(false);
  useEffect(() => { autostartIsEnabled().then(setStartOnBoot).catch(() => {}); }, []);
  const [closeToTray, setCloseToTray] = useState(() => getPref(PREF.closeToTray, "0") === "1");
  useEffect(() => { invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => {}); }, [closeToTray]);
  const [sendKey, setSendKeyState] = useState(() => getPref(PREF.sendKey, "enter"));
  const [desktopNotif, setDesktopNotif] = useState(() => getPref(PREF.desktopNotif, "0") === "1");
  const [soundDone, setSoundDone] = useState(() => getPref(PREF.soundOnDone, "0") === "1");
  const [autoConvert, setAutoConvert] = useState(() => getPref(PREF.autoConvertLongPaste, "1") === "1");
  const [stripSyc, setStripSyc] = useState(() => getPref(PREF.stripSycophancy, "0") === "1");
  const [promptTimeout, setPromptTimeout] = useState<string>(() => getPref(PREF.llmPromptTimeoutSec, "300"));
  const [budgetCap, setBudgetCap] = useState<string>(() => getPref(PREF.budgetMonthlyCapUsd, ""));
  // Running spend estimate. Display-only: seeded from localStorage and, if the
  // engine ever exposes a `engine_budget_status` command, refreshed from it.
  const [budgetSpent, setBudgetSpent] = useState<number>(() => {
    const v = parseFloat(getPref(PREF.budgetSpentUsd, "0"));
    return Number.isFinite(v) ? v : 0;
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await invoke<{ spent_usd?: number; cap_usd?: number }>("engine_budget_status");
        if (!alive) return;
        if (typeof s?.spent_usd === "number") setBudgetSpent(s.spent_usd);
        if (typeof s?.cap_usd === "number" && !getPref(PREF.budgetMonthlyCapUsd, "")) {
          setBudgetCap(String(s.cap_usd));
        }
      } catch {
        /* no engine budget command — stays display-only from localStorage */
      }
    })();
    return () => { alive = false; };
  }, []);
  const capNum = parseFloat(budgetCap);
  const hasCap = Number.isFinite(capNum) && capNum > 0;
  const pct = hasCap ? Math.min(100, Math.round((budgetSpent / capNum) * 100)) : 0;
  const meterColor = pct >= 90 ? "var(--color-danger, #d24b4b)" : pct >= 70 ? "var(--color-warn, #c98a2b)" : "var(--color-ok, #2e9e5b)";

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
          title="Start on boot"
          desc="Launch Prevail automatically when you sign in to this Mac."
          control={<Switch on={startOnBoot} onChange={async (v) => { try { if (v) await autostartEnable(); else await autostartDisable(); setStartOnBoot(v); } catch (e) { console.error("autostart", e); } }} />}
        />
        <Row
          title="Close to tray"
          desc="Keep Prevail running in the menu bar when you close the window. Quit from the tray icon or ⌘Q."
          control={<Switch on={closeToTray} onChange={(v) => { setCloseToTray(v); setPref(PREF.closeToTray, v ? "1" : "0"); }} />}
        />
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
        <Row
          title="Monthly budget cap"
          desc="A soft USD cap for model spend. The meter below tracks estimated spend against it. Leave blank for no cap."
          control={
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-text-muted">$</span>
              <input
                type="number"
                min={0}
                step="1"
                value={budgetCap}
                placeholder="0"
                onChange={(e) => { setBudgetCap(e.target.value); setPref(PREF.budgetMonthlyCapUsd, e.target.value); }}
                className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none"
              />
            </div>
          }
        />
      </div>

      {/* Budget meter — display-only spend vs cap. */}
      <div className="mt-6 rounded-lg border border-border bg-surface px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Budget this month</div>
          <div className="font-mono text-xs text-text-secondary">
            ${budgetSpent.toFixed(2)}{hasCap ? ` / $${capNum.toFixed(2)}` : " spent"}
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-strong">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: hasCap ? `${pct}%` : "0%", background: meterColor }}
          />
        </div>
        <div className="mt-1.5 font-mono text-[10px] text-text-muted">
          {hasCap
            ? `${pct}% of cap used${pct >= 90 ? " · approaching limit" : ""}`
            : "Set a cap above to track usage against it."}
        </div>
      </div>
    </>
  );
}

// Build a DistillConfig (snake_case keys for the Rust serde struct) from prefs.
function distillCfgFromPrefs(vaultPath: string) {
  return {
    vault: vaultPath,
    provider: getPref(PREF.memoryProvider, "claude"),
    model: getPref(PREF.distillModel, "claude-haiku-4-5"),
    memory_budget_chars: Number(getPref(PREF.memoryBudgetChars, "4000")) || 4000,
    threshold: Number(getPref(PREF.compressionThreshold, "0.5")) || 0.5,
    target: Number(getPref(PREF.compressionTarget, "0.2")) || 0.2,
    protected_recent: Number(getPref(PREF.protectedRecent, "20")) || 20,
    interval_sec: Number(getPref(PREF.distillIntervalSec, "900")) || 900,
  };
}

function MemoryContextSection({ vaultPath }: { vaultPath: string }) {
  const [persistent, setPersistent] = useState(() => getPref(PREF.persistentMemory, "1") === "1");
  const [profile, setProfile] = useState(() => getPref(PREF.userProfile, "1") === "1");
  const [memBudget, setMemBudget] = useState(() => getPref(PREF.memoryBudgetChars, "4000"));
  const [profBudget, setProfBudget] = useState(() => getPref(PREF.profileBudgetChars, "2000"));
  const [provider, setProvider] = useState(() => getPref(PREF.memoryProvider, "claude"));
  const [model, setModel] = useState(() => getPref(PREF.distillModel, "claude-haiku-4-5"));
  const [autoComp, setAutoComp] = useState(() => getPref(PREF.autoCompression, "1") === "1");
  const [threshold, setThreshold] = useState(() => getPref(PREF.compressionThreshold, "0.5"));
  const [target, setTarget] = useState(() => getPref(PREF.compressionTarget, "0.2"));
  const [protectedRecent, setProtectedRecent] = useState(() => getPref(PREF.protectedRecent, "20"));
  const [interval, setIntervalSec] = useState(() => getPref(PREF.distillIntervalSec, "900"));
  const [status, setStatus] = useState<{ running?: boolean; last_run_ts?: number | null; last_error?: string | null; lines_distilled?: number } | null>(null);
  const [distilling, setDistilling] = useState(false);
  const [distillMsg, setDistillMsg] = useState<string>("");

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const s = await invoke<typeof status>("distill_status"); if (alive) setStatus(s); } catch { /* daemon not started */ }
    };
    poll();
    const id = window.setInterval(poll, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  async function distillNow() {
    setDistilling(true); setDistillMsg("");
    try {
      const lines = await invoke<number>("distill_run_once", { cfg: distillCfgFromPrefs(vaultPath) });
      setDistillMsg(lines > 0 ? `Distilled ${lines} ledger entr${lines === 1 ? "y" : "ies"} into memory.` : "Nothing new to distill yet.");
    } catch (e) {
      setDistillMsg(`Distill failed: ${e}`);
    } finally { setDistilling(false); }
  }

  const Row = ({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
  const Num = ({ value, set, pref, w = "w-20", step }: { value: string; set: (v: string) => void; pref: string; w?: string; step?: string }) => (
    <input type="number" step={step} value={value}
      onChange={(e) => { set(e.target.value); setPref(pref, e.target.value); }}
      className={`${w} rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none`} />
  );

  return (
    <>
      <SettingsHeader
        title="Memory & Context"
        subtitle="Self-learning: every chat is captured as an intent; a background process distills them into a compact long-term memory that's fed back into future chats."
      />
      <div className="rounded-lg border border-border bg-surface px-5">
        <Row title="Persistent memory" desc="Distill the intent ledger into per-domain memory and prepend it to prompts. Master switch."
          control={<Toggle on={persistent} onChange={(v) => { setPersistent(v); setPref(PREF.persistentMemory, v ? "1" : "0"); }} />} />
        <Row title="User profile" desc="Prepend your About-me profile (vault/user.md) to every prompt."
          control={<Toggle on={profile} onChange={(v) => { setProfile(v); setPref(PREF.userProfile, v ? "1" : "0"); }} />} />
        <Row title="Memory budget" desc="Hard cap (characters) on the distilled memory injected into each prompt."
          control={<Num value={memBudget} set={setMemBudget} pref={PREF.memoryBudgetChars} w="w-24" />} />
        <Row title="Profile budget" desc="Hard cap (characters) on the user.md preamble."
          control={<Num value={profBudget} set={setProfBudget} pref={PREF.profileBudgetChars} w="w-24" />} />
        <Row title="Memory provider" desc="Which agent distills the ledger into memory (use a cheap, fast one)."
          control={
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setPref(PREF.memoryProvider, e.target.value); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="ollama">Ollama (local)</option>
            </select>
          } />
        <Row title="Distill model" desc="Model id used for distillation, e.g. claude-haiku-4-5."
          control={
            <input value={model} onChange={(e) => { setModel(e.target.value); setPref(PREF.distillModel, e.target.value); }}
              className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />
          } />
        <Row title="Context engine" desc="Strategy for managing long conversations near the context limit."
          control={
            <select value={getPref(PREF.contextEngine, "compressor")} onChange={(e) => setPref(PREF.contextEngine, e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
              <option value="compressor">Compressor</option>
            </select>
          } />
        <Row title="Auto-compression" desc="Run the background distillation daemon on a timer."
          control={<Toggle on={autoComp} onChange={(v) => { setAutoComp(v); setPref(PREF.autoCompression, v ? "1" : "0"); }} />} />
        <Row title="Compression threshold" desc="Start distilling once new activity reaches this fraction of the memory budget."
          control={<Num value={threshold} set={setThreshold} pref={PREF.compressionThreshold} step="0.1" />} />
        <Row title="Compression target" desc="Compress memory toward this fraction of the budget."
          control={<Num value={target} set={setTarget} pref={PREF.compressionTarget} step="0.1" />} />
        <Row title="Protected recent messages" desc="Never distill the most-recent N ledger entries — keep them raw."
          control={<Num value={protectedRecent} set={setProtectedRecent} pref={PREF.protectedRecent} />} />
        <Row title="Distill interval" desc="How often the background daemon runs a pass."
          control={<div className="flex items-center gap-1.5"><Num value={interval} set={setIntervalSec} pref={PREF.distillIntervalSec} /><span className="font-mono text-xs text-text-muted">s</span></div>} />
      </div>

      {/* Daemon status + manual trigger */}
      <div className="mt-6 rounded-lg border border-border bg-surface px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Distillation</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${status?.running ? "bg-ok" : "bg-text-muted/40"}`} />
            <span className="font-mono text-xs text-text-secondary">{status?.running ? "daemon running" : "idle"}</span>
          </div>
        </div>
        <div className="font-mono text-[11px] text-text-muted">
          {status?.lines_distilled ? `${status.lines_distilled} entries distilled this session` : "no distillation yet this session"}
          {status?.last_error ? ` · last error: ${status.last_error}` : ""}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={distillNow} disabled={distilling}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40">
            {distilling ? "distilling…" : "distill now"}
          </button>
          <button onClick={() => invoke("open_in_finder", { path: vaultPath }).catch(() => {})}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
            open vault
          </button>
          {distillMsg && <span className="text-xs text-text-secondary">{distillMsg}</span>}
        </div>
      </div>
    </>
  );
}

// Shared settings Row used by the Phase 3 sections.
function SettingsRowLite({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

// OpenAI dropped its logo from simple-icons (trademark), so we keep the glyph
// path inline (same one ProviderMark uses for Codex).
const OPENAI_PATH = "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973l-.001.142v5.518a.79.79 0 0 0 .388.677l5.815 3.354-2.02 1.168a.075.075 0 0 1-.071 0l-4.83-2.788a4.504 4.504 0 0 1-1.647-6.098zm16.597 3.855L13.116 8.38 15.131 7.22a.071.071 0 0 1 .07 0l4.83 2.792a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.394-.674zm2.01-3.023l-.142-.085-4.774-2.781a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.659 4.139l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z";

// Direct API providers on the roadmap — shown with real brand marks. `path`+`hex`
// render the company logo on a white tile; `mono` is a fallback for brands with
// no official simple-icon yet.
type DirectProvider = { name: string; path?: string; hex?: string; mono?: string };
// Safe accessor: if a simple-icon resolves undefined (e.g. stale dep cache),
// fall back to the monogram instead of throwing and taking down the page.
const brandIcon = (icon: { path?: string; hex?: string } | undefined, mono: string): Partial<DirectProvider> =>
  icon && icon.path ? { path: icon.path, hex: `#${icon.hex ?? "111111"}` } : { mono };
const DIRECT_PROVIDERS_SOON: DirectProvider[] = [
  { name: "Anthropic", ...brandIcon(siAnthropic, "A") },
  { name: "OpenAI", path: OPENAI_PATH, hex: "#000000" },
  { name: "xAI (Grok)", ...brandIcon(siXRaw, "x") },
  { name: "Google Gemini", ...brandIcon(siGooglegemini, "G") },
  { name: "DeepSeek", ...brandIcon(siDeepseek, "DS") },
  { name: "Qwen / DashScope", ...brandIcon(siQwen, "Q") },
  { name: "MiniMax", ...brandIcon(siMinimax, "M") },
  { name: "Hugging Face", ...brandIcon(siHuggingface, "HF") },
  { name: "GLM / Z.AI", mono: "Z" },
  { name: "Kimi / Moonshot", mono: "K" },
  { name: "OpenCode Zen", mono: "OZ" },
];

// Shared dimensions for every settings list row (providers, connectors,
// gateways, …) so lists look identical across pages: single column, h-8 icon
// tile, gap-3, px-4 py-3, subtle border. Containers wrap these in `space-y-2`.
const SETTINGS_ROW = "flex items-center gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-3 transition-colors";

function DirectProviderMark({ p }: { p: DirectProvider }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-white">
      {p.path ? (
        <svg width={17} height={17} viewBox="0 0 24 24" fill={p.hex ?? "#111"} aria-hidden><path d={p.path} /></svg>
      ) : (
        <span className="font-mono text-[10px] font-semibold text-text-muted">{p.mono}</span>
      )}
    </span>
  );
}
function ProvidersSection({ onActivated, embedded }: { onActivated?: () => Promise<CliInfo[]>; embedded?: boolean }) {
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  // I10: after a key save we re-detect providers and confirm OpenRouter is now
  // selectable, so the user gets real activation feedback instead of silence.
  const [activated, setActivated] = useState<boolean | null>(null);
  useEffect(() => {
    invoke<boolean>("provider_key_exists", { provider: "openrouter" }).then((ok) => setConfigured(!!ok)).catch(() => {});
  }, []);
  async function save() {
    try {
      await invoke("provider_key_set", { provider: "openrouter", key: key.trim() });
      setConfigured(!!key.trim());
      setKey("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
      // Re-detect so OpenRouter immediately shows as available in every picker,
      // and report back whether activation took.
      if (onActivated) {
        const list = await onActivated();
        const ok = list.some((c) => c.id === "openrouter" && c.available);
        setActivated(ok);
        window.setTimeout(() => setActivated(null), 6000);
      }
    } catch (e) { console.error("provider_key_set", e); }
  }
  async function remove() {
    try {
      await invoke("provider_key_del", { provider: "openrouter" });
      setConfigured(false);
      setActivated(null);
      if (onActivated) await onActivated();
    } catch (e) { console.error(e); }
  }
  return (
    <>
      {!embedded && <SettingsHeader title="Providers" subtitle="Bring your own models. OpenRouter is one key for 200+ models (Claude, GPT, Gemini, Grok, DeepSeek, Qwen…). Direct providers are coming next." />}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-semibold text-text-primary">OpenRouter</span>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">Recommended</span>
          {configured && <span className="ml-auto rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary">Configured</span>}
        </div>
        <div className="mb-3 text-xs text-text-secondary">One API key unlocks every model. Used by the engine inside any domain. <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-accent hover:underline">Get a key ›</a></div>
        <div className="flex items-center gap-2">
          <input type="password" value={key} placeholder={configured ? "•••••••• (replace)" : "sk-or-v1-…"} onChange={(e) => setKey(e.target.value)}
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm focus:border-accent-border focus:outline-none" />
          <button onClick={save} disabled={!key.trim()} className="rounded-md bg-text-primary px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">{saved ? "Saved" : "Save"}</button>
          {configured && <button onClick={remove} className="rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-warn hover:bg-warn/20">Remove</button>}
        </div>
        {activated === true && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-accent-border bg-accent-soft px-3 py-2 text-xs text-accent">
            <Check className="h-4 w-4" />
            OpenRouter activated — now selectable in every model picker (Chat &amp; Council).
          </div>
        )}
        {activated === false && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <AlertTriangle className="h-4 w-4" />
            Key saved, but OpenRouter didn&apos;t come online. Double-check the key at openrouter.ai/keys.
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Direct providers</div>
        {/* Shared list-row spec (see SETTINGS_ROW): single column, comfortable. */}
        <div className="space-y-2">
          {DIRECT_PROVIDERS_SOON.map((p) => (
            <div key={p.name} className={SETTINGS_ROW}>
              <DirectProviderMark p={p} />
              <span className="flex-1 text-sm text-text-secondary">{p.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Coming soon</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// Connectors — data sources that auto-build per-domain context, routed through
// a connector hub (Composio). Real brand marks (simple-icons) where available,
// else a tinted lucide fallback. Placeholders for now; live wiring next.
type Connector = { name: string; domain: string; brand?: Brand; icon?: LucideIcon; color?: string };
const CONNECTOR_GROUPS: { category: string; items: Connector[] }[] = [
  { category: "Finance", items: [
    { name: "Plaid (banks & cards)", domain: "wealth", icon: Landmark, color: "#111111" },
    { name: "Coinbase", domain: "wealth", brand: siCoinbase as Brand },
    { name: "Robinhood", domain: "wealth", brand: siRobinhood as Brand },
    { name: "Wise", domain: "wealth", brand: siWise as Brand },
    { name: "QuickBooks", domain: "business", brand: siQuickbooks as Brand },
    { name: "Stripe", domain: "business", brand: siStripe as Brand },
    { name: "Shopify", domain: "business", brand: siShopify as Brand },
  ]},
  { category: "Email & Calendar", items: [
    { name: "Gmail", domain: "general", brand: siGmail as Brand },
    { name: "Outlook / IMAP", domain: "general", icon: Mail, color: "#0A66C2" },
    { name: "Google Calendar", domain: "calendar", brand: siGooglecalendar as Brand },
    { name: "Calendly", domain: "calendar", brand: siCalendly as Brand },
  ]},
  { category: "Files & Notes", items: [
    { name: "Google Drive", domain: "general", brand: siGoogledrive as Brand },
    { name: "Google Sheets", domain: "general", brand: siGooglesheets as Brand },
    { name: "Dropbox", domain: "general", brand: siDropbox as Brand },
    { name: "Notion", domain: "general", brand: siNotion as Brand },
    { name: "Obsidian", domain: "general", brand: siObsidian as Brand },
  ]},
  { category: "Productivity", items: [
    { name: "Slack", domain: "general", icon: MessageSquare, color: "#4A154B" },
    { name: "Linear", domain: "career", brand: siLinear as Brand },
    { name: "Trello", domain: "general", brand: siTrello as Brand },
    { name: "Asana", domain: "general", brand: siAsana as Brand },
    { name: "Todoist", domain: "general", brand: siTodoist as Brand },
    { name: "Airtable", domain: "general", brand: siAirtable as Brand },
    { name: "Zoom", domain: "general", brand: siZoom as Brand },
    { name: "HubSpot", domain: "business", brand: siHubspot as Brand },
  ]},
  { category: "Developer", items: [
    { name: "GitHub", domain: "career", brand: siGithub as Brand },
    { name: "GitLab", domain: "career", brand: siGitlab as Brand },
  ]},
  { category: "Health & Fitness", items: [
    { name: "Apple Health", domain: "health", icon: Heart, color: "#FF2D55" },
    { name: "Strava", domain: "health", brand: siStrava as Brand },
    { name: "Fitbit", domain: "health", brand: siFitbit as Brand },
  ]},
  { category: "Social & Media", items: [
    { name: "Reddit", domain: "explore", brand: siReddit as Brand },
    { name: "YouTube", domain: "content", brand: siYoutube as Brand },
    { name: "Spotify", domain: "explore", brand: siSpotify as Brand },
    { name: "Discord", domain: "general", brand: siDiscord as Brand },
    { name: "WhatsApp", domain: "general", brand: siWhatsapp as Brand },
    { name: "Telegram", domain: "general", brand: siTelegram as Brand },
  ]},
];

function ConnectorIcon({ c }: { c: Connector }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-white">
      {c.brand ? (
        <svg width={16} height={16} viewBox="0 0 24 24" fill={`#${c.brand.hex}`} aria-hidden>
          <path d={c.brand.path} />
        </svg>
      ) : c.icon ? (
        <c.icon className="h-[16px] w-[16px]" style={{ color: c.color }} />
      ) : null}
    </span>
  );
}

function ConnectorsSection() {
  const total = CONNECTOR_GROUPS.reduce((n, g) => n + g.items.length, 0);
  return (
    <>
      <SettingsHeader
        title="Connectors"
        subtitle="Connect your data sources so Prevail auto-syncs and builds full context per domain — bank statements into Wealth, email where it belongs, and more."
      />
      {/* Connector hub */}
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
          <Plug className="h-5 w-5 text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">Composio connector hub</span>
            <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Coming soon</span>
          </div>
          <div className="mt-1 text-xs text-text-secondary">Authenticate once to Composio and switch on any connector below. Pulled data lands in the matching domain's vault and feeds the intent ledger + memory. {total} integrations planned.</div>
        </div>
      </div>
      {/* U1: cleaner grid — category counts, even 2/3-col tiles, and no
          per-card "Soon" badge (the hub banner already says coming soon, so a
          badge on every tile was just noise). Domain routing stays as the
          subtle caption. */}
      {CONNECTOR_GROUPS.map((g) => (
        <div key={g.category} className="mb-5">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">{g.category}</span>
            <span className="font-mono text-[10px] text-text-muted/60">{g.items.length}</span>
          </div>
          {/* Shared list-row spec; domain inline (one line). */}
          <div className="space-y-2">
            {g.items.map((c) => (
              <div key={c.name} className={`group ${SETTINGS_ROW} hover:border-accent-border hover:bg-surface-warm`}>
                <ConnectorIcon c={c} />
                <span className="flex-1 truncate text-sm font-medium text-text-primary">{c.name}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">→ {titleCase(c.domain)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function SafetySection() {
  const [approvalMode, setApprovalMode] = useState(() => getPref(PREF.approvalMode, "manual"));
  const [approvalTimeout, setApprovalTimeout] = useState(() => getPref(PREF.approvalTimeoutSec, "60"));
  const [confirmMcp, setConfirmMcp] = useState(() => getPref(PREF.confirmMcpReloads, "1") === "1");
  const [allowlist, setAllowlist] = useState(() => getPref(PREF.commandAllowlist, ""));
  const [redact, setRedact] = useState(() => getPref(PREF.redactSecrets, "0") === "1");
  const [allowPrivate, setAllowPrivate] = useState(() => getPref(PREF.allowPrivateUrls, "0") === "1");
  const [checkpoints, setCheckpoints] = useState(() => getPref(PREF.fileCheckpoints, "0") === "1");
  return (
    <>
      <SettingsHeader title="Safety" subtitle="Guardrails for what the agent can do and what gets stored. Redact secrets is enforced here; approval, allowlist, and checkpoints are honored by the engine." />
      <div className="rounded-lg border border-border bg-surface px-5">
        <SettingsRowLite title="Approval mode" desc="How commands that need explicit approval are handled."
          control={
            <select value={approvalMode} onChange={(e) => { setApprovalMode(e.target.value); setPref(PREF.approvalMode, e.target.value); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
              <option value="manual">Manual</option>
              <option value="auto">Auto</option>
            </select>
          } />
        <SettingsRowLite title="Approval timeout" desc="How long an approval prompt waits before timing out."
          control={<div className="flex items-center gap-1.5"><input type="number" value={approvalTimeout} onChange={(e) => { setApprovalTimeout(e.target.value); setPref(PREF.approvalTimeoutSec, e.target.value); }} className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" /><span className="font-mono text-xs text-text-muted">s</span></div>} />
        <SettingsRowLite title="Confirm MCP reloads" desc="Ask before reloading MCP servers."
          control={<Toggle on={confirmMcp} onChange={(v) => { setConfirmMcp(v); setPref(PREF.confirmMcpReloads, v ? "1" : "0"); }} />} />
        <SettingsRowLite title="Command allowlist" desc="Comma-separated commands the agent may run without prompting."
          control={<input value={allowlist} placeholder="git, ls, cat" onChange={(e) => { setAllowlist(e.target.value); setPref(PREF.commandAllowlist, e.target.value); }} className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
        <SettingsRowLite title="Redact secrets" desc="Scrub API keys, tokens, and passwords from saved chat transcripts and the intent ledger."
          control={<Toggle on={redact} onChange={(v) => { setRedact(v); setPref(PREF.redactSecrets, v ? "1" : "0"); }} />} />
        <SettingsRowLite title="Allow private URLs" desc="Let the agent fetch localhost / private-network URLs."
          control={<Toggle on={allowPrivate} onChange={(v) => { setAllowPrivate(v); setPref(PREF.allowPrivateUrls, v ? "1" : "0"); }} />} />
        <SettingsRowLite title="File checkpoints" desc="Snapshot files before the agent edits them so changes can be rolled back."
          control={<Toggle on={checkpoints} onChange={(v) => { setCheckpoints(v); setPref(PREF.fileCheckpoints, v ? "1" : "0"); }} />} />
      </div>
    </>
  );
}

// WhatsApp is rendered as its own (fuller) card below, so it's excluded here.
const COMING_SOON_GATEWAYS = ["Discord", "Slack", "Signal", "Matrix", "Mattermost", "Email (IMAP/SMTP)", "SMS (Twilio)"];

// U2: Gateway is the single, self-contained section (owns its header) — folds in
// the former "Integrations" bridge cards (A1) without the earlier double header /
// double Telegram-card bug. Live bridges first, then coming-soon, evenly gridded.
function GatewaySection() {
  return (
    <>
      <SettingsHeader title="Gateway" subtitle="Chat with your council from anywhere. Your vault stays local — these bridges relay messages to your domains and back." />

      {/* Live + in-progress bridges — each card carries its own brand mark/color. */}
      <div className="mb-6 grid grid-cols-1 gap-4">
        <TelegramCard />
        <WhatsAppCard />
      </div>

      {/* Planned surfaces — shared list-row spec. */}
      <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">More surfaces</div>
      <div className="space-y-2">
        {COMING_SOON_GATEWAYS.map((name) => (
          <div key={name} className={SETTINGS_ROW}>
            <span className="flex-1 text-sm text-text-secondary">{name}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Coming soon</span>
          </div>
        ))}
      </div>
    </>
  );
}

function RemoteSection() {
  const [running, setRunning] = useState(false);
  const [port, setPort] = useState(() => getPref(PREF.webuiPort, "8787"));
  const [user, setUser] = useState(() => getPref(PREF.webuiUser, "admin"));
  const [pass, setPass] = useState(() => {
    let p = getPref(PREF.webuiPass, "");
    if (!p) { p = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); setPref(PREF.webuiPass, p); }
    return p;
  });
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    invoke<{ running: boolean }>("webui_status").then((s) => setRunning(!!s.running)).catch(() => {});
  }, []);
  async function toggle(on: boolean) {
    setErr("");
    try {
      if (on) {
        await invoke("webui_start", { port: Number(port) || 8787, user, pass });
        setRunning(true);
      } else {
        await invoke("webui_stop");
        setRunning(false);
      }
    } catch (e) { setErr(String(e)); }
  }
  return (
    <>
      <SettingsHeader title="Remote (WebUI)" subtitle="Serve this exact app to a browser — same UI, no rebuild. Then reach it from your phone or laptop, anywhere, via Tailscale or Cloudflare." />
      <div className="rounded-lg border border-border bg-surface px-5">
        <SettingsRowLite title="Enable WebUI" desc="Run the bridge server so a browser can use Prevail. This Mac must stay on."
          control={<Toggle on={running} onChange={toggle} />} />
        <SettingsRowLite title="Port" desc="Local port the WebUI listens on."
          control={<input type="number" value={port} disabled={running} onChange={(e) => { setPort(e.target.value); setPref(PREF.webuiPort, e.target.value); }} className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />} />
        <SettingsRowLite title="Username" desc="Login for the WebUI."
          control={<input value={user} disabled={running} onChange={(e) => { setUser(e.target.value); setPref(PREF.webuiUser, e.target.value); }} className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />} />
        <SettingsRowLite title="Password" desc="Keep this private — anyone with it and the URL can use your agent."
          control={
            <div className="flex items-center gap-2">
              <input type={showPass ? "text" : "password"} value={pass} disabled={running} onChange={(e) => { setPass(e.target.value); setPref(PREF.webuiPass, e.target.value); }} className="w-40 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />
              <button onClick={() => setShowPass((v) => !v)} className="font-mono text-[11px] text-text-muted hover:text-accent">{showPass ? "hide" : "show"}</button>
            </div>
          } />
      </div>
      {running && (
        <div className="mt-4 rounded-lg border border-accent-border bg-accent-soft px-5 py-4">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Live</div>
          <div className="text-sm text-text-primary">Open <a href={`http://localhost:${port}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">http://localhost:{port}</a> in a browser, or from another device use this Mac's Tailscale/LAN address on port {port}.</div>
        </div>
      )}
      {err && <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}
    </>
  );
}

// The MCP "expose" config is pasted into Claude Desktop and used long-term, so
// it must reference a STABLE absolute path — not the transient location the app
// happens to be running from. When launched straight off the mounted DMG
// (/Volumes/…) or under macOS App Translocation (/private/var/folders/…), the
// bundled-sidecar path would vanish the moment the volume ejects. Normalize
// those to the canonical installed location. (feedback v0.4.1 B9)
function mcpCommandPath(enginePath: string): { command: string; unstable: boolean } {
  const p = (enginePath || "").trim();
  const unstable =
    p === "" ||
    p.includes("/Volumes/") ||
    p.includes("AppTranslocation") ||
    p.includes("/private/var/folders/");
  if (unstable) return { command: "/Applications/Prevail.app/Contents/MacOS/prevail", unstable: true };
  return { command: p, unstable: false };
}

function McpSection({ vaultPath }: { vaultPath: string }) {
  const [enginePath, setEnginePath] = useState<string>("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    invoke<{ engine_bin?: string }>("app_diagnostics").then((d) => setEnginePath(d.engine_bin ?? "prevail")).catch(() => setEnginePath("prevail"));
  }, []);
  const { command: mcpCommand, unstable: mcpPathUnstable } = mcpCommandPath(enginePath);
  const snippet = JSON.stringify({ mcpServers: { prevail: { command: mcpCommand, args: ["mcp", "--vault", vaultPath] } } }, null, 2);
  return (
    <>
      <SettingsHeader title="MCP" subtitle="Connect Model Context Protocol servers to Prevail, and expose Prevail as an MCP server to other tools." />
      <div className="mb-5">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Connected servers (Prevail consumes)</div>
        <McpCard />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Expose Prevail as an MCP server</div>
        <div className="mb-3 text-xs text-text-secondary">Add this to another tool's MCP config (e.g. Claude Desktop) to let it use your Prevail vault as an MCP server.</div>
        {mcpPathUnstable && (
          <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-text-secondary">
            Prevail is running from a temporary location (a mounted disk image or quarantine). Move <span className="font-mono">Prevail.app</span> into your <span className="font-mono">Applications</span> folder so this path stays valid after you eject the installer.
          </div>
        )}
        <pre className="overflow-auto rounded-md border border-border-subtle bg-background p-3 font-mono text-[11px] text-text-secondary">{snippet}</pre>
        <button onClick={() => { navigator.clipboard.writeText(snippet).catch(() => {}); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}
          className="mt-2 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
          {copied ? "Copied" : "Copy config"}
        </button>
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

function VaultSettings({ vaultPath, onChange, onSetupDomains }: { vaultPath: string; onChange: () => void; onSetupDomains?: () => void }) {
  const [backingUp, setBackingUp] = useState(false);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  async function backupVault() {
    setBackingUp(true);
    setBackupNote(null);
    try {
      const res = await invoke<BackupResult>("engine_vault_backup", { vault: vaultPath, domainOpt: null });
      if (res.ok) {
        const nDomains = res.domains?.length ?? 0;
        const files = res.file_count ?? 0;
        setBackupNote(
          `Backed up ${nDomains} domain${nDomains === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"} · ${bytesHuman(res.bytes ?? 0)}${res.archive_path ? ` → ${res.archive_path}` : ""}`,
        );
      } else {
        setBackupNote(`Backup failed: ${res.error ?? "unknown error"}`);
      }
    } catch (e) {
      setBackupNote(`Backup failed: ${String(e)}`);
    } finally {
      setBackingUp(false);
    }
  }
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
      {onSetupDomains && (
        <SettingRow label="Domains" desc="Let Prevail recommend a starter set of life domains, or add more.">
          <button
            onClick={onSetupDomains}
            className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Set up domains
          </button>
        </SettingRow>
      )}
      <div className="mt-1 rounded-lg border border-border bg-surface p-4 font-mono text-xs text-text-primary">
        {vaultPath}
      </div>
      <SettingRow label="Back up vault" desc="Write a compressed archive of the entire vault. Nothing is deleted.">
        <button
          onClick={backupVault}
          disabled={backingUp}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50"
        >
          {backingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {backingUp ? "Backing up…" : "Back up vault"}
        </button>
      </SettingRow>
      {backupNote && (
        <div className="mt-1 break-all rounded-lg border border-border-subtle bg-surface px-3 py-2 font-mono text-[11px] text-text-secondary">
          {backupNote}
        </div>
      )}
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
      <div className="mb-3 flex items-baseline gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
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
            <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
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
  const [diag, setDiag] = useState<string | null>(null);
  const [diagCopied, setDiagCopied] = useState(false);

  async function runDiagnosis() {
    try {
      const d = await invoke<{ desktop_version: string; os: string; arch: string; engine_version?: string; engine_bin: string; engine_bundled: boolean; app_support: string }>("app_diagnostics");
      let clis: CliInfo[] = [];
      try { clis = await invoke<CliInfo[]>("detect_clis"); } catch { /* ignore */ }
      setDiag([
        `Prevail Desktop v${d.desktop_version} (${d.os}/${d.arch})`,
        `Engine: ${d.engine_version ?? "?"} ${d.engine_bundled ? "(bundled sidecar)" : `(${d.engine_bin})`}`,
        `App support: ${d.app_support}`,
        `Agents: ${clis.map((c) => `${c.id}${c.available ? "✓" : "✗"}`).join("  ") || "none detected"}`,
      ].join("\n"));
    } catch (e) { setDiag(`diagnosis failed: ${e}`); }
  }

  async function exportConfig() {
    const cfg: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("prevail.")) cfg[k] = localStorage.getItem(k) ?? "";
    }
    try {
      const path = await save({ defaultPath: "prevail-config.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return;
      await invoke("write_text_file", { path, contents: JSON.stringify(cfg, null, 2) });
    } catch (e) { console.error("exportConfig", e); }
  }

  async function importConfig() {
    try {
      const path = await open({ multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path || typeof path !== "string") return;
      const json = await invoke<string>("read_text_file", { path });
      const cfg = JSON.parse(json) as Record<string, string>;
      for (const [k, v] of Object.entries(cfg)) if (k.startsWith("prevail.")) localStorage.setItem(k, String(v));
      window.location.reload();
    } catch (e) { console.error("importConfig", e); }
  }

  async function resetConfig() {
    const ok = await tauriConfirm("Reset all Prevail preferences to defaults? Your vault, chats, and stored secrets are not affected.", { title: "Reset to defaults", kind: "warning" });
    if (!ok) return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      // Reset prefs + desktop settings, but keep the vault selection.
      if ((k.startsWith("prevail.pref.") || k.startsWith("prevail.desktop.") || k.startsWith("prevail.about.")) && k !== "prevail.desktop.vaultPath") keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  }

  async function uninstall(scope: "app" | "data") {
    const msg = scope === "app"
      ? "Remove Prevail.app from Applications? Your config, chats, and secrets stay so you can reinstall later."
      : "Remove the app, all app data, caches, and stored secrets? Your vault folder is NOT deleted. This cannot be undone.";
    const ok = await tauriConfirm(msg, { title: "Uninstall Prevail", kind: "warning" });
    if (!ok) return;
    try { await invoke("app_uninstall", { scope }); } catch (e) { console.error("uninstall", e); }
  }

  const [installing, setInstalling] = useState(false);
  async function checkForUpdates() {
    setChecking(true);
    setCheckErr(null);
    setLatest(null);
    try {
      // Preferred path: the Tauri updater — checks the signed latest.json feed,
      // downloads + installs in-place, then relaunches. No browser detour.
      const update = await checkUpdate();
      if (update) {
        setLatest(update.version);
        setInstalling(true);
        await update.downloadAndInstall();
        await relaunch();
        return;
      }
      // No update object → already current.
      setLatest(APP_VERSION);
    } catch (_pluginErr) {
      // Updater feed not reachable yet (e.g. first release before latest.json
      // is published) → fall back to the GitHub releases API + open the page.
      try {
        const r = await fetch("https://api.github.com/repos/fru-dev3/prevail-desktop/releases?per_page=10");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const releases = await r.json() as Array<{ tag_name: string; prerelease: boolean; html_url: string }>;
        const eligible = releases.filter((rel) => includePre || !rel.prerelease);
        const top = eligible[0];
        if (!top) throw new Error("no releases found");
        setLatest(top.tag_name);
        try { await invoke("open_in_finder", { path: top.html_url }); } catch {}
      } catch (e) {
        setCheckErr(String(e).slice(0, 200));
      }
    } finally {
      setChecking(false);
      setInstalling(false);
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
          {installing ? "Downloading & installing…" : checking ? "Checking…" : "Check for updates"}
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

      {/* Config — export / import / reset */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Configuration</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportConfig}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Export config…</button>
          <button onClick={importConfig}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Import config…</button>
          <button onClick={resetConfig}
            className="rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-warn hover:bg-warn/20">Reset all to defaults</button>
        </div>
        <div className="mt-2 text-xs text-text-secondary">Backs up / restores all app preferences (not your vault). Reset clears every preference and reloads.</div>
      </div>

      {/* Diagnostics */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Diagnostics</div>
          <div className="flex gap-2">
            <button onClick={runDiagnosis}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Run diagnosis</button>
            <button onClick={() => { if (diag) { navigator.clipboard.writeText(diag).catch(() => {}); setDiagCopied(true); window.setTimeout(() => setDiagCopied(false), 1500); } }}
              disabled={!diag}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">{diagCopied ? "Copied" : "Debug dump"}</button>
          </div>
        </div>
        {diag && <pre className="max-h-48 overflow-auto rounded-md border border-border-subtle bg-background p-3 font-mono text-[11px] text-text-secondary">{diag}</pre>}
      </div>

      {/* Danger zone — uninstall (never touches the vault) */}
      <div className="mt-4 rounded-2xl border border-warn/30 bg-warn/5 p-5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-warn">Danger zone</div>
        <div className="mb-3 text-xs text-text-secondary">Removes the app and its data. Your vault is never deleted.</div>
        <div className="flex flex-col gap-2">
          <button onClick={() => uninstall("app")}
            className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-text-primary hover:border-warn/50">
            <div className="font-medium">Uninstall the app</div>
            <div className="text-xs text-text-secondary">Remove /Applications/Prevail.app. Keeps all config, chats, and secrets.</div>
          </button>
          <button onClick={() => uninstall("data")}
            className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-left text-sm text-warn hover:bg-warn/20">
            <div className="font-medium">Uninstall everything (keep vault)</div>
            <div className="text-xs">Remove the app, all app data, caches, and stored secrets. Your vault folder stays.</div>
          </button>
        </div>
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

// Default council membership — stored as SLOT KEYS (`${cli}::${model}`) so the
// panel can hold specific models, e.g. three different Claude models plus two
// Codex models. The chair is one slot key. Council sessions seed from these.
const COUNCIL_MEMBERS_KEY = "prevail.council.defaultMembers";
const COUNCIL_CHAIR_KEY = "prevail.council.defaultChair";
function councilSlotKey(cliId: string, modelId: string): string { return `${cliId}::${modelId}`; }
function councilModelsFor(cliId: string): ModelPick[] {
  return MODELS[cliId] ?? [{ id: "", label: "Default", blurb: "" } as ModelPick];
}
function readCouncilMembers(): string[] {
  // Only accept slot-key-shaped entries (`cli::model`). Older builds stored bare
  // CLI ids here; those are ignored so the panel re-seeds with real slots.
  try { const a = JSON.parse(lsGet(COUNCIL_MEMBERS_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.includes("::")) : []; } catch { return []; }
}
function readCouncilChair(): string { return lsGet(COUNCIL_CHAIR_KEY) || ""; }

// Council config — its own first-class section. You pick the EXACT models on the
// default panel (per-provider, multiple models allowed) and which one chairs.
function CouncilSettingsSection({ clis }: { clis: CliInfo[] }) {
  const available = useMemo(() => clis.filter((c) => c.available && (!isBunkerOn() || isLocalCli(c.id))), [clis]);
  const [members, setMembers] = useState<Set<string>>(() => new Set(readCouncilMembers()));
  const [chair, setChair] = useState<string>(() => readCouncilChair());
  // Each provider expands/collapses INDEPENDENTLY — a Set of open provider ids,
  // not a single value (opening one never closes another).
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set());
  // Once providers are detected: prune any stale slot keys that no longer map to
  // a real (available provider, model) — that's what made the count drift from
  // the visible badges — then seed a sensible default if the panel is empty.
  useEffect(() => {
    if (available.length === 0) return;
    const valid = new Set<string>();
    for (const c of available) for (const m of councilModelsFor(c.id)) valid.add(councilSlotKey(c.id, m.id));
    setMembers((prev) => {
      const pruned = new Set([...prev].filter((k) => valid.has(k)));
      if (pruned.size > 0) return pruned.size === prev.size ? prev : pruned;
      // Empty after pruning → seed the first model of the first three providers.
      return new Set(available.slice(0, 3).map((c) => councilSlotKey(c.id, councilModelsFor(c.id)[0].id)));
    });
    setExpandedSet((e) => (e.size ? e : new Set([available[0].id])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);
  useEffect(() => { lsSet(COUNCIL_MEMBERS_KEY, JSON.stringify([...members])); }, [members]);
  useEffect(() => {
    lsSet(COUNCIL_CHAIR_KEY, chair);
    const cli = chair.split("::")[0];
    if (cli) lsSet(LS.defaultChairCli, cli); // back-compat
  }, [chair]);
  // Chair must be a current member.
  useEffect(() => {
    if (members.size && !members.has(chair)) setChair([...members][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const toggle = (key: string) => setMembers((m) => { const n = new Set(m); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // Resolve a readable chair label from its slot key.
  const chairLabel = (() => {
    if (!chair) return "—";
    const [cli, model] = chair.split("::");
    const c = clis.find((x) => x.id === cli);
    const m = councilModelsFor(cli).find((x) => x.id === model);
    return `${c?.label ?? cli} · ${m?.label ?? (model || "default")}`;
  })();

  return (
    <>
      <SettingsHeader title="Council" subtitle="Convene several models on one question — each answers independently, then a chair writes the verdict. Pick the exact models on your default panel (you can add several from the same provider)." />
      {/* Compact summary bar — what the panel is right now. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-accent-border bg-accent-soft px-4 py-3 text-sm">
        <span className="font-semibold text-text-primary">{members.size} model{members.size === 1 ? "" : "s"} on the panel</span>
        <span className="inline-flex items-center gap-1 text-text-secondary"><Crown className="h-3.5 w-3.5 text-accent" /> chair: <span className="font-medium text-text-primary">{chairLabel}</span></span>
      </div>
      <div className="space-y-2">
        {available.length === 0 && <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-text-muted">No providers available{isBunkerOn() ? " in Bunker Mode (local only)" : ""}.</div>}
        {available.map((c) => {
          const models = councilModelsFor(c.id);
          const picked = models.filter((m) => members.has(councilSlotKey(c.id, m.id))).length;
          const isExp = expandedSet.has(c.id);
          return (
            <div key={c.id} className={`overflow-hidden rounded-lg border bg-surface transition-colors ${isExp || picked > 0 ? "border-accent-border" : "border-border-subtle"}`}>
              <button onClick={() => setExpandedSet((e) => { const n = new Set(e); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                {isExp ? <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />}
                <ProviderMark vendor={c.id} size={26} />
                <span className="flex-1 font-display text-sm font-semibold text-text-primary">{c.label}</span>
                {picked > 0 && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-background">{picked} on panel</span>}
                <span className="shrink-0 font-mono text-[10px] text-text-muted">{models.length} model{models.length === 1 ? "" : "s"}</span>
              </button>
              {isExp && (
                <div className="space-y-1.5 border-t border-border-subtle bg-background/40 p-3">
                  {models.map((m) => {
                    const key = councilSlotKey(c.id, m.id);
                    const on = members.has(key);
                    const isChair = chair === key;
                    return (
                      <div key={key} className={`flex items-center gap-3 rounded-md border px-3 py-2 ${on ? "border-accent-border bg-accent-soft" : "border-border-subtle bg-surface"}`}>
                        <button onClick={() => toggle(key)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border bg-background"}`}>
                            {on && <Check className="h-3 w-3" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0">
                            <span className="font-mono text-sm text-text-primary">{m.label}</span>
                            {m.blurb && <span className="ml-2 text-[11px] text-text-muted">{m.blurb}</span>}
                          </span>
                        </button>
                        {on && (
                          <button
                            onClick={() => setChair(key)}
                            title={isChair ? "Chairs the council (writes the verdict)" : "Make this model the chair"}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
                              isChair ? "bg-accent text-background" : "border border-border text-text-muted hover:border-accent-border hover:text-accent"
                            }`}
                          >
                            <Crown className="h-3 w-3" /> {isChair ? "Chair" : "Chair"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-text-muted">
        Convene a council from the <span className="text-accent">Council</span> tab in any domain — it starts with this panel. Each model answers in parallel; the <Crown className="inline h-3 w-3" /> chair synthesizes a consensus + disagreements + recommended action. <span className="text-accent">Defaults</span> sets your single-model chat; this sets the panel.
      </p>
    </>
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

interface TgBridgeStatus {
  running: boolean;
  last_update_id: number;
  last_inbound_ts: number | null;
  last_outbound_ts: number | null;
  last_error: string | null;
  inbound_count: number;
  outbound_count: number;
}

function TelegramCard() {
  // Audit #7: the bot token is a secret — it lives in the Keychain, never in
  // localStorage. `token` is a transient input value only; `tokenSaved` reflects
  // whether a token exists in the Keychain. chatId is just an identifier (not a
  // secret), so it stays in localStorage.
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [chatId, setChatId] = useState(lsGet(LS.telegramChatId));
  const [bridgeCli, setBridgeCli] = useState(lsGet("prevail.telegram.cli") || "claude");
  const [bridgeModel, setBridgeModel] = useState(lsGet("prevail.telegram.model"));
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" });
  const [bridge, setBridge] = useState<TgBridgeStatus | null>(null);
  const [feed, setFeed] = useState<Array<{ dir: "in" | "out"; text: string; ts: number }>>([]);

  // On mount: migrate any legacy localStorage token into the Keychain (then wipe
  // it), and reflect whether a token is configured.
  useEffect(() => {
    (async () => {
      try {
        const legacy = lsGet(LS.telegramToken);
        if (legacy && legacy.trim()) {
          await invoke("provider_key_set", { provider: "telegram", key: legacy.trim() });
          lsSet(LS.telegramToken, ""); // wipe the plaintext secret from localStorage
        }
        const ok = await invoke<boolean>("provider_key_exists", { provider: "telegram" });
        setTokenSaved(!!ok);
      } catch { /* keychain unavailable — leave unconfigured */ }
    })();
  }, []);
  useEffect(() => { lsSet(LS.telegramChatId, chatId); }, [chatId]);
  useEffect(() => { lsSet("prevail.telegram.cli", bridgeCli); }, [bridgeCli]);
  useEffect(() => { lsSet("prevail.telegram.model", bridgeModel); }, [bridgeModel]);

  async function refreshStatus() {
    try {
      const s = await invoke<TgBridgeStatus>("telegram_bridge_status");
      setBridge(s);
    } catch { /* ignore */ }
  }
  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 3000);
    let u1: UnlistenFn | null = null;
    let u2: UnlistenFn | null = null;
    (async () => {
      u1 = await listen<{ text: string }>("tg:message_in", (e) => {
        setFeed((cur) => [...cur.slice(-19), { dir: "in", text: e.payload.text, ts: Date.now() }]);
      });
      u2 = await listen<{ text: string }>("tg:message_out", (e) => {
        setFeed((cur) => [...cur.slice(-19), { dir: "out", text: e.payload.text, ts: Date.now() }]);
      });
    })();
    return () => { window.clearInterval(id); if (u1) u1(); if (u2) u2(); };
  }, []);

  async function startBridge() {
    if (!chatId.trim() || (!token.trim() && !tokenSaved)) {
      setStatus({ kind: "err", msg: "fill in token + chat ID first" });
      return;
    }
    try {
      // If a new token was typed, persist it to the Keychain (and clear the
      // input); otherwise the bridge resolves the saved token server-side.
      if (token.trim()) {
        await invoke("provider_key_set", { provider: "telegram", key: token.trim() });
        setTokenSaved(true);
        setToken("");
      }
      await invoke("telegram_bridge_start", {
        cfg: {
          token: "", // bridge reads the secret from the Keychain
          chat_id: chatId.trim(),
          cli: bridgeCli,
          model: bridgeModel || null,
          domain: null,
        },
      });
      await refreshStatus();
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }
  async function stopBridge() {
    try {
      await invoke("telegram_bridge_stop");
      await refreshStatus();
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }

  async function testSend() {
    if (!chatId || (!token.trim() && !tokenSaved)) {
      setStatus({ kind: "err", msg: "fill in token + chat ID first" });
      return;
    }
    // If a fresh token was typed, save it first so Test uses the same secret.
    if (token.trim()) {
      try { await invoke("provider_key_set", { provider: "telegram", key: token.trim() }); setTokenSaved(true); setToken(""); } catch { /* ignore */ }
    }
    setStatus({ kind: "idle", msg: "sending…" });
    try {
      const r = await invoke<{ ok: boolean; description?: string }>("telegram_send", {
        token: "", chatId, text: "◆ Prevail desktop · test message ✓",
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
          <p className="text-xs text-text-muted">
            Two-way chat. Inbound messages from the configured chat are routed to your chosen CLI and the reply pushed back. Test button still works for one-shot pushes.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-text-muted">
            Bot token
            {tokenSaved && <span className="rounded-full bg-accent-soft px-1.5 py-0 font-mono text-[9px] tracking-wider text-accent">in keychain</span>}
          </div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenSaved ? "•••••••• (saved — type to replace)" : "123456:ABC-XYZ…"}
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
            disabled={!chatId || (!token.trim() && !tokenSaved)}
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

        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
              Bidirectional bridge
            </div>
            <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
              bridge?.running
                ? "border border-accent-border bg-accent-soft text-accent"
                : "border border-border bg-surface text-text-muted"
            }`}>
              {bridge?.running ? "running" : "stopped"}
            </span>
          </div>
          <p className="mb-3 text-[11px] text-text-muted">
            Messages you send to the bot from Telegram get routed to the CLI below and the reply is pushed back to the same chat.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Route to CLI</div>
              <select
                value={bridgeCli}
                onChange={(e) => setBridgeCli(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none"
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="antigravity">Antigravity</option>
                <option value="ollama">Ollama</option>
              </select>
            </label>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Model (optional)</div>
              <input
                value={bridgeModel}
                onChange={(e) => setBridgeModel(e.target.value)}
                placeholder={MODELS[bridgeCli]?.[0]?.id ?? "default"}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs focus:border-accent-border focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {!bridge?.running ? (
              <button
                onClick={startBridge}
                disabled={!chatId.trim() || (!token.trim() && !tokenSaved)}
                className="rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
              >
                start bridge
              </button>
            ) : (
              <button
                onClick={stopBridge}
                className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn hover:text-warn"
              >
                stop bridge
              </button>
            )}
            {bridge && (
              <span className="font-mono text-[10px] text-text-muted">
                in: {bridge.inbound_count} · out: {bridge.outbound_count}
                {bridge.last_inbound_ts ? ` · last in ${Math.round((Date.now() / 1000 - bridge.last_inbound_ts))}s ago` : ""}
              </span>
            )}
          </div>
          {bridge?.last_error && (
            <div className="mt-2 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
              {bridge.last_error}
            </div>
          )}
          {feed.length > 0 && (
            <ul className="mt-3 max-h-40 overflow-y-auto rounded border border-border-subtle bg-surface px-2 py-1.5">
              {feed.map((f, i) => (
                <li key={i} className="font-mono text-[10px] leading-relaxed">
                  <span className={f.dir === "in" ? "text-accent" : "text-text-muted"}>
                    {f.dir === "in" ? "▶" : "◀"}
                  </span>{" "}
                  <span className={f.dir === "in" ? "text-text-primary" : "text-text-secondary"}>
                    {f.text.slice(0, 200)}{f.text.length > 200 ? "…" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border-subtle bg-background px-3 py-2">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Routing keywords</div>
          <p className="mt-1 text-xs text-text-secondary">
            Inbound messages are matched against each domain's keywords to pick where they land.
            Set them per-domain under{" "}
            <span className="font-mono text-accent">Domain → Prefs → Channels &amp; routing</span>{" "}
            (saved to <span className="font-mono">manifest.routing.keywords</span>).
          </p>
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
