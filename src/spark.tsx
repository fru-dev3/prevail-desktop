// Spark - the serendipity surface. A release valve against the bubble: each
// spark asks a RANDOMLY CHOSEN model for one genuinely random thing (a quote, a
// concept, a book, a film, a recipe, a "did you know", a skill...). Nothing is
// hardcoded - every spark is generated live and the model is rotated, so the
// randomness comes from the models too. The page loads a fresh batch of 5; you
// can ask for 1/2/3/5/10, save the ones you like, dismiss the rest, regenerate.
import { useEffect, useMemo, useRef, useState } from "react";
import { Dices, Loader2, ListPlus, Repeat, MessageSquare, AlertTriangle, Bookmark, Pencil, X } from "lucide-react";
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
  ts: number; // when it was generated (epoch ms) - captured so saved sparks keep their provenance
}

// "Jun 19, 2:14 PM" - compact date+time for a spark's provenance line.
function fmtStamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

// Best-effort terminal reconstruction. Some CLIs (notably ollama-backed local
// models) stream with cursor-back + erase-line redraws; captured as plain text
// these leave garbled fragments like "conti<ESC>[5D<ESC>[K continuing". Naive
// escape-stripping would leave "conticontinuing", so we REPLAY the common cursor
// ops against a line buffer to recover the text the user was meant to see. The
// ESC byte may arrive as 0x1B or as the replacement char (when decoded lossily).
function reconstructTty(input: string): string {
  const isEsc = (c: string) => c === "\x1b" || c === "�";
  let line = "";
  let col = 0;
  const out: string[] = [];
  const commit = () => { out.push(line); line = ""; col = 0; };
  for (let i = 0; i < input.length; ) {
    const ch = input[i]!;
    if (ch === "\n") { commit(); i++; continue; }
    if (ch === "\r") { col = 0; i++; continue; }
    if (isEsc(ch)) {
      // CSI: ESC [ params intermediates final
      const m = /^[\x1b�]\[([0-9;?]*)[ -/]*([@-~])/.exec(input.slice(i));
      if (m) {
        const n = parseInt(m[1] || "", 10);
        const final = m[2];
        if (final === "D") col = Math.max(0, col - (n || 1));        // cursor back
        else if (final === "C") col += (n || 1);                      // cursor forward
        else if (final === "G") col = Math.max(0, (n || 1) - 1);      // column absolute
        else if (final === "K") line = line.slice(0, col);            // erase to EOL
        else if (final === "H" || final === "f") { col = 0; }         // home (treat as line start)
        // SGR colors (m) and the rest: ignore, just consume
        i += m[0].length;
        continue;
      }
      i += 2; // unknown escape: drop ESC + the following byte
      continue;
    }
    if (ch.charCodeAt(0) < 0x20 && ch !== "\t") { i++; continue; } // stray C0 control
    line = line.slice(0, col) + ch + line.slice(col + 1);
    col++;
    i++;
  }
  commit();
  return out.join("\n");
}

// Clean a model's raw stdout into presentable prose: replay terminal redraws,
// drop any leftover control/replacement chars, and collapse the double spaces
// that overwrite-redraws leave behind.
function sanitizeModelText(s: string): string {
  return reconstructTty(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F�]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
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

// Truly-random coverage is enforced in CODE, not left to the model's bias (which
// skews to pop-science). We pick a field and a "register" at random per spark and
// command the model to stay inside them, so a batch spreads across all of life.
const SPARK_FIELDS = [
  "cinema and film", "television and animation", "visual art and painting", "sculpture and installation",
  "music and composition", "dance and choreography", "theatre and performance", "comedy and humor",
  "literature, poetry and myth", "world history", "ancient civilizations", "religion, scripture and spirituality",
  "philosophy and ethics", "psychology and the mind", "linguistics and etymology", "mathematics",
  "physics and cosmology", "astronomy and space", "chemistry and materials", "biology and ecology",
  "medicine and the human body", "food, cooking and fermentation", "wine, coffee and tea",
  "architecture and urban design", "engineering and invention", "a hands-on trade or craft (welding, masonry, tailoring, plumbing, carpentry)",
  "money, markets and economics", "law, justice and crime", "sports and games", "board games and puzzles",
  "fashion, textiles and style", "geography and unusual places", "anthropology and folk customs",
  "mythology and folklore", "everyday street wisdom and life hacks", "navigation, sailing and the sea",
  "agriculture and the land", "typography and design", "perfume, scent and the senses",
];
const SPARK_REGISTERS = [
  "explained so a curious 8-year-old would be delighted",
  "at a practical, hands-on trade-school level",
  "at a sharp undergraduate level",
  "at PhD / specialist depth, with a precise detail an expert would respect",
  "as street-smart, real-world wisdom you won't find in a textbook",
];

function pick<T>(xs: readonly T[]): T { return xs[Math.floor(Math.random() * xs.length)]!; }

// Case-insensitive de-dupe that preserves order and the first-seen casing. Used
// to keep the anti-repetition corpus tidy.
function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}

// `field` is the subject the model must stay in (a random SPARK_FIELD, or, when
// the user typed one, their topic). `avoid` is recent spark titles we must NOT
// repeat or cluster near - the anti-repetition lever that keeps the stream fresh.
function buildPrompt(seed: string, field: string, register: string, avoid: string[]): string {
  const avoidBlock = avoid.length
    ? [
        "",
        "AVOID REPETITION. These sparks were shown recently. Do NOT repeat any of them, and do not give anything in the same cluster of thinking, same example, or same angle. Go somewhere genuinely different in the subject area:",
        ...avoid.slice(0, 40).map((t) => `- ${t}`),
      ]
    : [];
  return [
    "You are a serendipity engine. Produce ONE genuinely surprising, delightful thing that broadens someone's horizons and nudges them out of their usual bubble.",
    "",
    `For THIS spark, the subject MUST come from: ${field}.`,
    `Pitch it ${register}.`,
    "",
    "Vary the FORM freely (pick whatever fits the subject): a quote, a concept or idea, a book, a film, a piece of music, a recipe or dish, a 'did you know' fact, a skill or practice, a thought experiment, an unusual word, a phenomenon, a small experiment to try.",
    ...avoidBlock,
    "",
    "Rules:",
    "- Stay strictly within the assigned subject area above. Do NOT drift to generic pop-science.",
    "- Any topic is fair game, including religion, history, politics and culture, treated with curiosity and neutrality. Do not push a partisan stance and do not target a specific living person.",
    "- Reach for the obscure and the lesser-known corner of the subject, not its most famous example. Genuinely surprise me; avoid the obvious and the cliche.",
    "- Be concrete and self-contained: the reader gets full value from the text alone, no extra lookup.",
    "- Keep it short: 2 to 5 sentences in the body.",
    "- Write in plain prose. Do not use em dashes. Do not include any markup, control characters, or formatting symbols.",
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
    // chat panel; ChatPanel reads it on mount.
    try { localStorage.setItem("prevail.compose.pending", seed); } catch { /* ignore */ }
    // A spark is a general, untied idea - explore it in GENERAL, not whatever
    // domain happened to be selected. open-domain "" routes to General chat and
    // leaves Settings; compose-seed handles the already-on-General case.
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: "" }));
    window.dispatchEvent(new CustomEvent("prevail:compose-seed", { detail: seed }));
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-warm/40 px-4 py-2">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">{s.category}</span>
        {s.ts > 0 && <span className="font-mono text-[10px] text-text-muted" title={new Date(s.ts).toLocaleString()}>{fmtStamp(s.ts)}</span>}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-text-muted" title={`Generated by ${s.modelLabel} at ${new Date(s.ts || Date.now()).toLocaleString()}`}>
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
  // Optional topic (minimalist): hidden behind an expand icon. Empty = fully
  // random; set = sparks themed to it ("ancient Rome, politics, culture").
  const [topicOpen, setTopicOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const word = usePlayfulWord();

  // Anti-repetition corpus: titles of recently-shown sparks (from the on-disk
  // archive + saved + this session). Fed to the model as an "avoid these, go
  // somewhere genuinely different" list so the stream doesn't collapse into the
  // same cluster over time. A ref so updating it never forces a re-render.
  const recentTitlesRef = useRef<string[]>([]);
  const titleOf = (s: Spark) => (s.title || s.body.slice(0, 60)).trim();
  useEffect(() => {
    const savedTitles = savedSparks.map(titleOf).filter(Boolean);
    invoke<Record<string, unknown>[]>("spark_archive_read", { vault: vaultPath, limit: 80 })
      .then((rows) => {
        const archived = (rows ?? [])
          .map((r) => (typeof r.title === "string" && r.title) || (typeof r.body === "string" ? r.body.slice(0, 60) : ""))
          .filter(Boolean) as string[];
        recentTitlesRef.current = dedupe([...savedTitles, ...archived]).slice(0, 60);
      })
      .catch(() => { recentTitlesRef.current = dedupe(savedTitles).slice(0, 60); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath]);
  const pushRecentTitles = (titles: string[]) => {
    recentTitlesRef.current = dedupe([...titles, ...recentTitlesRef.current]).slice(0, 60);
  };

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

  // Generate one spark from a given candidate; null on failure. `field` is the
  // subject to stay in (resolved by the caller: the user's topic, or a distinct
  // random field). `avoid` is the recent-titles list passed to the prompt.
  async function generateOne(cand: Candidate, opts: { batch: number; field: string; avoid: string[]; topical: boolean }): Promise<Spark | null> {
    try {
      const { batch, field, avoid, topical } = opts;
      const register = pick(SPARK_REGISTERS);
      const seed = randSeed();
      const raw = await invoke<string>("model_oneshot", { args: { cli: cand.cli, model: cand.model || null, prompt: buildPrompt(seed, field, register, avoid), timeout_sec: 60 } });
      // Clean terminal redraw noise + control chars BEFORE parsing the fields.
      const parsed = parseSpark(sanitizeModelText(raw));
      if (!parsed.body) return null;
      const cleanLabel = (modelLabel(cand.cli, cand.model) || cand.label).replace(/\s*\(.*?\)\s*/g, "").trim();
      const ts = Date.now();
      const spark: Spark = { id: `${ts}-${Math.random().toString(36).slice(2)}`, ...parsed, cli: cand.cli, model: cand.model, modelLabel: cleanLabel, ts };
      // Archive EVERY generated spark to disk (append-only; not loaded into
      // context unless explicitly browsed). Fire-and-forget so a write hiccup or
      // missing command never breaks generation.
      void invoke("spark_archive_append", {
        vault: vaultPath,
        record: { ...spark, field, register, batch, seed, topical, iso: new Date(ts).toISOString() },
      }).catch(() => {});
      return spark;
    } catch { return null; }
  }

  async function generate(n: number) {
    if (candidates.length === 0) { setErr("No runnable models available. Connect a runtime first."); return; }
    setBusy(true); setErr(null);
    // Rotate models across the batch; cycle the shuffled list if n exceeds it so
    // each spark still picks a (possibly repeated) model, mixing them up.
    const order = shuffle(candidates);
    const picks: Candidate[] = Array.from({ length: n }, (_, i) => order[i % order.length]!);
    // Subject per spark: the user's topic when given (themed batch), else DISTINCT
    // random fields across the batch (shuffled, cycled) so one batch spreads wide.
    const themed = topic.trim();
    const fieldOrder = shuffle([...SPARK_FIELDS]);
    const avoid = recentTitlesRef.current;
    const results = await Promise.all(picks.map((c, i) => generateOne(c, {
      batch: n,
      field: themed || fieldOrder[i % fieldOrder.length]!,
      avoid,
      topical: !!themed,
    })));
    const ok = results.filter((s): s is Spark => s !== null);
    setSparks(ok);
    // Feed the fresh titles back so the NEXT batch also diverges from these,
    // not just from the archive snapshot taken at mount.
    if (ok.length) pushRecentTitles(ok.map(titleOf));
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
          {busy ? `${word}…` : topic.trim() ? `Spark on "${topic.trim().slice(0, 22)}${topic.trim().length > 22 ? "…" : ""}"` : `Generate ${count} spark${count === 1 ? "" : "s"}`}
        </button>
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-border">
          {COUNTS.map((n, i) => (
            <button key={n} onClick={() => setCountPersist(n)} disabled={busy}
              className={`px-2.5 py-1.5 font-mono text-[11px] transition-colors disabled:opacity-50 ${i > 0 ? "border-l border-border" : ""} ${count === n ? "bg-accent text-background" : "bg-background text-text-secondary hover:bg-surface-warm"}`}>
              {n}
            </button>
          ))}
        </div>
        {/* Minimalist topic affordance: an icon that expands an optional prompt.
            Collapsed + empty = fully random; a topic themes the batch. */}
        <button onClick={() => setTopicOpen((v) => !v)} title={topic.trim() ? `Topic: ${topic.trim()}` : "Spark on a specific topic"}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${topicOpen || topic.trim() ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}>
          <Pencil className="h-4 w-4" />
        </button>
        {savedSparks.length > 0 && (
          <button onClick={() => setShowSaved((v) => !v)}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] ${showSaved ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}>
            <Bookmark className="h-3.5 w-3.5" /> Saved · {savedSparks.length}
          </button>
        )}
      </div>

      {/* Optional topic prompt - only present when expanded, so the default stays
          a clean random-spark surface. Enter sparks the topic; the field is the
          ONLY thing that themes a batch. */}
      {topicOpen && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/20 px-3 py-2">
          <Pencil className="h-3.5 w-3.5 shrink-0 text-accent" />
          <input
            autoFocus value={topic} onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) void generate(count); if (e.key === "Escape") setTopicOpen(false); }}
            placeholder="Optional topic to spark on, e.g. ancient Rome · jazz · deep-sea biology · Stoicism"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/60"
          />
          {topic && <button onClick={() => setTopic("")} title="Clear topic (back to fully random)" className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>}
        </div>
      )}

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
