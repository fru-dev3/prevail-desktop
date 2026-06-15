// Settings sections extracted from App.tsx: Safety (approvals/guardrails),
// Ideal State (life-pillar alignment), and the General section (appearance,
// start-on-boot, embedded Shortcuts).
import { useEffect, useMemo, useState } from "react";
import { disable as autostartDisable, enable as autostartEnable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import { Activity, Clock, Compass, Eye, EyeOff, FileClock, Globe, History, Keyboard, Lock, Monitor, Moon, Palette, PenLine, RefreshCw, ShieldAlert, ShieldCheck, SlidersHorizontal, Sun, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CollapsibleSection } from "./collapsible";
import { ALLOWED_EVENTS, clearTelemetryLog, crashOn, setCrash, setUsage, telemetryConfigured, telemetryLog, usageOn } from "./telemetry";
import { invoke } from "./bridge";
import { PALETTES } from "./constants";
import { PREF, getPref, setPref } from "./storage";
import { Toggle } from "./ui";
import { Markdown } from "./Markdown";
import { AlignmentCard, AppLockCard, SettingsRowLite } from "./panels";
import { PaletteCard } from "./panels3";
import { useAppearance } from "./hooks";
import { SettingsHeader, idealSectionIcon } from "./sectionutil";
import { ShortcutsSection } from "./settings1";
import { VaultEncryptionCard } from "./settings3";
import type { Mode } from "./types";

// SAFETY-1: a labelled cluster header so the panel reads as deliberate groups
// (Access protection vs Agent guardrails) instead of one flat stack of rows.
function SafetyGroup({ icon: Icon, label, desc, children }: { icon: LucideIcon; label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon className="h-3.5 w-3.5 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
        <span className="ml-auto text-[11px] text-text-muted">{desc}</span>
      </div>
      {children}
    </div>
  );
}

// SAFETY-1: a guardrail row with a leading state icon (lit when active) so each
// control reads as a deliberate, premium switch rather than a bare label row.
function GuardRow({ icon: Icon, title, desc, control, active }: { icon: LucideIcon; title: string; desc: string; control: React.ReactNode; active?: boolean }) {
  return (
    <div className="flex items-start gap-3 border-b border-border-subtle px-4 py-3.5 last:border-0">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${active ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0 self-center">{control}</div>
    </div>
  );
}

export function SafetySection({ vaultPath }: { vaultPath: string }) {
  const [approvalMode, setApprovalMode] = useState(() => getPref(PREF.approvalMode, "manual"));
  const [approvalTimeout, setApprovalTimeout] = useState(() => getPref(PREF.approvalTimeoutSec, "60"));
  const [confirmMcp, setConfirmMcp] = useState(() => getPref(PREF.confirmMcpReloads, "1") === "1");
  const [allowlist, setAllowlist] = useState(() => getPref(PREF.commandAllowlist, ""));
  const [redact, setRedact] = useState(() => getPref(PREF.redactSecrets, "0") === "1");
  const [allowPrivate, setAllowPrivate] = useState(() => getPref(PREF.allowPrivateUrls, "0") === "1");
  const [checkpoints, setCheckpoints] = useState(() => getPref(PREF.fileCheckpoints, "0") === "1");
  return (
    <>
      <SettingsHeader icon={ShieldCheck} title="Safety" subtitle="Guardrails for what the agent can do and what gets stored. Redact secrets is enforced here; approval, allowlist, and checkpoints are honored by the engine." />
      <SafetyGroup icon={Lock} label="Access protection" desc="Lock the app · encrypt the vault at rest">
        <AppLockCard />
        <VaultEncryptionCard vaultPath={vaultPath} />
      </SafetyGroup>
      <SafetyGroup icon={ShieldAlert} label="Agent guardrails" desc="What the agent may do, and what gets stored">
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <GuardRow icon={ShieldAlert} active={approvalMode === "manual"} title="Approval mode" desc="How commands that need explicit approval are handled."
            control={
              <select value={approvalMode} onChange={(e) => { setApprovalMode(e.target.value); setPref(PREF.approvalMode, e.target.value); }}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none">
                <option value="manual">Manual</option>
                <option value="auto">Auto</option>
              </select>
            } />
          <GuardRow icon={Clock} title="Approval timeout" desc="How long an approval prompt waits before timing out."
            control={<div className="flex items-center gap-1.5"><input type="number" value={approvalTimeout} onChange={(e) => { setApprovalTimeout(e.target.value); setPref(PREF.approvalTimeoutSec, e.target.value); }} className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none" /><span className="font-mono text-xs text-text-muted">s</span></div>} />
          <GuardRow icon={RefreshCw} active={confirmMcp} title="Confirm MCP reloads" desc="Ask before reloading MCP servers."
            control={<Toggle on={confirmMcp} onChange={(v) => { setConfirmMcp(v); setPref(PREF.confirmMcpReloads, v ? "1" : "0"); }} />} />
          <GuardRow icon={Terminal} active={!!allowlist.trim()} title="Command allowlist" desc="Comma-separated commands the agent may run without prompting."
            control={<input value={allowlist} placeholder="git, ls, cat" onChange={(e) => { setAllowlist(e.target.value); setPref(PREF.commandAllowlist, e.target.value); }} className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none" />} />
          <GuardRow icon={EyeOff} active={redact} title="Redact secrets" desc="Scrub API keys, tokens, and passwords from saved chat transcripts and the intent ledger."
            control={<Toggle on={redact} onChange={(v) => { setRedact(v); setPref(PREF.redactSecrets, v ? "1" : "0"); }} />} />
          <GuardRow icon={Globe} active={allowPrivate} title="Allow private URLs" desc="Let the agent fetch localhost / private-network URLs."
            control={<Toggle on={allowPrivate} onChange={(v) => { setAllowPrivate(v); setPref(PREF.allowPrivateUrls, v ? "1" : "0"); }} />} />
          <GuardRow icon={FileClock} active={checkpoints} title="File checkpoints" desc="Snapshot files before the agent edits them so changes can be rolled back."
            control={<Toggle on={checkpoints} onChange={(v) => { setCheckpoints(v); setPref(PREF.fileCheckpoints, v ? "1" : "0"); }} />} />
        </div>
      </SafetyGroup>
      <TelemetrySettings />
    </>
  );
}

// Anonymous, opt-in telemetry governance. Default OFF, two independent consents,
// and a fully transparent "what we collect" list + local log. See telemetry.ts
// and docs/TELEMETRY-PLAN.md. Network sends stay inert until build-time keys exist.
function TelemetrySettings() {
  const [usage, setUsageState] = useState(() => usageOn());
  const [crash, setCrashState] = useState(() => crashOn());
  const [showLog, setShowLog] = useState(false);
  const [, force] = useState(0);
  const log = telemetryLog();
  return (
    <div className="mt-5">
      <SettingsHeader title="Privacy & telemetry" icon={ShieldCheck}
        subtitle="Anonymous, opt-in, and never includes your prompts, vault, names you created, or any personal data. Off by default. Turn it on only if you want to help improve Prevail." />
      <div className="mb-3 rounded-lg border border-border bg-surface px-5">
        <SettingsRowLite title="Usage analytics (anonymous)" desc="Coarse, anonymous events (app opened, which features are used, OS) via PostHog. No content, ever."
          control={<Toggle on={usage} onChange={(v) => { setUsage(v); setUsageState(v); }} />} />
        <SettingsRowLite title="Crash & error reports" desc="Send anonymized crash stack traces (scrubbed of paths/PII) via Sentry so bugs get fixed faster."
          control={<Toggle on={crash} onChange={(v) => { setCrash(v); setCrashState(v); }} />} />
      </div>
      {!telemetryConfigured() && (usage || crash) && (
        <p className="mb-3 px-1 text-[11px] text-text-muted">
          Telemetry is enabled but no analytics keys are built into this release, so nothing is transmitted yet. Events are still recorded to the local log below so you can see exactly what would be sent.
        </p>
      )}
      <CollapsibleSection icon={Activity} title="What we collect" summary={`${ALLOWED_EVENTS.length} event types`}
        subtitle="The complete, exhaustive list. Anything not here is never sent.">
        <ul className="space-y-1.5 text-xs text-text-secondary">
          <li><span className="font-mono text-text-primary">app_opened</span> — app version, OS family (mac/win)</li>
          <li><span className="font-mono text-text-primary">feature_used</span> — which feature area (chat, council, benchmark…), nothing typed</li>
          <li><span className="font-mono text-text-primary">benchmark_run</span> — counts only (number of models, number of domains)</li>
          <li><span className="font-mono text-text-primary">provider_configured</span> — provider name (e.g. openrouter), never the key</li>
          <li><span className="font-mono text-text-primary">daemon_toggled</span> — which daemon, on/off</li>
          <li><span className="font-mono text-text-primary">crash reports</span> — error type + scrubbed stack trace + app version</li>
        </ul>
        <div className="mt-3 rounded-md border border-border-subtle bg-background p-2 text-[11px] text-text-muted">
          Never collected: prompts, replies, vault contents, file paths, names of domains/apps/skills you created, API keys, email, name, machine name, or precise location.
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setShowLog((s) => !s)}
            className="rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent">
            {showLog ? "Hide" : "View"} local log · {log.length}
          </button>
          {log.length > 0 && (
            <button onClick={() => { clearTelemetryLog(); force((n) => n + 1); }}
              className="rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-danger hover:text-danger">
              Clear log
            </button>
          )}
        </div>
        {showLog && (
          <div className="mt-2 max-h-48 overflow-auto rounded-md border border-border-subtle bg-background p-2 font-mono text-[10px] text-text-secondary">
            {log.length === 0 ? <div className="text-text-muted">No events recorded.</div> : log.slice().reverse().map((e, i) => (
              <div key={i} className="border-b border-border-subtle/40 py-0.5 last:border-0">
                <span className={e.sent ? "text-accent" : "text-text-muted"}>{e.sent ? "sent" : "local"}</span>{" "}
                <span className="text-text-primary">{e.event}</span> {JSON.stringify(e.props)}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

// WhatsApp is rendered as its own (fuller) card below, so it's excluded here.

export function IdealStateSection({ vaultPath }: { vaultPath: string }) {
  const [body, setBody] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [versions, setVersions] = useState<{ name: string; path: string }[]>([]);
  const loadVersions = () =>
    invoke<{ name: string; path: string }[]>("ideal_state_versions", { vault: vaultPath })
      .then((v) => setVersions(Array.isArray(v) ? v : []))
      .catch(() => {});
  useEffect(() => {
    invoke<string>("read_ideal_state", { vault: vaultPath })
      .then((s) => { setBody(s); setLoaded(true); })
      .catch(() => setLoaded(true));
    void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath]);
  async function save() {
    setSaving(true);
    try {
      await invoke("write_ideal_state", { vault: vaultPath, body });
      setSavedAt(Date.now());
      setEditing(false);
      void loadVersions();
    } finally {
      setSaving(false);
    }
  }

  // Split the markdown into an intro plus one block per `## ` heading, so the
  // default view is a structured, icon-marked map of the constitution.
  const parsed = useMemo(() => {
    const lines = body.split("\n");
    let title = "";
    const intro: string[] = [];
    const sections: { title: string; body: string[] }[] = [];
    let cur: { title: string; body: string[] } | null = null;
    for (const line of lines) {
      const h2 = line.match(/^##\s+(.+)/);
      const h1 = line.match(/^#\s+(.+)/);
      if (h2) { cur = { title: h2[1].trim(), body: [] }; sections.push(cur); continue; }
      if (h1 && !cur && !title) { title = h1[1].trim(); continue; }
      (cur ? cur.body : intro).push(line);
    }
    return {
      title,
      intro: intro.join("\n").trim(),
      sections: sections.map((s) => ({ title: s.title, body: s.body.join("\n").trim() })),
    };
  }, [body]);

  return (
    <>
      <SettingsHeader
        title="Ideal State"
        icon={Compass}
        subtitle="The vision and values everything optimizes for. Every chat, council, recommendation, plan, and background routine reads this first and aligns to it. Saved to vault/ideal-state.md the moment you hit Save."
      />
      <AlignmentCard vaultPath={vaultPath} />
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {editing
            ? "Editing markdown"
            : parsed.sections.length > 0
              ? `${parsed.sections.length} section${parsed.sections.length === 1 ? "" : "s"} · highest precedence everywhere`
              : "Highest precedence everywhere"}
        </span>
        <div className="flex items-center gap-2">
          {savedAt && !editing && (
            <span className="font-mono text-[10px] text-ok">✓ saved</span>
          )}
          {loaded && (
            <button
              onClick={() => setEditing((e) => !e)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent"
            >
              {editing ? <Eye className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
              {editing ? "View" : "Edit"}
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="rounded-lg border border-border bg-surface">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"# Operating Vision\n\n## Values\n\n- What every decision should honor\n\n## Wealth\n\n- The position you are building toward"}
            rows={24}
            className="w-full resize-y rounded-lg bg-transparent p-4 font-mono text-sm leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-4 py-2">
            <span className="font-mono text-[10px] text-text-muted">
              {body.length.toLocaleString()} chars · sections start with ## headings
            </span>
            <button
              onClick={save}
              disabled={saving || !loaded}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
            >
              {saving ? "saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : !loaded ? null : body.trim() === "" ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
          <Compass className="h-8 w-8 text-accent" />
          <div className="font-display text-base font-semibold">No Ideal State yet</div>
          <p className="max-w-md text-sm text-text-secondary">
            Write the life you are building and the principles every decision should honor.
            Use ## headings (Values, Wealth, Health, Family) and the page renders them as a map.
          </p>
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover"
          >
            <PenLine className="h-3.5 w-3.5" /> Start writing
          </button>
        </div>
      ) : (
        <div>
          {/* Lead: the constitution's title + intro as a calm document header,
              not a heavy accent box. */}
          {parsed.title && (
            <h2 className="font-display text-xl font-bold tracking-tight text-text-primary">{parsed.title}</h2>
          )}
          {parsed.intro && (
            <div className="mt-1.5 border-l-2 border-accent-border pl-3 text-sm leading-relaxed text-text-secondary">
              <Markdown source={parsed.intro} compact />
            </div>
          )}
          {/* Sections: a clean single-column stack of cards. Each card leads with
              an icon chip + title (clear hierarchy), then its content. */}
          {parsed.sections.length > 0 ? (
            <div className="mt-5 space-y-2.5">
              {parsed.sections.map((s) => {
                const Icon = idealSectionIcon(s.title);
                return (
                  <div key={s.title} className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="font-display text-base font-semibold tracking-tight text-text-primary">{s.title}</span>
                    </div>
                    {s.body && (
                      <div className="mt-2.5 pl-[38px] text-sm leading-relaxed text-text-secondary">
                        <Markdown source={s.body} compact />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed text-text-secondary">
              <Markdown source={body} compact />
            </div>
          )}
          {/* Version history: the one canonical collapsible, collapsed by default. */}
          {versions.length > 0 && (
            <CollapsibleSection
              icon={History}
              title="History"
              subtitle="Every edit is snapshotted: nothing is ever lost."
              summary={`${versions.length} version${versions.length === 1 ? "" : "s"}`}
              className="mt-4"
            >
              <div className="flex flex-col gap-1">
                {versions.map((v) => (
                  <div key={v.path} className="flex items-center gap-2 py-1">
                    <span className="flex-1 font-mono text-[11px] text-text-secondary">{v.name.replace("_", " · ")}</span>
                    <button
                      onClick={async () => {
                        try {
                          const old = await invoke<string>("read_text_file", { path: v.path });
                          if (window.confirm("Restore this version? The current text is snapshotted first.")) {
                            setBody(old);
                            await invoke("write_ideal_state", { vault: vaultPath, body: old });
                            setSavedAt(Date.now());
                            void loadVersions();
                          }
                        } catch (e) { console.error("restore ideal state", e); }
                      }}
                      className="rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </div>
      )}
    </>
  );
}

// "Demo & Production" — its own top-level Settings section (sibling of Vault):
// the demo/production mode toggle (with the real clean-slate production switch)
// plus the importable starter packs. Kept separate from Vault so the mode
// control is easy to find.

export function GeneralSection({ appearance }: { appearance?: ReturnType<typeof useAppearance> }) {
  const [startOnBoot, setStartOnBoot] = useState(false);
  useEffect(() => { autostartIsEnabled().then(setStartOnBoot).catch(() => {}); }, []);
  const [closeToTray, setCloseToTray] = useState(() => getPref(PREF.closeToTray, "0") === "1");
  useEffect(() => { invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => {}); }, [closeToTray]);
  const [sendKey, setSendKeyState] = useState(() => getPref(PREF.sendKey, "enter"));
  const [desktopNotif, setDesktopNotif] = useState(() => getPref(PREF.desktopNotif, "0") === "1");
  const [soundDone, setSoundDone] = useState(() => getPref(PREF.soundOnDone, "0") === "1");
  const [autoConvert, setAutoConvert] = useState(() => getPref(PREF.autoConvertLongPaste, "1") === "1");
  const [stripSyc, setStripSyc] = useState(() => getPref(PREF.stripSycophancy, "0") === "1");
  const [showThinking, setShowThinking] = useState(() => getPref(PREF.showThinking, "1") === "1");
  const [promptTimeout, setPromptTimeout] = useState<string>(() => getPref(PREF.llmPromptTimeoutSec, "300"));
  const [budgetCap, setBudgetCap] = useState<string>(() => getPref(PREF.budgetMonthlyCapUsd, ""));
  // Running spend estimate. Display-only: seeded from localStorage and, if the
  // engine ever exposes a `engine_budget_status` command, refreshed from it.
  const [budgetSpent, setBudgetSpent] = useState<number>(() => {
    const v = parseFloat(getPref(PREF.budgetSpentUsd, "0"));
    return Number.isFinite(v) ? v : 0;
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await invoke<{ spent_usd?: number; cap_usd?: number }>("engine_budget_status");
        if (!alive) return;
        if (typeof s?.spent_usd === "number") setBudgetSpent(s.spent_usd);
        if (typeof s?.cap_usd === "number" && !getPref(PREF.budgetMonthlyCapUsd, "")) {
          setBudgetCap(String(s.cap_usd));
        }
      } catch {
        /* no engine budget command — stays display-only from localStorage */
      }
    })();
    return () => { alive = false; };
  }, []);
  const capNum = parseFloat(budgetCap);
  const hasCap = Number.isFinite(capNum) && capNum > 0;
  const pct = hasCap ? Math.min(100, Math.round((budgetSpent / capNum) * 100)) : 0;
  const meterColor = pct >= 90 ? "var(--color-danger, #d24b4b)" : pct >= 70 ? "var(--color-warn, #c98a2b)" : "var(--color-ok, #2e9e5b)";

  const Row = ({
    title, desc, control,
  }: { title: string; desc: string; control: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  const Switch = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <Toggle on={on} onChange={onChange} />
  );

  // General's three sub-sections route through the canonical CollapsibleSection
  // so they match every other collapsible in the app (icon + title left, summary
  // right, collapsed by default, open state persisted per section).
  const GenSub = ({ id, title, icon, summary, children }: { id: "main" | "appearance" | "shortcuts"; title: string; icon: LucideIcon; summary?: string; children: React.ReactNode }) => (
    <CollapsibleSection icon={icon} title={title} summary={summary} defaultOpen={id === "main"} storageKey={`prevail.settings.general.${id}`}>
      {children}
    </CollapsibleSection>
  );

  return (
    <>
      <SettingsHeader
        title="General"
        subtitle="App-wide behavior, appearance, and keyboard shortcuts."
      />
      <div className="space-y-2">
      <GenSub id="main" title="Main" icon={SlidersHorizontal} summary="behavior & defaults">
      <div className="rounded-lg border border-border bg-surface px-5">
        <Row
          title="Start on boot"
          desc="Launch Prevail automatically when you sign in to this Mac."
          control={<Switch on={startOnBoot} onChange={async (v) => { try { if (v) await autostartEnable(); else await autostartDisable(); setStartOnBoot(v); } catch (e) { console.error("autostart", e); } }} />}
        />
        <Row
          title="Close to tray"
          desc="Keep Prevail running in the menu bar when you close the window. Quit from the tray icon or ⌘Q."
          control={<Switch on={closeToTray} onChange={(v) => { setCloseToTray(v); setPref(PREF.closeToTray, v ? "1" : "0"); }} />}
        />
        <Row
          title="Send messages with"
          desc="Choose which key combination sends messages. Use Shift+Enter for new lines either way."
          control={
            <select
              value={sendKey}
              onChange={(e) => { setSendKeyState(e.target.value); setPref(PREF.sendKey, e.target.value); }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
            >
              <option value="enter">Enter</option>
              <option value="cmd-enter">⌘ + Enter</option>
            </select>
          }
        />
        <Row
          title="Desktop notifications"
          desc="Get notified when a CLI finishes streaming a reply (Chat and Council)."
          control={<Switch on={desktopNotif} onChange={(v) => { setDesktopNotif(v); setPref(PREF.desktopNotif, v ? "1" : "0"); }} />}
        />
        <Row
          title="Sound effects"
          desc="Play a soft chime when a reply finishes."
          control={<Switch on={soundDone} onChange={(v) => { setSoundDone(v); setPref(PREF.soundOnDone, v ? "1" : "0"); }} />}
        />
        <Row
          title="Auto-convert long paste"
          desc="When you paste more than 5000 characters, treat it as a file attachment instead of inline prompt text."
          control={<Switch on={autoConvert} onChange={(v) => { setAutoConvert(v); setPref(PREF.autoConvertLongPaste, v ? "1" : "0"); }} />}
        />
        <Row
          title={`Strip "You're absolutely right!" sycophancy`}
          desc="Filters fluff openers from streamed replies before they hit the screen. Has no effect on saved logs."
          control={<Switch on={stripSyc} onChange={(v) => { setStripSyc(v); setPref(PREF.stripSycophancy, v ? "1" : "0"); }} />}
        />
        <Row
          title="Show model thinking"
          desc="When a model exposes its reasoning, show it in a collapsible 'Thinking' block above the answer (Chat and Council). Turn off to hide reasoning entirely."
          control={<Switch on={showThinking} onChange={(v) => { setShowThinking(v); setPref(PREF.showThinking, v ? "1" : "0"); }} />}
        />
        <Row
          title="LLM prompt timeout"
          desc="Hard cap on a single CLI call. The child process gets killed and the reply is finalized if it runs longer."
          control={
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={10}
                max={3600}
                value={promptTimeout}
                onChange={(e) => { setPromptTimeout(e.target.value); setPref(PREF.llmPromptTimeoutSec, e.target.value); }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none"
              />
              <span className="font-mono text-xs text-text-muted">s</span>
            </div>
          }
        />
        <Row
          title="Monthly budget cap"
          desc="A soft USD cap for model spend. The meter below tracks estimated spend against it. Leave blank for no cap."
          control={
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-text-muted">$</span>
              <input
                type="number"
                min={0}
                step="1"
                value={budgetCap}
                placeholder="0"
                onChange={(e) => { setBudgetCap(e.target.value); setPref(PREF.budgetMonthlyCapUsd, e.target.value); }}
                className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none"
              />
            </div>
          }
        />
      </div>

      {/* Budget meter */}
      <div className="mt-4 rounded-lg border border-border bg-surface px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Budget this month</div>
          <div className="font-mono text-xs text-text-secondary">
            ${budgetSpent.toFixed(2)}{hasCap ? ` / $${capNum.toFixed(2)}` : " spent"}
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-strong">
          <div className="h-full rounded-full transition-all" style={{ width: hasCap ? `${pct}%` : "0%", background: meterColor }} />
        </div>
        <div className="mt-1.5 font-mono text-[10px] text-text-muted">
          {hasCap ? `${pct}% of cap used${pct >= 90 ? " · approaching limit" : ""}` : "Set a cap above to track usage against it."}
        </div>
      </div>
      </GenSub>
      {appearance && (
        <GenSub id="appearance" title="Appearance" icon={Palette} summary={appearance?.mode ? `${appearance.mode} theme` : "theme & palette"}>
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <div className="mb-1 font-medium">Color Mode</div>
            <div className="mb-4 text-sm text-text-secondary">Pick a fixed mode or let Prevail follow your system setting.</div>
            <div className="inline-flex items-center rounded-md border border-border bg-background p-1 text-xs">
              {([{ id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }, { id: "system", label: "System", icon: Monitor }] as const).map((m) => {
                const Icon = m.icon; const active = appearance.mode === m.id;
                return (
                  <button key={m.id} onClick={() => appearance.setMode(m.id as Mode)}
                    className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${active ? "bg-accent text-background shadow-sm" : "text-text-secondary hover:bg-surface-warm"}`}>
                    <Icon className="h-3.5 w-3.5" />{m.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-1 font-medium">Theme</div>
            <p className="mb-4 text-sm text-text-secondary">Desktop palettes. The selected mode is applied on top.</p>
            <div className="grid grid-cols-3 gap-3">
              {PALETTES.map((p) => (
                <PaletteCard key={p.id} palette={p} active={appearance.palette === p.id} onSelect={() => appearance.setPalette(p.id)} />
              ))}
            </div>
          </div>
        </GenSub>
      )}
      <GenSub id="shortcuts" title="Shortcuts" icon={Keyboard} summary="keyboard">
        <ShortcutsSection />
      </GenSub>
      </div>
    </>
  );
}
