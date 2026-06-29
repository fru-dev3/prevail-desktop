// Shared type definitions extracted from App.tsx.
import type { LucideIcon } from "lucide-react";

export interface ModelPick {
  id: string;
  label: string;
  blurb?: string;
}

export type Brand = { path: string; hex: string; title: string };

export interface ThreadMeta {
  path: string;
  slug: string;
  title: string;
  domain: string | null;
  created: number;
  updated: number;
  turn_count: number;
  preview: string;
  // The model that last answered in this thread (for the rail icon).
  cli: string | null;
  model: string | null;
}

export interface ThreadTurn {
  role: "user" | "assistant";
  cli: string | null;
  model: string | null;
  content: string;
}

export interface DomainLogEntry {
  name: string;
  path: string;
  mtime_secs: number;
  preview: string;
}

export interface DomainContextBundle {
  state: string | null;
  decisions: string | null;
  journal: string | null;
  recent_logs: DomainLogEntry[];
  skills: { domain: string; name: string; path: string; description: string | null }[];
}

export interface ScoreDimension {
  score: number;
  detail: string;
}

export interface ScoreBreakdown {
  coverage: ScoreDimension;
  density: ScoreDimension;
  freshness: ScoreDimension;
  structure: ScoreDimension;
  activity: ScoreDimension;
  config_completeness: ScoreDimension;
}

export interface MissingItem {
  label: string;
  severity: string; // info | warn | critical
  kind: string;
}

export interface RelevanceItem {
  id: string;
  label: string;
  present: boolean;
  stale: boolean;
  severity: string; // info | warn | critical
  detail: string;
  recommend: string;
}

export interface DomainRelevance {
  matched: string;
  score: number;
  detail: string;
  items: RelevanceItem[];
}

export interface ContextScore {
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

export interface LifeReadiness {
  life_readiness: number | null;
  domains: ContextScore[];
  computed_at: string | null;
}

export interface ProposedDomain {
  name: string;
  label: string;
  emoji: string;
  summary: string;
  reason: string;
  recommended: boolean;
  starterGoals?: string[];
  suggestedSkills?: string[];
}

export interface OnboardingRecommendation {
  domains: ProposedDomain[];
  rationale: string;
  generated_at: string;
}

export interface ManifestConfig {
  cli?: string;
  model?: string;
  framework?: string | null;
  lens?: string | null;
  skills?: string[];
  autoState?: boolean;
}

export interface ManifestPrivacy {
  localOnly?: boolean;
}

export interface ManifestSandbox {
  mode?: string; // "open" | "locked"
}

export interface ManifestRouting {
  keywords?: string[];
  channels?: string[];
  default?: boolean;
}

export interface DomainManifest {
  config?: ManifestConfig;
  privacy?: ManifestPrivacy;
  sandbox?: ManifestSandbox;
  routing?: ManifestRouting;
  [k: string]: unknown;
}

export interface BackupResult {
  ok: boolean;
  archive_path: string | null;
  scope: "vault" | "domain";
  domains: string[];
  file_count: number;
  bytes: number;
  created_at: string;
  error?: string | null;
}

export interface Domain {
  name: string;
  path: string;
  has_state: boolean;
  state_preview: string | null;
}

export interface CliInfo {
  id: string;
  label: string;
  bin: string;
  available: boolean;
  version?: string | null;
  // Present when the binary is on disk but couldn't run (e.g. a wrapper whose
  // target is missing). `available` is false in that case; this says why.
  error?: string | null;
}

export interface BenchmarkRun {
  label: string;
  run_dir: string;
  judge_avg: number | null;
  keyword_avg: number | null;
  questions: number;
  date: string;
  domains: string[];
  scored: boolean;
  batch_id?: string | null;
  batch_label?: string | null;
  created_ms: number;
  cli?: string | null;
  model?: string | null;
  council?: boolean | null;
  // 3D Arena: speed + cost dimensions (null on older runs scored before this).
  ms_avg?: number | null;
  tokens_per_sec?: number | null;
  cost_usd_est?: number | null;
  cost_basis?: "local" | "frontier" | "mixed" | "unknown" | null;
}

export interface QuestionScore {
  id: string;
  domain: string;
  keyword_score: number | null;
  keyword_hits: string[];
  keyword_misses: string[];
  judge_score: number | null;
  judge_rationale: string | null;
}

export interface RunDetail {
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
    ms_avg?: number | null;
    tokens_per_sec?: number | null;
    cost_usd_est?: number | null;
    cost_basis?: "local" | "frontier" | "mixed" | "unknown" | null;
  };
}

export interface Framework {
  id: string;
  label: string;
  blurb: string;
  instruction: string;
}

