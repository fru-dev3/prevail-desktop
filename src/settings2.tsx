// Self-contained Settings sections extracted from App.tsx: Daemons, cross-domain
// Tasks, Intents, Memory & Context, and Skills. vaultPath-driven; no App-root
// state closure.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowRight, Bell, Brain, Check, ChevronRight, Eye, Folder, GraduationCap, Laptop, Lightbulb, ListChecks, Loader2, MessageSquarePlus, Server, Sparkles, Upload, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { CollapsibleSection } from "./collapsible";
import { formatFreshness, titleCase } from "./format";
import { PREF, getPref, lsGet, lsSet, setPref } from "./storage";
import { Toggle } from "./ui";
import { DaemonCard, HeadlessLearnCard } from "./panels";
import { distillCfgFromPrefs, intentDaemonCfgFromPrefs, skillgenCfgFromPrefs, taskgenCfgFromPrefs } from "./daemoncfg";
import { SettingsHeader } from "./sectionutil";
import { VENDOR_BRAND, isHarnessRuntime } from "./constants";
import { useDetectedClis } from "./hooks";
import type { DaemonStatus, SkillEntry } from "./types";

// One collapsible card per routine. Routes through the canonical CollapsibleSection
// (icon + title left, summary + running dot right, collapsed by default) so the
// Daemons page looks identical to every other collapsible in the app.
// Color-coded "alive" dot so one glance tells running daemons apart from idle/off
// ones. Running = bright green (pulses so it reads as alive); enabled-but-not-
// running = amber (idle but armed); disabled = muted grey.
function DaemonDot({ running, enabled = true }: { running: boolean; enabled?: boolean }) {
  const cls = running
    ? "bg-ok pulse-soft"
    : enabled
      ? "bg-warn"
      : "bg-text-muted/40";
  const title = running ? "running" : enabled ? "idle" : "off";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} title={title} />;
}

