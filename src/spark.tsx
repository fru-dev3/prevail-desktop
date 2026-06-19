// Spark - the serendipity surface. A release valve against the bubble: one
// click asks a RANDOMLY CHOSEN model for one genuinely random thing (a quote,
// a concept, a book, a film, a recipe, a "did you know", a skill to learn...).
// Nothing is hardcoded - every spark is generated live, and the model is
// rotated each time so the randomness comes from the models too. If a model
// fails, we fall through to the next available one. If the user likes a spark,
// they can turn it into a task or a routine.
import { useMemo, useState } from "react";
import { Dices, Loader2, ListPlus, Repeat, MessageSquare, AlertTriangle } from "lucide-react";
import { invoke } from "./bridge";
import { MODELS } from "./constants";
import { modelLabel } from "./helpers2";
import { ProviderMark } from "./marks";
import { Markdown } from "./Markdown";
import type { CliInfo } from "./types";

// Providers with no spawnable binary (engine-only) can't serve a one-shot, so
// we leave them out of the rotation.
const ENGINE_ONLY = new Set(["openrouter", "lmstudio", "mlx"]);

interface Candidate { cli: string; model: string; label: string }

interface Spark {
  category: string;
  title: string;
  body: string;
  cli: string;
  model: string;
  modelLabel: string;
}

// Parse the CATEGORY/TITLE/BODY block. Falls back to dumping the raw reply as
// the body so a model that ignores the format still produces something usable.
function parseSpark(raw: string): { category: string; title: string; body: string } {
  const cat = raw.match(/^CATEGORY:\s*(.+)$/im)?.[1]?.trim();
  const title = raw.match(/^TITLE:\s*(.+)$/im)?.[1]?.trim();
  const bodyM = raw.match(/^BODY:\s*([\s\S]+)$/im)?.[1]?.trim();
  if (cat || title || bodyM) {
    return { category: cat || "discovery", title: title || "", body: bodyM || raw.trim() };
  }
  return { category: "discovery", title: "", body: raw.trim() };
}

function buildPrompt(seed: string): string {
  return [
    "You are a serendipity engine. Produce ONE genuinely surprising, delightful thing that could broaden someone's horizons and nudge them out of their usual bubble.",
    "",
    "It can be ANY of (pick the category yourself, at random, and vary it every single time): a quote, a concept or idea, a book, a film, a piece of music, a recipe or a dish, a 'did you know' fact, a skill or practice to learn, a thought experiment, an unusual word, a phenomenon, a small experiment to try.",
    "",
    "Rules:",
    "- Be concrete and self-contained: the reader should get value from the text alone, with no extra lookup.",
    "- Do NOT center it on any specific living person, country, geography, religion, or politics. Keep it universal.",
    "- Avoid the obvious and the cliche. Genuinely surprise me.",
    "- Keep it short: 2 to 5 sentences in the body.",
    "- Do not use em dashes.",
    "",
    `Entropy seed (do not interpret it as meaning anything; use it only to diverge from any previous answer): ${seed}`,
    "",
    "Respond in EXACTLY this format and nothing else:",
    "CATEGORY: <one or two words>",
    "TITLE: <a short title>",
    "BODY: <2 to 5 sentences>",
  ].join("\n");
}

