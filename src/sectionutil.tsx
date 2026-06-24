// Pure settings-section helpers extracted from App.tsx: CLI login-command map,
// auth-error detection, section-header / ideal-state icon pickers, the MCP engine
// path resolver, and the skill-avatar color palette + hash picker.
import type { ReactNode } from "react";
import { Activity, Award, Brain, Briefcase, Coins, Compass, Folder, Github, Globe, GraduationCap, Heart, Home, Layers, Lightbulb, MessagesSquare, Monitor, Plug, Scale, Settings as SettingsIcon, Shield, ShieldCheck, Sparkles, Target, Users, Wrench } from "lucide-react";

export const CLI_LOGIN_CMD: Record<string, string> = {
  claude: "claude",
  codex: "codex login",
  antigravity: "agy login",
};

// When a verify error is an auth failure (CLI installed but not signed in),
// return the login command (or "" if the CLI is unknown). Returns null when
// the error isn't auth-related, so the raw message keeps showing.

export function authLoginCmd(cliId: string, raw: string): string | null {
  const isAuth = /\b401\b|invalid authentication|failed to authenticate|unauthorized|not (?:logged|signed) in|please (?:run )?.*login/i.test(raw);
  if (!isAuth) return null;
  return CLI_LOGIN_CMD[cliId] ?? "";
}

export function settingsHeaderIcon(title: string): typeof Folder {
  const t = title.toLowerCase();
  if (/privacy/.test(t)) return ShieldCheck;
  if (/council/.test(t)) return Scale;
  if (/framework|lens/.test(t)) return Scale;
  if (/skill/.test(t)) return Sparkles;
  if (/model|agent|provider/.test(t)) return Layers;
  if (/safety/.test(t)) return Shield;
  if (/gateway/.test(t)) return MessagesSquare;
  if (/remote|webui/.test(t)) return Monitor;
  if (/mcp/.test(t)) return Wrench;
  if (/vault/.test(t)) return Folder;
  if (/memory|context/.test(t)) return Brain;
  if (/about me|user|profile/.test(t)) return Users;
  if (/appearance/.test(t)) return Sparkles;
  if (/shortcut/.test(t)) return SettingsIcon;
  if (/connector|integration|ingest/.test(t)) return Plug;
  if (/about/.test(t)) return Github;
  return SettingsIcon;
}

export function mcpCommandPath(enginePath: string): { command: string; unstable: boolean } {
  const p = (enginePath || "").trim();
  // MCP-2: a dev/source-tree build path (…/src-tauri/target/debug|release/prevail)
  // must NEVER be emitted in a copyable config - it won't exist on an installed
  // user's machine AND it leaks the developer's home path/identity. Treat those
  // (along with translocated / external-volume / temp paths) as "unstable" and
  // emit the canonical installed sidecar path instead.
  const unstable =
    p === "" ||
    p.includes("/Volumes/") ||
    p.includes("AppTranslocation") ||
    p.includes("/private/var/folders/") ||
    p.includes("/target/debug/") ||
    p.includes("/target/release/") ||
    p.includes("/src-tauri/");
  if (unstable) return { command: "/Applications/Prevail.app/Contents/MacOS/prevail", unstable: true };
  return { command: p, unstable: false };
}

export function idealSectionIcon(title: string) {
  const t = title.toLowerCase();
  if (/vision|north|ideal|future|dream/.test(t)) return Compass;
  if (/value|principle|rule|constitution/.test(t)) return Scale;
  if (/wealth|money|finan|invest/.test(t)) return Coins;
  if (/health|body|fitness|energy|sleep/.test(t)) return Activity;
  if (/family|relation|people|friend|marriage/.test(t)) return Users;
  if (/work|career|business|craft|build/.test(t)) return Briefcase;
  if (/learn|grow|educat|skill|read|stud/.test(t)) return GraduationCap;
  if (/home|living|place|environment/.test(t)) return Home;
  if (/faith|spirit|soul|peace|joy/.test(t)) return Heart;
  if (/freedom|travel|world|adventure/.test(t)) return Globe;
  if (/legacy|impact|give|generos|serve/.test(t)) return Award;
  if (/secur|safe|protect|risk/.test(t)) return Shield;
  if (/mind|mental|focus|clarity|think/.test(t)) return Brain;
  if (/time|priorit|goal|target|measure/.test(t)) return Target;
  return Lightbulb;
}

// Deterministic per-skill avatar colors: hash the skill name into one of these.
export const SKILL_AVATAR_PALETTE = [
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

export function pickSkillColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h) + name.charCodeAt(i);
    h |= 0;
  }
  return SKILL_AVATAR_PALETTE[Math.abs(h) % SKILL_AVATAR_PALETTE.length];
}

// The level-1 header at the top of every Settings page: a big icon tile + title
// + optional subtitle, with a hairline rule. Picks an icon from the title when
// one isn't supplied.
export function SettingsHeader({ title, subtitle, icon, right }: { title: string; subtitle?: string; icon?: typeof Folder; right?: ReactNode }) {
  const Icon = icon ?? settingsHeaderIcon(title);
  return (
    <div className="relative mb-4 overflow-hidden border-b border-border-subtle pb-4">
      {/* Purely decorative right-side flourish: a soft gradient wash plus a large
          ghosted copy of the page icon. Adapts per page via the same icon prop.
          Sits behind content, ignores pointer events, and is clipped by the
          parent's overflow-hidden so it never pushes the title/subtitle layout
          or covers any right-aligned controls. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-0 w-1/2 bg-gradient-to-l from-accent-soft/40 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-4 top-1/2 z-0 -translate-y-1/2 text-accent/[0.06]">
        <Icon className="h-28 w-28" strokeWidth={1.25} />
      </div>
      <div className="relative z-10 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent ring-1 ring-accent-border/50">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h2 className="font-display text-[26px] font-bold leading-tight tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">{subtitle}</p>}
        </div>
        {right && <div className="ml-auto hidden shrink-0 items-center self-center sm:flex">{right}</div>}
      </div>
    </div>
  );
}
