// Spark - the serendipity surface. A release valve against the bubble: each
// spark asks a RANDOMLY CHOSEN model for one genuinely random thing (a quote, a
// concept, a book, a film, a recipe, a "did you know", a skill...). Nothing is
// hardcoded - every spark is generated live and the model is rotated, so the
// randomness comes from the models too. The page loads a fresh batch of 5; you
// can ask for 1/2/3/5/10, save the ones you like, dismiss the rest, regenerate.
import { useEffect, useMemo, useState } from "react";
import { Dices, Loader2, ListPlus, Repeat, MessageSquare, AlertTriangle, Bookmark, X } from "lucide-react";
import { invoke } from "./bridge";
import { MODELS } from "./constants";
import { modelLabel } from "./helpers2";
import { usePlayfulWord } from "./hooks";
import { lsGet, lsSet } from "./storage";
import { ProviderMark } from "./marks";
import { Markdown } from "./Markdown";
import { SettingsHeader } from "./sectionutil";
import type { CliInfo } from "./types";

// Providers with no spawnable binary (engine-only) can't serve a one-shot, so
// we leave them out of the rotation.
const ENGINE_ONLY = new Set(["openrouter", "lmstudio", "mlx"]);
const COUNTS = [1, 2, 3, 5, 10] as const;
const SAVED_KEY = "prevail.spark.saved";
const COUNT_KEY = "prevail.spark.count";

interface Candidate { cli: string; model: string; label: string }

interface Spark {
  id: string;
  category: string;
  title: string;
  body: string;
  cli: string;
  model: string;
  modelLabel: string;
}

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

function loadSaved(): Spark[] {
  try { return JSON.parse(lsGet(SAVED_KEY) || "[]"); } catch { return []; }
}

