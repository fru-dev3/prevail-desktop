// Domain Loops — the persistent-control-loop model that replaces one-off tasks.
//
// A task is a one-time execution (goal → plan → do → done). A LOOP is a standing
// force on a domain: a desired state, the signals to watch, a stopping condition,
// a cadence, and what good looks like. The AI's job is to continuously shrink the
// gap between current and desired state; concrete "actions" are just the loop's
// current output, not first-class objects.
//
// Loops are mutable per-domain records (you toggle them, change cadence, open and
// close them), so they live in a single JSON document per domain rather than an
// append-only ledger. Stored at <vault>/<domain>/_loops.json and read/written
// through the existing encryption-aware read_file / write_text_file commands.
import { invoke } from "./bridge";
import { PREF, getPref, lsGet, lsSet } from "./storage";
import { titleCase } from "./format";

export type LoopType = "open" | "closed";
export type LoopCadence = "continuous" | "daily" | "weekly" | "monthly";
export type LoopStatus = "active" | "paused" | "done";
// Guardrail level — how much a loop may do on its own (Monday feedback: loops
// must communicate goals + guardrails, not just "always on"). suggest = only
// propose actions; tasks = also file them as tasks; ask = act via connectors but
// every consequential step needs your approval (default); auto = act within
// guardrails without asking (still records everything).
export type LoopAutonomy = "suggest" | "tasks" | "ask" | "auto";
export const AUTONOMY_LABEL: Record<LoopAutonomy, string> = {
  suggest: "Suggest only",
  tasks: "Create tasks",
  ask: "Act with approval",
  auto: "Autonomous",
};
export const AUTONOMY_BLURB: Record<LoopAutonomy, string> = {
  suggest: "Proposes next actions. Does nothing on its own.",
  tasks: "Files concrete steps as tasks in this domain. No external actions.",
  ask: "Can act through your connected apps, but every consequential step waits for your OK.",
  auto: "Acts within its guardrails without asking. Everything is logged in run history.",
};

// One persistent loop. The schema is universal across every domain so the runner
// daemon and the UI can treat them uniformly.
export interface Loop {
  id: string;
  name: string;
  purpose: string;
  type: LoopType;           // open = never ends · closed = stops when condition holds
  signals: string[];        // what the loop observes
  condition: string;        // closed: stop when true · open: usually "always on"
  cadence: LoopCadence;     // how often the runner evaluates it
  autonomy?: LoopAutonomy;  // guardrail: how much it may do on its own (default "ask")
  evaluation: string;       // what "good" looks like — how to judge the gap
  actions: string[];        // the loop's current suggested actions (its output)
  status: LoopStatus;
  enabled: boolean;         // the runner only evaluates enabled loops
  lastRunTs: number | null;
  createdTs: number;
  model?: string;           // per-loop model override ("" = use the global loops model)
  executor?: string;        // per-loop runtime/cli override ("" = use the global loops provider). May be a harness (hermes/pi/opencode) now that they run as agents.
  kind?: "steward" | "briefing" | "scout"; // briefing = domain digest · scout = web-search AI models for the benchmark · default steward
  channel?: "gmail" | "telegram" | "log"; // briefing delivery target (default gmail)
}

export interface LoopsDoc {
  schema: 1;
  desiredState: string;     // the domain's desired/ideal state, in the user's words
  loops: Loop[];
}

export function emptyLoopsDoc(): LoopsDoc {
  return { schema: 1, desiredState: "", loops: [] };
}

function loopsPath(domainPath: string): string {
  // Loops sit alongside the other engine files (_state.md, _decisions.jsonl) as
  // _loops.json. We take the already-resolved domain path (which the backend
  // resolves to the v3 vault/domains/<d> or legacy vault/<d> location) so this
  // works regardless of layout.
  return `${domainPath.replace(/\/+$/, "")}/_loops.json`;
}

// Read a domain's loops. Returns an empty doc when none exist yet (first run).
export async function readLoops(domainPath: string): Promise<LoopsDoc> {
  try {
    const raw = await invoke<string>("read_file", { path: loopsPath(domainPath) });
    if (!raw || !raw.trim()) return emptyLoopsDoc();
    const doc = JSON.parse(raw) as Partial<LoopsDoc>;
    return {
      schema: 1,
      desiredState: typeof doc.desiredState === "string" ? doc.desiredState : "",
      loops: Array.isArray(doc.loops) ? doc.loops.map(normalizeLoop) : [],
    };
  } catch {
    // Missing file or unreadable → treat as no loops yet.
    return emptyLoopsDoc();
  }
}

