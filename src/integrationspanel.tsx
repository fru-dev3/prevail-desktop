// Integrations - the one-click hub for wiring Prevail into every AI CLI.
//
// Two things per harness, no copy-paste:
//   1. CAPTURE - record the prompts you type in each CLI into the vault
//      (push hook where supported, sync backstop everywhere else).
//   2. MCP - expose your vault to the CLI so it can drive Prevail.
//
// The heavy lifting lives in the prevail engine (`prevail capture …`) and is
// reached through thin Tauri commands; this panel is orchestration + status.
import { useCallback, useEffect, useState } from "react";
import { Cable, Check, Download, Loader2, RefreshCw, Wrench, Zap } from "lucide-react";
import { invoke } from "./bridge";
import { SettingsHeader } from "./sectionutil";
import type { CliInfo } from "./types";

type Harness = {
  tool: string;
  method: "push" | "sync";
  present: boolean;
  wired: boolean;
  target?: string;
  detail?: string;
};
type Stream = { tool: string; path: string; count: number };
type CaptureStatus = {
  streams?: Stream[];
  agent?: { plistPresent: boolean; loaded: boolean; supported: boolean; plist: string };
  harnesses?: Harness[];
};
type SyncSource = { tool: string; found: number; written: number; skipped: number };
type McpClient = { client: string; present: boolean; registered: boolean; error?: string };

// MCP-capable clients, in display order. Subset of the capture harnesses.
const MCP_CLIENT_ORDER = ["claude", "codex", "gemini", "antigravity", "cursor"];

const LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  antigravity: "Antigravity",
  opencode: "opencode",
  openclaw: "Openclaw",
  hermes: "Hermes",
  pi: "Pi",
  prevail: "Prevail",
};

