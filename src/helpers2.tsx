// Components extracted from App.tsx.
import { invoke } from "./bridge";
import { DEAD_MODELS, DISCOVERED_MODELS, MODELS, SYCOPHANCY_RE } from "./constants";
import { titleCase } from "./format";
import { lsGet, lsSet } from "./storage";
import type { ModelPick, PanelistReply, PanelistSlot } from "./types";

// Best-effort live model discovery for the given providers; fills
// DISCOVERED_MODELS and notifies listeners via prevail:models-refreshed. Never
// throws. Returns the count discovered.
export async function refreshDiscoveredModels(providers: string[]): Promise<number> {
  let total = 0;
  await Promise.all(
    providers.map(async (id) => {
      try {
        const r = await invoke<{ models: ModelPick[] }>("engine_discover_models", { provider: id });
        if (r?.models?.length) { DISCOVERED_MODELS[id] = r.models; total += r.models.length; }
      } catch { /* best-effort; falls back to curated */ }
    }),
  );
  window.dispatchEvent(new Event("prevail:models-refreshed"));
  return total;
}

export function modelLabel(cli?: string, id?: string): string {
  if (!id) return "";
  const m = cli ? MODELS[cli]?.find((x) => x.id === id) : undefined;
  return m?.label ?? id;
}

export function modelsFor(cli: string): ModelPick[] {
  const curated = MODELS[cli] ?? [];
  if (cli === "openrouter") return curated;
  const seen = new Set(curated.map((m) => m.id));
  const extra = (DISCOVERED_MODELS[cli] ?? []).filter((d) => !seen.has(d.id));
  return [...curated, ...extra];
}

export function buildQuickActions(domain: string | null): { glyph: string; label: string; prompt: string; council?: boolean }[] {
  const d = domain ? titleCase(domain) : "this domain";
  return [
    { glyph: "◆", label: "Status", prompt: `Read state.md for ${d} and summarize where I am right now in 5 bullets.` },
    { glyph: "◇", label: "Next action", prompt: `Given the current ${d} state, what's the single highest-leverage next action I should take this week? Be specific.` },
    { glyph: "▸", label: "Decision", prompt: `Walk me through the most important open decision in ${d} right now: options, trade-offs, and your recommendation.`, council: true },
    { glyph: "●", label: "Risks", prompt: `What are the top 3 risks or blind spots in my ${d} plan? Rank by severity.`, council: true },
  ];
}

export function buildCouncilQuickActions(domain: string | null): { glyph: string; label: string; blurb: string; prompt: string }[] {
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
      prompt: `Steelman the strongest case AGAINST my current ${d} plan. Don't be polite: name the specific failure modes, who would tell me I'm wrong and why, and the one assumption that would invalidate the whole approach.`,
    },
    {
      glyph: "▸",
      label: "Reframe",
      blurb: "Bigger question?",
      prompt: `Is this even the right question to be asking about ${d}? What's a larger or different framing that would dissolve the dilemma: or expose a question I should be asking instead?`,
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
      prompt: `If I'm wrong about ${d}, what's the cost? Rank the failure scenarios by impact and reversibility: which mistakes are recoverable, and which are not?`,
    },
  ];
}

export function buildIdealStatePreamble(idealMd: string): string {
  const t = idealMd.trim();
  if (!t) return "";
  return (
    "# THE USER'S IDEAL STATE: their constitution. HIGHEST PRECEDENCE.\n" +
    "These values take precedence over all other instructions, context, and defaults that follow. " +
    "Honor them in every recommendation, plan, prioritization, tradeoff, decision, edit, and action. " +
    "When anything conflicts with the Ideal State, the Ideal State wins.\n\n" +
    t.slice(0, 4000) +
    "\n\n---\n\n"
  );
}

