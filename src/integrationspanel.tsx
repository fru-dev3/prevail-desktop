// Integrations - wiring Prevail into every AI CLI. Rendered inside the MCP page
// (MCP setup on top, capture below), so it has no page header of its own.
//
//   1. MCP ACCESS  - register your vault as an MCP server in each CLI, one click.
//   2. PROMPT CAPTURE - record the prompts you type in each CLI into the vault.
//
// Heavy lifting lives in the prevail engine (`prevail capture …`, `prevail mcp
// install …`), reached through async Tauri commands that never block the UI.
import { useCallback, useEffect, useState } from "react";
import { Check, Download, FolderOpen, History, Loader2, RefreshCw, Zap } from "lucide-react";
import { invoke } from "./bridge";
import { Toggle } from "./ui";
import { McpSection } from "./settings5";
import type { CliInfo } from "./types";

type Harness = {
  tool: string;
  method: "push" | "sync";
  present: boolean;
  wired: boolean;
  enabled?: boolean;
  target?: string;
  detail?: string;
};
type Stream = { tool: string; path: string; count: number };
type CaptureStatus = {
  meta?: string;
  streams?: Stream[];
  agent?: { plistPresent: boolean; loaded: boolean; supported: boolean; plist: string };
  harnesses?: Harness[];
};
type SyncSource = { tool: string; found: number; written: number; skipped: number };
type McpClient = { client: string; present: boolean; registered: boolean; error?: string };

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
  const [mcpClients, setMcpClients] = useState<McpClient[]>([]);
  const [busy, setBusy] = useState<"" | "install" | "sync">("");
  const [note, setNote] = useState<string | null>(null);
  const [togglingTool, setTogglingTool] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpBusyClient, setMcpBusyClient] = useState("");
  const [mcpMsg, setMcpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mcpTab, setMcpTab] = useState<"oneclick" | "manual">("oneclick");

  const loadCapture = useCallback(async () => {
    try {
      setStatus(await invoke<CaptureStatus>("capture_status", { vault: vaultPath }));
    } catch (e) {
      setNote(`Could not read capture status: ${String(e).slice(0, 140)}`);
    }
  }, [vaultPath]);

  const loadMcp = useCallback(async () => {
    try {
      const m = await invoke<{ clients?: McpClient[] }>("mcp_install_status");
      setMcpClients(m.clients ?? []);
    } catch {
      /* leave the MCP list at its registry defaults */
    }
  }, []);

  useEffect(() => {
    void loadCapture();
    void loadMcp();
  }, [loadCapture, loadMcp]);

  async function runInstall() {
    setBusy("install");
    setNote(null);
    try {
      await invoke("capture_install", { vault: vaultPath });
      setNote("Capture turned on. Claude Code now logs live; other tools are read automatically from their chat history.");
      await loadCapture();
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
      await loadCapture();
    } catch (e) {
      setNote(`Sync failed: ${String(e).slice(0, 140)}`);
    } finally {
      setBusy("");
    }
  }

  async function toggleCapture(tool: string, on: boolean) {
    setTogglingTool(tool);
    setNote(null);
    try {
      await invoke("capture_set_enabled", { vault: vaultPath, tool, on });
      setNote(`${LABELS[tool] ?? tool} capture turned ${on ? "on" : "off"}.`);
      await loadCapture();
    } catch (e) {
      setNote(`Could not change ${LABELS[tool] ?? tool}: ${String(e).slice(0, 120)}`);
    } finally {
      setTogglingTool("");
    }
  }

  async function installClientMcp(client: string) {
    setMcpBusyClient(client);
    setMcpMsg(null);
    try {
      const r = await invoke<{ clients?: McpClient[] }>("mcp_install", { client });
      const c = r.clients?.find((x) => x.client === client);
      const label = LABELS[client] ?? client;
      // The install result is authoritative for THIS client (the registrar just
      // wrote the config / ran `claude mcp add`). Reflect it in the row
      // immediately instead of trusting the slower, flakier status re-check.
      if (c) {
        setMcpClients((prev) =>
          prev.some((x) => x.client === client)
            ? prev.map((x) => (x.client === client ? { ...x, ...c, present: true } : x))
            : [...prev, { ...c, present: true }],
        );
      }
      setMcpMsg(
        c?.registered
          ? { ok: true, text: `${label}: registered. Restart ${label} to pick it up.` }
          : { ok: false, text: `${label}: ${(c?.error || "install failed").slice(0, 150)}` },
      );
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

  async function reveal(path?: string) {
    if (!path) return;
    try {
      await invoke("open_in_finder", { path });
    } catch {
      /* best effort */
    }
  }
  const openFolder = () => reveal(status?.meta);
  const openFile = (tool: string) => reveal(status?.streams?.find((s) => s.tool === tool)?.path);

  return (
    <div className="mt-8 border-t border-border-subtle pt-6">
      {/* USE PREVAIL FROM YOUR TOOLS (MCP) - one-click OR manual, tabbed ------ */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-xl font-semibold text-text-primary">Use Prevail from your AI tools</h2>
        <div className="mb-4 text-sm text-text-secondary">
          MCP (Model Context Protocol) lets the AI CLIs you already use call into Prevail - run a council across your models, read a life domain's state, or list your domains - right inside the tool. Register Prevail once and it shows up as tools in Claude Code, Codex, Gemini and more. Uses a local stdio connection; nothing leaves your machine.
        </div>
        <div className="mb-4 inline-flex gap-1 rounded-lg border border-border-subtle bg-surface-warm/60 p-1">
          {(
            [
              ["oneclick", "One-click setup"],
              ["manual", "Manual config"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMcpTab(id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${mcpTab === id ? "bg-surface text-accent shadow-sm ring-1 ring-black/5" : "text-text-muted hover:text-text-secondary"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mcpTab === "manual" ? (
          <McpSection vaultPath={vaultPath} />
        ) : (
          <>
        <div className="mb-3 text-sm text-text-secondary">
          One click writes the server into each CLI's own config - no copy-paste. Flag-less, so it follows your vault if you move it.
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
          {mcpMsg && (
            <span className={`font-mono text-[11px] ${mcpMsg.ok ? "text-ok" : "text-warn"}`}>
              {mcpMsg.ok ? "OK " : "x "}{mcpMsg.text}
            </span>
          )}
        </div>
          </>
        )}
      </div>

      {/* PROMPT CAPTURE - record prompts from each CLI into the vault --------- */}
      <div className="mt-5 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mb-1 text-xl font-semibold text-text-primary">Prompt capture</h2>
            <div className="text-sm text-text-secondary">
              Every prompt you submit, saved to <code className="text-accent">_meta/prompts/&lt;tool&gt;.jsonl</code> and distilled into your intents. <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3 text-ai" /> = captured live as you type, <History className="h-3 w-3" /> = read from a tool's saved chats.</span>
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
          <button
            onClick={openFolder}
            disabled={!status?.meta}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50"
          >
            <FolderOpen className="h-3 w-3" /> Open folder
          </button>
          {note && <span className="text-[11px] text-text-secondary">{note}</span>}
        </div>

        <div className="mt-4 overflow-hidden rounded-md border border-border-subtle">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-warm/60 text-[10px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Harness</th>
                <th className="px-3 py-2 text-center font-medium">How</th>
                <th className="px-3 py-2 text-right font-medium">Captured</th>
                <th className="px-3 py-2 text-right font-medium">Capture</th>
              </tr>
            </thead>
            <tbody>
              {harnesses.map((h) => (
                <tr key={h.tool} className="border-t border-border-subtle">
                  <td className="px-3 py-2">
                    <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${h.present ? "bg-ok" : "bg-border"}`} />
                    {LABELS[h.tool] ?? h.tool}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className="inline-flex"
                      title={h.method === "push" ? "Captured live, the moment you send a prompt" : "Read from this tool's saved chat files"}
                    >
                      {h.method === "push" ? <Zap className="h-4 w-4 text-ai" /> : <History className="h-4 w-4 text-text-muted" />}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-text-secondary">
                    {streamCount(h.tool) > 0 ? (
                      <button onClick={() => openFile(h.tool)} className="underline-offset-2 hover:text-accent hover:underline" title="Open this file">
                        {streamCount(h.tool).toLocaleString()}
                      </button>
                    ) : (
                      <span className="text-text-muted">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <Toggle
                        on={h.enabled !== false}
                        onChange={(v) => toggleCapture(h.tool, v)}
                        disabled={togglingTool !== ""}
                        label={`Capture ${LABELS[h.tool] ?? h.tool}`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {harnesses.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-3 text-center text-text-muted">Run "Install capture" to wire up your CLIs.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