export interface Lens {
  id: string;
  label: string;
  blurb: string;
  instruction: string;
}

export type TabId = "chat" | "council" | "benchmark" | "settings" | "work";

export type DomainTab = "chat" | "context" | "insights" | "usage" | "state" | "decisions" | "journal" | "logs" | "skills" | "prefs" | "apps" | "loops" | "work";

export type DomainToggle = "council" | "web" | "save" | "serendipity" | "auto";

export type CliVerifyInfo = { status: "unknown" | "verifying" | "ok" | "failed"; error?: string };

export type Mode = "light" | "dark" | "system";

export type Palette = "vault" | "midnight" | "ember" | "mono" | "cyberpunk" | "slate";

export interface ChatMessage {
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

export interface ChatEvent {
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

export interface SurfaceResult { questions: string[]; actions: string[]; generated_at: number; stale: boolean }

export interface DomainTask { text: string; done: boolean; due?: string | null; added?: string | null; source?: string | null; owner?: string | null; status?: string | null; id?: string | null }
// A task as returned by tasks_read_all (carries its domain + normalized owner/status/id).
export interface BoardTask { domain: string; text: string; done: boolean; due?: string | null; added?: string | null; source?: string | null; owner: string; status: string; id?: string | null; trashed?: string | null; priority?: string | null }
// A cross-domain item that needs the user's decision (from decisions_pending):
// a loop approval or an AI task awaiting review.
export interface DecisionItem { id: string; domain: string; kind: "approval" | "review"; source: "loop" | "task"; loopId?: string; taskId?: string | null; text: string; why?: string | null; ts: number }

export type AppRun = { ts: number; ok: boolean; skill: string; summary?: string; error?: string; duration_ms: number; artifacts: number };

export type AppRunHistory = { runs: AppRun[]; nextDueTs: number | null; consecutiveFailures: number };

export interface UsageBucket {
  key: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageSummary {
  total_turns: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  by_cli: UsageBucket[];
  by_model: UsageBucket[];
  by_domain: UsageBucket[];
  by_day: UsageBucket[];
}

export interface PanelistReply {
  cli: string;
  content: string;
  streaming: boolean;
  startedAt: number;
  stderr?: string;
}

export interface PanelistSlot {
  key: string;          // "<cli>::<model>"
  cli: string;
  cliLabel: string;
  model: string;        // empty string = CLI default
  modelLabel: string;
  blurb?: string;
}

export interface BenchQuestion {
  id: string;
  domain: string;
  prompt: string;
  context: string;
  notes: string;
  council: boolean;
  expected_decision: string;
  expected_verdict_keywords: string[];
  path: string;
  created?: string | null; // YYYY-MM-DD
  source?: string | null; // "user" | "ai"
  edited?: string | null; // YYYY-MM-DD last edit (prior text preserved in _versions/)
  archived?: boolean;
}

export interface MatrixDomainCell {
  judge_avg: number | null;
  keyword_avg: number | null;
  count: number;
}

export interface MatrixRow {
  label: string;
  run_dir: string;
  judge_avg: number | null;
  keyword_avg: number | null;
  per_domain: Record<string, MatrixDomainCell>;
}

export type BenchJobStatus = "queued" | "running" | "scoring" | "done" | "error" | "cancelled";

export interface BenchJob {
  key: string;
  cli: string;
  model: string;
  label: string;
  status: BenchJobStatus;
  note?: string;
  /// Per-question progress, parsed live from the engine's output lines.
  done: number;
  total: number;
  /// The scoped question ids this job will answer, in run order.
  qids: string[];
  /// id -> completion info ("Claude·opus", "council · 3 panelists", "✗ …").
  qdone: Record<string, string>;
  /// The question currently in flight, when detectable.
  qcur?: string;
}

export interface BenchBatch {
  id: string;
  label: string;
  scopeLabel: string; // human-readable scope ("All domains", "Wealth", …)
  scopeKey: string; // lowercase csv of scoped domains; "" = all
  scopeDomains: string[]; // titlecased, for chips + nav targeting
  vault: string;
  councilMode: boolean;
  jobs: BenchJob[];
  running: boolean;
  log: string;
  sessions: string[]; // engine session ids (jobs + scoring) for cancel
  cancelled: boolean;
  consumed: boolean; // a panel already showed the finished banner
}

export type ModelVerifyStatus = "unknown" | "verifying" | "ok" | "failed";

export type DaemonStatus = { running?: boolean; last_run_ts?: number | null; last_error?: string | null; lines_distilled?: number; tasks_generated?: number; skills_created?: number; domains_processed?: number; last_due_count?: number };

export type DirectProvider = { name: string; path?: string; hex?: string; mono?: string };

export type Connector = { name: string; domain: string; brand?: Brand; icon?: LucideIcon; color?: string };

export type ConnectionHint = { method: string; server?: string; command?: string; install?: string; privacy?: "local" | "vendor-cloud"; readOnly?: boolean; note?: string };
export type CatalogApp = { name: string; domain: string; tags?: string[]; pattern: string; fallback?: string; via?: string; note?: string; tier?: number; sources?: string[]; verified?: boolean; obscure?: boolean; iconSlug?: string; curated?: boolean; soul?: string; connection_hint?: ConnectionHint };

export type BrandLogo = { hex: string; path: string };

export type EngineApp = {
  id: string; title: string; integration: string; status: string; configured: boolean;
  domains: string[]; lastSuccessTs: number | null; lastError: string | null;
  // When set, this app is fronted by a managed gateway (Composio / Nango) rather
  // than connected directly. Keeps each connection mode's list separate (a Nango
  // app must never appear under Direct) and labels the method in the sidebar.
  gateway?: { provider: "composio" | "nango"; toolkit: string } | null;
  // The user's free-text "what to pull" instruction (drives the gateway sync).
  pullInstructions?: string | null;
  account: { label?: string; address?: string } | null;
  refresh: { every?: string; at?: string; on?: string } | null;
  autonomy?: string | null;
  connections?: { kind: string; description?: string }[] | null;
  // Whether the sync daemon may run this app. Absent / true = enabled.
  enabled?: boolean | null;
  community: boolean;
  path?: string | null;
  // Sync-state surfaced for the Apps view: when the next scheduled sync is due,
  // and the last few run-log entries (manual + autonomous).
  nextDueTs?: number | null;
  runs?: { ts: number; ok: boolean; skill?: string; summary?: string; error?: string; artifacts?: number }[];
  // The fetch gate: has this connector EVER pulled real data? Combined with
  // lastSuccessTs by appStatus() to separate a fetch-verified "connected" from
  // "authorized · verifying" (creds present, nothing pulled yet).
  firstFetchOk?: boolean;
  // Generic per-method auth: env-var names this connector needs (drives the
  // inline credential fields instead of the old PayPal-only hardcode). Empty
  // for OAuth (sign-in flow) and no-secret connectors.
  authEnvVars?: string[] | null;
  // For integration === "mcp": how the guided-setup card stands up the local
  // MCP server. `install` is shown/run with consent; `command` is the spawn target.
  mcpSetup?: { install?: string; command?: string } | null;
};

export type ConnectorCatalog = { version: number; domains?: string[]; apps: CatalogApp[]; patterns?: Record<string, { tier: string; label: string }> };

export type AlignmentReport = { method: string; overall: number; pillars: { pillar: string; score: number; trend: string; rationale: string }[]; actions: string[] };

export type PreambleOption = { id: string; label: string; blurb: string; instruction?: string };

export interface SkillEntry {
  domain: string;
  name: string;
  path: string;
  description: string | null;
}

export interface IngestionTierStatus {
  id: string;
  label: string;
  state: string;
  active: boolean;
  running: number;
  last_error: string | null;
}

export interface IngestionMcpServer {
  name: string;
  command: string;
  args: string[];
  running: boolean;
  pid: number | null;
}

export interface IngestionArtifact {
  tier_id: string;
  domain: string;
  source: string;
  path: string;
  sha256: string;
  size: number;
  original: string;
  ts: number;
}

export type CliProvider = { id: string; label: string; app: string; domain: string; binary: string; version_args: string[]; fetch_args: string[] };

export type IngestionAction =
  | { type: "goto"; url: string; wait_until?: string }
  | { type: "click"; selector: string; timeout_sec?: number }
  | { type: "wait_for"; selector: string; timeout_sec?: number }
  | { type: "select_option"; selector: string; value: string }
  | { type: "download_all_links"; selector: string; max?: number }
  | { type: "sleep"; seconds: number };

export interface PortalRecipe {
  id: string;
  label: string;
  domain_hint: string;
  start_url: string;
  success_url_contains: string | null;
  notes: string | null;
  actions?: IngestionAction[];
}

export interface IngestionAuditEntry {
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

export type DiagCheck = { label: string; status: "ok" | "warn" | "fail" | "info"; detail: string; why: string };

export interface TgBridgeStatus {
  running: boolean;
  last_update_id: number;
  last_inbound_ts: number | null;
  last_outbound_ts: number | null;
  last_error: string | null;
  inbound_count: number;
  outbound_count: number;
}

