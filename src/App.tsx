import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders LLM output as proper markdown — headings, lists, bold,
// inline code, fenced blocks, tables. Wraps each block element in
// `prose`-like Tailwind so the spacing reads.
function Markdown({ source }: { source: string }) {
  return (
    <div className="prose prose-sm max-w-none text-text-primary [&_a]:text-accent [&_blockquote]:border-l-2 [&_blockquote]:border-accent-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-text-secondary [&_code]:rounded [&_code]:bg-surface-warm [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-accent [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p]:leading-relaxed [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-warm [&_pre]:p-3 [&_pre]:text-[12px] [&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_pre>code]:text-text-primary [&_strong]:font-semibold [&_strong]:text-text-primary [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border-subtle [&_th]:bg-surface-warm [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border-subtle [&_td]:px-2 [&_td]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}

// Single source of truth for the version chip in title bar.
const APP_VERSION = "0.2.42";

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
    { id: "claude-opus-4-7",   label: "Opus 4.7",       blurb: "current flagship" },
    { id: "claude-opus-4-6",   label: "Opus 4.6",       blurb: "previous flagship" },
    { id: "sonnet",            label: "Sonnet (latest)", blurb: "alias · balanced" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6",     blurb: "balanced workhorse" },
    { id: "haiku",             label: "Haiku (latest)", blurb: "alias · fast + cheap" },
    { id: "claude-haiku-4-5",  label: "Haiku 4.5",      blurb: "fastest, cheapest" },
  ],
  codex: [
    { id: "gpt-5",       label: "GPT-5",        blurb: "flagship" },
    { id: "gpt-5-high",  label: "GPT-5 (high)", blurb: "extra reasoning" },
    { id: "gpt-5-mini",  label: "GPT-5 mini",   blurb: "fast + cheap" },
  ],
  antigravity: [
    { id: "gemini-3-pro-high", label: "Gemini 3 Pro (high)", blurb: "extra reasoning" },
    { id: "gemini-3-pro",      label: "Gemini 3 Pro",        blurb: "flagship" },
    { id: "gemini-3-flash",    label: "Gemini 3 Flash",      blurb: "fast" },
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

function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`tracking-[0.04em] ${className}`}>
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
        />
        {/* legacy single-render below disabled */}
        {false && !sidebarCollapsed && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface" />
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
  const togglePin = (name: string) => {
    setPinned((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      lsSet(PIN_KEY, Array.from(next).join(","));
      return next;
    });
  };
  const sortedDomains = useMemo(() => {
    const isPinned = (d: Domain) => pinned.has(d.name);
    const pin = domains.filter(isPinned);
    const rest = domains.filter((d) => !isPinned(d));
    return [...pin, ...rest];
  }, [domains, pinned]);
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

  const width = collapsed ? "w-14" : "w-60";

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-border-subtle bg-surface transition-[width] duration-150 ${width}`}
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
            <Brand className="font-sans text-2xl font-extrabold tracking-tight text-text-primary" />
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
              <line x1="6" y1="2.5" x2="6" y2="13.5" />
              <path d="M11 5.5 L9 8 L11 10.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" />
            <path d="M9 5.5 L11 8 L9 10.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
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
            // Render a thin "Pinned / All" divider when transitioning.
            const showDivider =
              !collapsed && i > 0 && pinned.has(sortedDomains[i - 1].name) && !isPinned;
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
                {showDivider && (
                  <li className="my-1 px-2.5 text-[9px] font-medium uppercase tracking-[0.18em] text-text-muted">
                    All
                  </li>
                )}
              <li
                className="group flex items-center gap-1"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-prevail-domain", d.name);
                  e.dataTransfer.setData("text/plain", titleCase(d.name));
                  e.dataTransfer.effectAllowed = "copy";
                }}>
                <button
                  onClick={() => {
                    setSelectedDomain(d.name);
                    if (tab === "settings") setTab("chat");
                  }}
                  className={`flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
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
}: {
  domain: string;
  vaultPath: string;
  onInjectContext: (body: string, label: string) => void;
  onPickPrompt: (text: string) => void;
  onInsertSkill: (name: string) => void;
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
  const tabs: { id: Tab; label: string }[] = [
    { id: "chat", label: "Chat" },
    { id: "state", label: "State" },
    { id: "decisions", label: "Decisions" },
    { id: "journal", label: "Journal" },
    { id: "logs", label: "Sessions" },
    { id: "skills", label: "Skills" },
  ];
  const Icon = domainIcon(domain);

  // Suppress unused warning — kept for future read-only views.
  void onInjectContext;
  void Icon;
  // Domain title lives in the ChatPanel header above; here we go
  // straight to the tab strip. Avoids the duplicate "Estate · Estate"
  // problem the user flagged.
  return (
    <div className="flex h-full w-full flex-col px-6 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-border-subtle">
        {tabs.map((t) => {
          const active = tab === t.id;
          const c = t.id === "chat" ? undefined : counts[t.id as Exclude<Tab, "chat">];
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative -mb-px flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                active ? "text-accent" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {t.label}
              {c !== undefined && (
                <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${active ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
                  {c}
                </span>
              )}
              {active && <span className="absolute bottom-0 left-0 right-0 h-px bg-accent" />}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-sm text-text-muted">loading domain context…</div>}
        {!loading && ctx && (
          <div>
            {tab === "chat" && (
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {buildQuickActions(domain).map((q) => (
                  <button
                    key={q.label}
                    onClick={() => onPickPrompt(q.prompt)}
                    className="rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
                  >
                    <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent">
                      <span>{q.glyph}</span> {q.label}
                    </div>
                    <div className="mt-1 line-clamp-3 text-sm text-text-secondary">
                      {q.prompt}
                    </div>
                  </button>
                ))}
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
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ctx.skills.map((s) => (
                    <li key={s.path}>
                      <button
                        onClick={() => { onInsertSkill(s.name); setTab("chat"); }}
                        className="block w-full rounded-lg border border-border bg-surface p-3 text-left hover:border-accent-border hover:bg-surface-warm"
                      >
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-accent" />
                          <span className="font-mono text-sm text-accent">/{s.name}</span>
                        </div>
                        {s.description && <div className="mt-1 line-clamp-2 text-xs text-text-muted">{s.description}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
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
}: {
  domain: string;
  vaultPath: string;
  domainPath: string;
  onClose: () => void;
  onInjectContext: (text: string, label: string) => void;
  onInsertSkill: (skillName: string) => void;
}) {
  const [ctx, setCtx] = useState<DomainContextBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({
    state: true, decisions: false, journal: false, logs: false, skills: false,
  });
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
    <aside className="flex w-80 shrink-0 flex-col border-l border-border-subtle bg-surface">
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
                    <li key={s.path}>
                      <button
                        onClick={() => onInsertSkill(s.name)}
                        className="w-full rounded border border-border-subtle bg-background px-2 py-1.5 text-left hover:border-accent-border hover:bg-surface-warm"
                      >
                        <div className="font-mono text-[11px] text-accent">/{s.name}</div>
                        {s.description && <div className="mt-0.5 line-clamp-2 text-[10px] text-text-muted">{s.description}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            } />
          </>
        )}
      </div>
      <div className="border-t border-border-subtle px-4 py-2 font-mono text-[10px] text-text-muted" title={domainPath}>
        {domainPath.split("/").slice(-3).join("/")}
      </div>
    </aside>
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
}: {
  domain: string | null;
  domainPath: string | null;
  vaultPath: string;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
  onSwitchToCouncil: () => void;
  onOpenInFinder: () => void;
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
  // (cli, model) if one is set. Falls back to the global default.
  useEffect(() => {
    if (!domain) {
      const globalCli = lsGet(LS.defaultChatCli);
      if (globalCli) setSelectedCli(globalCli);
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
  }, [domain]);
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
  // applies again. Exposed for next-turn wiring.
  // @ts-expect-error queued for v0.2.42 UI button
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
  function insertSkillSlash(name: string) {
    setInput((cur) => `${cur}${cur && !cur.endsWith(" ") ? " " : ""}/${name} `);
  }
  // Auto-prime the domain's state.md so the AI has context without
  // the user having to click "use in chat" in the drawer. Labels start
  // with "auto:" so they get cleared when the domain switches.
  useEffect(() => {
    if (!domain || !vaultPath) {
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
  }, [domain, vaultPath]);
  const [attachments, setAttachments] = useState<string[]>([]);
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
    const head = input.slice(0, slashMatch.start);
    const tail = input.slice(slashMatch.end);
    const next = `${head}/${name} ${tail}`;
    setInput(next);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const caret = head.length + name.length + 2;
      ta.focus();
      ta.setSelectionRange(caret, caret);
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
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) {
              return [...m.slice(0, -1), { ...last, content: maybeStripSycophancy(last.content + stripAnsi(e.payload.data)) }];
            }
            return m;
          });
        },
      );
      const u2 = await listen<{ session: string; cli: string; code: number }>(
        "chat:done",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
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
    // Build multi-turn context from prior messages. We pass it as a
    // single text payload because the CLIs spawn fresh each turn and
    // have no shared session. Cap at ~40K characters (~10K tokens) and
    // drop the oldest turns to fit, keeping at least the most recent.
    const history = buildChatContext(messages, 40000);
    const promptText = fwLens.buildPrompt(
      history
        ? `${userPreamble}${attachPreamble}${primedPreamble}You are mid-conversation. Below is the prior turn history; use it as context but do NOT repeat it back to the user.\n\n--- PRIOR TURNS ---\n${history}\n--- END PRIOR TURNS ---\n\nUser's next message: ${visible}`
        : `${userPreamble}${attachPreamble}${primedPreamble}${visible}`
    );
    pushHistory(visible);
    setAttachments([]);
    setInput("");
    sessionRef.current = `s-${Date.now()}`;
    try {
      await invoke("chat_send", {
        args: {
          cli: selectedCli,
          model: lsGet(`prevail.model.${selectedCli}`) || null,
          prompt: promptText,
          session_id: sessionRef.current,
        },
      });
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `(error spawning ${selectedCli}: ${e})`, ts: Date.now() }]);
    }
  }

  const quickActions = useMemo(() => buildQuickActions(domain), [domain]);

  const selectedCliLabel = selectedCli
    ? (clis.find((c) => c.id === selectedCli)?.label ?? selectedCli)
    : "no model";
  const selectedModelLabel = selectedModel
    ? (MODELS[selectedCli ?? ""]?.find((m) => m.id === selectedModel)?.label ?? selectedModel)
    : "";

  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-prevail-domain")) {
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
        const name = e.dataTransfer.getData("application/x-prevail-domain");
        if (!name || !vaultPath) return;
        e.preventDefault();
        try {
          const c = await invoke<DomainContextBundle>("domain_context", { vault: vaultPath, domain: name });
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
      {/* Minimal header — domain + finder + (optional) convene shortcut */}
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
            Context{primedContext.length > 0 ? ` · ${primedContext.length}` : ""}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !domain && (
          <div className="flex h-full flex-col items-center justify-center px-6 py-12">
            <img src="/logo.png" alt="" className="h-16 w-16 rounded-2xl opacity-90" />
            <h2 className="mt-6 font-display text-4xl font-semibold tracking-tight">
              What should we work on?
            </h2>
            <p className="mt-3 max-w-md text-center text-sm text-text-muted">
              Start chatting · pick a domain from the sidebar to ground the conversation in its state and history.
            </p>
            <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 md:grid-cols-2">
              {quickActions.map((q) => (
                <button
                  key={q.label}
                  onClick={() => setInput(q.prompt)}
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
        )}
        {messages.length === 0 && domain && (
          <DomainHome
            domain={domain}
            vaultPath={vaultPath}
            onInjectContext={(body, label) => injectContext(body, label)}
            onPickPrompt={(text) => setInput(text)}
            onInsertSkill={(name) => insertSkillSlash(name)}
          />
        )}
        {messages.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
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
          {/* Detected /skill tokens — show as pills so the user can
              tell which words will be treated as skill refs. */}
          {(() => {
            const detected = Array.from(input.matchAll(/(?:^|\s)(\/[a-zA-Z][a-zA-Z0-9_-]*)/g))
              .map((m) => m[1])
              .filter((tok, i, arr) => arr.indexOf(tok) === i);
            if (detected.length === 0) return null;
            const known = new Set(skillsCache.map((s) => s.name));
            return (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 px-2">
                {detected.map((tok) => {
                  const isKnown = known.has(tok.slice(1));
                  return (
                    <span
                      key={tok}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                        isKnown
                          ? "border-accent-border bg-accent-soft text-accent"
                          : "border-warn/40 bg-warn/10 text-warn"
                      }`}
                      title={isKnown ? "Known skill — will be linked in the reply" : "Unknown skill — typo?"}
                    >
                      <Sparkles className="h-3 w-3" />
                      {tok}
                    </span>
                  );
                })}
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

            <button
              onClick={send}
              disabled={!input.trim() || !selectedCli}
              title="Send (enter)"
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-background shadow-sm transition-all hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
            >
              Send
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
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
        />
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    // Claude/ChatGPT-style: user message sits in the same centered
    // column as the assistant, with a subtle surface tint instead of a
    // loud bubble. Author label above, content below.
    return (
      <div className="mb-8">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-muted">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-strong text-[10px] font-semibold text-text-secondary">
            Y
          </span>
          You
        </div>
        <div className="rounded-2xl border border-border-subtle bg-surface-warm px-4 py-3 text-[15px] leading-relaxed text-text-primary">
          <div className="whitespace-pre-wrap">{renderSkillTokens(msg.content)}</div>
        </div>
      </div>
    );
  }
  // Assistant: no bubble — just the body. Mark + name above, content
  // below in proper markdown. Mirrors how Claude.ai / ChatGPT render
  // their replies.
  const vendor = msg.cli ?? "claude";
  const vendorName =
    vendor === "claude" ? "Claude"
    : vendor === "codex" ? "Codex"
    : vendor === "antigravity" ? "Antigravity"
    : vendor === "ollama" ? "Ollama"
    : vendor;
  return (
    <div className="mb-10">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-muted">
        <ProviderMark vendor={vendor} size={18} />
        <span>{vendorName}</span>
        {msg.streaming && <span className="pulse-soft">· streaming</span>}
      </div>
      <div className="text-[15px] leading-relaxed">
        {msg.content ? (
          <Markdown source={msg.content} />
        ) : (
          <div className="text-text-muted">
            {msg.streaming ? <ThinkingDots /> : "(empty reply)"}
          </div>
        )}
        {msg.streaming && msg.content && <span className="cursor-blink text-accent">▌</span>}
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
}: {
  domain: string | null;
  domainPath: string | null;
  vaultPath: string;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
  onOpenInFinder: () => void;
  onSwitchToChat: () => void;
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
  // @ts-expect-error queued for v0.2.42 verify-error UI
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
          setReplies((r) => {
            const existing = r[slotKey] ?? { cli: e.payload.cli, content: "", streaming: true, startedAt: Date.now() };
            return { ...r, [slotKey]: { ...existing, content: maybeStripSycophancy(existing.content + stripAnsi(e.payload.data)) } };
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

  async function convene() {
    if (!prompt.trim() || panelistSlots.length === 0) return;
    sessionRef.current = `council-${Date.now()}`;
    setReplies({});
    setVerdict("");
    setPhase("panelists");
    const trimmed = prompt.trim();
    setSubmittedPrompt(trimmed);
    const enrichedPrompt = fwLens.buildPrompt(trimmed);
    setPrompt("");
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

  return (
    <div className="flex h-full flex-col">
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

            <div className="mt-6 grid w-full max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {buildCouncilQuickActions(domain).map((q) => (
                <button
                  key={q.label}
                  onClick={() => setPrompt(q.prompt)}
                  className="rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
                >
                  <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent">
                    <span>{q.glyph}</span> {q.label}
                  </div>
                  <div className="mt-1 text-sm text-text-primary">{q.blurb}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-text-muted">
                    {q.prompt}
                  </div>
                </button>
              ))}
            </div>
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

          {/* Panelist pills row */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {panelistSlots.map((s) => (
              <span
                key={s.key}
                title={s.blurb}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-1.5"
              >
                <ProviderMark vendor={s.cli} size={16} />
                <span className="font-mono text-[11px] text-text-primary">{s.modelLabel}</span>
                <button
                  onClick={() => toggleSlot(s.key)}
                  className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-err"
                  title="Remove from panel"
                >
                  ×
                </button>
              </span>
            ))}

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
}: {
  appearance: ReturnType<typeof useAppearance>;
  vaultPath: string;
  onChangeVault: () => void;
  clis: CliInfo[];
  onBack?: () => void;
}) {
  type Section = "general" | "user" | "vault" | "appearance" | "defaults" | "frameworks" | "skills" | "tools" | "about";
  const [section, setSection] = useState<Section>("general");

  const items: Array<{ id: Section; label: string; icon: typeof Folder }> = [
    { id: "general", label: "General", icon: SettingsIcon },
    { id: "user", label: "About me", icon: Users },
    { id: "vault", label: "Vault", icon: Folder },
    { id: "appearance", label: "Appearance", icon: Sparkles },
    { id: "defaults", label: "Defaults", icon: SettingsIcon },
    { id: "frameworks", label: "Frameworks", icon: Scale },
    { id: "skills", label: "Skills", icon: Sparkles },
    { id: "tools", label: "Integrations", icon: Wrench },
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
        <div className="mx-auto max-w-3xl px-8 py-10">
          {section === "general" && <GeneralSection />}
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
          {section === "about" && <AboutSection />}
        </div>
      </div>
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
  const [showCtx, setShowCtx] = useState(() => getPref(PREF.alwaysShowContextUsage, "0") === "1");
  const [dontCollapse, setDontCollapse] = useState(() => getPref(PREF.dontCollapseToolCalls, "0") === "1");

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
    <button
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-strong"}`}
      role="switch"
      aria-checked={on}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
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
          title="Always show context usage"
          desc="Show how much of the conversation context you've used in every turn. By default it's only shown above 70%."
          control={<Switch on={showCtx} onChange={(v) => { setShowCtx(v); setPref(PREF.alwaysShowContextUsage, v ? "1" : "0"); }} />}
        />
        <Row
          title="Don't collapse tool calls"
          desc="Show every tool invocation expanded by default instead of behind a click."
          control={<Switch on={dontCollapse} onChange={(v) => { setDontCollapse(v); setPref(PREF.dontCollapseToolCalls, v ? "1" : "0"); }} />}
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
  return (
    <>
      <SettingsHeader
        title="Frameworks & Lenses"
        subtitle="The bracketed preamble Prevail prepends to every prompt. Framework shapes structure; lens shapes perspective. Pick a default below; per-domain overrides live next to the composer."
      />

      {/* Active selection */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-accent-border bg-accent-soft p-4">
          <div className="font-mono text-xs uppercase tracking-wider text-accent">Active framework</div>
          <div className="mt-1 font-display text-2xl font-semibold">
            {FRAMEWORKS.find((f) => f.id === fwLens.framework)?.label ?? "—"}
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {FRAMEWORKS.find((f) => f.id === fwLens.framework)?.blurb}
          </p>
        </div>
        <div className="rounded-lg border border-accent-border bg-accent-soft p-4">
          <div className="font-mono text-xs uppercase tracking-wider text-accent">Active lens</div>
          <div className="mt-1 font-display text-2xl font-semibold">
            {LENSES.find((l) => l.id === fwLens.lens)?.label ?? "—"}
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {LENSES.find((l) => l.id === fwLens.lens)?.blurb}
          </p>
        </div>
      </div>

      {/* All frameworks */}
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-text-muted">
          <span className="text-accent">◆</span> Frameworks
          <span className="text-text-muted">· {FRAMEWORKS.length}</span>
        </div>
        <div className="space-y-2">
          {FRAMEWORKS.map((f) => {
            const on = fwLens.framework === f.id;
            return (
              <div
                key={f.id}
                className={`rounded-lg border p-4 transition-colors ${
                  on ? "border-accent-border bg-accent-soft" : "border-border bg-surface"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm font-semibold ${on ? "text-accent" : "text-text-primary"}`}>
                        {f.label}
                      </span>
                      <span className="text-xs text-text-muted">{f.blurb}</span>
                    </div>
                    {f.instruction ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                        {f.instruction}
                      </pre>
                    ) : (
                      <p className="mt-2 text-xs italic text-text-muted">no preamble — uses the model's default response shape</p>
                    )}
                  </div>
                  <button
                    onClick={() => fwLens.setFramework(f.id)}
                    disabled={on}
                    className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-xs ${
                      on
                        ? "border-accent-border bg-accent text-background"
                        : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                    }`}
                  >
                    {on ? "active" : "set default"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* All lenses */}
      <div>
        <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-text-muted">
          <span className="text-accent">◇</span> Lenses
          <span className="text-text-muted">· {LENSES.length}</span>
        </div>
        <div className="space-y-2">
          {LENSES.map((l) => {
            const on = fwLens.lens === l.id;
            return (
              <div
                key={l.id}
                className={`rounded-lg border p-4 transition-colors ${
                  on ? "border-accent-border bg-accent-soft" : "border-border bg-surface"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm font-semibold ${on ? "text-accent" : "text-text-primary"}`}>
                        {l.label}
                      </span>
                      <span className="text-xs text-text-muted">{l.blurb}</span>
                    </div>
                    {l.instruction ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded border border-border-subtle bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                        {l.instruction}
                      </pre>
                    ) : (
                      <p className="mt-2 text-xs italic text-text-muted">no preamble — neutral lens</p>
                    )}
                  </div>
                  <button
                    onClick={() => fwLens.setLens(l.id)}
                    disabled={on}
                    className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-xs ${
                      on
                        ? "border-accent-border bg-accent text-background"
                        : "border-border bg-background text-text-secondary hover:bg-surface-warm"
                    }`}
                  >
                    {on ? "active" : "set default"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-6 rounded border border-border-subtle bg-surface px-3 py-2 text-xs text-text-muted">
        Custom frameworks + lenses are queued — for now these are the same set the prevail CLI ships with, sync'd from
        <code className="ml-1 text-accent">src/framework.ts</code> and <code className="text-accent">src/lens.ts</code>.
      </p>
    </>
  );
}

interface SkillEntry {
  domain: string;
  name: string;
  path: string;
  description: string | null;
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

  const byDomain = useMemo(() => {
    const filtered = filter.trim()
      ? skills.filter((s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.domain.toLowerCase().includes(filter.toLowerCase()) ||
          (s.description ?? "").toLowerCase().includes(filter.toLowerCase()))
      : skills;
    const groups = new Map<string, SkillEntry[]>();
    for (const s of filtered) {
      if (!groups.has(s.domain)) groups.set(s.domain, []);
      groups.get(s.domain)!.push(s);
    }
    return Array.from(groups.entries());
  }, [skills, filter]);

  async function openSkill(p: string) {
    try { await invoke("open_in_finder", { path: p }); } catch {}
  }

  return (
    <>
      <SettingsHeader
        title="Skills"
        subtitle="Drop a folder under any domain's skills/ directory to expose it here. The first non-empty line of SKILL.md or README.md becomes the description."
      />
      <div className="mb-4 flex items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter skills…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
        />
        <span className="font-mono text-xs text-text-muted">
          {skills.length} skill{skills.length === 1 ? "" : "s"} · {byDomain.length} domain{byDomain.length === 1 ? "" : "s"}
        </span>
      </div>
      {loading && <div className="text-sm text-text-muted">scanning…</div>}
      {!loading && skills.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-text-muted opacity-50" />
          <p className="mt-3 text-sm text-text-muted">
            No skills found. Try creating <code className="text-accent">{"<domain>/skills/<skill-name>/"}</code> with a SKILL.md.
          </p>
        </div>
      )}
      {!loading && byDomain.length > 0 && (
        <div className="space-y-6">
          {byDomain.map(([domain, items]) => (
            <div key={domain}>
              <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-text-muted">
                <span className="text-accent">◆</span> {titleCase(domain)}
                <span className="text-text-muted">· {items.length}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {items.map((s) => (
                  <button
                    key={s.path}
                    onClick={() => openSkill(s.path)}
                    title={s.path}
                    className="group rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent-border hover:bg-surface-warm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-text-primary">{s.name}</span>
                      <Folder className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 group-hover:text-accent group-hover:opacity-100" />
                    </div>
                    {s.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-text-muted">{s.description}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AboutSection() {
  return (
    <>
      <SettingsHeader title="About" />
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Prevail" className="h-14 w-14 rounded-2xl" />
          <div>
            <div className="font-display text-xl font-semibold"><Brand /></div>
            <div className="mt-0.5 font-mono text-xs text-text-muted">v0.2.4 · Tauri 2 · React 19 · Tailwind 4</div>
          </div>
        </div>
        <div className="mt-6 grid gap-2 text-sm">
          <a href="https://github.com/fru-dev3/prevail-desktop" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            github.com/fru-dev3/prevail-desktop
          </a>
          <a href="https://github.com/fru-dev3/prevail" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            github.com/fru-dev3/prevail  (CLI)
          </a>
          <a href="https://prevail.sh" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            prevail.sh
          </a>
        </div>
        <p className="mt-6 text-xs text-text-muted">
          MIT licensed. Local-first. Your vault stays on this Mac.
        </p>
      </div>
    </>
  );
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
  const fwLens = useFrameworkLens();
  const [defaultChatCli, setDefaultChatCli] = useState(lsGet(LS.defaultChatCli));
  const [defaultChairCli, setDefaultChairCli] = useState(lsGet(LS.defaultChairCli));

  useEffect(() => { lsSet(LS.defaultChatCli, defaultChatCli); }, [defaultChatCli]);
  useEffect(() => { lsSet(LS.defaultChairCli, defaultChairCli); }, [defaultChairCli]);

  return (
    <div className="space-y-6">
      {/* CLI + chair as visual chip pickers */}
      <div className="grid gap-4 md:grid-cols-2">
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
        <div className="grid gap-4 md:grid-cols-2">
          {clis.filter((c) => MODELS[c.id]).map((c) => (
            <ModelPickerCard key={c.id} cli={c} />
          ))}
        </div>
      </div>

      {/* Framework + lens as scrollable chip rows */}
      <div className="grid gap-4 md:grid-cols-2">
        <FrameworkPickerCard
          title="Default framework"
          options={FRAMEWORKS.map((f) => ({ id: f.id, label: f.label, blurb: f.blurb }))}
          value={fwLens.framework}
          onChange={fwLens.setFramework}
        />
        <FrameworkPickerCard
          title="Default lens"
          options={LENSES.map((l) => ({ id: l.id, label: l.label, blurb: l.blurb }))}
          value={fwLens.lens}
          onChange={fwLens.setLens}
        />
      </div>
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
  const all = [{ id: "", label: "First available", available: true } as CliInfo, ...clis];
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
      <p className="mt-0.5 text-xs text-text-muted/80">{hint}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {all.map((c) => {
          const picked = value === c.id;
          const disabled = c.id !== "" && !c.available;
          return (
            <button
              key={c.id || "first"}
              disabled={disabled}
              onClick={() => onChange(c.id)}
              className={`rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                picked
                  ? "border-accent-border bg-accent-soft text-accent"
                  : disabled
                  ? "border-border-subtle bg-surface-strong text-text-muted opacity-50"
                  : "border-border bg-background text-text-secondary hover:bg-surface-warm"
              }`}
            >
              {c.label.toLowerCase()}
              {disabled && <span className="ml-1 opacity-60">·off</span>}
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
              className={`group flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                on
                  ? "border-accent-border bg-accent-soft"
                  : "border-border bg-background hover:bg-surface-warm"
              }`}
            >
              <div className="min-w-0">
                <div className={`font-mono text-sm ${on ? "text-accent" : "text-text-primary"}`}>
                  {m.label}
                </div>
                {m.blurb && (
                  <div className="text-[11px] text-text-muted">{m.blurb}</div>
                )}
              </div>
              {on && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
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

function FrameworkPickerCard({
  title, options, value, onChange,
}: {
  title: string;
  options: { id: string; label: string; blurb: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const cur = options.find((o) => o.id === value);
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wider text-text-muted">{title}</div>
      <div className="mt-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
        {options.map((o) => {
          const on = value === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                on
                  ? "border-accent-border bg-accent-soft text-accent"
                  : "border-border bg-background text-text-secondary hover:bg-surface-warm"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 min-h-[2.5em] text-xs leading-relaxed text-text-muted">
        {cur?.blurb}
      </p>
    </div>
  );
}

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
        <button
          onClick={() => setEnabled((e) => !e)}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            enabled ? "bg-accent" : "bg-surface-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      <p className="mt-3 text-xs text-text-muted">
        For full MCP coverage right now, run the <Brand /> CLI's <code className="text-accent">mcp-server</code> command — it ships read-only by default and is parent-process verified.
      </p>
    </div>
  );
}

// BriefingsCard removed — landing back in v0.3 when wired up.