// Persist a domain's loops (full-document write, matching how _state.md and the
// manifest are written).
export async function writeLoops(domainPath: string, doc: LoopsDoc): Promise<void> {
  await invoke("write_text_file", {
    path: loopsPath(domainPath),
    contents: JSON.stringify({ ...doc, schema: 1 }, null, 2),
  });
}

// Defensive normalization so a hand-edited or older file never crashes the UI.
function normalizeLoop(l: Partial<Loop>): Loop {
  return {
    id: l.id || newLoopId(l.name || "loop"),
    name: l.name || "Untitled loop",
    purpose: l.purpose || "",
    type: l.type === "closed" ? "closed" : "open",
    signals: Array.isArray(l.signals) ? l.signals : [],
    condition: l.condition || (l.type === "closed" ? "" : "always on"),
    cadence: (["continuous", "daily", "weekly", "monthly"] as const).includes(l.cadence as LoopCadence)
      ? (l.cadence as LoopCadence)
      : "weekly",
    autonomy: (["suggest", "tasks", "ask", "auto"] as const).includes(l.autonomy as LoopAutonomy) ? (l.autonomy as LoopAutonomy) : "ask",
    evaluation: l.evaluation || "",
    actions: Array.isArray(l.actions) ? l.actions : [],
    status: (["active", "paused", "done"] as const).includes(l.status as LoopStatus) ? (l.status as LoopStatus) : "active",
    enabled: l.enabled !== false,
    lastRunTs: typeof l.lastRunTs === "number" ? l.lastRunTs : null,
    createdTs: typeof l.createdTs === "number" ? l.createdTs : Date.now(),
    ...(typeof l.model === "string" && l.model.trim() ? { model: l.model.trim() } : {}),
    ...(l.kind === "briefing" ? { kind: "briefing" as const } : {}),
    ...(l.channel === "gmail" || l.channel === "telegram" || l.channel === "log" ? { channel: l.channel } : {}),
  };
}

