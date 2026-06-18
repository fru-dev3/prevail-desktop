// Settings sections extracted from App.tsx: Privacy & Connectivity (Bunker Mode),
// Council defaults, Configuration (groups the memory/tasks/ideal sub-sections),
// and the Agents catalog (AgentCard + AgentsSection).
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Brain, Check, ChevronRight, Cloud, CloudOff, Cpu, Crown, Globe, ListChecks, Search, Server, ShieldCheck, ShieldOff, Wifi, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { CollapsibleSection } from "./collapsible";
import { RUNTIME_META, VENDOR_BRAND, isHarnessRuntime } from "./constants";
import { isLocalCli } from "./helpers";
import { modelsFor, prettyModelId } from "./helpers2";
import { LS, PREF, getPref, isBunkerOn, lsGet, lsSet, setPref } from "./storage";
import { Ghost } from "lucide-react";
import { Toggle } from "./ui";
import { GroupLabel } from "./panels";
import { COUNCIL_CHAIR_KEY, COUNCIL_MEMBERS_KEY, councilModelsFor, councilSlotKey, readCouncilChair, readCouncilMembers } from "./council";
import { SettingsHeader, authLoginCmd } from "./sectionutil";
import { cliVerifyLive, loadVerifyMap, saveVerifyMap, setCliVerify, useCliVerifyLive, verifyCliDefaultModel } from "./verify";
import { ProviderMark } from "./marks";
import { MemoryContextSection, TasksCrossDomainSection } from "./settings2";
import { TelemetrySettings } from "./settings4";
import type { CliInfo, ModelVerifyStatus, UsageSummary } from "./types";