// One spark card - shared by the live batch and the saved list.
function SparkCard({ s, onSave, onDismiss, saved, vaultPath }: {
  s: Spark; onSave?: () => void; onDismiss?: () => void; saved?: boolean; vaultPath: string;
}) {
  const [didTask, setDidTask] = useState(false);
  async function makeTask() {
    const text = s.title ? `${s.title}: ${s.body}` : s.body;
    try { await invoke("tasks_add", { vault: vaultPath, domain: "general", text: `Explore: ${text}`, source: "spark" }); setDidTask(true); } catch { /* ignore */ }
  }
  function discuss(asRoutine: boolean) {
    const lead = asRoutine ? "I'd like to turn this spark into a recurring routine. Help me set one up:" : "Let's explore this spark together:";
    const seed = `${lead}\n\n${s.title ? s.title + "\n\n" : ""}${s.body}`;
    // Persist so the seed survives navigating from Settings to the (then-mounting)
    // chat panel; ChatPanel reads it on mount. App leaves Settings -> Chat on this event.
    try { localStorage.setItem("prevail.compose.pending", seed); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("prevail:compose-seed", { detail: seed }));
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-warm/40 px-4 py-2">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">{s.category}</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-text-muted" title="The model that generated this spark">
          <ProviderMark vendor={s.cli} size={14} /> {s.modelLabel}
        </span>
        {onSave && (
          <button onClick={onSave} title={saved ? "Saved" : "Save this spark"} className={`rounded p-1 ${saved ? "text-accent" : "text-text-muted hover:text-accent"}`}>
            <Bookmark className="h-3.5 w-3.5" fill={saved ? "currentColor" : "none"} />
          </button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} title="Dismiss" className="rounded p-1 text-text-muted hover:text-danger"><X className="h-3.5 w-3.5" /></button>
        )}
      </div>
      <div className="px-5 py-4">
        {s.title && <h3 className="mb-1.5 font-display text-lg font-semibold tracking-tight text-text-primary">{s.title}</h3>}
        <div className="text-[15px] leading-relaxed text-text-primary"><Markdown source={s.body} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-2.5">
        <button onClick={makeTask} disabled={didTask} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
          <ListPlus className="h-3.5 w-3.5" /> {didTask ? "Saved to Work" : "Make a task"}
        </button>
        <button onClick={() => discuss(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-secondary hover:border-accent-border hover:text-accent">
          <Repeat className="h-3.5 w-3.5" /> Turn into routine
        </button>
        <button onClick={() => discuss(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-text-secondary hover:border-accent-border hover:text-accent">
          <MessageSquare className="h-3.5 w-3.5" /> Explore in chat
        </button>
      </div>
    </div>
  );
}

export function SparkPanel({ vaultPath, clis }: { vaultPath: string; clis: CliInfo[] }) {
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState<number>(() => { const n = parseInt(lsGet(COUNT_KEY) || "5", 10); return COUNTS.includes(n as typeof COUNTS[number]) ? n : 5; });
  const [savedSparks, setSavedSparks] = useState<Spark[]>(loadSaved);
  const [showSaved, setShowSaved] = useState(false);
  const word = usePlayfulWord();

  // Every available (cli, model) pair that can actually run a one-shot.
  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    for (const c of clis) {
      if (c.available === false || ENGINE_ONLY.has(c.id)) continue;
      const models = MODELS[c.id] ?? [];
      if (models.length === 0) out.push({ cli: c.id, model: "", label: `${c.label} · default` });
      else for (const m of models) out.push({ cli: c.id, model: m.id, label: `${c.label} · ${m.label}` });
    }
    return out;
  }, [clis]);

  // Generate one spark from a given candidate; null on failure.
  async function generateOne(cand: Candidate): Promise<Spark | null> {
    try {
      const raw = await invoke<string>("model_oneshot", { args: { cli: cand.cli, model: cand.model || null, prompt: buildPrompt(randSeed()), timeout_sec: 60 } });
      const parsed = parseSpark(raw);
      if (!parsed.body) return null;
      const cleanLabel = (modelLabel(cand.cli, cand.model) || cand.label).replace(/\s*\(.*?\)\s*/g, "").trim();
      return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...parsed, cli: cand.cli, model: cand.model, modelLabel: cleanLabel };
    } catch { return null; }
  }

  async function generate(n: number) {
    if (candidates.length === 0) { setErr("No runnable models available. Connect a runtime first."); return; }
    setBusy(true); setErr(null);
    // Rotate models across the batch; cycle the shuffled list if n exceeds it so
    // each spark still picks a (possibly repeated) model, mixing them up.
    const order = shuffle(candidates);
    const picks: Candidate[] = Array.from({ length: n }, (_, i) => order[i % order.length]!);
    const results = await Promise.all(picks.map((c) => generateOne(c)));
    const ok = results.filter((s): s is Spark => s !== null);
    setSparks(ok);
    if (ok.length === 0) setErr(`Couldn't conjure any sparks (tried ${n}). Try again.`);
    setBusy(false);
  }

  // Default: populate the page with a fresh batch on first load.
  useEffect(() => {
    if (candidates.length > 0) void generate(count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.length]);

  const setCountPersist = (n: number) => { setCount(n); lsSet(COUNT_KEY, String(n)); };
  const isSaved = (s: Spark) => savedSparks.some((x) => x.id === s.id || (x.title === s.title && x.body === s.body));
  const saveSpark = (s: Spark) => { const next = isSaved(s) ? savedSparks : [s, ...savedSparks]; setSavedSparks(next); lsSet(SAVED_KEY, JSON.stringify(next)); };
  const unsaveSpark = (s: Spark) => { const next = savedSparks.filter((x) => !(x.id === s.id || (x.title === s.title && x.body === s.body))); setSavedSparks(next); lsSet(SAVED_KEY, JSON.stringify(next)); };
  const dismiss = (id: string) => setSparks((cur) => cur.filter((s) => s.id !== id));

  return (
    <div className="w-full">
      <SettingsHeader
        icon={Dices}
        title="Spark"
        subtitle="A nudge out of the bubble. Genuinely random things - a quote, a concept, a book, a recipe, a fact - generated live by randomly chosen models. Save the ones you like, dismiss the rest, regenerate."
      />

      {/* Controls: how many, regenerate, saved. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => generate(count)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
          {busy ? `${word}…` : `Generate ${count} spark${count === 1 ? "" : "s"}`}
        </button>
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-border">
          {COUNTS.map((n, i) => (
            <button key={n} onClick={() => setCountPersist(n)} disabled={busy}
              className={`px-2.5 py-1.5 font-mono text-[11px] transition-colors disabled:opacity-50 ${i > 0 ? "border-l border-border" : ""} ${count === n ? "bg-accent text-background" : "bg-background text-text-secondary hover:bg-surface-warm"}`}>
              {n}
            </button>
          ))}
        </div>
        {savedSparks.length > 0 && (
          <button onClick={() => setShowSaved((v) => !v)}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] ${showSaved ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}>
            <Bookmark className="h-3.5 w-3.5" /> Saved · {savedSparks.length}
          </button>
        )}
      </div>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-err/30 bg-err/5 px-3 py-2 text-[13px] text-err">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      {showSaved ? (
        <div className="space-y-3">
          {savedSparks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-text-muted">No saved sparks yet.</div>
          ) : savedSparks.map((s) => (
            <SparkCard key={s.id} s={s} vaultPath={vaultPath} saved onSave={() => unsaveSpark(s)} />
          ))}
        </div>
      ) : busy && sparks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-text-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-accent" /> {word}…
        </div>
      ) : (
        <div className="space-y-3">
          {sparks.map((s) => (
            <SparkCard key={s.id} s={s} vaultPath={vaultPath} saved={isSaved(s)}
              onSave={() => (isSaved(s) ? unsaveSpark(s) : saveSpark(s))}
              onDismiss={() => dismiss(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