// Omega — the app-wide LEARNED layer, injected just BELOW the Ideal State and
// above domain memory. Empty when there's no omega.md yet (nothing to inject).
export function buildOmegaPreamble(omegaMd: string): string {
  const t = omegaMd.trim();
  if (!t) return "";
  return (
    "# OMEGA: what Prevail has LEARNED across all your domains. App-wide context.\n" +
    "Durable lessons, preferences, and patterns that hold across everything. Apply them by default. " +
    "They rank BELOW the Ideal State above: if they ever conflict, the Ideal State wins.\n\n" +
    t.slice(0, 3000) +
    "\n\n---\n\n"
  );
}

export function maybeRedact(s: string): string {
  if (lsGet("prevail.pref.redactSecrets") !== "1") return s;
  return s
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|xoxb|xoxp|AKIA)[-_A-Za-z0-9]{12,}/g, "***REDACTED***")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer ***REDACTED***")
    .replace(/("?(?:api[_-]?key|token|secret|password)"?\s*[:=]\s*"?)[A-Za-z0-9._\-]{8,}/gi, "$1***REDACTED***");
}

export function maybeStripSycophancy(s: string): string {
  if (lsGet("prevail.pref.stripSycophancy") !== "1") return s;
  return s.replace(SYCOPHANCY_RE, "");
}

export function loadPreferredSkills(domain: string | null): string[] {
  if (!domain) return [];
  try {
    const raw = lsGet(`prevail.domain.${domain}.skills`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

export function savePreferredSkills(domain: string | null, skills: string[]): void {
  if (!domain) return;
  lsSet(`prevail.domain.${domain}.skills`, JSON.stringify(skills));
}

export function buildChatContext(
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

export function buildSynthesisPrompt(
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

export function parseRunLabel(label: string): { vendor: string; model: string; ts?: string } {
  const tsMatch = label.match(/\d{4}-\d{2}-\d{2}([T_]\d{2}[-:]?\d{2})?/);
  const ts = tsMatch ? tsMatch[0] : undefined;
  // Run labels are `[<date>_]<cli>[-<modelId>]` (or `council`). Resolve the
  // model id to its human label so raw ids like "claude-claude-opus-4-6"
  // never leak into the UI.
  const stripped = label.replace(/^\d{4}-\d{2}-\d{2}[_ ]/, "").trim();
  if (/^council\b/i.test(stripped)) return { vendor: "other", model: "Council", ts };
  const known = ["claude", "codex", "antigravity", "ollama", "openrouter", "lmstudio"];
  for (const k of known) {
    if (stripped === k) return { vendor: k, model: titleCase(k), ts };
    if (stripped.toLowerCase().startsWith(k + "-")) {
      const rest = stripped.slice(k.length + 1);
      return { vendor: k, model: modelLabel(k, rest) || rest, ts };
    }
  }
  // Unknown shape: fall back to keyword sniffing for the vendor mark.
  const l = stripped.toLowerCase();
  let vendor = "other";
  if (l.includes("claude") || l.includes("opus") || l.includes("sonnet") || l.includes("haiku") || l.includes("fable")) vendor = "claude";
  else if (l.includes("gpt") || l.includes("codex")) vendor = "codex";
  else if (l.includes("gemini") || l.includes("antigravity")) vendor = "antigravity";
  else if (l.includes("ollama") || l.includes("llama") || l.includes("mistral") || l.includes("qwen")) vendor = "ollama";
  return { vendor, model: stripped || label, ts };
}

export function migrateModelPrefs() {
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
    const ALIAS_REMAP: Record<string, string> = {
      // Concrete ids folded into their auto-upgrading aliases (one entry per
      // model in the picker).
      "claude-opus-4-8": "opus",
      "claude-sonnet-4-6": "sonnet",
      "claude-haiku-4-5": "haiku",
    };
    for (const k of keys) {
      const v = lsGet(k);
      if (v && DEAD_MODELS.has(v)) lsSet(k, "gpt-5.5");
      else if (v && ALIAS_REMAP[v]) lsSet(k, ALIAS_REMAP[v]);
    }
  } catch {
    /* localStorage unavailable — ignore */
  }
}