// G3: the global incognito master. On = chat AND council run as a plain model
// with none of your context (profile, ideal state, omega, memory). Per-surface
// toggles in each composer can still go incognito just there.
function GlobalIncognitoToggle() {
  const [on, setOn] = useState(() => getPref(PREF.incognito, "0") === "1");
  return (
    <div className="mt-6 border-t border-border-subtle pt-5">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}><Ghost className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-primary">Incognito everywhere</div>
            <div className="mt-0.5 text-xs text-text-secondary">Run every surface (chat and council) as a plain model with none of your context: no profile, ideal state, omega, or memory. Turn it on per-surface from each composer instead.</div>
          </div>
          <Toggle on={on} onChange={(v) => { setOn(v); setPref(PREF.incognito, v ? "1" : "0"); }} label="Incognito everywhere" />
        </div>
      </div>
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
        subtitle="Bunker Mode is a trust guarantee, not a preference. While it's on, everything stays on this device: local models only, no network, no cloud AI, no web search."
      />

      {/* Hero - the master control. Two colors only: the AI cyan (the "AI" in
          the wordmark) as the on-accent, and brand-dark when off. Text stays
          high-contrast (dark on the light card, white on the dark card). */}
      <div className={`rounded-2xl border p-5 transition-colors ${
        enabled
          ? "border-ai/40 bg-ai/10"
          : "border-black/30 bg-[#141416]"
      }`}>
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${enabled ? "bg-ai/15" : "bg-white/10"}`}>
            {enabled ? <ShieldCheck className="h-6 w-6 text-ai" /> : <ShieldOff className="h-6 w-6 text-white" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-display text-lg font-semibold ${enabled ? "text-text-primary" : "text-white"}`}>Bunker Mode</span>
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${enabled ? "bg-ai text-white" : "bg-white/15 text-white"}`}>
                {enabled ? "On" : "Off"}
              </span>
            </div>
            <p className={`mt-1 text-sm ${enabled ? "text-text-secondary" : "text-white/70"}`}>
              {enabled
                ? "Everything stays on this device. Nothing leaves your machine."
                : "Cloud AI, web search, and network access are available and may transmit data."}
            </p>
          </div>
          <Toggle on={enabled} disabled={busy} onChange={onToggle} label="Bunker Mode" />
        </div>
      </div>

      {/* Live status - visual tiles for what's blocked vs open. */}
      <div className="mt-5">
        <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Live status</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.label}
              className={`rounded-xl border p-4 transition-colors ${
                t.good
                  ? "border-ai/40 bg-ai/5"
                  : "border-border bg-surface"
              }`}
            >
              <div className="flex items-center justify-between">
                <t.Icon className={`h-5 w-5 ${t.good ? "text-ai" : "text-text-muted"}`} />
                {t.good
                  ? <Check className="h-3.5 w-3.5 text-ai" />
                  : <span className="h-1.5 w-1.5 rounded-full bg-text-muted/50" />}
              </div>
              <div className="mt-2.5 text-sm font-semibold text-text-primary">{t.label}</div>
              <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
                {t.state}
              </div>
            </div>
          ))}
        </div>

        {/* Verdict strip */}
        <div className={`mt-3 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm ${
          enabled
            ? "border-ai/40 bg-ai/10 text-text-primary"
            : "border-black/30 bg-[#141416] text-white"
        }`}>
          {enabled ? <ShieldCheck className="h-4 w-4 shrink-0 text-ai" /> : <ShieldOff className="h-4 w-4 shrink-0" />}
          <span>
            {enabled
              ? "Verified. No requests leave your machine while Bunker Mode is active."
              : "Cloud connected. Cloud models, web search, and external services can transmit data."}
          </span>
        </div>
        {!status?.local_available && enabled && (
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
            <Cpu className="h-3.5 w-3.5" /> No local model detected. Install Ollama to run on-device.
          </a>
        )}
      </div>

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

      {/* G3: global incognito - one switch to run EVERY surface (chat + council)
          with none of your context. Per-surface toggles live in each composer. */}
      <GlobalIncognitoToggle />

      {/* Telemetry lives under Privacy (moved from Safety). Anonymous, opt-in,
          default-OFF - see TelemetrySettings. */}
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
      <div className="mb-5 flex h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface text-center">
        <Crown className="h-7 w-7 text-text-muted" />
        <div className="text-sm text-text-secondary">No one seated yet</div>
        <div className="text-xs text-text-muted">Pick models below to assemble your council.</div>
      </div>
    );
  }
  return (
    <div className="mb-5 flex justify-center rounded-xl border border-border bg-surface py-4">
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

export function CouncilSettingsSection({ clis }: { clis: CliInfo[] }) {
  const available = useMemo(() => clis.filter((c) => c.available && (!isBunkerOn() || isLocalCli(c.id))), [clis]);
  const [members, setMembers] = useState<Set<string>>(() => new Set(readCouncilMembers()));
  const [chair, setChair] = useState<string>(() => readCouncilChair());
  // Each provider expands/collapses INDEPENDENTLY - a Set of open provider ids,
  // not a single value (opening one never closes another).
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set());
  // Once providers are detected: prune any stale slot keys that no longer map to
  // a real (available provider, model) - that's what made the count drift from
  // the visible badges - then seed a sensible default if the panel is empty.
  useEffect(() => {
    if (available.length === 0) return;
    const valid = new Set<string>();
    for (const c of available) for (const m of councilModelsFor(c.id)) valid.add(councilSlotKey(c.id, m.id));
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
      {/* Visual round table - who's seated and who chairs, at a glance. */}
      <CouncilCircle members={[...members]} chair={chair} clis={clis} />
      {/* Compact summary bar - what the panel is right now. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-accent-border bg-accent-soft px-4 py-3 text-sm">
        <span className="font-semibold text-text-primary">{members.size} model{members.size === 1 ? "" : "s"} on the panel</span>
        <span className="inline-flex items-center gap-1 text-text-secondary"><Crown className="h-3.5 w-3.5 text-accent" /> chair: <span className="font-medium text-text-primary">{chairLabel}</span></span>
      </div>
      <div className="space-y-2">
        {available.length === 0 && <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-text-muted">No providers available{isBunkerOn() ? " in Bunker Mode (local only)" : ""}.</div>}
        {available.map((c) => {
          const models = councilModelsFor(c.id);
          const picked = models.filter((m) => members.has(councilSlotKey(c.id, m.id))).length;
          const isExp = expandedSet.has(c.id);
          return (
            <div key={c.id} className={`overflow-hidden rounded-lg border bg-surface transition-colors ${isExp || picked > 0 ? "border-accent-border" : "border-border-subtle"}`}>
              <button onClick={() => setExpandedSet((e) => { const n = new Set(e); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${isExp ? "rotate-90" : ""}`} strokeWidth={2.5} />
                <ProviderMark vendor={c.id} size={26} />
                <span className="flex-1 font-display text-sm font-semibold text-text-primary">{c.label}</span>
                {picked > 0 && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-background">{picked} on panel</span>}
                <span className="shrink-0 font-mono text-[10px] text-text-muted">{models.length} model{models.length === 1 ? "" : "s"}</span>
              </button>
              {isExp && (
                <div className="space-y-1.5 border-t border-border-subtle bg-background/40 p-3">
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
}: {
  cli: CliInfo;
  onStartChat?: (cliId: string, modelId?: string) => void;
  isDefault?: boolean;
  onMakeDefault?: () => void;
  /** Cumulative spend on this runtime (USD), from the usage ledger. */
  cost?: number;
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
    if (!open) return;
    const unverified = models.some((m) => status[m.id] !== "ok");
    if (unverified) verifyAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function StatusGlyph({ s }: { s: ModelVerifyStatus | undefined }) {
    if (s === "ok") return <span className="text-accent" title="Verified">✓</span>;
    if (s === "verifying") return <span className="text-text-muted animate-pulse" title="Verifying…">◐</span>;
    if (s === "failed") return <span className="text-warn" title="Failed verification">✗</span>;
    return <span className="text-text-muted/60" title="Not yet verified">○</span>;
  }

  const cliErr = liveVerify.get(cli.id);
  return (
    <div className={`rounded-lg border bg-surface transition-colors ${open ? "border-accent-border" : "border-border-subtle"}`}>
      {/* Single-line runtime row, Multica-style columns: Runtime · Health · Cost
          · Version · action. Column widths mirror the header strip in AgentsSection. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <ProviderMark vendor={cli.id} size={30} />
        {/* Runtime identity (click to expand the model list). */}
        <button
          onClick={() => cli.available && setOpen((v) => !v)}
          disabled={!cli.available || models.length === 0}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          {cli.available && models.length > 0 && (
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
        {/* Health column. */}
        <div className="flex w-[124px] shrink-0 flex-col items-start gap-0.5">
          {(() => {
            const v = cli.available ? cliVerifyLive.get(cli.id) : undefined;
            const chip = !cli.available
              ? { cls: "border-border bg-background text-text-muted", label: "Not installed" }
              : v?.status === "ok"
                ? { cls: "border-accent-border bg-accent-soft text-accent", label: "✓ Valid" }
                : v?.status === "failed"
                  ? { cls: "border-warn/40 bg-warn/10 text-warn", label: "✗ Not valid" }
                  : v?.status === "verifying"
                    ? { cls: "border-border bg-background text-text-muted animate-pulse", label: "◐ Checking" }
                    : { cls: "border-border bg-background text-text-muted", label: "Detected" };
            return (
              <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${chip.cls}`}>
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
          {cli.available ? (cli.version ?? `${cli.bin} in PATH`) : `${cli.bin} not found`}
        </div>
        {cli.available ? (
          <button
            onClick={() => onStartChat?.(cli.id)}
            className="w-[92px] shrink-0 rounded-md border border-accent-border bg-accent-soft py-1.5 text-center font-mono text-[11px] uppercase tracking-wider text-accent transition-colors hover:bg-accent hover:text-background"
          >
            Start chat
          </button>
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

      {open && cli.available && models.length > 0 && (
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
  // Two distinct kinds of runtime, shown as SEPARATE groups: primary vendor CLIs
  // (Claude Code, Codex, Gemini, Antigravity, …) and harnesses that wrap a base
  // protocol (Pi, OpenCode, Hermes, OpenClaw, Paperclip, Motorcar). Within each,
  // installed runtimes sort first; not-installed show a "Set up" link. Both groups
  // open by default so every supported runtime is visible to set up.
  const sortReady = (a: CliInfo, b: CliInfo) => Number(b.available) - Number(a.available) || a.label.localeCompare(b.label);
  const cliRuntimes = clis.filter((c) => !isHarnessRuntime(c.id)).sort(sortReady);
  const harnesses = clis.filter((c) => isHarnessRuntime(c.id)).sort(sortReady);
  const [showClis, setShowClis] = useState(true);
  const [showHarnesses, setShowHarnesses] = useState(true);
  // Per-runtime spend (cumulative), from the local usage ledger. Multica-style
  // Cost column; "—" when nothing has been spent / no vault.
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
  return (
    <>
      {!embedded && (
        <SettingsHeader
          title="Agents"
          subtitle="CLIs Prevail can route prompts to. Each agent is detected from your machine. Prevail doesn't install or update them."
        />
      )}
      {[
        { key: "cli", label: "CLIs", hint: "Primary vendor coding-agent CLIs — offered on the chat composer.", list: cliRuntimes, open: showClis, toggle: () => setShowClis((v) => !v) },
        { key: "harness", label: "Harnesses", hint: "Agent harnesses that wrap a base protocol. Set up here; not shown on the homepage composer.", list: harnesses, open: showHarnesses, toggle: () => setShowHarnesses((v) => !v) },
      ].filter((g) => g.list.length > 0).map((g) => {
        const ready = g.list.filter((c) => c.available).length;
        return (
          <section key={g.key} className="mb-6">
            <button onClick={g.toggle} className="mb-2 flex w-full items-center gap-2 text-left" title={g.hint}>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${g.open ? "rotate-90" : ""}`} strokeWidth={2.5} />
              <GroupLabel className="mb-0">{g.label} · {g.list.length}</GroupLabel>
              <span className="font-mono text-[10px] text-text-muted/60">{ready}/{g.list.length} set up</span>
            </button>
            {g.open && (
              <div className="flex flex-col gap-3 pl-5">
                {/* Multica-style column header: aligns with each row's right-hand
                    Health / Cost / Version columns. */}
                <div className="flex items-center gap-3 px-4 font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted/70">
                  <span className="flex-1">Runtime</span>
                  <span className="w-[124px] shrink-0">Health</span>
                  <span className="w-[64px] shrink-0 text-right">Cost</span>
                  <span className="w-[116px] shrink-0 text-right">Version</span>
                  <span className="w-[92px] shrink-0" />
                </div>
                {g.list.map((c) => (
                  <AgentCard
                    key={c.id}
                    cli={c}
                    onStartChat={onStartChatWith}
                    isDefault={defaultChatCli === c.id}
                    onMakeDefault={onMakeDefault ? () => onMakeDefault(c.id) : undefined}
                    cost={costByCli[c.id]}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