function randSeed(): string {
  // Runtime randomness (this is the app, not a workflow script). Mix two draws
  // plus the clock so repeat calls within a session always diverge.
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function SparkPanel({ vaultPath, clis }: { vaultPath: string; clis: CliInfo[] }) {
  const [spark, setSpark] = useState<Spark | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tried, setTried] = useState<string[]>([]);
  const [saved, setSaved] = useState<"task" | null>(null);

  // Every available (cli, model) pair that can actually run a one-shot.
  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    for (const c of clis) {
      if (c.available === false) continue;
      if (ENGINE_ONLY.has(c.id)) continue;
      const models = MODELS[c.id] ?? [];
      if (models.length === 0) {
        out.push({ cli: c.id, model: "", label: `${c.label} · default` });
      } else {
        for (const m of models) out.push({ cli: c.id, model: m.id, label: `${c.label} · ${m.label}` });
      }
    }
    return out;
  }, [clis]);

  async function generate() {
    if (candidates.length === 0) { setErr("No runnable models available. Connect a runtime first."); return; }
    setBusy(true);
    setErr(null);
    setSaved(null);
    const seed = randSeed();
    const prompt = buildPrompt(seed);
    // Shuffle so the model is genuinely rotated; walk the order until one works.
    const order = shuffle(candidates);
    const attempted: string[] = [];
    for (const cand of order) {
      attempted.push(cand.label);
      try {
        const raw = await invoke<string>("model_oneshot", {
          args: { cli: cand.cli, model: cand.model || null, prompt, timeout_sec: 60 },
        });
        const parsed = parseSpark(raw);
        if (!parsed.body) throw new Error("empty reply");
        setSpark({ ...parsed, cli: cand.cli, model: cand.model, modelLabel: modelLabel(cand.cli, cand.model) || cand.label });
        setTried(attempted);
        setBusy(false);
        return;
      } catch {
        // Try the next model. Keep going so one flaky CLI doesn't block a spark.
      }
    }
    setTried(attempted);
    setErr(`All ${attempted.length} model${attempted.length === 1 ? "" : "s"} failed to produce a spark. Try again.`);
    setBusy(false);
  }

  async function saveAsTask() {
    if (!spark) return;
    const text = spark.title ? `${spark.title}: ${spark.body}` : spark.body;
    try {
      await invoke("tasks_add", { vault: vaultPath, domain: "general", text: `Explore: ${text}`, source: "spark" });
      setSaved("task");
    } catch (e) { setErr(`Could not save task: ${String(e)}`); }
  }

  function discuss(asRoutine: boolean) {
    if (!spark) return;
    const lead = asRoutine
      ? "I'd like to turn this spark into a recurring routine. Help me set one up:"
      : "Let's explore this spark together:";
    const seed = `${lead}\n\n${spark.title ? spark.title + "\n\n" : ""}${spark.body}`;
    window.dispatchEvent(new CustomEvent("prevail:compose-seed", { detail: seed }));
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Dices className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight text-text-primary">Spark</h2>
          <p className="text-[13px] leading-relaxed text-text-secondary">
            A nudge out of the bubble. One click, one genuinely random thing - a quote, a concept, a book, a recipe, a fact - generated live by a randomly chosen model. Like it? Make it a task or a routine.
          </p>
        </div>
      </div>

      <button
        onClick={generate}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
        {busy ? "Conjuring…" : spark ? "Surprise me again" : "Surprise me"}
      </button>

      {err && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-err/30 bg-err/5 px-3 py-2 text-[13px] text-err">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {spark && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-warm/40 px-4 py-2">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">{spark.category}</span>
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-text-muted" title="The model that generated this spark">
              <ProviderMark vendor={spark.cli} size={14} />
              {spark.modelLabel}
            </span>
          </div>
          <div className="px-5 py-4">
            {spark.title && <h3 className="mb-1.5 font-display text-lg font-semibold tracking-tight text-text-primary">{spark.title}</h3>}
            <div className="prose-spark text-[15px] leading-relaxed text-text-primary">
              <Markdown source={spark.body} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-2.5">
            <button
              onClick={saveAsTask}
              disabled={saved === "task"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
            >
              <ListPlus className="h-3.5 w-3.5" /> {saved === "task" ? "Saved to Work" : "Make a task"}
            </button>
            <button
              onClick={() => discuss(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-secondary hover:border-accent-border hover:text-accent"
            >
              <Repeat className="h-3.5 w-3.5" /> Turn into routine
            </button>
            <button
              onClick={() => discuss(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-secondary hover:border-accent-border hover:text-accent"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Explore in chat
            </button>
          </div>
        </div>
      )}

      {!spark && !busy && (
        <p className="mt-6 font-mono text-[11px] text-text-muted">
          {candidates.length} model{candidates.length === 1 ? "" : "s"} in the rotation.
        </p>
      )}
      {tried.length > 1 && spark && (
        <p className="mt-3 font-mono text-[10px] text-text-muted">Rotated through {tried.length} models for this one.</p>
      )}
    </div>
  );
}
