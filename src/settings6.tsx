// Settings sections extracted from App.tsx: Privacy & Connectivity (Bunker Mode),
// Council defaults, Configuration (groups the memory/tasks/ideal sub-sections),
// and the Agents catalog (AgentCard + AgentsSection).
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Brain, Check, ChevronRight, Cloud, CloudOff, Cpu, Crown, FileX, FolderCheck, FolderX, Globe, ListChecks, Loader2, Lock, LockOpen, Search, Server, ShieldCheck, ShieldOff, Sigma, Target, Terminal, User, Wifi, WifiOff, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { CollapsibleSection } from "./collapsible";
import { DISCOVERED_MODELS, RUNTIME_META, VENDOR_BRAND, isHarnessRuntime } from "./constants";
import { isLocalCli } from "./helpers";
import { modelsFor, prettyModelId } from "./helpers2";
import { LS, PREF, getPref, isBunkerOn, lsGet, lsSet, setPref } from "./storage";
import { Ghost } from "lucide-react";
import { Toggle } from "./ui";
import { COUNCIL_CHAIR_KEY, COUNCIL_MEMBERS_KEY, councilModelsFor, councilSlotKey, readCouncilChair, readCouncilMembers } from "./council";
import { SettingsHeader, authLoginCmd } from "./sectionutil";
import { cliVerifyLive, loadVerifyMap, saveVerifyMap, setCliVerify, useCliVerifyLive, verifyCliDefaultModel } from "./verify";
import { ProviderMark } from "./marks";
import { MasterDetail } from "./masterdetail";
import { MemoryContextSection, TasksCrossDomainSection } from "./settings2";
import { TelemetrySettings } from "./settings4";
import type { CliInfo, ModelVerifyStatus, UsageSummary } from "./types";

// Consistent section header shared by the three privacy controls. Big, legible
// title + a one-line plain-language explanation of what the section governs, so
// each grouping reads on its own.
function PrivacyGroupHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-3">
      <h3 className="font-display text-lg font-semibold tracking-tight text-text-primary">{title}</h3>
      <p className="mt-1 max-w-2xl text-sm text-text-secondary">{blurb}</p>
    </div>
  );
}