function DaemonGroup({ icon, title, summary, running, enabled = true, defaultOpen = false, children }: {
  icon: LucideIcon;
  title: string;
  summary?: React.ReactNode;
  // A daemon row passes a running boolean: when present we render a color-coded
  // state dot. Producer views (no daemon) leave it undefined and get no dot.
  running?: boolean;
  enabled?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  // The canonical CollapsibleSection dot is gold/muted; for daemons we want a
  // vivid green/amber/grey state dot, so render our own at the head of the
  // summary and suppress the section's own status dot.
  const summaryNode = running === undefined ? summary : (
    <span className="inline-flex items-center gap-1.5">
      <DaemonDot running={running} enabled={enabled} />
      {summary != null && summary !== "" && <span>{summary}</span>}
    </span>
  );
  return (
    <CollapsibleSection icon={icon} title={title} summary={summaryNode} defaultOpen={defaultOpen}>
      {children}
    </CollapsibleSection>
  );
}

export function DaemonsSection({ vaultPath }: { vaultPath: string }) {
  // Installed runtimes for the provider dropdown (the global default executor for
  // distill + loops). Only ones actually on the machine; harnesses included so a
  // loop can default to an agent.
  const installedRuntimes = useDetectedClis().filter((c) => c.available);
  const provModels = installedRuntimes.map((c) => c.id).filter((id) => !isHarnessRuntime(id));
  const provHarnesses = installedRuntimes.map((c) => c.id).filter((id) => isHarnessRuntime(id));
  const [distillSt, setDistillSt] = useState<DaemonStatus | null>(null);
  const [remindersSt, setRemindersSt] = useState<DaemonStatus | null>(null);
  const [taskgenSt, setTaskgenSt] = useState<DaemonStatus | null>(null);
  const [taskgenEnabled, setTaskgenEnabled] = useState(() => getPref(PREF.taskgenEnabled, "0") === "1");
  const [taskgenModel, setTaskgenModel] = useState(() => getPref(PREF.taskgenModel, "claude-haiku-4-5"));
  const [taskgenInterval, setTaskgenInterval] = useState(() => getPref(PREF.taskgenIntervalSec, "3600"));
  const [taskgenMax, setTaskgenMax] = useState(() => getPref(PREF.taskgenMaxPerDomain, "3"));
  const [skillgenSt, setSkillgenSt] = useState<DaemonStatus | null>(null);
  const [skillgenEnabled, setSkillgenEnabled] = useState(() => getPref(PREF.skillgenEnabled, "1") === "1");
  const [skillgenModel, setSkillgenModel] = useState(() => getPref(PREF.skillgenModel, "claude-haiku-4-5"));
  const [skillgenInterval, setSkillgenInterval] = useState(() => getPref(PREF.skillgenIntervalSec, "21600"));
  const [skillgenMax, setSkillgenMax] = useState(() => getPref(PREF.skillgenMaxPerDomain, "2"));
  const [skillgenMsg, setSkillgenMsg] = useState("");
  const [skillgenRunning, setSkillgenRunning] = useState(false);
  const [remInterval, setRemInterval] = useState(() => getPref(PREF.remindersIntervalSec, "900"));
  const [taskgenMsg, setTaskgenMsg] = useState("");
  const [running, setRunning] = useState(false);
  // Intent distillation routine (automated, default ON).
  const [intentSt, setIntentSt] = useState<{ running?: boolean; last_run_ts?: number | null; distills?: number; last_intent_count?: number } | null>(null);
  const [intentEnabled, setIntentEnabled] = useState(() => getPref(PREF.intentDaemonEnabled, "1") === "1");
  const [intentMinNew, setIntentMinNew] = useState(() => getPref(PREF.intentDaemonMinNew, "10"));
  const [intentInterval, setIntentInterval] = useState(() => getPref(PREF.intentDaemonIntervalSec, "1800"));
  // Distill (memory) tuning - moved here from Memory & Context so all routine
  // operation lives in one place. These write the same prefs distillCfgFromPrefs reads.
  const [dProvider, setDProvider] = useState(() => getPref(PREF.memoryProvider, "claude"));
  const [dModel, setDModel] = useState(() => getPref(PREF.distillModel, "claude-haiku-4-5"));
  const [dAuto, setDAuto] = useState(() => getPref(PREF.autoCompression, "1") === "1");
  const [dThreshold, setDThreshold] = useState(() => getPref(PREF.compressionThreshold, "0.5"));
  const [dTarget, setDTarget] = useState(() => getPref(PREF.compressionTarget, "0.2"));
  const [dProtected, setDProtected] = useState(() => getPref(PREF.protectedRecent, "20"));
  const [dInterval, setDInterval] = useState(() => getPref(PREF.distillIntervalSec, "900"));
  const [distilling, setDistilling] = useState(false);
  const [distillMsg, setDistillMsg] = useState("");
  async function distillNow() {
    setDistilling(true); setDistillMsg("");
    try {
      const lines = await invoke<number>("distill_run_once", { cfg: distillCfgFromPrefs(vaultPath) });
      setDistillMsg(lines > 0 ? `Distilled ${lines} entr${lines === 1 ? "y" : "ies"} into memory.` : "Nothing new to distill yet.");
    } catch (e) { setDistillMsg(`Failed: ${e}`); }
    finally { setDistilling(false); }
  }

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const s = await invoke<DaemonStatus>("distill_status"); if (alive) setDistillSt(s); } catch {}
      try { const s = await invoke<DaemonStatus>("reminders_daemon_status"); if (alive) setRemindersSt(s); } catch {}
      try { const s = await invoke<DaemonStatus>("taskgen_status"); if (alive) setTaskgenSt(s); } catch {}
      try { const s = await invoke<DaemonStatus>("skillgen_status"); if (alive) setSkillgenSt(s); } catch {}
      try { const s = await invoke<typeof intentSt>("intent_daemon_status"); if (alive) setIntentSt(s); } catch {}
    };
    poll();
    const id = window.setInterval(poll, 2000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  // Machine role (hub | client) for a vault shared across two Macs. A client
  // captures prompts only; every processing daemon is disabled here (enforcement
  // lives in the CLI, this is presentation-only). Sourced from `prevail role`.
  const [machineRole, setMachineRoleState] = useState<"hub" | "client">("hub");
  const [roleBusy, setRoleBusy] = useState(false);
  const isClient = machineRole === "client";
  useEffect(() => {
    let alive = true;
    invoke<string>("machine_role_get").then((r) => { if (alive) setMachineRoleState(r === "client" ? "client" : "hub"); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  async function pickRole(next: "hub" | "client") {
    if (next === machineRole || roleBusy) return;
    setRoleBusy(true);
    try {
      await invoke<string>("machine_role_set", { role: next });
      setMachineRoleState(next);
      // Let the bottom trust-bar badge refresh immediately.
      window.dispatchEvent(new Event("prevail:role-changed"));
    } catch { /* leave the previous role selected on failure */ }
    finally { setRoleBusy(false); }
  }

  const Row = ({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  async function runTaskgenNow() {
    setRunning(true); setTaskgenMsg("");
    try {
      const n = await invoke<number>("taskgen_run_once", { cfg: taskgenCfgFromPrefs(vaultPath) });
      setTaskgenMsg(n > 0 ? `Generated ${n} task${n === 1 ? "" : "s"}.` : "No new tasks (domains need memory/state first).");
    } catch (e) { setTaskgenMsg(`Failed: ${e}`); }
    finally { setRunning(false); }
  }

  async function runSkillgenNow() {
    setSkillgenRunning(true); setSkillgenMsg("");
    try {
      const n = await invoke<number>("skillgen_run_once", { cfg: skillgenCfgFromPrefs(vaultPath) });
      setSkillgenMsg(n > 0 ? `Learned ${n} skill${n === 1 ? "" : "s"}.` : "No new skills (domains need conversation history first).");
    } catch (e) { setSkillgenMsg(`Failed: ${e}`); }
    finally { setSkillgenRunning(false); }
  }

  return (
    <>
      <SettingsHeader
        title="Daemons"
        subtitle="The background workers. Each runs continuously: distill intents into memory, fire task reminders, proactively generate tasks, and learn reusable skills from your conversations."
      />

      {/* Machine role picker. When a vault is shared by two Macs, only the hub
          runs background automation; a client captures prompts only. This is a
          per-machine setting (not stored in the vault). */}
      <div className="mb-4 rounded-lg border border-border-subtle bg-background p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary">This machine's role</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              When one vault is shared by two Macs, only the hub runs background automation. A client captures prompts only. This is a per-machine setting and is not stored in the vault.
            </div>
          </div>
          <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-surface p-1">
            {(["hub", "client"] as const).map((r) => {
              const Icon = r === "hub" ? Server : Laptop;
              const active = machineRole === r;
              return (
                <button
                  key={r}
                  type="button"
                  disabled={roleBusy}
                  onClick={() => pickRole(r)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors disabled:opacity-40 ${
                    active ? "bg-accent text-white" : "text-text-muted hover:text-accent"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {r === "hub" ? "Hub" : "Client"}
                </button>
              );
            })}
          </div>
        </div>
        {isClient && (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-text-secondary">
            This machine is a client. The processing daemons below run only on the hub, so they are disabled here. Prompt capture still runs on this machine. Set the role to hub to run automation here.
          </div>
        )}
      </div>

      {/* On a client the processing-daemon controls are disabled (presentation
          only; the CLI is the real enforcement). A disabled fieldset natively
          switches off every toggle, select, input and button it contains. */}
      <fieldset disabled={isClient} className={isClient ? "pointer-events-none opacity-50" : ""}>
      {/* One collapsible group per routine: status + tuning + run-now together. */}
      <DaemonGroup
        icon={Brain}
        title="Distill · memory"
        running={!!distillSt?.running}
        enabled={dAuto}
        summary={distillSt?.lines_distilled ? `${distillSt.lines_distilled} lines distilled` : dAuto ? `auto · every ${dInterval}s` : "manual only"}
      >
        <DaemonCard
          name="Distill"
          intervalSec={Number(dInterval) || undefined}
          status={distillSt}
          extra={distillSt?.lines_distilled ? `${distillSt.lines_distilled} lines distilled` : null}
          onStop={async () => { await invoke("distill_stop"); }}
          onStart={async () => { await invoke("distill_start", { cfg: distillCfgFromPrefs(vaultPath) }); }}
        />
        <div className="mt-3 rounded-lg border border-border-subtle bg-background px-5">
          <Row title="Distill provider" desc="Which agent distills the intent ledger into memory (use a cheap, fast one)."
            control={
              <select value={dProvider} onChange={(e) => { setDProvider(e.target.value); setPref(PREF.memoryProvider, e.target.value); }}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
                {provModels.length === 0 && provHarnesses.length === 0 && <option value={dProvider}>{VENDOR_BRAND[dProvider]?.name ?? dProvider}</option>}
                {provModels.length > 0 && (
                  <optgroup label="Models">
                    {provModels.map((id) => <option key={id} value={id}>{VENDOR_BRAND[id]?.name ?? id}</option>)}
                  </optgroup>
                )}
                {provHarnesses.length > 0 && (
                  <optgroup label="Harnesses (agent)">
                    {provHarnesses.map((id) => <option key={id} value={id}>{VENDOR_BRAND[id]?.name ?? id}</option>)}
                  </optgroup>
                )}
              </select>} />
          <Row title="Distill model" desc="Model id used for distillation, e.g. claude-haiku-4-5."
            control={<input value={dModel} onChange={(e) => { setDModel(e.target.value); setPref(PREF.distillModel, e.target.value); }}
              className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Auto-compression" desc="Run the distill routine on a timer (off = manual passes only)."
            control={<Toggle on={dAuto} onChange={(v) => { setDAuto(v); setPref(PREF.autoCompression, v ? "1" : "0"); }} />} />
          <Row title="Compression threshold" desc="Start distilling once new activity reaches this fraction of the memory budget."
            control={<input type="number" step="0.1" value={dThreshold} onChange={(e) => { setDThreshold(e.target.value); setPref(PREF.compressionThreshold, e.target.value); }}
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Compression target" desc="Compress memory toward this fraction of the budget."
            control={<input type="number" step="0.1" value={dTarget} onChange={(e) => { setDTarget(e.target.value); setPref(PREF.compressionTarget, e.target.value); }}
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Protected recent" desc="Never distill the most-recent N ledger entries: keep them raw."
            control={<input type="number" value={dProtected} onChange={(e) => { setDProtected(e.target.value); setPref(PREF.protectedRecent, e.target.value); }}
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Distill interval" desc="How often the distill routine runs a pass (seconds)."
            control={<div className="flex items-center gap-1.5"><input type="number" value={dInterval} onChange={(e) => { setDInterval(e.target.value); setPref(PREF.distillIntervalSec, e.target.value); }}
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" /><span className="font-mono text-xs text-text-muted">s</span></div>} />
          <Row title="Distill now" desc="Run a distillation pass immediately."
            control={<button onClick={distillNow} disabled={distilling}
              className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40">
              {distilling ? "distilling…" : "distill now"}</button>} />
          {distillMsg && <div className="pb-3 text-xs text-text-secondary">{distillMsg}</div>}
        </div>
      </DaemonGroup>

      <DaemonGroup
        icon={Bell}
        title="Reminders"
        running={!!remindersSt?.running}
        summary={remindersSt?.last_due_count != null ? (remindersSt.last_due_count > 0 ? `${remindersSt.last_due_count} due` : "none due") : `every ${remInterval}s`}
      >
        <DaemonCard
          name="Reminders"
          intervalSec={Number(remInterval) || undefined}
          status={remindersSt}
          extra={remindersSt?.last_due_count != null
            ? remindersSt.last_due_count > 0
              ? `${remindersSt.last_due_count} task${remindersSt.last_due_count === 1 ? "" : "s"} due`
              : "no due tasks"
            : null}
          onStop={async () => { await invoke("reminders_daemon_stop"); }}
          onStart={async () => {
            const sec = Number(getPref(PREF.remindersIntervalSec, "900")) || 900;
            await invoke("reminders_daemon_start", { vault: vaultPath, interval_sec: sec });
          }}
        />
        <div className="mt-3 rounded-lg border border-border-subtle bg-background px-5">
          <Row title="Reminders interval" desc="How often the reminders routine checks for due tasks (seconds)."
            control={
              <div className="flex items-center gap-1.5">
                <input type="number" value={remInterval} onChange={(e) => { setRemInterval(e.target.value); setPref(PREF.remindersIntervalSec, e.target.value); }}
                  className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />
                <span className="font-mono text-xs text-text-muted">s</span>
              </div>
            } />
        </div>
      </DaemonGroup>

      <DaemonGroup
        icon={ListChecks}
        title="Task generation"
        running={!!taskgenSt?.running}
        enabled={taskgenEnabled}
        summary={taskgenSt?.tasks_generated ? `${taskgenSt.tasks_generated} generated` : taskgenEnabled ? "on" : "off"}
      >
        <DaemonCard
          name="Task Gen"
          intervalSec={Number(taskgenInterval) || undefined}
          status={taskgenSt}
          extra={taskgenSt?.tasks_generated ? `${taskgenSt.tasks_generated} tasks generated` : null}
          onStop={async () => { await invoke("taskgen_stop"); }}
          onStart={async () => { await invoke("taskgen_start", { cfg: taskgenCfgFromPrefs(vaultPath) }); }}
        />
        <div className="mt-3 rounded-lg border border-border-subtle bg-background px-5">
          <Row title="Task generation" desc="Proactively generate new tasks from your goals, memory, and domain state once per day."
            control={<Toggle on={taskgenEnabled} onChange={(v) => { setTaskgenEnabled(v); setPref(PREF.taskgenEnabled, v ? "1" : "0"); if (!v) invoke("taskgen_stop").catch(() => {}); else invoke("taskgen_start", { cfg: taskgenCfgFromPrefs(vaultPath) }).catch(() => {}); }} />} />
          <Row title="Task gen model" desc="Model used to generate task suggestions (use a cheap, fast model)."
            control={<input value={taskgenModel} onChange={(e) => { setTaskgenModel(e.target.value); setPref(PREF.taskgenModel, e.target.value); }}
              className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Tasks per domain" desc="Maximum tasks generated per domain per day."
            control={<input type="number" value={taskgenMax} onChange={(e) => { setTaskgenMax(e.target.value); setPref(PREF.taskgenMaxPerDomain, e.target.value); }}
              className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Task gen interval" desc="How often the task-gen routine checks for domains that need new tasks (seconds)."
            control={
              <div className="flex items-center gap-1.5">
                <input type="number" value={taskgenInterval} onChange={(e) => { setTaskgenInterval(e.target.value); setPref(PREF.taskgenIntervalSec, e.target.value); }}
                  className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />
                <span className="font-mono text-xs text-text-muted">s</span>
              </div>
            } />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={runTaskgenNow} disabled={running}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40">
            {running ? "generating…" : "generate tasks now"}
          </button>
          {taskgenMsg && <span className="text-xs text-text-secondary">{taskgenMsg}</span>}
        </div>
      </DaemonGroup>

      <DaemonGroup
        icon={GraduationCap}
        title="Skill learning"
        running={!!skillgenSt?.running}
        enabled={skillgenEnabled}
        summary={skillgenSt?.skills_created ? `${skillgenSt.skills_created} learned` : skillgenEnabled ? "on" : "off"}
      >
        <DaemonCard
          name="Skill Gen"
          intervalSec={Number(skillgenInterval) || undefined}
          status={skillgenSt}
          extra={skillgenSt?.skills_created ? `${skillgenSt.skills_created} skill${skillgenSt.skills_created === 1 ? "" : "s"} learned` : null}
          onStop={async () => { await invoke("skillgen_stop"); }}
          onStart={async () => { await invoke("skillgen_start", { cfg: skillgenCfgFromPrefs(vaultPath) }); }}
        />
        <div className="mt-3 rounded-lg border border-border-subtle bg-background px-5">
          <Row title="Skill learning" desc="Self-learning: distill reusable skills (playbooks, checklists, decision frameworks) from each domain's conversations, once per day."
            control={<Toggle on={skillgenEnabled} onChange={(v) => { setSkillgenEnabled(v); setPref(PREF.skillgenEnabled, v ? "1" : "0"); if (!v) invoke("skillgen_stop").catch(() => {}); else invoke("skillgen_start", { cfg: skillgenCfgFromPrefs(vaultPath) }).catch(() => {}); }} />} />
          <Row title="Skill gen model" desc="Model used to learn skills from conversations (use a cheap, fast model)."
            control={<input value={skillgenModel} onChange={(e) => { setSkillgenModel(e.target.value); setPref(PREF.skillgenModel, e.target.value); }}
              className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Skills per domain" desc="Maximum new skills learned per domain per day."
            control={<input type="number" value={skillgenMax} onChange={(e) => { setSkillgenMax(e.target.value); setPref(PREF.skillgenMaxPerDomain, e.target.value); }}
              className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Skill gen interval" desc="How often the skill-learning routine scans domains for new lessons (seconds; default 6h)."
            control={
              <div className="flex items-center gap-1.5">
                <input type="number" value={skillgenInterval} onChange={(e) => { setSkillgenInterval(e.target.value); setPref(PREF.skillgenIntervalSec, e.target.value); }}
                  className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />
                <span className="font-mono text-xs text-text-muted">s</span>
              </div>
            } />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={runSkillgenNow} disabled={skillgenRunning}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-40">
            {skillgenRunning ? "learning…" : "learn skills now"}
          </button>
          {skillgenMsg && <span className="text-xs text-text-secondary">{skillgenMsg}</span>}
        </div>
      </DaemonGroup>

      <DaemonGroup
        icon={Lightbulb}
        title="Intent distillation"
        running={!!intentSt?.running}
        enabled={intentEnabled}
        summary={intentSt?.last_intent_count ? `${intentSt.last_intent_count} intents` : intentEnabled ? "auto" : "off"}
      >
        {/* Like the other routines: when it last ran + when it runs next. */}
        {(() => {
          const fmt = (sec: number) => new Date(sec * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          const last = intentSt?.last_run_ts ?? 0;
          const nextSec = last && intentEnabled ? last + (Number(intentInterval) || 0) : 0;
          return (
            <div className="mb-2 flex items-center gap-2 px-1 font-mono text-[10px] text-text-muted">
              <DaemonDot running={!!intentSt?.running} enabled={intentEnabled} />
              <span>
                {intentSt?.running ? "running" : "idle"}
                {last ? ` · last pass ${formatFreshness(Math.max(0, Date.now() / 1000 - last))}` : ""}
                {nextSec ? ` · next ~${fmt(nextSec)}` : ""}
              </span>
            </div>
          );
        })()}
        <div className="rounded-lg border border-border-subtle bg-background px-5">
          <Row title="Automatic intent distillation"
            desc="Infer your high-level intents + recommended actions automatically, with no manual click. Runs on a cadence and whenever enough new prompts pile up."
            control={<Toggle on={intentEnabled} onChange={(v) => {
              setIntentEnabled(v); setPref(PREF.intentDaemonEnabled, v ? "1" : "0");
              if (v) invoke("intent_daemon_start", { cfg: intentDaemonCfgFromPrefs(vaultPath) }).catch(() => {});
              else invoke("intent_daemon_stop").catch(() => {});
            }} />} />
          <Row title="Distill after N new prompts"
            desc="Re-distill once this many new prompts have been logged since the last pass."
            control={<input type="number" value={intentMinNew} onChange={(e) => { setIntentMinNew(e.target.value); setPref(PREF.intentDaemonMinNew, e.target.value); }}
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" />} />
          <Row title="Check interval"
            desc="How often the routine checks whether a re-distill is due (a check with nothing new costs no model call). It also re-distills at least daily."
            control={<div className="flex items-center gap-1.5"><input type="number" value={intentInterval} onChange={(e) => { setIntentInterval(e.target.value); setPref(PREF.intentDaemonIntervalSec, e.target.value); }}
              className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" /><span className="font-mono text-xs text-text-muted">s</span></div>} />
        </div>
        <p className="mt-2 px-1 text-[11px] text-text-muted">View the distilled intents in Configuration → Intents. Uses the same provider/model as Distill.</p>
      </DaemonGroup>

      {/* image #29: Memory & Context is what these routines PRODUCE, so it lives
          here as a peer collapsible group — not a divider-separated orphan page. */}
      <DaemonGroup icon={Brain} title="Memory & Context" summary="what the daemons produce">
        <MemoryContextSection vaultPath={vaultPath} headerless />
      </DaemonGroup>

      {/* "Keep working with the app closed" is always-expanded (a single toggle, not
          collapsible), so it sits LAST - below the collapsible routine rows. */}
      <HeadlessLearnCard vaultPath={vaultPath} />
      </fieldset>
    </>
  );
}

// Shared settings Row used by the Phase 3 sections.

// OpenAI dropped its logo from simple-icons (trademark), so we keep the glyph
// path inline (same one ProviderMark uses for Codex).

export function TasksCrossDomainSection({ vaultPath }: { vaultPath: string }) {
  type TaskRow = { domain: string; text: string; done: boolean; due?: string | null; added?: string | null; source?: string | null };
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [domainFilter, setDomainFilter] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const refresh = () => invoke<TaskRow[]>("tasks_read_all", { vault: vaultPath }).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [vaultPath]);
  const domains = useMemo(() => [...new Set(rows.map((r) => r.domain))].sort(), [rows]);
  const today = new Date().toISOString().slice(0, 10);
  const shown = rows.filter((r) => (domainFilter === "all" || r.domain === domainFilter) && (showDone || !r.done));
  const openCount = rows.filter((r) => !r.done).length;
  const overdue = rows.filter((r) => !r.done && r.due && r.due < today).length;
  async function toggle(r: TaskRow) {
    try {
      const cur = await invoke<TaskRow[]>("tasks_read", { vault: vaultPath, domain: r.domain });
      const next = cur.map((t) => (t.text === r.text ? { ...t, done: !t.done } : t));
      await invoke("tasks_set", { vault: vaultPath, domain: r.domain, tasks: next });
      refresh();
    } catch (e) { console.error("toggle task", e); }
  }
  return (
    <>
      <SettingsHeader title="Tasks" icon={Check} subtitle="Every task across every domain, in one place: triage what is piling up where. Per-domain lists live in each domain's Insights tab." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-text-secondary">{openCount} open{overdue > 0 ? ` · ${overdue} overdue` : ""}</span>
        <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-text-secondary">
          <option value="all">All domains</option>
          {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <button onClick={() => setShowDone((s) => !s)} className={`rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${showDone ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>
          {showDone ? "Hiding done off" : "Show done"}
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">No {showDone ? "" : "open "}tasks{domainFilter !== "all" ? ` in ${titleCase(domainFilter)}` : ""}.</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((r, i) => (
            <label key={`${r.domain}-${r.text}-${i}`} className="flex items-start gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0 hover:bg-surface-warm">
              <input type="checkbox" checked={r.done} onChange={() => toggle(r)} className="mt-0.5" />
              <span className="mt-0.5 shrink-0 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{titleCase(r.domain)}</span>
              <span className={`min-w-0 flex-1 text-sm ${r.done ? "text-text-muted line-through" : "text-text-primary"}`}>{r.text}</span>
              {r.source && r.source !== "user" && <span className="shrink-0 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{r.source === "daemon" ? "auto" : "suggested"}</span>}
              {r.due && !r.done && (() => { const od = r.due < today, du = r.due === today; return <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${od ? "bg-warn/15 text-warn" : du ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>{od ? "overdue" : du ? "today" : r.due}</span>; })()}
              <span className="shrink-0 font-mono text-[10px] text-text-muted/60">{r.added ?? ""}</span>
            </label>
          ))}
        </div>
      )}
    </>
  );
}

// Settings > Intents: every question ever asked, across every domain, in one
// searchable browser. Each row is the exact ask plus the model settings in
// effect (replayable provenance, kept on-device).

type DistilledIntent = {
  title?: string;
  goal?: string;
  underlying_need?: string;
  domains?: string[];
  /** Surfaces (tools/apps) whose prompts fed this intent: claude, codex,
   *  gemini, prevail, … - the provenance shown as badges. */
  sources?: string[];
  status?: string;
  confidence?: number;
  open_questions?: string[];
  evidence?: string[];
  recommendations?: string[];
};

// Pretty labels for the source surfaces a distilled intent can come from. Keeps
// the engine slugs (claude/codex/…) human-readable in the provenance badges.
const SOURCE_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  antigravity: "Antigravity",
  opencode: "opencode",
  openclaw: "Openclaw",
  hermes: "Hermes",
  pi: "Pi",
  cursor: "Cursor",
  prevail: "Prevail chat",
};
const sourceLabel = (s: string) => SOURCE_LABELS[s.toLowerCase()] ?? titleCase(s);
type DistilledDoc = { generated_ts: number; source_count: number; intents: DistilledIntent[] };

export function IntentsSection({ vaultPath }: { vaultPath: string }) {
  type IntentRow = { message?: string; cli?: string; model?: string; ts?: number; domain?: string; surface?: string; source?: string; host?: string; app_version?: string };
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [q, setQ] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // Distilled layer: high-level intents + recommendations inferred from the log.
  const [distilled, setDistilled] = useState<DistilledDoc>({ generated_ts: 0, source_count: 0, intents: [] });
  const [distilling, setDistilling] = useState(false);
  const [distillMsg, setDistillMsg] = useState<string | null>(null);
  const [openIntent, setOpenIntent] = useState<number | null>(null);
  // Render-pagination: cap how many rows hit the DOM so a vault with hundreds of
  // intents / thousands of journal rows stays responsive. "Load more" reveals
  // the next page; the search/filter still runs across the FULL set.
  const INTENTS_PAGE = 12;
  const JOURNAL_PAGE = 50;
  const [intentsShown, setIntentsShown] = useState(INTENTS_PAGE);
  const [journalShown, setJournalShown] = useState(JOURNAL_PAGE);
  const [intentQuery, setIntentQuery] = useState("");
  // Recommendations that have been turned into tracked tasks (keyed intent:rec).
  const [addedRecs, setAddedRecs] = useState<Set<string>>(new Set());
  async function addRecAsTask(intent: DistilledIntent, rec: string, key: string) {
    const domain = (intent.domains && intent.domains[0]) || "general";
    try {
      await invoke("tasks_add", { vault: vaultPath, domain, text: rec, source: "intent" });
      setAddedRecs((s) => new Set(s).add(key));
    } catch (e) {
      console.error("tasks_add from intent", e);
    }
  }
  useEffect(() => {
    // The journal merges the native ledger (Prevail chats) with prompts captured
    // from other tools (Claude Code, Codex, …), newest first, so "what you asked"
    // spans every surface - the same union the distiller works from.
    Promise.all([
      invoke<IntentRow[]>("intents_read_all", { vault: vaultPath, limit: 500 }).catch(() => [] as IntentRow[]),
      invoke<IntentRow[]>("capture_prompts_read", { vault: vaultPath, limit: 500 }).catch(() => [] as IntentRow[]),
    ]).then(([native, captured]) => {
      const merged = [...(Array.isArray(native) ? native : []), ...(Array.isArray(captured) ? captured : [])]
        .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
      setIntents(merged);
    });
    invoke<DistilledDoc>("intents_distilled_read", { vault: vaultPath })
      .then((d) => setDistilled(d ?? { generated_ts: 0, source_count: 0, intents: [] }))
      .catch(() => {});
  }, [vaultPath]);
  async function distillNow() {
    setDistilling(true);
    setDistillMsg(null);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      // Don't hand a claude-specific model id to a non-claude CLI (that made the
      // distiller emit an error line with no JSON array). Use the default only
      // for claude; for other providers, pass a stored model only if it isn't a
      // claude id, else let the engine pick that provider's default.
      const storedModel = getPref(PREF.distillModel, "");
      const model = provider === "claude"
        ? (storedModel || "claude-haiku-4-5")
        : (storedModel && !storedModel.startsWith("claude") ? storedModel : "");
      const doc = await invoke<DistilledDoc>("intents_distill", { cfg: { vault: vaultPath, provider, model, limit: 200 } });
      setDistilled(doc);
      setDistillMsg(`Distilled ${doc.intents?.length ?? 0} intent${(doc.intents?.length ?? 0) === 1 ? "" : "s"} from ${doc.source_count} prompts.`);
    } catch (e) {
      setDistillMsg(`Distill failed: ${e}`);
    } finally {
      setDistilling(false);
    }
  }
  // M4 (Monday feedback): let the user dismiss distilled intents so the list
  // doesn't grow punishingly long. Dismissed keys persist locally; the next
  // distill can re-surface a genuinely active intent under a new title.
  const DISMISS_KEY = "prevail.intents.dismissed";
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(lsGet(DISMISS_KEY) || "[]")); } catch { return new Set(); }
  });
  const intentKey = (it: DistilledIntent, i: number) => (it.title || it.goal || `#${i}`).trim().toLowerCase();
  const dismissIntent = (key: string) => setDismissed((cur) => {
    const n = new Set(cur); n.add(key); lsSet(DISMISS_KEY, JSON.stringify([...n])); return n;
  });
  const statusTone = (s?: string) => s === "active" ? "text-accent" : s === "resolved" ? "text-ok" : "text-text-muted";
  // Non-dismissed intents (original index preserved for openIntent/dismiss keys),
  // then sliced to the current page.
  const iq = intentQuery.trim().toLowerCase();
  const visibleIntentPairs = distilled.intents
    .map((it, i) => [it, i] as const)
    .filter(([it, i]) => !dismissed.has(intentKey(it, i)))
    .filter(([it]) =>
      !iq ||
      [it.title, it.goal, it.underlying_need, it.status, ...(it.domains ?? []), ...(it.sources ?? []), ...(it.recommendations ?? []), ...(it.open_questions ?? []), ...(it.evidence ?? [])]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(iq)),
    );
  const pagedIntents = visibleIntentPairs.slice(0, intentsShown);
  // Captured rows carry a tool slug as their `domain`; keep those out of the
  // life-domain filter so the dropdown stays meaningful (you filter them by
  // surface badge instead).
  const domains = useMemo(
    () => [...new Set(intents.map((i) => i.domain ?? "general").filter((d) => !(d.toLowerCase() in SOURCE_LABELS)))].sort(),
    [intents],
  );
  const shown = intents.filter(
    (i) =>
      (domainFilter === "all" || (i.domain ?? "general") === domainFilter) &&
      (!q.trim() || String(i.message ?? "").toLowerCase().includes(q.trim().toLowerCase())),
  );
  // Searching/filtering narrows the set, so reset the journal page to the top.
  useEffect(() => { setJournalShown(JOURNAL_PAGE); }, [q, domainFilter]);
  return (
    <>
      <SettingsHeader
        title="Intents"
        icon={Lightbulb}
        subtitle="Intents are the goal behind your questions, distilled from your journal (the raw record of what you asked), with recommended next actions. The journal lives below as provenance."
      />

      {/* Distilled intents - the high-level layer. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">Distilled intents</span>
        {distilled.generated_ts > 0 && (
          <span className="font-mono text-[10px] text-text-muted">
            {distilled.intents.length} from {distilled.source_count} prompts · {formatFreshness(Math.max(0, (Date.now() - distilled.generated_ts * 1000) / 1000))}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={distillNow}
          disabled={distilling}
          title="Read the prompt log and infer your high-level intents + next actions"
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40"
        >
          {distilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {distilling ? "Distilling…" : distilled.generated_ts > 0 ? "Re-distill" : "Distill intents"}
        </button>
      </div>
      {distillMsg && <div className="mb-3 rounded-md border border-border-subtle bg-surface px-3 py-2 text-xs text-text-secondary">{distillMsg}</div>}
      {distilled.intents.length > 0 && (
        <div className="mb-3">
          <input
            value={intentQuery}
            onChange={(e) => { setIntentQuery(e.target.value); setIntentsShown(INTENTS_PAGE); }}
            placeholder="search intents…"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
          />
          {intentQuery.trim() && (
            <div className="mt-1 px-1 font-mono text-[10px] text-text-muted">
              {visibleIntentPairs.length} of {distilled.intents.length} intents match “{intentQuery.trim()}”
            </div>
          )}
        </div>
      )}
      {distilled.intents.length === 0 ? (
        <div className="mb-6 rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          No distilled intents yet. Hit <span className="text-accent">Distill intents</span> to infer the goals behind your prompts and get recommended next actions.
        </div>
      ) : (
        <div className="mb-6 space-y-2">
          {pagedIntents.map(([it, i]) => {
            const open = openIntent === i;
            return (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
               <div className="flex items-start">
                <button onClick={() => setOpenIntent(open ? null : i)} className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left hover:bg-surface-warm">
                  <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Lightbulb className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-semibold tracking-tight text-text-primary">{it.title ?? "Intent"}</span>
                      {it.status && <span className={`font-mono text-[10px] uppercase tracking-wider ${statusTone(it.status)}`}>{it.status}</span>}
                      {typeof it.confidence === "number" && <span className="font-mono text-[10px] text-text-muted">{Math.round(it.confidence * 100)}%</span>}
                    </div>
                    {it.goal && <div className="mt-0.5 text-sm text-text-secondary">{it.goal}</div>}
                    {(it.sources ?? []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">From</span>
                        {(it.sources ?? []).map((s) => (
                          <span key={s} className="inline-flex items-center gap-1 rounded border border-ai/30 bg-ai/5 px-1.5 py-0.5 font-mono text-[10px] text-ai" title="Surface this intent was drawn from">
                            {sourceLabel(s)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="hidden shrink-0 items-center gap-1 sm:flex">
                    {(it.domains ?? []).slice(0, 3).map((d) => (
                      <span key={d} className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">{titleCase(d)}</span>
                    ))}
                  </span>
                </button>
                {/* M4: dismiss this intent so the list stays manageable. */}
                <button onClick={() => dismissIntent(intentKey(it, i))} title="Dismiss this intent"
                  className="m-2 shrink-0 rounded p-1 text-text-muted hover:bg-surface-warm hover:text-err">
                  <X className="h-3.5 w-3.5" />
                </button>
               </div>
                {open && (
                  <div className="space-y-3 border-t border-border-subtle px-4 py-4 pl-[60px] text-sm">
                    {it.underlying_need && (
                      <div><span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Underlying need</span><div className="mt-0.5 text-text-secondary">{it.underlying_need}</div></div>
                    )}
                    {(it.recommendations ?? []).length > 0 && (
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">Recommended next actions</span>
                        <ul className="mt-1 space-y-1">
                          {it.recommendations!.map((r, j) => {
                            const key = `${i}:${j}`;
                            const added = addedRecs.has(key);
                            return (
                              <li key={j} className="group/rec flex items-start gap-2">
                                <ArrowRight className="mt-1 h-3 w-3 shrink-0 text-accent" />
                                <span className="flex-1 text-text-primary">{r}</span>
                                <button
                                  onClick={() => addRecAsTask(it, r, key)}
                                  disabled={added}
                                  title={added ? "Added to your tasks" : `Add as a task in ${titleCase((it.domains && it.domains[0]) || "general")}`}
                                  className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${added ? "border-ok/40 text-ok" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}
                                >
                                  {added ? "added ✓" : "+ task"}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {(it.open_questions ?? []).length > 0 && (
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Open questions</span>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-secondary">
                          {it.open_questions!.map((qq, j) => <li key={j}>{qq}</li>)}
                        </ul>
                      </div>
                    )}
                    {(it.evidence ?? []).length > 0 && (
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Evidence ({it.evidence!.length} prompts)</span>
                        <ul className="mt-1 space-y-0.5">
                          {it.evidence!.map((e, j) => <li key={j} className="border-l-2 border-border-subtle pl-2 text-text-muted">{e}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {visibleIntentPairs.length > intentsShown && (
            <button
              onClick={() => setIntentsShown((n) => n + INTENTS_PAGE)}
              className="w-full rounded-xl border border-dashed border-border bg-surface px-4 py-2.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent"
            >
              Show {Math.min(INTENTS_PAGE, visibleIntentPairs.length - intentsShown)} more · {intentsShown} of {visibleIntentPairs.length}
            </button>
          )}
        </div>
      )}

      {/* M3 (Monday feedback): this raw log IS the Journal - what you asked, the
          provenance intents are distilled from. Labelled so the relationship is clear. */}
      <div className="mb-1 text-sm font-semibold text-text-primary">Journal · what you asked</div>
      <div className="mb-2 text-xs text-text-secondary">The raw record across every thread and tool - Prevail chats plus prompts captured from Claude Code, Codex, and more. Intents above are distilled from this.</div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search journal…"
          className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
        />
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-text-secondary"
        >
          <option value="all">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>{titleCase(d)}</option>
          ))}
        </select>
        <span className="font-mono text-[10px] text-text-muted">{Math.min(journalShown, shown.length)} of {shown.length}{shown.length !== intents.length ? ` (${intents.length} total)` : ""}</span>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          {intents.length === 0
            ? "No intents captured yet. Every chat question is logged here as you work."
            : "Nothing matches that filter."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.slice(0, journalShown).map((it, i) => {
            // Captured external prompts carry a surface other than "prevail";
            // badge them by source (cyan) instead of the redundant tool-as-domain.
            const external = !!it.surface && it.surface.toLowerCase() !== "prevail";
            return (
            <div key={i} className="flex items-start gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0 hover:bg-surface-warm">
              {external ? (
                <span className="mt-0.5 shrink-0 rounded border border-ai/30 bg-ai/5 px-1.5 py-0.5 font-mono text-[10px] text-ai" title="Captured from this tool">
                  {sourceLabel(it.surface!)}
                </span>
              ) : (
                <span className="mt-0.5 shrink-0 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                  {titleCase(it.domain ?? "general")}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm text-text-primary">{String(it.message ?? "(no text)")}</div>
                <div className="mt-0.5 font-mono text-[10px] text-text-muted">
                  {(external
                    ? `${it.source === "push" ? "live" : "synced"}${it.ts ? ` · ${formatFreshness(Math.max(0, (Date.now() - it.ts) / 1000))}` : ""}`
                    : `${it.surface === "app-chat" ? "app chat · " : ""}${it.cli ?? ""}${it.model ? ` · ${it.model}` : ""}${it.ts ? ` · ${formatFreshness(Math.max(0, (Date.now() - it.ts) / 1000))}` : ""}`)
                    /* Provenance: which machine (and app version) this prompt
                       came from - the activity-attribution ask. Old rows
                       without the fields render exactly as before. */
                    + (it.host ? ` · ${it.host}` : "") + (it.app_version ? ` · v${it.app_version}` : "")}
                </div>
              </div>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(String(it.message ?? ""));
                  setCopiedIdx(i);
                  setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
                }}
                title="Copy the question to re-ask it anywhere"
                className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-secondary hover:border-accent-border hover:text-accent"
              >
                {copiedIdx === i ? "copied" : "copy"}
              </button>
            </div>
            );
          })}
          {shown.length > journalShown && (
            <button
              onClick={() => setJournalShown((n) => n + JOURNAL_PAGE)}
              className="w-full border-t border-border-subtle px-4 py-2.5 text-center text-sm text-text-secondary hover:bg-surface-warm hover:text-accent"
            >
              Load {Math.min(JOURNAL_PAGE, shown.length - journalShown)} more · {journalShown} of {shown.length}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// Map an ideal-state section heading to an icon matching its theme, so the
// rendered constitution reads as a visual map rather than a text wall.

export function MemoryContextSection({ headerless }: { vaultPath: string; headerless?: boolean }) {
  const [persistent, setPersistent] = useState(() => getPref(PREF.persistentMemory, "1") === "1");
  const [memBudget, setMemBudget] = useState(() => getPref(PREF.memoryBudgetChars, "4000"));
  const [status, setStatus] = useState<{ running?: boolean; last_run_ts?: number | null; last_error?: string | null; lines_distilled?: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const s = await invoke<typeof status>("distill_status"); if (alive) setStatus(s); } catch { /* routine not started */ }
    };
    poll();
    const id = window.setInterval(poll, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const Row = ({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
  const Num = ({ value, set, pref, w = "w-20", step }: { value: string; set: (v: string) => void; pref: string; w?: string; step?: string }) => (
    <input type="number" step={step} value={value}
      onChange={(e) => { set(e.target.value); setPref(pref, e.target.value); }}
      className={`${w} rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none`} />
  );

  return (
    <>
      {/* B2-10: skip the header when wrapped in a CollapsibleSection that already
          shows the "Memory & Context" title (avoids the duplicate title). */}
      {!headerless && (
        <SettingsHeader
          title="Memory & Context"
          subtitle="What the system has learned about you. Every chat is captured as an intent; the distiller routine compacts them into per-domain long-term memory that is fed back into future chats."
        />
      )}
      {/* The distiller runs on the Daemons page; this is its outcome view. A
          live status chip links across so the two pages are clearly related. */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: "daemons" }))}
        className="mb-4 flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-2.5 text-left hover:border-accent-border"
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">Distiller</span>
        <span className="font-mono text-[10px] text-text-muted">
          {status?.running ? "running" : "idle"}
          {/* B2-19: last_run_ts is in SECONDS (treating it as ms gave "20601 days");
              formatFreshness already returns "... ago" (don't append a second one). */}
          {status?.last_run_ts ? ` · last pass ${formatFreshness(Math.max(0, Date.now() / 1000 - status.last_run_ts))}` : ""}
          {status?.lines_distilled ? ` · ${status.lines_distilled} lines` : ""}
        </span>
        <span className="ml-auto font-mono text-[10px] text-accent">Schedule & controls in Daemons →</span>
      </button>
      <div className="rounded-lg border border-border bg-surface px-5">
        <Row title="Persistent memory" desc="Distill the intent ledger into per-domain memory and prepend it to prompts. Master switch."
          control={<Toggle on={persistent} onChange={(v) => { setPersistent(v); setPref(PREF.persistentMemory, v ? "1" : "0"); }} />} />
        <Row title="Memory budget" desc="Hard cap (characters) on the distilled memory injected into each prompt."
          control={<Num value={memBudget} set={setMemBudget} pref={PREF.memoryBudgetChars} w="w-24" />} />
        <Row title="Context engine" desc="Strategy for managing long conversations near the context limit."
          control={
            <select value={getPref(PREF.contextEngine, "compressor")} onChange={(e) => setPref(PREF.contextEngine, e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
              <option value="compressor">Compressor</option>
            </select>
          } />
      </div>
      <div className="mt-3 rounded-lg border border-border-subtle bg-surface px-4 py-2.5 text-xs text-text-muted">
        The distiller (its provider, interval, threshold, and a manual "distill now") is configured on the Daemons page. This page is what it produces.
      </div>
    </>
  );
}

// ── Daemon card ───────────────────────────────────────────────────────────────


// ── Daemons settings panel ────────────────────────────────────────────────────
// Run the self-learning loop with the desktop CLOSED, via a launchd agent
// (engine `daemon install`). When on, the in-app distiller defers to it.

export function SkillsSection({ vaultPath }: { vaultPath: string }) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [listOpen, setListOpen] = useState(false);
  // B2-5: upload a skill — pick a SKILL.md, choose a domain, install it.
  const [allDomains, setAllDomains] = useState<string[]>([]);
  const [upload, setUpload] = useState<{ name: string; body: string } | null>(null);
  const [uploadDomain, setUploadDomain] = useState<string>("general");
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    invoke<SkillEntry[]>("scan_skills", { vault: vaultPath })
      .then((s) => { if (mounted) setSkills(s); })
      .catch(() => { if (mounted) setSkills([]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [vaultPath]);

  // Usage intelligence: per-skill uses / last-used / verdict from the vault
  // ledger, so the list ranks by REAL popularity and dead weight is visible.
  type UsageRow = { domain: string; id: string; uses: number; lastTs: number | null; verdict: "active" | "dormant" | "unused" };
  const [usage, setUsage] = useState<Map<string, UsageRow>>(new Map());
  const [usageTotals, setUsageTotals] = useState<{ unused: number; dormant: number } | null>(null);
  const loadUsage = useCallback(() => {
    invoke<{ unused: number; dormant: number; rows: UsageRow[] }>("engine_skills_report")
      .then((rep) => {
        const m = new Map<string, UsageRow>();
        for (const r of rep.rows ?? []) m.set(`${r.domain.toLowerCase()}/${r.id.toLowerCase()}`, r);
        setUsage(m); setUsageTotals({ unused: rep.unused ?? 0, dormant: rep.dormant ?? 0 });
      })
      .catch(() => { setUsage(new Map()); setUsageTotals(null); });
  }, []);
  useEffect(() => { loadUsage(); }, [vaultPath, loadUsage]);
  const usageOf = (sk: SkillEntry) => usage.get(`${sk.domain.toLowerCase()}/${sk.name.toLowerCase()}`);
  // Archive a skill (move to skills/_archive - never deleted; restorable via
  // `prevail skill-usage unarchive`). Refreshes both the scan and the report.
  async function archiveSkillRow(sk: SkillEntry) {
    try {
      const r = await invoke<{ ok?: boolean; error?: string }>("engine_skill_archive", { domain: sk.domain, skill: sk.name, restore: null });
      if (r && r.ok === false) { setUploadMsg(r.error ?? "archive failed"); return; }
      setSkills((cur) => cur.filter((x) => x.path !== sk.path));
      setUploadMsg(`Archived ${sk.name}. Restore anytime: prevail skill-usage unarchive ${sk.domain} ${sk.name}`);
      loadUsage();
    } catch (e) { setUploadMsg(`archive failed: ${String(e).slice(0, 140)}`); }
  }

  // Domains present in the vault's skills, for the by-domain filter.
  const domains = useMemo(
    () => [...new Set(skills.map((s) => s.domain.toLowerCase()))].sort(),
    [skills],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = skills.filter((s) => {
      if (domainFilter !== "all" && s.domain.toLowerCase() !== domainFilter) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) ||
        s.domain.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q);
    });
    // Popularity order: most-used first, never-used last, ties by name - the
    // "intelligent surface" that keeps living skills on top and bloat visible.
    return [...list].sort((a, b) => {
      const ua = usageOf(a); const ub = usageOf(b);
      return ((ub?.uses ?? 0) - (ua?.uses ?? 0)) || ((ub?.lastTs ?? 0) - (ua?.lastTs ?? 0)) || a.name.localeCompare(b.name);
    });
  }, [skills, filter, domainFilter, usage]);

  // All vault domains (not just those with skills) for the install target.
  useEffect(() => {
    invoke<{ name: string }[]>("scan_vault", { path: vaultPath })
      .then((ds) => setAllDomains(Array.isArray(ds) ? ds.map((d) => d.name.toLowerCase()) : []))
      .catch(() => setAllDomains([]));
  }, [vaultPath]);

  async function openSkill(p: string) {
    try { await invoke("open_in_finder", { path: p }); } catch {}
  }
  // View a skill's SKILL.md inline, without leaving the app.
  const [viewer, setViewer] = useState<{ name: string; body: string } | null>(null);
  async function viewSkill(s: SkillEntry) {
    try { setViewer({ name: s.name, body: await invoke<string>("read_skill", { path: s.path }) }); }
    catch (e) { setViewer({ name: s.name, body: `Could not read this skill: ${String(e)}` }); }
  }
  // Open a chat in the skill's domain (or General) with a ready prompt to run it.
  function useSkillInChat(s: SkillEntry) {
    lsSet("prevail.compose.pending", `Run the "${s.name}" skill.`);
    const dom = s.domain && s.domain.toLowerCase() !== "general" ? s.domain : "";
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: dom }));
    window.dispatchEvent(new CustomEvent("prevail:compose-seed"));
  }
  // B2-5: pick a SKILL.md (or .md) and stage it for install.
  async function pickSkillFile() {
    setUploadMsg(null);
    try {
      const f = await openDialog({ filters: [{ name: "Skill", extensions: ["md"] }], multiple: false });
      if (!f || typeof f !== "string") return;
      const body = await invoke<string>("read_text_file", { path: f });
      const parts = f.split("/");
      const file = parts.pop() ?? "";
      const parent = parts.pop() ?? "";
      const name = /^skill\.md$/i.test(file) ? parent : file.replace(/\.md$/i, "");
      setUpload({ name: name || "skill", body });
    } catch (e) { setUploadMsg(`Couldn't read that file: ${e}`); }
  }
  async function installSkill() {
    if (!upload) return;
    try {
      await invoke("skill_create", { vault: vaultPath, domain: uploadDomain === "general" ? null : uploadDomain, name: upload.name, body: upload.body });
      setUploadMsg(`Installed "${upload.name}" into ${titleCase(uploadDomain)}.`);
      setUpload(null);
      await rescan();
    } catch (e) { setUploadMsg(`Install failed: ${e}`); }
  }
  async function rescan() {
    setLoading(true);
    try {
      const s = await invoke<SkillEntry[]>("scan_skills", { vault: vaultPath });
      setSkills(s);
    } catch { /* ignore */ }
    setLoading(false);
  }

  return (
    <>
      <SettingsHeader
        title="Skills"
        subtitle="Upload a SKILL.md to install it into a domain, or drop a folder under a domain's _skills/ directory. The first non-empty line of SKILL.md or README.md becomes the description."
      />

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        {/* Toolbar: title · count · refresh · search */}
        <div className="mb-4 flex items-center gap-3">
          <h3 className="font-display text-xl font-semibold tracking-tight">My Skills</h3>
          <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-secondary">{skills.length}</span>
          <button
            onClick={rescan}
            title="Re-scan vault"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-warm hover:text-text-primary"
          >
            ↻
          </button>
          <div className="flex-1" />
          {/* B2-5: upload a skill from a file. */}
          <button
            onClick={pickSkillFile}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1.5 text-sm font-medium text-accent hover:bg-accent hover:text-background"
          >
            <Upload className="h-3.5 w-3.5" /> Upload skill
          </button>
          {/* Filter by domain - see only one domain's skills, or all. */}
          <select
            value={domainFilter}
            onChange={(e) => { setDomainFilter(e.target.value); setListOpen(true); }}
            title="Filter skills by domain"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none"
          >
            <option value="all">All domains</option>
            {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
          <div className="relative w-56">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted">⌕</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search skills…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm focus:border-accent-border focus:outline-none"
            />
          </div>
        </div>

        {/* B2-5: staged upload — choose the install domain, then install. */}
        {upload && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/30 px-3 py-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-accent" />
            <span className="text-sm text-text-primary">Install <span className="font-semibold">{upload.name}</span> into</span>
            <select value={uploadDomain} onChange={(e) => setUploadDomain(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-accent-border focus:outline-none">
              <option value="general">General (vault root)</option>
              {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
            </select>
            <button onClick={installSkill} className="rounded-md bg-accent px-3 py-1 text-sm font-semibold text-background hover:bg-accent-hover">Install</button>
            <button onClick={() => setUpload(null)} className="text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
          </div>
        )}
        {uploadMsg && <div className="mb-4 rounded-lg border border-border-subtle bg-background px-3 py-2 text-xs text-text-secondary">{uploadMsg}</div>}

        {/* Path bar */}
        <div className="mb-4 flex items-center gap-2 rounded-md bg-background px-3 py-2 font-mono text-[11px] text-text-secondary">
          <Folder className="h-3.5 w-3.5 text-text-muted" />
          <span className="truncate" title={vaultPath}>{vaultPath}</span>
        </div>

        {loading && <div className="py-6 text-center text-sm text-text-muted">scanning…</div>}
        {!loading && skills.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-background p-10 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-text-muted opacity-50" />
            <p className="mt-3 text-sm text-text-muted">
              No skills found. Try creating <code className="text-accent">{"<domain>/_skills/<skill-name>/"}</code> with a SKILL.md.
            </p>
          </div>
        )}
        {!loading && filtered.length === 0 && skills.length > 0 && (
          <div className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-text-muted">
            No skills match <code className="text-accent">{filter}</code>.
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <>
            <button
              onClick={() => setListOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${listOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
              {listOpen ? "Collapse" : `Show ${filtered.length} skill${filtered.length === 1 ? "" : "s"}`}
              {usageTotals && (usageTotals.unused > 0 || usageTotals.dormant > 0) && (
                <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-warn">
                  {usageTotals.unused > 0 ? `${usageTotals.unused} never used` : ""}{usageTotals.unused > 0 && usageTotals.dormant > 0 ? " · " : ""}{usageTotals.dormant > 0 ? `${usageTotals.dormant} dormant` : ""} - consider archiving
                </span>
              )}
            </button>
            {listOpen && (
              <ul className="ml-4 mt-1 flex flex-col gap-1 border-l border-border-subtle pl-3">
                {filtered.map((s) => {
                  const cleaned = (s.description ?? "").replace(/^[>*\-\s]+/, "").trim();
                  return (
                    <li key={s.path}>
                      <div className="group relative flex w-full items-start gap-3.5 rounded-xl px-3 py-3 pb-8 transition-colors hover:bg-surface-warm">
                        <button
                          onClick={() => viewSkill(s)}
                          title={`View ${s.name}`}
                          className="flex min-w-0 flex-1 items-start gap-3.5 text-left"
                        >
                          {/* Calm, uniform tile (no per-skill rainbow). */}
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-warm text-text-secondary ring-1 ring-border-subtle group-hover:text-accent">
                            <Sparkles className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-display text-base font-semibold tracking-tight text-text-primary">{s.name}</span>
                              <span className="rounded-md border border-border-subtle bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                                {titleCase(s.domain)}
                              </span>
                              {(() => {
                                const u = usageOf(s);
                                if (!u) return null;
                                if (u.verdict === "unused") return <span className="rounded-md bg-warn/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warn">never used</span>;
                                const days = u.lastTs ? Math.max(0, Math.floor((Date.now() - u.lastTs) / 86_400_000)) : null;
                                const rel = days === null ? "" : days === 0 ? " · today" : ` · ${days}d ago`;
                                return <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${u.verdict === "dormant" ? "bg-warn/10 text-warn" : "bg-surface-warm text-text-muted"}`}>{u.uses} use{u.uses === 1 ? "" : "s"}{rel}{u.verdict === "dormant" ? " · dormant" : ""}</span>;
                              })()}
                            </div>
                            {cleaned && (
                              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-secondary">
                                {cleaned}
                              </p>
                            )}
                          </div>
                        </button>
                        {/* Minimal per-skill actions: revealed only on row hover, bottom-right. */}
                        <div className="absolute bottom-1.5 right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button onClick={() => viewSkill(s)} title="View skill here" aria-label="View skill here"
                            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-accent">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => openSkill(s.path)} title="Reveal in Finder" aria-label="Reveal in Finder"
                            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-accent">
                            <Folder className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => useSkillInChat(s)} title="Use in a chat" aria-label="Use in a chat"
                            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-accent">
                            <MessageSquarePlus className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => void archiveSkillRow(s)} title="Archive this skill (moved aside, never deleted)" aria-label="Archive this skill"
                            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-warn">
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setViewer(null)}>
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <div className="flex min-w-0 items-center gap-2 font-display text-sm font-semibold text-text-primary">
                <Sparkles className="h-4 w-4 shrink-0 text-accent" /> <span className="truncate">{viewer.name}</span>
              </div>
              <button onClick={() => setViewer(null)} aria-label="Close" className="rounded-md p-1 text-text-muted hover:bg-surface-warm hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-secondary">{viewer.body}</pre>
          </div>
        </div>
      )}
    </>
  );
}
