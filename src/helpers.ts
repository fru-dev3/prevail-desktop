// Pure cross-component helpers extracted from App.tsx.
import { titleCase } from "./format";
import type { EngineApp, DomainToggle } from "./types";
import { DOMAIN_BLURBS, VENDOR_BRAND, DOMAIN_PALETTE, ANSI_RE, LOCAL_CLI_IDS } from "./constants";

export function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatAuditedAt(ms: number | null): string {
  if (!ms) return "never audited";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "unknown";
  }
}

export function splitThinking(raw: string): { thinking: string; answer: string } {
  if (!raw || raw.indexOf("<think") === -1) return { thinking: "", answer: raw };
  let thinking = "";
  const answer = raw.replace(/<think(?:ing)?>([\s\S]*?)(?:<\/think(?:ing)?>|$)/gi, (_m, inner: string) => {
    thinking += inner;
    return "";
  });
  return { thinking: thinking.trim(), answer: answer.trim() };
}

export function appScheduleText(app: EngineApp): string {
  if (!app.refresh?.every) return "Manual. No schedule set.";
  const parts = [`Every ${app.refresh.every}`];
  if (app.refresh.on) parts.push(titleCase(app.refresh.on));
  if (app.refresh.at) parts.push(`at ${app.refresh.at}`);
  return parts.join(" · ");
}

export function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

export function fmtCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export function domainBlurb(name: string): string {
  return DOMAIN_BLURBS[name.toLowerCase()] ?? "A space to track and work on this part of your life.";
}

export function vendorAccent(vendor: string): { accent: string; tint: string } {
  const v = VENDOR_BRAND[vendor] ?? VENDOR_BRAND.other;
  return { accent: v.accent, tint: `${v.accent}14` }; // 14 ≈ 8% alpha
}

export function domainColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DOMAIN_PALETTE[h % DOMAIN_PALETTE.length];
}

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function isLocalCli(id: string): boolean {
  return LOCAL_CLI_IDS.has(id.toLowerCase());
}

export function preferredLocalCli(clis: { id: string; available: boolean }[]): string | null {
  return clis.find((c) => isLocalCli(c.id) && c.available)?.id ?? null;
}

export function looksLikeJudgmentCall(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (t.length < 12) return false;
  // Decision / comparison / tradeoff signals.
  const signals = [
    /\bshould (i|we|my|the)\b/, /\bshould\b.*\?/, /\b(vs|versus)\b/, /\bor (should|to|the|a|just)\b/,
    /\bbetter to\b/, /\bworth (it|the)\b/, /\bpros and cons\b/, /\btrade[- ]?offs?\b/,
    /\b(decide|decision|deciding)\b/, /\bwhich (one|option|is better|should)\b/,
    /\b(do i|should i) (sell|buy|quit|move|invest|replace|hire|fire|switch|leave|take|accept|sign|refinance)\b/,
    /\bhow should i\b/, /\bwhat would you (do|recommend)\b/, /\bis it (worth|smart|wise|a good idea)\b/,
    /\b(now or|wait or|stay or)\b/, /\brisk(s|y)?\b.*\?/,
    // Advice / brainstorm prompts the council is well-suited to (the user's own
    // example: "can you suggest some actions?").
    /\b(suggest|recommend|advise|advice)\b/, /\bwhat should i\b/, /\bhelp me (decide|choose|figure|think|plan)\b/,
    /\bideas? (for|on|about)\b/, /\bwhat (are|would be) (some|the best)\b/, /\bhow (do|should) i (approach|handle|plan)\b/,
  ];
  if (signals.some((re) => re.test(t))) return true;
  // High-stakes life words plus a question mark = likely a real decision.
  const stakes = /\b(mortgage|rsu|vest|salary|comp|promotion|invest|retire|529|hvac|insurance|umbrella|surgery|diagnosis|relocat|tenant|lawsuit|equity|severance)\b/;
  return stakes.test(t) && t.includes("?");
}

export function domainTogglesKey(domain: string | null, t: DomainToggle): string {
  return `prevail.desktop.domain.${domain || "__general__"}.${t}`;
}

// When the Google app is ATTACHED to a chat but the user has NOT explicitly
// picked a Google account in Modes, the domain chat should inherit the app's
// authenticated account so it acts exactly as the app's own chat would. Given
// the accounts the user explicitly picked and the list of CONNECTED accounts,
// return the account label(s) to send as `googleAccount` (comma-joined), or null
// to leave it unset:
//   - an explicit pick always wins (returned verbatim);
//   - otherwise, if Google is attached and at least one account is connected,
//     inherit ONE account: the default profile if it is connected (least
//     surprising, matches the app chat), else the first connected account (the
//     domain-chat fix for a user who only authorized a labeled account);
//   - otherwise null (no app attached / nothing connected -> unchanged behavior).
export function inheritedGoogleAccount(
  picked: string[],
  connected: string[],
  googleAttached: boolean,
): string | null {
  const explicit = picked.filter((s) => typeof s === "string" && s.trim());
  if (explicit.length > 0) return explicit.join(",");
  if (!googleAttached) return null;
  const conn = connected.filter((s) => typeof s === "string" && s.trim());
  if (conn.length === 0) return null;
  return conn.includes("default") ? "default" : conn[0]!;
}