// The compact per-channel status row shared by all three privacy controls, so
// each card has the same granularity. `good` = the protective/active state
// (highlighted cyan); otherwise muted. Sits inside the card under a divider.
type StatusChip = { Icon: LucideIcon; label: string; state: string; good: boolean };
function StatusChips({ items }: { items: StatusChip[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border-subtle pt-3">
      {items.map((t) => (
        <span
          key={t.label}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${t.good ? "border-ai/30 bg-ai/5 text-text-primary" : "border-border bg-surface text-text-muted"}`}
        >
          <t.Icon className={`h-3.5 w-3.5 ${t.good ? "text-ai" : "text-text-muted"}`} />
          {t.label}
          <span className="font-mono uppercase tracking-wide opacity-70">{t.state}</span>
        </span>
      ))}
    </div>
  );
}

// G3: the global incognito master. On = chat AND council run as a plain model
// with none of your context (profile, ideal state, omega, memory). Per-surface
// toggles in each composer can still go incognito just there.
function GlobalIncognitoToggle() {
  const [on, setOn] = useState(() => getPref(PREF.incognito, "0") === "1");
  // What the model sees right now, per context channel. `good` = hidden (the
  // private state), matching the cyan-when-protective convention.
  const chips: StatusChip[] = [
    { Icon: User, label: "Profile", state: on ? "Hidden" : "Used", good: on },
    { Icon: Target, label: "Ideal state", state: on ? "Hidden" : "Used", good: on },
    { Icon: Sigma, label: "Omega", state: on ? "Hidden" : "Used", good: on },
    { Icon: Brain, label: "Memory", state: on ? "Hidden" : "Used", good: on },
  ];
  return (
    <div className={`rounded-xl border p-4 ${on ? "border-accent-border bg-accent-soft/30" : "border-border bg-surface"}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}><Ghost className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{on ? "On - every surface runs blank" : "Off - your context is used"}</div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {on
              ? "Chat and council run as a plain model with no profile, ideal state, omega, or memory."
              : "Chat and council see your profile, ideal state, omega, and memory. You can still go incognito per-surface from each composer."}
          </div>
        </div>
        <Toggle on={on} onChange={(v) => { setOn(v); setPref(PREF.incognito, v ? "1" : "0"); }} label="Incognito everywhere" />
      </div>
      <StatusChips items={chips} />
    </div>
  );
}

// Vault Lock - the filesystem-scope switch. A SEPARATE dimension from Bunker
// Mode (which is about local vs cloud models). On = the assistant may only
// touch files inside the vault; off = full local-machine access. Default ON.
function VaultLockToggle() {
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    invoke<{ enabled: boolean }>("vault_lock_status").then((s) => setOn(!!s.enabled)).catch(() => {});
  }, []);
  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const s = await invoke<{ enabled: boolean }>("vault_lock_set", { enabled: next });
      setOn(!!s.enabled);
      // Tell the footer trust-bar to update immediately (it listens for this).
      window.dispatchEvent(new CustomEvent("prevail:vault-lock-changed"));
    } catch (e) { console.error("vault_lock_set", e); } finally { setBusy(false); }
  }
  // What the assistant can reach on disk right now. `good` = restricted to the
  // vault (the protective state), matching the cyan-when-protective convention.
  const chips: StatusChip[] = [
    { Icon: FolderCheck, label: "Vault", state: "Read/write", good: true },
    { Icon: FolderX, label: "Other folders", state: on ? "Blocked" : "Allowed", good: on },
    { Icon: FileX, label: "Outside files", state: on ? "Blocked" : "Allowed", good: on },
    { Icon: Terminal, label: "Local tools", state: on ? "Vault only" : "Whole machine", good: on },
  ];
  return (
    <div className={`rounded-xl border p-4 ${on ? "border-accent-border bg-accent-soft/30" : "border-border bg-surface"}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
          {on ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{on ? "On - vault only" : "Off - whole machine"}</div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {on
              ? "The assistant may only read and write files inside your vault. The rest of your machine is off-limits - no scanning other folders, no outside files, no tools that reach beyond the vault."
              : "Full local-machine access. The assistant can scan any directory and use local tools across your computer."}
          </div>
        </div>
        <Toggle on={on} disabled={busy} onChange={toggle} label="Vault Lock" />
      </div>
      <StatusChips items={chips} />
    </div>
  );
}

export function PrivacyConnectivitySection({ enabled, onChange }: { enabled: boolean; onChange: (on: boolean) => void }) {
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

  // What's blocked vs open right now, as visual tiles. "good" = the
  // privacy-protective state (blocked / available). Each maps an icon to its
  // on/off variant so the page reads at a glance.
  const tiles = [
    {
      good: !!status?.network_blocked,
      Icon: status?.network_blocked ? WifiOff : Wifi,
      label: "Network",
      state: status?.network_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.web_blocked,
      Icon: status?.web_blocked ? Search : Globe,
      label: "Web search",
      state: status?.web_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.cloud_blocked,
      Icon: status?.cloud_blocked ? CloudOff : Cloud,
      label: "Cloud AI",
      state: status?.cloud_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.local_available,
      Icon: Cpu,
      label: "Local models",
      state: status?.local_available ? "Available" : "Not detected",
    },
  ];

  return (
    <>
      <SettingsHeader
        title="Privacy"
        subtitle="Three independent controls, each answering a different question. They work in any combination."
      />

      {/* ── SECTION 1 - BUNKER MODE: where your data can go ─────────────────── */}
      <section>
        <PrivacyGroupHead
          title="Bunker Mode"
          blurb="Where your data can go. On = nothing leaves this device: local models only, no network, no cloud AI, no web search."
        />

        {/* Control card - SAME shape/weight as Vault Lock and Incognito so no one
            section dominates. The per-channel live status lives inside the card
            as compact chips, not a separate hero grid. */}
        <div className={`rounded-xl border p-4 ${enabled ? "border-accent-border bg-accent-soft/30" : "border-border bg-surface"}`}>
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${enabled ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
              {enabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-primary">{enabled ? "On - fully local" : "Off - cloud connected"}</div>
              <div className="mt-0.5 text-xs text-text-secondary">
                {enabled
                  ? "Everything stays on this device. Nothing leaves your machine."
                  : "Cloud AI, web search, and network access are available and may transmit data."}
              </div>
            </div>
            <Toggle on={enabled} disabled={busy} onChange={onToggle} label="Bunker Mode" />
          </div>

          {/* Compact live status - what's blocked vs open right now. */}
          <StatusChips items={tiles} />
          {!status?.local_available && enabled && (
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
              <Cpu className="h-3.5 w-3.5" /> No local model detected. Install Ollama to run on-device.
            </a>
          )}
        </div>
      </section>

      {/* Leave-Bunker-Mode confirmation */}
      {confirmOff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setConfirmOff(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-black/20 bg-[#141416] px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <ShieldOff className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold text-white">Leave Bunker Mode?</h3>
                <p className="text-xs text-white/60">This opens your machine to the network.</p>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-text-secondary">Turning this off enables:</p>
              <div className="mt-3 grid grid-cols-1 gap-2">
                {([
                  [Cloud, "Cloud AI providers"],
                  [Globe, "Internet access"],
                  [Search, "Web search"],
                  [Server, "External services"],
                ] as const).map(([Icon, label]) => (
                  <div key={label} className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
                    <Icon className="h-4 w-4 shrink-0 text-text-muted" />
                    {label}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-text-muted">Your data may be transmitted to third-party services depending on which features you use.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle bg-surface-warm/40 px-5 py-3">
              <button onClick={() => setConfirmOff(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-strong">Cancel</button>
              <button onClick={() => void setBunker(false)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#141416] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50">
                <ShieldOff className="h-4 w-4" /> Leave Bunker Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 2 - VAULT LOCK: what files the assistant can touch ──────── */}
      <section className="mt-6 border-t border-border-subtle pt-6">
        <PrivacyGroupHead
          title="Vault Lock"
          blurb="What files the assistant can touch on your machine. On = your vault only; the rest of your computer is off-limits. Independent of Bunker Mode."
        />
        <VaultLockToggle />
      </section>

      {/* ── SECTION 3 - INCOGNITO: how much of you the model sees ───────────── */}
      <section className="mt-6 border-t border-border-subtle pt-6">
        <PrivacyGroupHead
          title="Incognito"
          blurb="How much of you the model sees. On = a blank model with none of your context. You can also go incognito per-surface from each composer."
        />
        <GlobalIncognitoToggle />
      </section>

      {/* Telemetry lives under Privacy (moved from Safety). Anonymous, opt-in,
          default-OFF. Brings its own border-t / heading. */}
      <TelemetrySettings />
    </>
  );
}

// ─── General preferences storage ──────────────────────────────────────
// Read/write small boolean + string prefs to localStorage with sensible
// defaults. Exported helpers used at call sites (textarea, chat chunk
// handlers, etc.) to read live.

// A visual "round table": the panel drawn as seats around a ring, the chair
// crowned at the top, spokes to a central emblem. New seats animate in as members
// are added, so picking a council feels like assembling a table, not editing a
// list. Why it matters: the council's value is the spread of independent minds -
// seeing them arranged makes that legible at a glance.
function CouncilCircle({ members, chair, clis }: { members: string[]; chair: string; clis: CliInfo[] }) {
  const size = 232, R = 84, cx = size / 2, cy = size / 2, seat = 46;
  // Chair first so it always takes the top seat; the rest fan around clockwise.
  const ordered = [chair, ...members.filter((m) => m && m !== chair)].filter(Boolean);
  const n = ordered.length;
  const labelFor = (key: string) => {
    const [cli, model] = key.split("::");
    const c = clis.find((x) => x.id === cli);
    const m = councilModelsFor(cli).find((x) => x.id === model);
    return `${c?.label ?? cli} · ${m?.label ?? (prettyModelId(model || "") || "default")}`;
  };
  // B2-4: the short model name shown UNDER each seat (e.g. "Opus 4.7"), so the
  // ring labels its models, not just provider glyphs.
  const modelShort = (key: string) => {
    const [cli, model] = key.split("::");
    const m = councilModelsFor(cli).find((x) => x.id === model);
    return (m?.label ?? (prettyModelId(model || "") || "default")).replace(/\s*\(.*?\)\s*/g, "").trim();
  };
  if (n === 0) {
    return (
      <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center">
        <Crown className="h-7 w-7 text-text-muted" />
        <div className="text-sm text-text-secondary">No one seated yet</div>
        <div className="text-xs text-text-muted">Pick models below to assemble your council.</div>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center py-2">
      <style>{`@keyframes councilSeatIn{from{opacity:0;transform:translate(-50%,-50%) scale(.4)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`}</style>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="absolute inset-0" aria-hidden>
          <circle cx={cx} cy={cy} r={R} fill="none" className="stroke-border-subtle" strokeWidth={1} />
          {ordered.map((key, i) => {
            const a = -Math.PI / 2 + i * ((2 * Math.PI) / n);
            return <line key={key} x1={cx} y1={cy} x2={cx + R * Math.cos(a)} y2={cy + R * Math.sin(a)} className="stroke-border-subtle" strokeWidth={1} />;
          })}
        </svg>
        {/* Center emblem: the panel size at a glance. */}
        <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-border bg-background">
          <span className="font-display text-base font-bold leading-none text-text-primary">{members.length}</span>
          <span className="font-mono text-[7px] uppercase tracking-wider text-text-muted">panel</span>
        </div>
        {ordered.map((key, i) => {
          const a = -Math.PI / 2 + i * ((2 * Math.PI) / n);
          const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
          const isChair = key === chair;
          const cli = key.split("::")[0];
          return (
            <div
              key={key}
              title={`${labelFor(key)}${isChair ? " (chair)" : ""}`}
              className="absolute"
              style={{ left: x, top: y, width: seat, height: seat, transform: "translate(-50%,-50%)", animation: "councilSeatIn .3s cubic-bezier(0.22,1,0.36,1)" }}
            >
              <div className={`relative flex h-full w-full items-center justify-center rounded-full border bg-background ${isChair ? "border-accent ring-2 ring-accent/30" : "border-border"}`}>
                <ProviderMark vendor={cli} size={26} />
                {isChair && (
                  <span className="absolute -top-2.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-background shadow-sm">
                    <Crown className="h-3 w-3" />
                  </span>
                )}
              </div>
              {/* B2-4: model name under the seat. */}
              <div className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-center font-mono text-[8px] leading-tight text-text-secondary">
                {modelShort(key)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Live aggregate stats over the same council member set the ring draws. Every
// number recomputes (useMemo) as models are added or removed, so the panel reads
// as a running portrait of the council you are assembling: how big it is, how it
// splits open-source vs cloud, how many distinct vendors sit at the table, local
// vs remote, and a rough "what would it cost to run all of these at once" gauge.
//
// Classification is intentionally string-based (lowercase cli + model + label):
// each member is open-source if it matches an OSS token, cloud if it matches a
// cloud token, otherwise unknown. Local == the open-source / on-device set.
const COUNCIL_OSS_TOKENS = ["ollama", "llama", "mistral", "qwen", "deepseek", "gemma", "phi", "mixtral", "mlx", "lmstudio"];
const COUNCIL_CLOUD_TOKENS = ["claude", "anthropic", "gpt", "openai", "codex", "gemini", "google", "grok", "xai", "kimi"];

// Relative "burn" weight per member. Cloud flagships are the heaviest (~3),
// mid-tier cloud ~2, anything local ~1. No real cost metadata is exposed in this
// codebase, so this is a deliberately rough, clearly-labelled estimate.
function councilMemberWeight(hay: string, isOss: boolean): number {
  if (isOss) return 1;
  const flagship = ["opus", "gpt-5", "gpt5", "gemini-2.5-pro", "gemini-pro", "grok-4", "o3", "o1"];
  if (flagship.some((t) => hay.includes(t))) return 3;
  return 2; // mid cloud (sonnet, haiku, gpt-4o-mini, flash, etc.)
}

// Estimated dollar cost for ONE member to answer one council question. Local /
// open-source models run on-device, so $0. Cloud models use a rough blended
// $/1M-tokens by tier times a typical council-turn size. Deliberately an
// estimate (real prices vary by provider + exact model), but a concrete figure
// is far more useful than "$$$". Tuned to land in a believable per-run range.
const COUNCIL_TURN_TOKENS = 6000; // ~prompt + context + answer for one seat
function councilMemberCostUsd(hay: string, isOss: boolean): number {
  if (isOss) return 0; // on-device, no API spend
  const flagship = ["opus", "gpt-5", "gpt5", "gemini-2.5-pro", "gemini-pro", "grok-4", "o3", "o1"];
  const perMillion = flagship.some((t) => hay.includes(t)) ? 18 : 4; // blended $/1M tokens
  return (COUNCIL_TURN_TOKENS / 1_000_000) * perMillion;
}
// Format a small USD figure without losing precision on cheap panels.
function fmtUsd(n: number): string {
  if (n <= 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function CouncilStats({ members, clis }: { members: string[]; clis: CliInfo[] }) {
  const stats = useMemo(() => {
    const total = members.length;
    // Build the lowercase haystack (cli + model + resolved label) per member.
    const classify = members.map((key) => {
      const [cli, model] = key.split("::");
      const c = clis.find((x) => x.id === cli);
      const m = councilModelsFor(cli).find((x) => x.id === model);
      const label = `${c?.label ?? cli} ${m?.label ?? model ?? ""}`;
      const hay = `${cli} ${model ?? ""} ${label}`.toLowerCase();
      const isOss = COUNCIL_OSS_TOKENS.some((t) => hay.includes(t));
      const isCloud = !isOss && COUNCIL_CLOUD_TOKENS.some((t) => hay.includes(t));
      return { cli, hay, isOss, isCloud };
    });
    const oss = classify.filter((x) => x.isOss).length;
    // Anything not matched as open-source is treated as cloud for the split so the
    // two segments always sum to the panel size (unknown providers are remote).
    const cloudish = total - oss;
    const ossPct = total ? Math.round((oss / total) * 100) : 0;
    const cloudPct = total ? 100 - ossPct : 0;
    const vendors = Array.from(new Set(classify.map((x) => x.cli)));
    const local = oss; // local == the open-source / on-device set
    const remote = total - local;
    const burn = classify.reduce((sum, x) => sum + councilMemberWeight(x.hay, x.isOss), 0);
    const maxBurn = total * 3 || 1; // all-flagship-cloud ceiling
    const burnPct = Math.round((burn / maxBurn) * 100);
    const burnTier = burnPct >= 67 ? "$$$" : burnPct >= 34 ? "$$" : "$";
    // Concrete dollar estimate: sum each cloud member's per-run cost (local = $0).
    const costUsd = classify.reduce((sum, x) => sum + councilMemberCostUsd(x.hay, x.isOss), 0);
    return { total, oss, cloud: cloudish, ossPct, cloudPct, vendors, local, remote, burn, burnPct, burnTier, costUsd };
  }, [members, clis]);

  if (stats.total === 0) {
    return (
      <div className="flex h-full min-h-[180px] flex-col items-center justify-center p-4 text-center">
        <ListChecks className="h-6 w-6 text-text-muted" />
        <div className="mt-2 text-sm text-text-secondary">No stats yet</div>
        <div className="text-xs text-text-muted">Seat some models to see the panel breakdown.</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Panel stats</div>

      {/* Number cards: panel size + providers. */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-border-subtle bg-background p-3">
          <div className="font-display text-2xl font-bold leading-none text-text-primary">{stats.total}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">Panel size</div>
        </div>
        <div className="rounded-lg border border-border-subtle bg-background p-3">
          <div className="font-display text-2xl font-bold leading-none text-text-primary">{stats.vendors.length}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">Provider{stats.vendors.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* Open-source vs cloud split + two-segment bar. */}
      <div className="rounded-lg border border-border-subtle bg-background p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><Cpu className="h-3.5 w-3.5 text-ok" /> {stats.ossPct}% open <span className="text-text-muted">({stats.oss})</span></span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><Cloud className="h-3.5 w-3.5 text-accent" /> {stats.cloudPct}% cloud <span className="text-text-muted">({stats.cloud})</span></span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-warm">
          <div className="h-full bg-ok" style={{ width: `${stats.ossPct}%` }} />
          <div className="h-full bg-accent" style={{ width: `${stats.cloudPct}%` }} />
        </div>
      </div>

      {/* Local vs remote split (local = the open-source / on-device set). */}
      <div className="rounded-lg border border-border-subtle bg-background p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><Server className="h-3.5 w-3.5 text-text-muted" /> {stats.local} local</span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><Globe className="h-3.5 w-3.5 text-text-muted" /> {stats.remote} remote</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-warm">
          <div className="h-full bg-ok" style={{ width: `${stats.total ? (stats.local / stats.total) * 100 : 0}%` }} />
          <div className="h-full bg-text-muted/60" style={{ width: `${stats.total ? (stats.remote / stats.total) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Estimated dollar cost for one full panel run (every seat answers once). */}
      <div className="mt-auto rounded-lg border border-border-subtle bg-background p-3">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Est. cost / panel run</span>
          <span className="font-display text-lg font-bold text-accent">{fmtUsd(stats.costUsd)} <span className="font-mono text-[10px] font-normal text-text-muted">{stats.burnTier}</span></span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-warm">
          <div className="h-full bg-accent" style={{ width: `${stats.burnPct}%` }} />
        </div>
        <div className="mt-1.5 text-[10px] text-text-muted">
          Rough estimate: ~{(COUNCIL_TURN_TOKENS / 1000).toFixed(0)}K tokens/seat at blended cloud rates; local models are free. Actual prices vary.
        </div>
      </div>
    </div>
  );
}

export function CouncilSettingsSection({ clis }: { clis: CliInfo[] }) {
  const available = useMemo(() => clis.filter((c) => c.available && (!isBunkerOn() || isLocalCli(c.id))), [clis]);
  const [members, setMembers] = useState<Set<string>>(() => new Set(readCouncilMembers()));
  const [chair, setChair] = useState<string>(() => readCouncilChair());
  // Each provider expands/collapses INDEPENDENTLY - a Set of open provider ids,
  // not a single value (opening one never closes another).
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set());
  // Per-provider catalog search (aggregators like OpenRouter expose hundreds of
  // models — search, don't scroll a fixed list).
  const [panelSearch, setPanelSearch] = useState<Record<string, string>>({});
  // Once providers are detected: prune any stale slot keys that no longer map to
  // a real (available provider, model) - that's what made the count drift from
  // the visible badges - then seed a sensible default if the panel is empty.
  // Discovered (live-catalog) models count as valid too, so a model added via
  // search (e.g. an OpenRouter GLM) isn't pruned away on the next mount.
  useEffect(() => {
    if (available.length === 0) return;
    const valid = new Set<string>();
    for (const c of available) {
      for (const m of councilModelsFor(c.id)) valid.add(councilSlotKey(c.id, m.id));
      for (const m of (DISCOVERED_MODELS[c.id] ?? [])) valid.add(councilSlotKey(c.id, m.id));
    }
    setMembers((prev) => {
      const pruned = new Set([...prev].filter((k) => valid.has(k)));
      if (pruned.size > 0) return pruned.size === prev.size ? prev : pruned;
      // Empty after pruning → seed the first model of the first three providers.
      return new Set(available.slice(0, 3).map((c) => councilSlotKey(c.id, councilModelsFor(c.id)[0].id)));
    });
    setExpandedSet((e) => (e.size ? e : new Set([available[0].id])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);
  useEffect(() => { lsSet(COUNCIL_MEMBERS_KEY, JSON.stringify([...members])); window.dispatchEvent(new Event("prevail:council-changed")); }, [members]);
  useEffect(() => {
    lsSet(COUNCIL_CHAIR_KEY, chair);
    const cli = chair.split("::")[0];
    if (cli) lsSet(LS.defaultChairCli, cli); // back-compat
    window.dispatchEvent(new Event("prevail:council-changed"));
  }, [chair]);
  // Chair must be a current member.
  useEffect(() => {
    if (members.size && !members.has(chair)) setChair([...members][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const toggle = (key: string) => setMembers((m) => { const n = new Set(m); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // Resolve a readable chair label from its slot key.
  const chairLabel = (() => {
    if (!chair) return "-";
    const [cli, model] = chair.split("::");
    const c = clis.find((x) => x.id === cli);
    const m = councilModelsFor(cli).find((x) => x.id === model);
    return `${c?.label ?? cli} · ${m?.label ?? (model || "default")}`;
  })();

  return (
    <>
      <SettingsHeader title="Council" subtitle="Convene several models on one question: each answers independently, then a chair writes the verdict. Pick the exact models on your default panel (you can add several from the same provider)." />
      {/* G3 (Monday feedback): make it explicit that the panel saves as you edit. */}
      <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-surface-warm px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        <Check className="h-3 w-3 text-ok" /> Changes save automatically
      </div>
      {/* One seamless panel: the round table on the left (prominent, centered),
          a divider, then the live aggregate stats on the right. Stacks on narrow
          widths (divider becomes a top border on the stats half). */}
      <div className="mb-5 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <div className="flex items-center justify-center p-4 lg:w-[42%] lg:shrink-0">
            <CouncilCircle members={[...members]} chair={chair} clis={clis} />
          </div>
          <div className="min-w-0 flex-1 border-t border-border-subtle lg:border-l lg:border-t-0">
            <CouncilStats members={[...members]} clis={clis} />
          </div>
        </div>
      </div>
      {/* Compact summary bar - what the panel is right now. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-accent-border bg-accent-soft px-4 py-3 text-sm">
        <span className="font-semibold text-text-primary">{members.size} model{members.size === 1 ? "" : "s"} on the panel</span>
        <span className="inline-flex items-center gap-1 text-text-secondary"><Crown className="h-3.5 w-3.5 text-accent" /> chair: <span className="font-medium text-text-primary">{chairLabel}</span></span>
      </div>
      <div className="space-y-2">
        {available.length === 0 && <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-text-muted">No providers available{isBunkerOn() ? " in Bunker Mode (local only)" : ""}.</div>}
        {available.map((c) => {
          const curated = councilModelsFor(c.id);
          const live = DISCOVERED_MODELS[c.id] ?? [];
          // Aggregators (OpenRouter) ship a big live catalog — make every model
          // reachable via search, not just the curated handful.
          const isAggregator = live.length > 0;
          const q = (panelSearch[c.id] ?? "").trim().toLowerCase();
          // Slot keys already on the panel for this provider (so search-added
          // models still render as checked, even if not in the curated list).
          const onPanelIds = [...members].filter((k) => k.startsWith(`${c.id}::`)).map((k) => k.slice(c.id.length + 2));
          const picked = onPanelIds.length;
          let models: { id: string; label: string; blurb?: string }[];
          if (isAggregator && q) {
            models = live.filter((m) => `${m.id} ${m.label ?? ""}`.toLowerCase().includes(q)).slice(0, 40)
              .map((m) => ({ id: m.id, label: m.label && m.label !== m.id ? m.label : m.id, blurb: "" }));
          } else if (isAggregator) {
            const curatedIds = new Set(curated.map((m) => m.id));
            const extras = onPanelIds.filter((id) => !curatedIds.has(id)).map((id) => {
              const lm = live.find((x) => x.id === id);
              return { id, label: lm?.label ?? id, blurb: "" };
            });
            models = [...curated, ...extras];
          } else {
            models = curated;
          }
          const isExp = expandedSet.has(c.id);
          return (
            <div key={c.id} className={`overflow-hidden rounded-lg border bg-surface transition-colors ${isExp || picked > 0 ? "border-accent-border" : "border-border-subtle"}`}>
              <button onClick={() => setExpandedSet((e) => { const n = new Set(e); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${isExp ? "rotate-90" : ""}`} strokeWidth={2.5} />
                <ProviderMark vendor={c.id} size={26} />
                <span className="flex-1 font-display text-sm font-semibold text-text-primary">{c.label}</span>
                {picked > 0 && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-background">{picked} on panel</span>}
                <span className="shrink-0 font-mono text-[10px] text-text-muted">{isAggregator ? `${live.length} models, search` : `${models.length} model${models.length === 1 ? "" : "s"}`}</span>
              </button>
              {isExp && (
                <div className="space-y-1.5 border-t border-border-subtle bg-background/40 p-3">
                  {isAggregator && (
                    <div className="relative mb-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                      <input
                        value={panelSearch[c.id] ?? ""}
                        onChange={(e) => setPanelSearch((s) => ({ ...s, [c.id]: e.target.value }))}
                        placeholder={`Search all ${live.length} models (e.g. glm, kimi, qwen)…`}
                        className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
                      />
                    </div>
                  )}
                  {models.length === 0 && (
                    <div className="px-1 py-2 font-mono text-[11px] text-text-muted">No models match "{panelSearch[c.id]}".</div>
                  )}
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
        Convene a council from the <span className="text-accent">Council</span> tab in any domain: it starts with this panel. Each model answers in parallel; the <Crown className="inline h-3 w-3" /> chair synthesizes a consensus + disagreements + recommended action. <span className="text-accent">Defaults</span> sets your single-model chat; this sets the panel.
      </p>
    </>
  );
}



// FrameworkPickerCard was deleted with v0.2.92 - the chip-row UI
// it provided lived only in Settings → Defaults as a duplicate of
// the dedicated Settings → Frameworks page. The full two-column
// FrameworksSection is now the single source of truth.

// ─────────────────────────────────────────────────────────────────────
// Integration cards (Telegram / WhatsApp / MCP / Briefings) are now
// rendered directly inside Settings → Integrations. Old ToolsPanel
// wrapper removed.

export function ConfigurationSection({ vaultPath }: { vaultPath: string }) {
  // Configuration's sub-sections route through the canonical CollapsibleSection
  // (icon + title/subtitle left, collapsed by default, persisted per section).
  const Sub = ({ id, title, icon, desc, children }: { id: "memory" | "tasks"; title: string; icon: LucideIcon; desc: string; children: React.ReactNode }) => (
    <CollapsibleSection icon={icon} title={title} subtitle={desc} storageKey={`prevail.settings.config.${id}`}>
      {children}
    </CollapsibleSection>
  );
  return (
    <>
      <SettingsHeader
        title="Memory engine"
        icon={Brain}
        subtitle="Persistent memory, distillation, and the cross-domain task ledger. Your Ideal State lives in Ideals."
      />
      {/* D2: Ideal State removed here - it has its own Ideals surface and lives in
          the Context panel, so repeating it on this page was a duplicate. */}
      <div className="space-y-2">
        <Sub id="memory" title="Memory & Context" icon={Brain} desc="Persistent memory, distillation, and what stays in context across sessions.">
          <MemoryContextSection vaultPath={vaultPath} headerless />
        </Sub>
        <Sub id="tasks" title="Tasks" icon={ListChecks} desc="Cross-domain task ledger: every pending item across your vault in one view.">
          <TasksCrossDomainSection vaultPath={vaultPath} />
        </Sub>
      </div>
    </>
  );
}

export function AgentCard({
  cli,
  onStartChat,
  isDefault,
  onMakeDefault,
  cost,
  chattable = true,
  forceOpen = false,
}: {
  cli: CliInfo;
  onStartChat?: (cliId: string, modelId?: string) => void;
  isDefault?: boolean;
  onMakeDefault?: () => void;
  /** Cumulative spend on this runtime (USD), from the usage ledger. */
  cost?: number;
  /** Whether this runtime can power the chat composer. Harnesses are false —
      they're catalog-only and never offered "Start chat". */
  chattable?: boolean;
  /** Render always-expanded with no collapse chevron - used as the detail pane
      in the Runtimes master-detail, where the row IS the only thing shown. */
  forceOpen?: boolean;
}) {
  const brand = VENDOR_BRAND[cli.id] ?? VENDOR_BRAND.other;
  const liveVerify = useCliVerifyLive();
  // Re-render when live discovery fills in new models.
  const [, setModelsNonce] = useState(0);
  useEffect(() => {
    const h = () => setModelsNonce((n) => n + 1);
    window.addEventListener("prevail:models-refreshed", h);
    return () => window.removeEventListener("prevail:models-refreshed", h);
  }, []);
  const models = modelsFor(cli.id);
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
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
  const [cmdCopied, setCmdCopied] = useState(false);

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
      setCliVerify(cli.id, { status: "ok" }); // any working model = usable provider
    } catch (e) {
      setStatus((s) => ({ ...s, [modelId]: "failed" }));
      setErrors((er) => ({ ...er, [modelId]: String(e).slice(0, 200) }));
      // Only demote the provider when nothing of it has verified ok.
      if (cliVerifyLive.get(cli.id)?.status !== "ok") {
        setCliVerify(cli.id, { status: "failed", error: String(e).slice(0, 200) });
      }
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
    if (!isOpen) return;
    const unverified = models.some((m) => status[m.id] !== "ok");
    if (unverified) verifyAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function StatusGlyph({ s }: { s: ModelVerifyStatus | undefined }) {
    if (s === "ok") return <span className="text-accent" title="Verified">✓</span>;
    if (s === "verifying") return <span className="text-text-muted animate-pulse" title="Verifying…">◐</span>;
    if (s === "failed") return <span className="text-warn" title="Failed verification">✗</span>;
    return <span className="text-text-muted/60" title="Not yet verified">○</span>;
  }

  const cliErr = liveVerify.get(cli.id);
  return (
    <div className={forceOpen ? "bg-surface" : `rounded-lg border bg-surface transition-colors ${open ? "border-accent-border" : "border-border-subtle"}`}>
      {/* Single-line runtime row, Multica-style columns: Runtime · Health · Cost
          · Version · action. Column widths mirror the header strip in AgentsSection. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <ProviderMark vendor={cli.id} size={40} />
        {/* Runtime identity (click to expand the model list; no-op in detail mode). */}
        <button
          onClick={() => !forceOpen && cli.available && setOpen((v) => !v)}
          disabled={forceOpen || !cli.available || models.length === 0}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          {!forceOpen && cli.available && models.length > 0 && (
            <span className="shrink-0 text-[11px] text-text-muted">{open ? "▾" : "▸"}</span>
          )}
          <span className="truncate font-display text-sm font-semibold tracking-tight">{cli.label}</span>
          {isDefault && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-background">
              <Check className="h-2.5 w-2.5" strokeWidth={3} /> Default
            </span>
          )}
          <span className="truncate font-mono text-[10px] text-text-muted/60">{brand.name}</span>
        </button>
        {/* Health column. Color-coded so valid/not-installed read at a glance:
            green for valid, amber for checking/not-valid, neutral muted for
            not-installed. */}
        <div className="flex w-[124px] shrink-0 flex-col items-start gap-0.5">
          {(() => {
            const v = cli.available ? cliVerifyLive.get(cli.id) : undefined;
            const chip = !cli.available
              ? cli.error
                ? { cls: "border-danger/40 bg-danger/10 text-danger", label: "Broken", Icon: X, spin: false }
                : { cls: "border-border bg-surface-warm text-text-muted", label: "Not installed", Icon: null, spin: false }
              : v?.status === "ok"
                ? { cls: "border-ok/40 bg-ok/10 text-ok", label: "Valid", Icon: Check, spin: false }
                : v?.status === "failed"
                  ? { cls: "border-danger/40 bg-danger/10 text-danger", label: "Not valid", Icon: X, spin: false }
                  : v?.status === "verifying"
                    ? { cls: "border-warn/40 bg-warn/10 text-warn", label: "Checking", Icon: Loader2, spin: true }
                    : { cls: "border-border bg-background text-text-muted", label: "Detected", Icon: null, spin: false };
            return (
              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${chip.cls}`}>
                {chip.Icon && <chip.Icon className={`h-2.5 w-2.5 ${chip.spin ? "animate-spin" : ""}`} strokeWidth={3} />}
                {chip.label}
              </span>
            );
          })()}
          {cli.available && models.length > 0 && (
            <span className="font-mono text-[10px] text-text-muted">{models.filter((m) => status[m.id] === "ok").length}/{models.length} verified</span>
          )}
        </div>
        {/* Cost column (cumulative spend on this runtime). */}
        <div className="w-[64px] shrink-0 text-right font-mono text-[11px] text-text-secondary" title="Total spend on this runtime (local usage ledger)">
          {typeof cost === "number" && cost > 0
            ? `$${cost < 1 ? cost.toFixed(2) : cost < 100 ? cost.toFixed(1) : Math.round(cost)}`
            : <span className="text-text-muted/50">—</span>}
        </div>
        {/* Version column. */}
        <div className="w-[116px] shrink-0 truncate text-right font-mono text-[10px] text-text-muted/80">
          {cli.available ? (cli.version ?? `${cli.bin} in PATH`) : cli.error ? "won't run" : `${cli.bin} not found`}
        </div>
        {cli.available && chattable ? (
          <button
            onClick={() => onStartChat?.(cli.id)}
            className="w-[92px] shrink-0 rounded-md border border-accent-border bg-accent-soft py-1.5 text-center font-mono text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent hover:text-background"
          >
            Start chat
          </button>
        ) : cli.available && !chattable ? (
          // Harness, installed: catalog-only (not a homepage chat runtime).
          <span className="inline-flex w-[92px] shrink-0 items-center justify-center font-mono text-[10px] uppercase tracking-wider text-text-muted/60" title="Harness — set up here; not a chat runtime">
            Ready
          </span>
        ) : (
          // Not installed → prompt setup with a link to the install docs.
          <a
            href={RUNTIME_META[cli.id]?.install ?? "#"}
            target="_blank"
            rel="noreferrer"
            title={RUNTIME_META[cli.id]?.blurb ? `${RUNTIME_META[cli.id]?.blurb} — opens setup docs` : "Open setup docs"}
            className="inline-flex w-[92px] shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-background py-1.5 text-center font-mono text-[11px] uppercase tracking-wider text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
          >
            Set up <ArrowUpRight className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Why it's not valid, on the card face: usually an auth/token problem,
          so lead with the fix (the login command) rather than the stack. */}
      {cli.available && cliErr?.status === "failed" && cliErr.error && (
        <div className="flex items-start gap-2 border-t border-border-subtle bg-warn/5 px-4 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            {(() => {
              const loginCmd = authLoginCmd(cli.id, cliErr.error ?? "");
              return loginCmd ? (
                <span className="text-xs text-text-secondary">
                  Not signed in. Run <code className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[11px] text-accent">{loginCmd}</code> in a terminal, then hit Re-check.
                </span>
              ) : (
                <span className="line-clamp-2 text-xs text-text-secondary">{cliErr.error}</span>
              );
            })()}
          </div>
          <button
            onClick={() => void verifyCliDefaultModel(cli.id)}
            className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          >
            Re-check
          </button>
        </div>
      )}

      {isOpen && cli.available && models.length > 0 && (
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
                            · not signed in: run{" "}
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
                      onClick={() => {
                        // Jump to the Benchmark cockpit with this model's runs
                        // expanded (key matches the leaderboard aggregation).
                        lsSet("prevail.bench.expandModel", `${cli.id}::${m.label}`);
                        window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: "benchmark" }));
                      }}
                      title={`Benchmark runs for ${m.label}: scores, domains, history`}
                      className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                    >
                      runs
                    </button>
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

      {/* Installed but no model list (harnesses): the body was previously blank,
          which read as "broken." Explain what it is and that it's ready. */}
      {isOpen && cli.available && models.length === 0 && (
        <div className="space-y-2 border-t border-border-subtle px-4 py-3">
          <div className="text-sm text-text-secondary">
            {RUNTIME_META[cli.id]?.blurb || `${cli.label} is a harness runtime.`}
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            This is a <span className="font-semibold text-text-secondary">harness</span> — it wraps the{" "}
            <code className="text-accent">{RUNTIME_META[cli.id]?.protocol ?? "base"}</code> protocol and runs through your installed base CLI. It's installed and validated, so it's ready to use wherever harnesses are offered (it isn't a homepage chat runtime).
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="font-mono text-[10px] text-text-muted/80">{cli.version ? `version ${cli.version} · ` : ""}{cli.bin}</span>
            {RUNTIME_META[cli.id]?.install && (
              <a href={RUNTIME_META[cli.id]!.install} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
                Docs <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Not installed: a real setup body (not just a tiny link), so the detail
          pane always says something actionable. */}
      {isOpen && !cli.available && (
        <div className="space-y-2.5 border-t border-border-subtle px-4 py-3">
          <div className="text-sm text-text-secondary">
            {cli.error
              ? `${cli.label} is installed but won't run — its launcher is on disk but failed to start.`
              : RUNTIME_META[cli.id]?.blurb || `${cli.label} isn't installed on this Mac yet.`}
          </div>
          {/* Broken install: show the actual failure so the user knows what to
              fix (the most common cause is a wrapper pointing at a removed env). */}
          {cli.error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-text-secondary">{cli.error}</code>
            </div>
          )}
          <div className="space-y-2 rounded-lg border border-border-subtle bg-background p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{cli.error ? `Reinstall ${cli.label}` : `Set up ${cli.label}`}</div>
            <p className="text-xs leading-relaxed text-text-secondary">
              {cli.error
                ? `Reinstall ${cli.label} to repair the launcher. It runs on your own subscription — no key to paste here. Prevail auto-detects it; hit Re-check once it's fixed.`
                : `Install ${cli.label} from its setup guide. It runs on your own subscription — no key to paste here. Prevail auto-detects it; hit Re-check once it's installed.`}
            </p>
            {RUNTIME_META[cli.id]?.cmd && (
              <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-warm/60 px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary" title={RUNTIME_META[cli.id]!.cmd}>{RUNTIME_META[cli.id]!.cmd}</code>
                <button
                  onClick={() => { void invoke("open_in_terminal", { command: RUNTIME_META[cli.id]!.cmd }).catch((e) => console.error("open_in_terminal", e)); }}
                  title="Open Terminal and run this install command (you'll see it run and can confirm any prompts)"
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background"
                >
                  <Terminal className="h-3 w-3" /> Install
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(RUNTIME_META[cli.id]!.cmd!).then(() => { setCmdCopied(true); window.setTimeout(() => setCmdCopied(false), 1500); }).catch(() => {}); }}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                >
                  {cmdCopied ? <><Check className="h-3 w-3" /> Copied</> : "Copy"}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {RUNTIME_META[cli.id]?.install && (
                <a
                  href={RUNTIME_META[cli.id]!.install}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
                >
                  Open setup guide <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
              <button
                onClick={() => void verifyCliDefaultModel(cli.id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent-border hover:text-accent"
              >
                Re-check
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Pick a representative icon for a settings page from its title, so every
// header gets a matching glyph without threading an icon through 20 call sites.

// Header hierarchy, level 2: a subsection within a settings page. Sits clearly
// below the big SettingsHeader (level 1) and above the small mono group labels
// (level 3), so the eye reads page -> subsection -> group without guessing.
// Display-weight, sentence case, with a hairline rule underneath.

// Header hierarchy, level 3: a small group label inside a subsection (e.g.
// "Detected · 2"). The quietest of the three so it never competes with a
// level-2 SubsectionHeader.

// Privacy & Connectivity - the Bunker Mode control surface. The toggle + status
// card here reflect the BACKEND policy (bunker.rs), which is the real source of
// truth and enforcer; this screen never decides anything on its own.

// One row in the Runtimes master-detail list: provider mark, name, a health
// dot, version sub-line, and the default marker. Selecting it shows the runtime
// detail (an always-open AgentCard) on the right.
function RuntimeRow({ cli, active, vstatus, isDefault, onSelect }: {
  cli: CliInfo;
  active: boolean;
  vstatus?: string;
  isDefault?: boolean;
  onSelect: () => void;
}) {
  const sub = !cli.available ? "not installed" : (cli.version ? cli.version.slice(0, 22) : "detected");
  const badge = !cli.available ? "bg-surface-strong text-text-muted"
    : vstatus === "ok" ? "bg-ok text-background"
    : vstatus === "failed" ? "bg-warn text-background"
    : vstatus === "verifying" ? "animate-pulse bg-text-muted text-background"
    : "bg-surface-strong text-text-muted";
  const glyph = !cli.available ? "" : vstatus === "ok" ? "✓" : vstatus === "failed" ? "✗" : vstatus === "verifying" ? "·" : "○";
  const tip = !cli.available ? "not installed" : vstatus === "ok" ? "valid" : vstatus === "failed" ? "not valid" : vstatus === "verifying" ? "checking…" : "detected";
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors ${active ? "border-l-accent bg-accent-soft shadow-sm ring-1 ring-accent-border" : "border-l-transparent ring-1 ring-transparent hover:bg-surface-warm"}`}
    >
      <ProviderMark vendor={cli.id} size={28} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{cli.label}</span>
        <span className="block truncate font-mono text-[9px] uppercase tracking-wider text-text-muted">{sub}</span>
      </span>
      {isDefault && <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-background">def</span>}
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none ${badge}`} title={tip}>{glyph}</span>
    </button>
  );
}

export function AgentsSection({
  clis,
  onStartChatWith,
  embedded,
  defaultChatCli,
  onMakeDefault,
  vaultPath,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  embedded?: boolean;
  defaultChatCli?: string;
  onMakeDefault?: (cliId: string) => void;
  vaultPath?: string;
}) {
  // Runtimes shown as SEPARATE collapsible groups: hosted vendor CLIs (Cloud
  // models: Claude Code, Codex, Gemini, Antigravity, ...), on-device runtimes
  // (Local models: Ollama, LM Studio, MLX, LocalAI, llama.cpp), and harnesses
  // that wrap a base protocol (Pi, OpenCode, Hermes, OpenClaw, Paperclip,
  // Motorcar). Within each, installed runtimes sort first; not-installed show a
  // "Set up" link. All groups open by default so every supported runtime is
  // visible to set up.
  const sortReady = (a: CliInfo, b: CliInfo) => Number(b.available) - Number(a.available) || a.label.localeCompare(b.label);
  // Aggregators (OpenRouter, Bedrock) are HTTP gateways, not spawnable CLIs —
  // they have their own "Aggregator runtimes" section with key + catalog, so
  // they must NOT also appear in the CLI runtimes list (and can't be "spawned").
  const AGGREGATOR_IDS = new Set(["openrouter", "bedrock"]);
  const cliRuntimes = clis.filter((c) => !isHarnessRuntime(c.id) && !AGGREGATOR_IDS.has(c.id)).sort(sortReady);
  const harnesses = clis.filter((c) => isHarnessRuntime(c.id)).sort(sortReady);
  // Split the vendor CLIs into on-device (local) vs hosted (cloud) so the user
  // can configure local-only models in one place. Match local runtimes by id,
  // case-insensitively, covering the common naming variants.
  const LOCAL_RUNTIME_IDS = new Set(["ollama", "omlx", "mlx", "lmstudio", "lm-studio", "localai", "llamacpp"]);
  const isLocalRuntime = (id: string) => LOCAL_RUNTIME_IDS.has(id.toLowerCase());
  const localClis = cliRuntimes.filter((c) => isLocalRuntime(c.id));
  const cloudClis = cliRuntimes.filter((c) => !isLocalRuntime(c.id));
  // Per-runtime spend (cumulative), from the local usage ledger. Shown in the
  // detail; "-" when nothing has been spent / no vault.
  const [costByCli, setCostByCli] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    invoke<UsageSummary>("usage_summary", { vault: vaultPath })
      .then((s) => {
        if (!alive) return;
        const m: Record<string, number> = {};
        for (const b of s.by_cli || []) m[b.key] = b.cost_usd;
        setCostByCli(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [vaultPath]);

  // Master-detail: pick a runtime on the left, see its full detail (an
  // always-open AgentCard) on the right - the canonical app layout.
  const groups = [
    { key: "cloud", label: "Cloud models", list: cloudClis },
    { key: "local", label: "Local models", list: localClis },
    { key: "harness", label: "Harnesses", list: harnesses },
  ].filter((g) => g.list.length > 0);
  const all = groups.flatMap((g) => g.list);
  const verify = useCliVerifyLive();
  const [selectedId, setSelectedId] = useState("");
  const selectedEff = selectedId || defaultChatCli || all.find((c) => c.available)?.id || all[0]?.id || "";
  const selected = all.find((c) => c.id === selectedEff) ?? null;

  const listEl = (
    <div className="space-y-3">
      {groups.map((g) => {
        const ready = g.list.filter((c) => c.available).length;
        return (
          <div key={g.key} className="space-y-1">
            <div className="flex items-baseline justify-between px-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{g.label} · {g.list.length}</span>
              <span className="font-mono text-[9px] text-text-muted/60">{ready}/{g.list.length} set up</span>
            </div>
            {g.list.map((c) => (
              <RuntimeRow
                key={c.id}
                cli={c}
                active={c.id === selectedEff}
                vstatus={verify.get(c.id)?.status}
                isDefault={defaultChatCli === c.id}
                onSelect={() => setSelectedId(c.id)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );

  // Collapsed icon rail: each runtime's mark, clickable to select (so collapsing
  // keeps every runtime reachable, not hidden).
  const railEl = (
    <>
      {all.map((c) => (
        <button
          key={c.id}
          onClick={() => setSelectedId(c.id)}
          title={`${c.label}${c.available ? "" : " (not installed)"}`}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${c.id === selectedEff ? "ring-2 ring-accent" : "hover:bg-surface-strong"} ${c.available ? "" : "opacity-50"}`}
        >
          <ProviderMark vendor={c.id} size={26} />
        </button>
      ))}
    </>
  );

  const detailEl = selected ? (
    <AgentCard
      key={selected.id}
      cli={selected}
      forceOpen
      onStartChat={onStartChatWith}
      isDefault={defaultChatCli === selected.id}
      onMakeDefault={onMakeDefault ? () => onMakeDefault(selected.id) : undefined}
      cost={costByCli[selected.id]}
      chattable={!isHarnessRuntime(selected.id)}
    />
  ) : (
    <div className="p-8 text-center text-sm text-text-muted">Select a runtime to see its status, models, and actions.</div>
  );

  return (
    <>
      {!embedded && (
        <SettingsHeader
          title="Runtimes"
          subtitle="CLIs Prevail can route prompts to. Each runtime is detected from your machine. Prevail doesn't install or update them."
        />
      )}
      <MasterDetail title="Runtimes" storageKey="prevail.runtimes.listCollapsed" list={listEl} rail={railEl} detail={detailEl} />
    </>
  );
}