export function IntegrationsPanel({ vaultPath }: { vaultPath: string; clis: CliInfo[] }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [busy, setBusy] = useState<"" | "install" | "sync">("");
  const [note, setNote] = useState<string | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpBusyClient, setMcpBusyClient] = useState("");
  const [mcpClients, setMcpClients] = useState<McpClient[]>([]);
  const [mcpMsg, setMcpMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await invoke<CaptureStatus>("capture_status", { vault: vaultPath }));
    } catch (e) {
      setNote(`Could not read capture status: ${String(e).slice(0, 140)}`);
    }
    try {
      const m = await invoke<{ clients?: McpClient[] }>("mcp_install_status");
      setMcpClients(m.clients ?? []);
    } catch {
      /* engine may be mid-launch; leave MCP list empty */
    }
  }, [vaultPath]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runInstall() {
    setBusy("install");
    setNote(null);
    try {
      await invoke("capture_install", { vault: vaultPath });
      setNote("Capture installed. Push hooks wired; sync backstop staged (disabled until you enable it).");
      await load();
    } catch (e) {
      setNote(`Install failed: ${String(e).slice(0, 140)}`);
    } finally {
      setBusy("");
    }
  }

  async function runSync() {
    setBusy("sync");
    setNote(null);
    try {
      const r = await invoke<{ sources?: SyncSource[] }>("capture_sync", { vault: vaultPath });
      const wrote = (r.sources ?? []).reduce((n, s) => n + (s.written ?? 0), 0);
      setNote(wrote > 0 ? `Synced ${wrote} new prompt${wrote === 1 ? "" : "s"} from your CLI transcripts.` : "Already up to date - nothing new to sync.");
      await load();
    } catch (e) {
      setNote(`Sync failed: ${String(e).slice(0, 140)}`);
    } finally {
      setBusy("");
    }
  }

  async function installClientMcp(client: string) {
    setMcpBusyClient(client);
    setMcpMsg(null);
    try {
      const r = await invoke<{ clients?: McpClient[] }>("mcp_install", { client });
      const c = r.clients?.find((x) => x.client === client);
      const label = LABELS[client] ?? client;
      setMcpMsg(
        c?.registered
          ? { ok: true, text: `${label}: registered. Restart ${label} to pick it up.` }
          : { ok: false, text: `${label}: ${(c?.error || "install failed").slice(0, 150)}` },
      );
      await load();
    } catch (e) {
      setMcpMsg({ ok: false, text: String(e).slice(0, 160) });
    } finally {
      setMcpBusyClient("");
    }
  }

  async function testMcp() {
    setMcpBusy(true);
    setMcpMsg(null);
    try {
      const r = await invoke<{ ok: boolean; info?: string; error?: string }>("mcp_test_handshake", { vault: vaultPath });
      setMcpMsg({ ok: !!r.ok, text: r.ok ? (r.info ?? "Handshake OK.") : (r.error ?? "Handshake failed.") });
    } catch (e) {
      setMcpMsg({ ok: false, text: String(e).slice(0, 160) });
    } finally {
      setMcpBusy(false);
    }
  }

  const streamCount = (tool: string) => status?.streams?.find((s) => s.tool === tool)?.count ?? 0;
  const totalCaptured = (status?.streams ?? []).reduce((n, s) => n + s.count, 0);
  const harnesses = status?.harnesses ?? [];

  function gotoMcpSection() {
    window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: "mcp" }));
  }

  return (
    <>
      <SettingsHeader
        title="Integrations"
        icon={Cable}
        subtitle="Wire Prevail into every AI CLI you use. Capture the prompts you type across Claude Code, Codex, Gemini and more into your vault, and expose your vault back to them over MCP - one click, no copy-paste."
      />

      {/* CAPTURE ------------------------------------------------------------ */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Prompt capture</div>
            <div className="text-xs text-text-secondary">
              Every prompt you submit, saved to <code className="text-accent">_meta/prompts.&lt;tool&gt;.jsonl</code> and distilled into your intents.
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg font-semibold text-accent">{totalCaptured.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">prompts captured</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={runInstall}
            disabled={busy !== ""}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
          >
            {busy === "install" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {busy === "install" ? "Installing…" : "Install capture"}
          </button>
          <button
            onClick={runSync}
            disabled={busy !== ""}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50"
          >
            {busy === "sync" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
          {note && <span className="text-[11px] text-text-secondary">{note}</span>}
        </div>

        {/* per-harness wiring + counts */}
        <div className="mt-4 overflow-hidden rounded-md border border-border-subtle">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-warm/60 text-[10px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Harness</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Captured</th>
              </tr>
            </thead>
            <tbody>
              {harnesses.map((h) => (
                <tr key={h.tool} className="border-t border-border-subtle">
                  <td className="px-3 py-2">
                    <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${h.present ? "bg-ok" : "bg-border"}`} />
                    {LABELS[h.tool] ?? h.tool}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${h.method === "push" ? "bg-ai/15 text-ai" : "bg-surface-warm text-text-muted"}`}>
                      {h.method}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {h.method === "push"
                      ? h.wired
                        ? <span className="inline-flex items-center gap-1 text-ok"><Check className="h-3 w-3" /> wired</span>
                        : <span className="text-text-muted">{h.present ? "not wired" : "not installed"}</span>
                      : <span className="text-text-muted" title={h.detail}>{h.detail ? "backstop" : "-"}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-text-secondary">{streamCount(h.tool).toLocaleString()}</td>
                </tr>
              ))}
              {harnesses.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-3 text-center text-text-muted">Run “Install capture” to wire up your CLIs.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {status?.agent && !status.agent.loaded && status.agent.plistPresent && (
          <div className="mt-2 text-[11px] text-text-muted">
            Sync backstop is staged but disabled (safe default). Enable it with <code className="text-accent">launchctl load {status.agent.plist}</code>, or just hit “Sync now” when you want a pull.
          </div>
        )}
      </div>

      {/* MCP --------------------------------------------------------------- */}
      <div className="mt-5 rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">MCP access</div>
        <div className="mb-3 text-xs text-text-secondary">
          Let each CLI drive Prevail: register your vault as an MCP server in its config, one click, no copy-paste. Registered flag-less so it follows your vault if you move it.
        </div>
        <div className="overflow-hidden rounded-md border border-border-subtle">
          {MCP_CLIENT_ORDER.map((id) => {
            const c = mcpClients.find((x) => x.client === id);
            const present = c?.present ?? false;
            const registered = c?.registered ?? false;
            const busyThis = mcpBusyClient === id;
            return (
              <div key={id} className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${present ? "bg-ok" : "bg-border"}`} />
                  <span>{LABELS[id] ?? id}</span>
                  {registered && (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-ok">
                      <Check className="h-3 w-3" /> registered
                    </span>
                  )}
                  {!present && <span className="text-[10px] uppercase tracking-wider text-text-muted">not installed</span>}
                </div>
                <button
                  onClick={() => installClientMcp(id)}
                  disabled={busyThis || mcpBusyClient !== ""}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
                >
                  {busyThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  {registered ? "Re-install" : "Install"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={testMcp}
            disabled={mcpBusy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50"
          >
            {mcpBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Test handshake
          </button>
          <button
            onClick={gotoMcpSection}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
          >
            <Wrench className="h-3 w-3" /> Manual configs
          </button>
          {mcpMsg && (
            <span className={`font-mono text-[11px] ${mcpMsg.ok ? "text-ok" : "text-warn"}`}>
              {mcpMsg.ok ? "OK " : "x "}{mcpMsg.text}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