// Every domain always has a built-in Briefing loop: a standing agent that, on its
// cadence, synthesizes a digest of the domain (state + open tasks + what needs
// attention) and delivers it to a channel (default Gmail). Stable id so we never
// create duplicates. autonomy "auto" - it only produces + sends a digest.
export function makeBriefingLoop(domain: string): Loop {
  return normalizeLoop({
    id: `loop-briefing-${domain.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: `${titleCase(domain)} Briefing`,
    purpose: `Synthesize a regular digest of your ${titleCase(domain)} domain - where things stand, what needs attention, and the next steps - and deliver it to you.`,
    type: "open",
    signals: [],
    condition: "always on",
    cadence: "weekly",
    autonomy: "auto",
    evaluation: "You get a clear, timely briefing on this domain.",
    actions: [],
    status: "active",
    enabled: true,
    kind: "briefing",
    channel: "gmail",
    createdTs: Date.now(),
  });
}

// The Model Scout — a built-in loop that lives ONLY in the General domain. Each
// day it searches the web for AI models worth adding to the Arena benchmark
// (open-weight + frontier) and writes build/_meta/model_suggestions.json, which
// the Arena surfaces. Runs autonomously (read-only research, nothing to approve).
export function makeModelScoutLoop(): Loop {
  return normalizeLoop({
    id: "loop-model-scout",
    name: "Model Scout",
    purpose: "Scan the web daily for AI models worth benchmarking - both open-weight (Llama, Qwen, DeepSeek, ...) and frontier (Claude, GPT, Gemini, Grok, ...) - and recommend ones to add to the Arena so the benchmark tracks the current model landscape.",
    type: "open",
    signals: ["new AI model releases", "open-source models", "frontier models", "benchmark coverage"],
    condition: "always on",
    cadence: "daily",
    autonomy: "auto",
    evaluation: "The benchmark's model list reflects the current notable models; new releases are surfaced for inclusion.",
    actions: [],
    status: "active",
    enabled: true,
    kind: "scout",
    createdTs: Date.now(),
  });
}

// Ensure the General domain's doc contains the built-in Model Scout loop. No-op
// for every other domain (the scout is a global concern, so it lives in General).
export function ensureModelScoutLoop(doc: LoopsDoc, domain: string): { doc: LoopsDoc; added: boolean } {
  if (domain.toLowerCase() !== "general") return { doc, added: false };
  if (doc.loops.some((l) => l.kind === "scout" || l.id === "loop-model-scout")) return { doc, added: false };
  return { doc: { ...doc, loops: [makeModelScoutLoop(), ...doc.loops] }, added: true };
}

// Ensure the doc contains the domain's built-in Briefing loop. Returns the doc
// (possibly with the briefing loop appended) and whether it was added, so the
// caller can persist only when something changed.
export function ensureBriefingLoop(doc: LoopsDoc, domain: string): { doc: LoopsDoc; added: boolean } {
  if (doc.loops.some((l) => l.kind === "briefing")) return { doc, added: false };
  return { doc: { ...doc, loops: [makeBriefingLoop(domain), ...doc.loops] }, added: true };
}

let loopSeq = 0;
export function newLoopId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "loop";
  return `loop-${slug}-${Date.now().toString(36)}-${(loopSeq++).toString(36)}`;
}

// Build a fresh loop with sensible defaults.
export function makeLoop(partial: Partial<Loop> & { name: string }): Loop {
  return normalizeLoop({ ...partial, id: partial.id ?? newLoopId(partial.name), createdTs: Date.now() });
}

// ── Seeded starter loops ─────────────────────────────────────────────────────
// Authored from the user's life-OS spec: each domain gets a desired state and a
// set of real, standing loops in the universal schema. Used to scaffold a domain
// the first time loops are opened, so the user starts with a meaningful steward
// instead of a blank page. Domains not listed get a generic starter pair.
type SeedLoop = Omit<Loop, "id" | "status" | "enabled" | "lastRunTs" | "createdTs">;
type Seed = { desiredState: string; loops: SeedLoop[] };

const SEEDS: Record<string, Seed> = {
  wealth: {
    desiredState: "Abundant, growing, resilient, diversified, tax-efficient, and cash-flow positive. Net worth and passive income climbing toward financial freedom.",
    loops: [
      { name: "Wealth Acceleration", purpose: "Continuously grow net worth toward the target.", type: "open", signals: ["assets", "liabilities", "income", "expenses"], condition: "net worth < target", cadence: "weekly", evaluation: "Net-worth trend is up and the gap to target is shrinking.", actions: ["Increase investments", "Increase income", "Reduce liabilities"] },
      { name: "Investment", purpose: "Keep the portfolio aligned to target allocation and risk.", type: "open", signals: ["asset allocation", "returns", "concentration risk"], condition: "always on", cadence: "weekly", evaluation: "Allocation within tolerance; no single position over-concentrated.", actions: ["Rebalance toward target", "Trim concentrated positions"] },
      { name: "Opportunity Detection", purpose: "Surface high-leverage opportunities (stocks, startups, businesses, real estate).", type: "open", signals: ["private deals", "stocks", "businesses", "real estate"], condition: "always on", cadence: "daily", evaluation: "A live shortlist of vetted opportunities exists.", actions: ["Evaluate a flagged opportunity", "Pass or pursue with a clear thesis"] },
      { name: "Cash & Spending Optimization", purpose: "Cut waste and reallocate capital to its best use.", type: "open", signals: ["spending", "subscriptions", "recurring costs", "debt"], condition: "inefficiency detected", cadence: "monthly", evaluation: "No wasteful recurring spend; debt at the cheapest available terms.", actions: ["Cancel an unused service", "Refinance expensive debt", "Reallocate capital"] },
      { name: "Liquidity", purpose: "Keep an adequate cash reserve without idle drag.", type: "open", signals: ["cash", "emergency reserves"], condition: "liquidity below target", cadence: "weekly", evaluation: "Reserve covers target months of expenses; excess is invested.", actions: ["Top up reserve", "Sweep excess cash into investments"] },
      { name: "Tax Efficiency", purpose: "Minimize avoidable tax drag on growth.", type: "open", signals: ["realized gains", "deductions", "tax exposure"], condition: "tax optimization available", cadence: "monthly", evaluation: "Gains harvested, accounts used tax-efficiently, no obvious leakage.", actions: ["Harvest losses", "Max tax-advantaged accounts", "Defer or shift income"] },
    ],
  },
  career: {
    desiredState: "Meaningful, high-income, high-leverage, respected, growing, and future-proof.",
    loops: [
      { name: "Growth", purpose: "Compound skills, performance, and standing.", type: "open", signals: ["skills", "performance", "feedback", "promotions"], condition: "growth score < ideal", cadence: "weekly", evaluation: "Skills and impact are visibly compounding.", actions: ["Learn a high-leverage skill", "Ship a visible project", "Seek mentorship"] },
      { name: "Visibility", purpose: "Build recognition inside and outside the org.", type: "open", signals: ["internal recognition", "public presence", "speaking", "content"], condition: "visibility score < target", cadence: "monthly", evaluation: "Known for the right things to the right people.", actions: ["Publish an article", "Speak at an event", "Share work internally"] },
      { name: "Opportunity", purpose: "Keep better roles and bets in view.", type: "open", signals: ["recruiter activity", "market demand", "network opportunities"], condition: "always on", cadence: "weekly", evaluation: "A live sense of the best available next moves.", actions: ["Evaluate an inbound role", "Explore a board/advisor seat"] },
      { name: "Compensation", purpose: "Close the gap to market comp.", type: "open", signals: ["salary", "equity", "bonuses", "market compensation"], condition: "compensation gap > threshold", cadence: "monthly", evaluation: "Total comp at or above market for the role.", actions: ["Benchmark comp", "Open a comp conversation"] },
      { name: "Network", purpose: "Keep key relationships warm.", type: "open", signals: ["meaningful contacts", "dormant relationships"], condition: "relationship decay detected", cadence: "monthly", evaluation: "Important relationships are active, not dormant.", actions: ["Reconnect with a dormant contact", "Add value to a key relationship"] },
    ],
  },
  health: {
    desiredState: "Energetic, disease-free, resilient, and long-lived.",
    loops: [
      { name: "Biomarkers", purpose: "Keep core health metrics in range.", type: "open", signals: ["bloodwork", "weight", "blood pressure"], condition: "metric outside range", cadence: "monthly", evaluation: "All tracked biomarkers within healthy ranges.", actions: ["Book a blood test", "Adjust nutrition", "Increase activity"] },
      { name: "Sleep", purpose: "Protect sleep duration and quality.", type: "open", signals: ["sleep duration", "sleep quality"], condition: "sleep deficit detected", cadence: "daily", evaluation: "Consistent, sufficient, high-quality sleep.", actions: ["Earlier bedtime", "Cut late screens/caffeine"] },
      { name: "Nutrition", purpose: "Hit protein and nutrient targets.", type: "open", signals: ["calories", "protein", "nutrient quality"], condition: "nutrition gap detected", cadence: "daily", evaluation: "Targets met with whole foods most days.", actions: ["Plan meals", "Hit protein target"] },
      { name: "Prevention", purpose: "Stay ahead of screenings and risks.", type: "open", signals: ["screenings", "appointments", "risk factors"], condition: "prevention action due", cadence: "monthly", evaluation: "All due screenings scheduled or done.", actions: ["Schedule a physical", "Book an overdue screening"] },
      { name: "Stress", purpose: "Keep stress and recovery balanced.", type: "open", signals: ["mood", "workload", "recovery"], condition: "stress above target", cadence: "weekly", evaluation: "Stress sustainable; recovery adequate.", actions: ["Add a recovery block", "Reduce overcommitment"] },
    ],
  },
  fitness: {
    desiredState: "Strong, mobile, capable, and durable.",
    loops: [
      { name: "Training", purpose: "Progress strength and capacity over time.", type: "open", signals: ["workouts", "recovery", "performance"], condition: "progress stalled", cadence: "weekly", evaluation: "Lifts/capacity trending up without injury.", actions: ["Increase volume", "Change the program", "Add a rest day"] },
      { name: "Recovery", purpose: "Recover enough to keep progressing.", type: "open", signals: ["sleep", "HRV", "soreness"], condition: "recovery low", cadence: "daily", evaluation: "Recovery markers green; no chronic soreness.", actions: ["Take a rest day", "Mobility work", "Earlier bedtime"] },
      { name: "Consistency", purpose: "Keep the training habit unbroken.", type: "open", signals: ["sessions/week", "missed sessions"], condition: "consistency < target", cadence: "weekly", evaluation: "Hitting the planned sessions most weeks.", actions: ["Reschedule a missed session", "Lower the bar to keep the streak"] },
    ],
  },
  tax: {
    desiredState: "Compliant, optimized, and predictable.",
    loops: [
      { name: "Tax Minimization", purpose: "Reduce avoidable tax across the year.", type: "open", signals: ["income", "deductions", "investments"], condition: "tax optimization available", cadence: "monthly", evaluation: "Obvious tax leakage eliminated.", actions: ["Harvest losses", "Max HSA/401k", "Time income/deductions"] },
      { name: "Deduction Discovery", purpose: "Find every legitimate deduction.", type: "open", signals: ["expenses", "life changes"], condition: "always on", cadence: "monthly", evaluation: "No eligible deduction left unclaimed.", actions: ["Log a deductible expense", "Flag a new credit"] },
      { name: "Filing Readiness", purpose: "Be ready well before deadlines.", type: "closed", signals: ["documents", "deadlines"], condition: "return filed", cadence: "monthly", evaluation: "All documents collected; return filed on time.", actions: ["Chase a missing W2/1099", "Assemble documents", "File the return"] },
      { name: "Regulation Change", purpose: "Catch tax-law changes that matter.", type: "open", signals: ["tax law changes"], condition: "change detected", cadence: "monthly", evaluation: "Relevant changes reviewed and acted on.", actions: ["Review a rule change", "Adjust strategy"] },
    ],
  },
  insurance: {
    desiredState: "Adequately protected and cost-optimized.",
    loops: [
      { name: "Coverage Adequacy", purpose: "Match coverage to assets, liabilities, and dependents.", type: "open", signals: ["assets", "liabilities", "dependents"], condition: "coverage gap detected", cadence: "monthly", evaluation: "No material uncovered risk.", actions: ["Increase umbrella policy", "Add disability/life as needed"] },
      { name: "Cost Optimization", purpose: "Pay no more than necessary for the same protection.", type: "open", signals: ["premiums", "competitor quotes"], condition: "cheaper equivalent available", cadence: "monthly", evaluation: "Premiums competitive for the coverage.", actions: ["Re-quote a policy", "Bundle coverage", "Switch carrier"] },
      { name: "Claims & Beneficiaries", purpose: "Keep claims current and beneficiaries correct.", type: "open", signals: ["open claims", "beneficiary designations", "life changes"], condition: "review due", cadence: "monthly", evaluation: "Claims progressing; beneficiaries accurate.", actions: ["Follow up a claim", "Update a beneficiary"] },
    ],
  },
  learning: {
    desiredState: "Continuously expanding, retained, and applied.",
    loops: [
      { name: "Acquisition", purpose: "Close knowledge gaps tied to goals.", type: "open", signals: ["goals", "knowledge gaps"], condition: "gap identified", cadence: "weekly", evaluation: "Actively learning what matters most now.", actions: ["Read a book/course", "Interview an expert"] },
      { name: "Retention", purpose: "Remember what's worth keeping.", type: "open", signals: ["notes", "recall"], condition: "always on", cadence: "weekly", evaluation: "Key ideas stick and resurface when needed.", actions: ["Review notes", "Make flashcards", "Summarize a concept"] },
      { name: "Application", purpose: "Use new knowledge, don't just collect it.", type: "open", signals: ["newly learned knowledge"], condition: "always on", cadence: "weekly", evaluation: "New ideas show up in real work.", actions: ["Apply a concept", "Build a small project", "Teach someone"] },
    ],
  },
  homestead: {
    desiredState: "Safe, organized, maintained, and improving.",
    loops: [
      { name: "Maintenance", purpose: "Keep home systems and equipment healthy.", type: "open", signals: ["home systems", "vehicles", "equipment"], condition: "maintenance due", cadence: "monthly", evaluation: "Nothing overdue for service; no deferred failures.", actions: ["Replace a filter", "Service the furnace", "Repair before it breaks"] },
      { name: "Improvement", purpose: "Raise comfort, function, and value over time.", type: "open", signals: ["property value", "comfort", "functionality"], condition: "always on", cadence: "monthly", evaluation: "Steady, sensible upgrades.", actions: ["Plan an upgrade", "Add efficiency (solar/insulation)"] },
      { name: "Safety", purpose: "Keep the home safe and risk-free.", type: "open", signals: ["alarms", "hazards", "risk factors"], condition: "hazard detected", cadence: "monthly", evaluation: "Detectors working; hazards addressed.", actions: ["Test detectors", "Fix a hazard"] },
    ],
  },
  travel: {
    desiredState: "Well-explored, efficiently planned, and meaningful.",
    loops: [
      { name: "Discovery", purpose: "Keep a living shortlist of trips worth taking.", type: "open", signals: ["interests", "season", "budget"], condition: "always on", cadence: "monthly", evaluation: "An inspiring, feasible shortlist exists.", actions: ["Add a destination", "Match a trip to the season/budget"] },
      { name: "Trip Planning", purpose: "Turn a chosen trip into a booked plan.", type: "closed", signals: ["flights", "hotels", "itinerary"], condition: "trip booked", cadence: "weekly", evaluation: "Flights, lodging, and itinerary booked.", actions: ["Book a flight", "Reserve lodging", "Draft an itinerary"] },
    ],
  },
  calendar: {
    desiredState: "Time spent in line with values; focused, not overloaded.",
    loops: [
      { name: "Time Allocation", purpose: "Spend time the way your values say you should.", type: "open", signals: ["actual time spent", "ideal allocation"], condition: "drift detected", cadence: "weekly", evaluation: "Actual time tracks the ideal split across domains.", actions: ["Rebalance the week", "Cut a low-value commitment"] },
      { name: "Focus", purpose: "Protect deep work from fragmentation.", type: "open", signals: ["interruptions", "meetings", "deep work"], condition: "fragmentation high", cadence: "weekly", evaluation: "Enough protected deep-work blocks.", actions: ["Block focus time", "Decline/condense a meeting"] },
      { name: "White Space", purpose: "Keep recovery and slack in the schedule.", type: "open", signals: ["free time", "back-to-back load"], condition: "white space < target", cadence: "weekly", evaluation: "Recovery time is on the calendar, not optional.", actions: ["Add a recovery block", "Protect an evening"] },
    ],
  },
  chief: {
    desiredState: "Every domain aligned to your vision, nothing neglected, disorder caught early, and the highest-leverage move always clear.",
    loops: [
      { name: "Alignment", purpose: "Keep all domains aligned to the life vision.", type: "open", signals: ["all domains", "ideal state"], condition: "always on", cadence: "weekly", evaluation: "No domain drifting from the vision.", actions: ["Flag a misaligned domain", "Re-anchor to ideal state"] },
      { name: "Neglect", purpose: "Catch the domain that's deteriorating.", type: "open", signals: ["all domains"], condition: "always on", cadence: "weekly", evaluation: "No domain quietly decaying.", actions: ["Surface the most-neglected domain", "Schedule a corrective action"] },
      { name: "Entropy", purpose: "Detect rising disorder before it compounds.", type: "open", signals: ["health", "wealth", "relationships", "home", "career"], condition: "entropy detected", cadence: "weekly", evaluation: "Disorder caught and reversed early.", actions: ["Name the entropy", "Generate a corrective action"] },
      { name: "Priority", purpose: "Always know the highest-leverage move.", type: "open", signals: ["all open loops"], condition: "always on", cadence: "daily", evaluation: "A clear top-3 for today across all domains.", actions: ["Rank by leverage × urgency × impact", "Surface today's top 3"] },
      { name: "Balance", purpose: "Catch one domain over-optimized at another's cost.", type: "open", signals: ["effort by domain", "outcomes by domain"], condition: "imbalance detected", cadence: "weekly", evaluation: "No domain starved to feed another.", actions: ["Rebalance attention", "Protect a starved domain"] },
      { name: "Thesis", purpose: "Continuously test the beliefs the system runs on.", type: "open", signals: ["beliefs", "outcomes", "evidence"], condition: "thesis challenged", cadence: "monthly", evaluation: "Theses are supported by evidence, or revised.", actions: ["Test a thesis against reality", "Revise a disproven belief"] },
    ],
  },
};

// A generic pair for any domain without a hand-authored seed, so every domain can
// start with a working steward.
function genericSeed(domain: string): Seed {
  const d = domain.replace(/[-_]/g, " ");
  return {
    desiredState: `A clear, improving state for ${d}, moving steadily toward where you want it to be.`,
    loops: [
      { name: "Steward", purpose: `Continuously move ${d} toward its desired state.`, type: "open", signals: ["state", "recent activity", "decisions"], condition: "gap to desired state", cadence: "weekly", evaluation: "The gap to the desired state is shrinking.", actions: ["Identify the highest-leverage next action", "Take it and measure the result"] },
      { name: "Opportunity", purpose: `Surface opportunities and risks in ${d}.`, type: "open", signals: ["new information", "changes"], condition: "always on", cadence: "weekly", evaluation: "Opportunities and risks are caught early.", actions: ["Flag an opportunity or risk", "Recommend a response"] },
    ],
  };
}

// Build a fresh LoopsDoc for a domain from its seed (hand-authored or generic).
export function seedLoopsFor(domain: string): LoopsDoc {
  const seed = SEEDS[domain.toLowerCase()] ?? genericSeed(domain);
  return {
    schema: 1,
    desiredState: seed.desiredState,
    loops: seed.loops.map((l) => makeLoop({ ...l, status: "active", enabled: true })),
  };
}

export function hasSeed(domain: string): boolean {
  return !!SEEDS[domain.toLowerCase()];
}

export const CADENCE_LABEL: Record<LoopCadence, string> = {
  continuous: "Continuous",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

// ── Loop runtime: history + pending approvals (engine-owned) ─────────────────
// Written by the engine loop runner (_loops_runtime.json). The desktop reads it
// to show what each loop has been doing and to surface the steps a loop is ASKING
// the user to approve before it acts.
export interface LoopRun { ts: number; actions: string[]; note: string; done: boolean; tasksCreated: string[] }
export interface LoopRtEntry { history: LoopRun[]; pending: { text: string; ts: number }[] }
export interface LoopsRuntime { schema: 1; loops: Record<string, LoopRtEntry> }

function runtimePath(domainPath: string): string {
  return `${domainPath.replace(/\/+$/, "")}/_loops_runtime.json`;
}
export async function readLoopsRuntime(domainPath: string): Promise<LoopsRuntime> {
  try {
    const raw = await invoke<string>("read_file", { path: runtimePath(domainPath) });
    const d = JSON.parse(raw) as LoopsRuntime;
    if (d && d.loops) return d;
  } catch { /* none yet */ }
  return { schema: 1, loops: {} };
}
export async function writeLoopsRuntime(domainPath: string, rt: LoopsRuntime): Promise<void> {
  await invoke("write_text_file", { path: runtimePath(domainPath), contents: JSON.stringify(rt, null, 2) }).catch(() => {});
}

// ── In-app loop runner (behind the scenes) ───────────────────────────────────
// Loops should advance on their own, not only when the user clicks "Run loops
// now". This is a module-level timer (same pattern as the benchmark/backup
// schedulers): it wakes on a cadence and triggers one loop pass via the engine,
// which advances every DUE loop (each loop still respects its own cadence). The
// tick re-reads the prefs each time, so toggling needs no restart.
let loopsSchedTimer: number | null = null;
export function startLoopsScheduler(vault: string) {
  if (loopsSchedTimer !== null) window.clearInterval(loopsSchedTimer);
  const tick = async () => {
    try {
      if (getPref(PREF.loopsAutoRun, "1") !== "1") return;
      const intervalMs = (Number(getPref(PREF.loopsIntervalSec, "3600")) || 3600) * 1000;
      const last = Number(lsGet(PREF.loopsLastRun, "0")) || 0;
      if (Date.now() - last < intervalMs) return;
      // Stamp BEFORE running so a long pass can't trigger overlapping runs.
      lsSet(PREF.loopsLastRun, String(Date.now()));
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      await invoke("loops_run_once", { vault, provider, model });
      window.dispatchEvent(new Event("prevail:loops-advanced"));
    } catch (e) {
      console.error("loops scheduler tick", e);
    }
  };
  // First check shortly after launch, then on a steady cadence.
  loopsSchedTimer = window.setInterval(tick, 60_000);
  window.setTimeout(tick, 8_000);
}
