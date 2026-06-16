// Settings sections extracted from App.tsx: Gateways (Telegram/WhatsApp + the
// coming-soon roster), MCP (server config + the McpCard verifier), and About
// (version, update check, changelog).
import { useEffect, useState } from "react";
import { confirm as tauriConfirm, open, save } from "@tauri-apps/plugin-dialog";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Check, Folder, Loader2, Mail, MessageSquare, MessagesSquare, Network, Radio, Send, Sparkles, Wrench, Zap } from "lucide-react";
import { siDiscord, siMatrix, siMattermost, siSignal, siTelegram } from "simple-icons";
import { invoke, listen } from "./bridge";
import { CollapsibleSection } from "./collapsible";
import { APP_VERSION, SETTINGS_ROW } from "./constants";
import { modelsFor } from "./helpers2";
import { LS, isBunkerOn, lsGet, lsSet } from "./storage";
import { Toggle } from "./ui";
import { GatewayMark, WhatsAppCard } from "./panels";
import { SettingsHeader, mcpCommandPath } from "./sectionutil";
import { compareSemver } from "./textutil";
import { useCliVerifyLive } from "./verify";
import { BrandMark } from "./brandmark";
import type { CliInfo, DiagCheck, TgBridgeStatus } from "./types";
import type { UnlistenFn } from "./bridge";

export const COMING_SOON_GATEWAYS: { name: string; icon?: { path: string; hex: string }; mono?: typeof Mail }[] = [
  { name: "Discord", icon: siDiscord },
  { name: "Slack", mono: MessagesSquare },
  { name: "Signal", icon: siSignal },
  { name: "Matrix", icon: siMatrix },
  { name: "Mattermost", icon: siMattermost },
  { name: "Email (IMAP/SMTP)", mono: Mail },
  { name: "SMS (Twilio)", mono: MessageSquare },
];

// U2: Gateway is the single, self-contained section (owns its header) — folds in
// the former "Integrations" bridge cards (A1) without the earlier double header /
// double Telegram-card bug. Live bridges first, then coming-soon, evenly gridded.

export function GatewaySection() {
  const [liveTg, setLiveTg] = useState(false);
  const liveWa = false;
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try { const t = await invoke<{ running: boolean }>("telegram_bridge_status"); if (alive) setLiveTg(!!t.running); } catch { if (alive) setLiveTg(false); }
    };
    void check();
    const id = window.setInterval(() => void check(), 8000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  const anyLive = liveTg || liveWa;
  return (
    <>
      <SettingsHeader title="Gateway" icon={MessagesSquare} subtitle="Chat with your council from anywhere. Your vault stays local: these bridges relay messages to your domains and back." />

      <div>
        <CollapsibleSection
          icon={Radio}
          title="Bridges"
          subtitle="Two-way relays: message your council from another app."
          summary={anyLive ? `live${liveTg ? " · Telegram" : ""}` : "Telegram, WhatsApp"}
          status={anyLive}
          defaultOpen={anyLive}
        >
          <div className="space-y-4">
            <TelegramCard />
            <WhatsAppCard />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          icon={Sparkles}
          title="More surfaces"
          subtitle="Other gateways on the way."
          summary={`${COMING_SOON_GATEWAYS.length} coming`}
        >
          <div className="space-y-1">
            {COMING_SOON_GATEWAYS.map((g) => (
              <div key={g.name} className={SETTINGS_ROW}>
                <GatewayMark icon={g.icon} mono={g.mono} />
                <span className="flex-1 text-sm text-text-secondary">{g.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Coming soon</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      </div>
    </>
  );
}

export function TelegramCard() {
  // Audit #7: the bot token is a secret — it lives in the Keychain, never in
  // localStorage. `token` is a transient input value only; `tokenSaved` reflects
  // whether a token exists in the Keychain. chatId is just an identifier (not a
  // secret), so it stays in localStorage.
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [chatId, setChatId] = useState(lsGet(LS.telegramChatId));
  const [bridgeCli, setBridgeCli] = useState(lsGet("prevail.telegram.cli") || "claude");
  const [bridgeModel, setBridgeModel] = useState(lsGet("prevail.telegram.model"));
  // Only route to providers that are detected AND validated (the user asked for
  // the dropdown to list "the ones that have been validated and are actually
  // active"). cliVerifyLive is the app-wide validation map.
  const verify = useCliVerifyLive();
  const [tgClis, setTgClis] = useState<CliInfo[]>([]);
  useEffect(() => { invoke<CliInfo[]>("detect_clis").then(setTgClis).catch(() => {}); }, []);
  const routableClis = tgClis.filter((c) => c.available && verify.get(c.id)?.status !== "failed");
  // Keep the selection valid: if the chosen CLI isn't routable, fall back.
  useEffect(() => {
    if (routableClis.length > 0 && !routableClis.some((c) => c.id === bridgeCli)) {
      setBridgeCli(routableClis[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgClis, verify]);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" });
  const [bridge, setBridge] = useState<TgBridgeStatus | null>(null);
  const [feed, setFeed] = useState<Array<{ dir: "in" | "out"; text: string; ts: number }>>([]);

  // On mount: migrate any legacy localStorage token into the Keychain (then wipe
  // it), and reflect whether a token is configured.
  useEffect(() => {
    (async () => {
      try {
        const legacy = lsGet(LS.telegramToken);
        if (legacy && legacy.trim()) {
          await invoke("provider_key_set", { provider: "telegram", key: legacy.trim() });
          lsSet(LS.telegramToken, ""); // wipe the plaintext secret from localStorage
        }
        const ok = await invoke<boolean>("provider_key_exists", { provider: "telegram" });
        setTokenSaved(!!ok);
      } catch { /* keychain unavailable: leave unconfigured */ }
    })();
  }, []);
  useEffect(() => { lsSet(LS.telegramChatId, chatId); }, [chatId]);
  useEffect(() => { lsSet("prevail.telegram.cli", bridgeCli); }, [bridgeCli]);
  useEffect(() => { lsSet("prevail.telegram.model", bridgeModel); }, [bridgeModel]);

  async function refreshStatus() {
    try {
      const s = await invoke<TgBridgeStatus>("telegram_bridge_status");
      setBridge(s);
    } catch { /* ignore */ }
  }
  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 3000);
    let u1: UnlistenFn | null = null;
    let u2: UnlistenFn | null = null;
    (async () => {
      u1 = await listen<{ text: string }>("tg:message_in", (e) => {
        setFeed((cur) => [...cur.slice(-19), { dir: "in", text: e.payload.text, ts: Date.now() }]);
      });
      u2 = await listen<{ text: string }>("tg:message_out", (e) => {
        setFeed((cur) => [...cur.slice(-19), { dir: "out", text: e.payload.text, ts: Date.now() }]);
      });
    })();
    return () => { window.clearInterval(id); if (u1) u1(); if (u2) u2(); };
  }, []);

  async function startBridge() {
    if (!chatId.trim() || (!token.trim() && !tokenSaved)) {
      setStatus({ kind: "err", msg: "fill in token + chat ID first" });
      return;
    }
    try {
      // If a new token was typed, persist it to the Keychain (and clear the
      // input); otherwise the bridge resolves the saved token server-side.
      if (token.trim()) {
        await invoke("provider_key_set", { provider: "telegram", key: token.trim() });
        setTokenSaved(true);
        setToken("");
      }
      // Routing table: every vault domain plus its stored/derived keywords,
      // so a "wealth" question from Telegram lands in the wealth domain with
      // a recorded thread.
      let routes: { domain: string; keywords: string[] }[] = [];
      let vault: string | null = null;
      try {
        vault = lsGet(LS.vault) || null;
        if (vault) {
          const ds = await invoke<{ name: string }[]>("scan_vault", { path: vault });
          routes = ds.map((d) => ({
            domain: d.name,
            keywords: (lsGet(`prevail.domain.${d.name}.routing.keywords`) || "")
              .split(",").map((s) => s.trim()).filter(Boolean),
          }));
        }
      } catch { /* routing is best-effort; bridge works without it */ }
      await invoke("telegram_bridge_start", {
        cfg: {
          token: "", // bridge reads the secret from the Keychain
          chat_id: chatId.trim(),
          cli: bridgeCli,
          model: bridgeModel || null,
          domain: null,
          vault,
          routes,
        },
      });
      await refreshStatus();
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }
  async function stopBridge() {
    try {
      await invoke("telegram_bridge_stop");
      await refreshStatus();
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }

  async function testSend() {
    if (!chatId || (!token.trim() && !tokenSaved)) {
      setStatus({ kind: "err", msg: "fill in token + chat ID first" });
      return;
    }
    // If a fresh token was typed, save it first so Test uses the same secret.
    if (token.trim()) {
      try { await invoke("provider_key_set", { provider: "telegram", key: token.trim() }); setTokenSaved(true); setToken(""); } catch { /* ignore */ }
    }
    setStatus({ kind: "idle", msg: "sending…" });
    try {
      const r = await invoke<{ ok: boolean; description?: string }>("telegram_send", {
        token: "", chatId, text: "◆ Prevail desktop · test message ✓",
      });
      if (r.ok) {
        setStatus({ kind: "ok", msg: "delivered ✓" });
      } else {
        setStatus({ kind: "err", msg: r.description ?? "send failed" });
      }
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }

  const ready = !!chatId.trim() && (!!token.trim() || tokenSaved);
  return (
    // TG-1: cleaner top-to-bottom flow — header carries the live status; setup
    // (credentials + routing) is one labelled block; one primary action row;
    // running stats + feed only appear when relevant; help is a quiet footer.
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#229ED9]/15">
          <svg width={20} height={20} viewBox="0 0 24 24" fill="#229ED9" aria-hidden><path d={siTelegram.path} /></svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Telegram bridge</h3>
          <p className="text-xs text-text-muted">Two-way chat: messages to your bot route to the chosen model and the reply is pushed back.</p>
        </div>
        <span className={`shrink-0 self-start rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
          bridge?.running ? "border border-accent-border bg-accent-soft text-accent" : "border border-border bg-background text-text-muted"
        }`}>
          {bridge?.running ? "● live" : "○ stopped"}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        {/* Step 1 — credentials + routing, one premium setup block. */}
        <div className="rounded-lg border border-border bg-background p-4">
          <div className="space-y-3">
            <label className="block">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
                Bot token
                {tokenSaved && <span className="rounded-full bg-accent-soft px-1.5 py-0 font-mono text-[9px] tracking-wider text-accent">in keychain</span>}
              </div>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)}
                placeholder={tokenSaved ? "•••••••• (type to replace)" : "123456:ABC-XYZ…"}
                className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 font-mono text-sm focus:border-accent-border focus:outline-none" spellCheck={false} />
            </label>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Chat ID</div>
              <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890"
                className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 font-mono text-sm focus:border-accent-border focus:outline-none" spellCheck={false} />
            </label>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Route to model</div>
              <select value={bridgeCli} onChange={(e) => setBridgeCli(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm focus:border-accent-border focus:outline-none">
                {routableClis.length === 0 ? (
                  <option value="">No validated provider; set one in Models</option>
                ) : (
                  routableClis.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}{verify.get(c.id)?.status === "ok" ? " ✓" : ""}</option>
                  ))
                )}
              </select>
            </label>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Model</div>
              <select value={bridgeModel} onChange={(e) => setBridgeModel(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface px-2 py-2 text-sm focus:border-accent-border focus:outline-none">
                <option value="">{`Provider default (${modelsFor(bridgeCli)[0]?.label ?? "default"})`}</option>
                {modelsFor(bridgeCli).map((m) => (<option key={m.id} value={m.id}>{m.label}</option>))}
              </select>
            </label>
          </div>
        </div>

        {/* Step 2 — one action row. P1 (Monday feedback): the bridge is an ON/Off
            toggle (was Start/Stop text); test is the secondary action. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm ${ready ? "" : "opacity-50"}`} title={ready ? "Turn the bridge on/off" : "Fill in token + chat ID first"}>
            <Radio className={`h-3.5 w-3.5 ${bridge?.running ? "text-accent" : "text-text-muted"}`} />
            <span className="font-medium text-text-secondary">Bridge</span>
            <Toggle on={!!bridge?.running} onChange={(v) => { if (!ready) return; v ? void startBridge() : void stopBridge(); }} label="Telegram bridge on/off" />
          </label>
          <button onClick={testSend} disabled={!ready}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> Send test
          </button>
          {status.kind === "ok" && <span className="text-xs text-ok"><Check className="mr-1 inline h-3 w-3" />{status.msg}</span>}
          {status.kind === "err" && <span className="text-xs text-warn">{status.msg}</span>}
          {bridge?.running && (
            <span className="ml-auto font-mono text-[10px] text-text-muted">
              in {bridge.inbound_count} · out {bridge.outbound_count}{bridge.last_inbound_ts ? ` · last ${Math.round((Date.now() / 1000 - bridge.last_inbound_ts))}s ago` : ""}
            </span>
          )}
        </div>
        {bridge?.last_error && (
          <div className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">{bridge.last_error}</div>
        )}

        {/* Live feed — only when there's traffic. */}
        {feed.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-lg border border-border-subtle bg-background px-2 py-1.5">
            {feed.map((f, i) => (
              <li key={i} className="font-mono text-[10px] leading-relaxed">
                <span className={f.dir === "in" ? "text-accent" : "text-text-muted"}>{f.dir === "in" ? "▶" : "◀"}</span>{" "}
                <span className={f.dir === "in" ? "text-text-primary" : "text-text-secondary"}>{f.text.slice(0, 200)}{f.text.length > 200 ? "…" : ""}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Quiet footer: routing + setup help. */}
        <p className="text-[11px] leading-relaxed text-text-muted">
          Inbound messages route to a domain by its keywords (set per-domain under <span className="font-mono text-text-secondary">Domain → Prefs → Channels &amp; routing</span>).
          {" "}New to bots? <a href="https://core.telegram.org/bots/features#botfather" target="_blank" rel="noreferrer" className="text-accent hover:underline">Create one via @BotFather</a>, then use getUpdates to find your chat ID.
        </p>
      </div>
    </div>
  );
}

export function McpCard() {
  const [enabled, setEnabled] = useState(lsGet(LS.mcpEnabled) === "1");
  useEffect(() => { lsSet(LS.mcpEnabled, enabled ? "1" : ""); }, [enabled]);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ai/15 text-ai">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">
            MCP server <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">preview</span>
          </h3>
          <p className="text-xs text-text-muted">Expose your vault to Claude Desktop or any MCP client over localhost.</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-background p-3">
        <div>
          <div className="text-sm">MCP server</div>
          <div className="text-xs text-text-muted">
            {enabled ? "Listening on localhost:7842" : "Off"}
          </div>
        </div>
        <Toggle on={enabled} onChange={setEnabled} label="Enable MCP server" />
      </div>
      <p className="mt-3 text-xs text-text-muted">
        For full MCP coverage right now, run the <BrandMark /> CLI's <code className="text-accent">mcp-server</code> command: it ships read-only by default and is parent-process verified.
      </p>
    </div>
  );
}

// BriefingsCard removed — landing back in v0.3 when wired up.

export function McpSection({ vaultPath }: { vaultPath: string }) {
  const [enginePath, setEnginePath] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [handshake, setHandshake] = useState<{ ok: boolean; msg: string } | null>(null);
  // "Move to Applications" state — must be top-level hooks (the block that uses
  // them renders conditionally on mcpPathUnstable, which flips after the async
  // engine-path resolves; declaring them inside that block broke rules-of-hooks).
  const [moving, setMoving] = useState(false);
  const [moveMsg, setMoveMsg] = useState<string | null>(null);
  async function runHandshake() {
    setTesting(true); setHandshake(null);
    try {
      const r = await invoke<{ ok: boolean; info?: string; error?: string }>("mcp_test_handshake", { vault: vaultPath });
      setHandshake({ ok: !!r.ok, msg: r.ok ? (r.info ?? "Handshake OK.") : (r.error ?? "Handshake failed.") });
    } catch (e) {
      setHandshake({ ok: false, msg: String(e).slice(0, 160) });
    } finally { setTesting(false); }
  }
  useEffect(() => {
    invoke<{ engine_bin?: string }>("app_diagnostics").then((d) => setEnginePath(d.engine_bin ?? "prevail")).catch(() => setEnginePath("prevail"));
  }, []);
  const { command: mcpCommand, unstable: mcpPathUnstable } = mcpCommandPath(enginePath);
  // Ready-to-paste configs per client — the resolved absolute bin path baked in,
  // so connecting is copy-paste instead of guesswork.
  const clients: { id: string; label: string; kind: "shell" | "json" | "toml"; body: string; note: string }[] = [
    {
      id: "claude-code", label: "Claude Code", kind: "shell",
      body: `claude mcp add prevail -- ${mcpCommand} mcp --vault ${vaultPath}`,
      note: "Run this in your terminal. Restart Claude Code, then `/mcp` to confirm.",
    },
    {
      id: "claude-desktop", label: "Claude Desktop", kind: "json",
      body: JSON.stringify({ mcpServers: { prevail: { command: mcpCommand, args: ["mcp", "--vault", vaultPath] } } }, null, 2),
      note: "Add to claude_desktop_config.json (Settings → Developer → Edit Config), then restart.",
    },
    {
      id: "codex", label: "Codex", kind: "toml",
      body: `[mcp_servers.prevail]\ncommand = "${mcpCommand}"\nargs = ["mcp", "--vault", "${vaultPath}"]`,
      note: "Add to ~/.codex/config.toml, then restart Codex.",
    },
    {
      id: "gemini", label: "Gemini CLI", kind: "json",
      body: JSON.stringify({ mcpServers: { prevail: { command: mcpCommand, args: ["mcp", "--vault", vaultPath] } } }, null, 2),
      note: "Add to ~/.gemini/settings.json under mcpServers, then restart.",
    },
    // MCP-3: broaden coverage to the other common MCP hosts. All use stdio with
    // the same resolved command; only the file location + the wrapper key differ.
    {
      id: "cursor", label: "Cursor", kind: "json",
      body: JSON.stringify({ mcpServers: { prevail: { command: mcpCommand, args: ["mcp", "--vault", vaultPath] } } }, null, 2),
      note: "Add to ~/.cursor/mcp.json (global) or .cursor/mcp.json in a project, then reload Cursor.",
    },
    {
      id: "vscode", label: "VS Code", kind: "json",
      body: JSON.stringify({ servers: { prevail: { command: mcpCommand, args: ["mcp", "--vault", vaultPath] } } }, null, 2),
      note: "Add to .vscode/mcp.json (note: VS Code uses \"servers\", not \"mcpServers\"). Works with Copilot Agent mode + Continue/Cline.",
    },
    {
      id: "generic", label: "Other / stdio", kind: "json",
      body: JSON.stringify({ mcpServers: { prevail: { command: mcpCommand, args: ["mcp", "--vault", vaultPath] } } }, null, 2),
      note: "Any MCP host that speaks stdio (OpenClaw, Paperclip, Multica, Goose, Zed, …). Use this command + args in that client's MCP config. The server is read-only over stdio and parent-verified.",
    },
  ];
  const [client, setClient] = useState(clients[0].id);
  const active = clients.find((c) => c.id === client) ?? clients[0];
  return (
    <>
      <SettingsHeader title="MCP" icon={Wrench} subtitle="Use Prevail headlessly: expose your vault as an MCP server so Claude Code, Claude Desktop, Codex, or the Gemini CLI drive it: the same domains, routing, and self-learning, no UI required." />
      <div className="mb-5">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Connected servers (Prevail consumes)</div>
        <McpCard />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Expose Prevail to your agent</div>
        <div className="mb-3 text-xs text-text-secondary">Pick your tool, copy the config (the engine path is filled in), paste it, restart the tool. Then Test handshake to confirm it answers.</div>
        {mcpPathUnstable && (
          <div className="mb-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
            <div className="mb-2 font-medium">Prevail is not in your Applications folder.</div>
            <div className="mb-2">MCP requires a stable path. Move Prevail.app to /Applications/ once and this resolves permanently.</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={async () => {
                  setMoving(true); setMoveMsg(null);
                  try {
                    const src = enginePath?.includes(".app") ? enginePath.slice(0, enginePath.lastIndexOf(".app") + 4) : enginePath || "";
                    const msg = await invoke<string>("move_to_applications", { source: src });
                    setMoveMsg(msg);
                  } catch (e) { setMoveMsg(`Failed: ${e}`); }
                  setMoving(false);
                }}
                disabled={moving || !enginePath}
                className="inline-flex items-center gap-1.5 rounded border border-warn bg-warn/20 px-2.5 py-1 text-[11px] font-semibold hover:bg-warn/30 disabled:opacity-50"
              >
                {moving ? "Moving…" : "Move to Applications automatically"}
              </button>
              <button
                onClick={() => invoke("open_in_finder", { path: "/Applications" }).catch(() => {})}
                className="inline-flex items-center gap-1.5 rounded border border-warn/40 bg-warn/10 px-2.5 py-1 text-[11px] hover:bg-warn/20"
              >
                <Folder className="h-3 w-3" /> Open Applications folder
              </button>
              {moveMsg && <span className="w-full text-[11px]">{moveMsg}</span>}
            </div>
          </div>
        )}
        <div className="mb-3 inline-flex flex-wrap gap-1 rounded-lg border border-border-subtle bg-surface-warm/60 p-1">
          {clients.map((c) => (
            <button key={c.id} onClick={() => setClient(c.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${client === c.id ? "bg-surface text-accent shadow-sm ring-1 ring-black/5" : "text-text-muted hover:text-text-secondary"}`}>
              {c.label}
            </button>
          ))}
        </div>
        <pre className="overflow-auto rounded-md border border-border-subtle bg-background p-3 font-mono text-[11px] text-text-secondary whitespace-pre-wrap">{active.body}</pre>
        <div className="mt-1.5 text-[11px] text-text-muted">{active.note}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => { navigator.clipboard.writeText(active.body).catch(() => {}); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
            {copied ? "Copied" : `Copy ${active.kind === "shell" ? "command" : "config"}`}
          </button>
          <button onClick={runHandshake} disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50">
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {testing ? "Testing…" : "Test handshake"}
          </button>
          {handshake && (
            <span className={`font-mono text-[11px] ${handshake.ok ? "text-ok" : "text-warn"}`}>
              {handshake.ok ? "✓ " : "✗ "}{handshake.msg}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

// Settings > Tasks: every task across every domain in one place, so you can
// triage what is accumulating where (the cross-domain view, vs per-domain
// Insights). Grouped by status; shows due, source, and added date.

export function AboutSection({ vaultPath }: { vaultPath: string }) {
  const verify = useCliVerifyLive();
  const [checking, setChecking] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<DiagCheck[] | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagCopied, setDiagCopied] = useState(false);

  // A real health check: each item verifies one thing Prevail depends on and
  // says why it matters, with a pass/warn/fail verdict you can act on.
  async function runDiagnosis() {
    setDiagRunning(true);
    const out: DiagCheck[] = [];
    let d: { desktop_version: string; os: string; arch: string; engine_version?: string; engine_bin: string; engine_bundled: boolean; app_support: string } | null = null;
    try { d = await invoke("app_diagnostics"); } catch { /* engine probe failed */ }

    // Engine sidecar.
    if (d) {
      const match = d.engine_version && d.engine_version.length > 0;
      out.push({
        label: "Engine", status: match ? "ok" : "warn",
        detail: `${d.engine_version ?? "unknown"} ${d.engine_bundled ? "(bundled)" : `(${d.engine_bin})`}`,
        why: "The engine runs every chat, council, and benchmark. Bundled = shipped with the app.",
      });
    } else {
      out.push({ label: "Engine", status: "fail", detail: "not reachable", why: "Without the engine, nothing runs. Reinstall the app." });
    }

    // Vault: reachable, writable, encryption state.
    if (vaultPath) {
      let exists = false;
      try { exists = await invoke<boolean>("vault_exists", { path: vaultPath }); } catch { /* */ }
      let enc: { encrypted: boolean; unlocked: boolean } | null = null;
      try { enc = await invoke("engine_vault_status", { vault: vaultPath }); } catch { /* */ }
      const encNote = enc?.encrypted ? (enc.unlocked ? " · encrypted, unlocked" : " · encrypted, LOCKED") : "";
      out.push({
        label: "Vault", status: exists ? (enc?.encrypted && !enc.unlocked ? "warn" : "ok") : "fail",
        detail: `${vaultPath}${encNote}`,
        why: exists ? "Your data lives here. An encrypted+locked vault can't be read until you unlock it." : "The vault path doesn't exist; pick or restore it in Settings → Workspace.",
      });
    } else {
      out.push({ label: "Vault", status: "fail", detail: "no vault selected", why: "Set up a vault in Settings → Workspace." });
    }

    // Agents: detected AND validated.
    let clis: CliInfo[] = [];
    try { clis = await invoke<CliInfo[]>("detect_clis"); } catch { /* */ }
    const detected = clis.filter((c) => c.available);
    const valid = detected.filter((c) => verify.get(c.id)?.status === "ok");
    out.push({
      label: "Agents", status: valid.length > 0 ? "ok" : detected.length > 0 ? "warn" : "fail",
      detail: detected.length === 0 ? "none detected" : detected.map((c) => `${c.label}${verify.get(c.id)?.status === "ok" ? " ✓" : verify.get(c.id)?.status === "failed" ? " ✗" : " ?"}`).join(", "),
      why: valid.length > 0 ? "These models are installed and answered a live test." : detected.length > 0 ? "Installed but not validated; open Settings → Models and re-check (often a login/token issue)." : "Install at least one CLI (claude, codex, ollama) to chat.",
    });

    // Network + Bunker.
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    const bunker = isBunkerOn();
    out.push({
      label: "Network", status: bunker ? "info" : online ? "ok" : "warn",
      detail: bunker ? "Bunker Mode ON (local-only by design)" : online ? "online" : "offline",
      why: bunker ? "Cloud is intentionally blocked; only local models run." : online ? "Cloud models and updates are reachable." : "Offline; cloud models and update checks won't work until reconnected.",
    });

    // Update check.
    try {
      const u = await checkUpdate();
      out.push({
        label: "Updates", status: u ? "warn" : "ok",
        detail: u ? `v${u.version} available` : `on the latest (v${APP_VERSION})`,
        why: u ? "Click 'Check for updates' above to install it in place." : "You're running the newest release.",
      });
    } catch {
      out.push({ label: "Updates", status: "info", detail: "couldn't check", why: "Update feed unreachable (offline or first release). Not a problem." });
    }

    // Background surfaces.
    try {
      const tg = await invoke<{ running: boolean }>("telegram_bridge_status");
      const wu = await invoke<{ running: boolean }>("webui_status");
      const surfaces = [tg.running ? "Telegram" : null, wu.running ? "WebUI" : null].filter(Boolean);
      out.push({
        label: "External access", status: surfaces.length > 0 ? "info" : "ok",
        detail: surfaces.length > 0 ? `LIVE: ${surfaces.join(", ")}` : "none active",
        why: surfaces.length > 0 ? "These bridges can reach the app from outside right now." : "No external surface is exposed.",
      });
    } catch { /* */ }

    setChecks(out);
    setDiagRunning(false);
  }

  function diagText(): string {
    const head = `Prevail Desktop v${APP_VERSION}`;
    const lines = (checks ?? []).map((c) => `[${c.status.toUpperCase()}] ${c.label}: ${c.detail}`);
    return [head, ...lines].join("\n");
  }

  async function exportConfig() {
    const cfg: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("prevail.")) cfg[k] = localStorage.getItem(k) ?? "";
    }
    try {
      const path = await save({ defaultPath: "prevail-config.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return;
      await invoke("write_text_file", { path, contents: JSON.stringify(cfg, null, 2) });
    } catch (e) { console.error("exportConfig", e); }
  }

  async function importConfig() {
    try {
      const path = await open({ multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path || typeof path !== "string") return;
      const json = await invoke<string>("read_text_file", { path });
      const cfg = JSON.parse(json) as Record<string, string>;
      for (const [k, v] of Object.entries(cfg)) if (k.startsWith("prevail.")) localStorage.setItem(k, String(v));
      window.location.reload();
    } catch (e) { console.error("importConfig", e); }
  }

  async function resetConfig() {
    const ok = await tauriConfirm("Reset all Prevail preferences to defaults? Your vault, chats, and stored secrets are not affected.", { title: "Reset to defaults", kind: "warning" });
    if (!ok) return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      // Reset prefs + desktop settings, but keep the vault selection.
      if ((k.startsWith("prevail.pref.") || k.startsWith("prevail.desktop.") || k.startsWith("prevail.about.")) && k !== "prevail.desktop.vaultPath") keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  }

  async function uninstall(scope: "app" | "data") {
    const msg = scope === "app"
      ? "Remove Prevail.app from Applications? Your config, chats, and secrets stay so you can reinstall later."
      : "Remove the app, all app data, caches, and stored secrets? Your vault folder is NOT deleted. This cannot be undone.";
    const ok = await tauriConfirm(msg, { title: "Uninstall Prevail", kind: "warning" });
    if (!ok) return;
    try { await invoke("app_uninstall", { scope }); } catch (e) { console.error("uninstall", e); }
  }

  const [installing, setInstalling] = useState(false);
  async function checkForUpdates() {
    setChecking(true);
    setCheckErr(null);
    setLatest(null);
    try {
      // Preferred path: the Tauri updater — checks the signed latest.json feed,
      // downloads + installs in-place, then relaunches. No browser detour.
      const update = await checkUpdate();
      if (update) {
        setLatest(update.version);
        setInstalling(true);
        await update.downloadAndInstall();
        await relaunch();
        return;
      }
      // No update object → already current.
      setLatest(APP_VERSION);
    } catch (_pluginErr) {
      // Updater feed not reachable yet (e.g. first release before latest.json
      // is published) → fall back to the GitHub releases API + open the page.
      try {
        const r = await fetch("https://api.github.com/repos/fru-dev3/prevail-desktop/releases?per_page=10");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const releases = await r.json() as Array<{ tag_name: string; prerelease: boolean; html_url: string }>;
        const top = releases.find((rel) => !rel.prerelease) ?? releases[0];
        if (!top) throw new Error("no releases found");
        setLatest(top.tag_name);
        try { await invoke("open_in_finder", { path: top.html_url }); } catch {}
      } catch (e) {
        setCheckErr(String(e).slice(0, 200));
      }
    } finally {
      setChecking(false);
      setInstalling(false);
    }
  }

  function Row({ label, href }: { label: string; href: string }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary shadow-sm transition-colors hover:border-accent-border hover:text-accent"
      >
        <span>{label}</span>
        <span className="text-text-muted">›</span>
      </a>
    );
  }

  const cmp = latest ? compareSemver(latest.replace(/^v/, ""), APP_VERSION) : 0;
  const upToDate = latest && cmp <= 0;
  const newer = latest && cmp > 0;

  return (
    // ABOUT-1: full-width single column (was a narrow centered max-w-xl). The
    // header + update controls collapse into one horizontal banner so the page
    // uses the width and fits with far less vertical scroll.
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <img src="/logo.png" alt="Prevail" className="h-14 w-14 shrink-0 rounded-2xl shadow-md" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            <BrandMark className="[letter-spacing:0.12em]" />
            <span className="ml-2 align-middle rounded-full bg-surface-warm px-2.5 py-1 font-mono text-xs font-normal text-text-secondary">v{APP_VERSION}</span>
          </h1>
          <p className="mt-0.5 text-xs text-text-secondary">One desktop. Your AI council, grounded in your domains.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            onClick={checkForUpdates}
            disabled={checking}
            className="rounded-md bg-text-primary px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {installing ? "Installing…" : checking ? "Checking…" : newer ? "Download & install" : "Check for updates"}
          </button>
          {latest ? (
            <span className={`font-mono text-[10px] ${upToDate ? "text-accent" : "text-warn"}`}>
              {upToDate ? `latest (${latest})` : newer ? `update: ${latest}` : `latest: ${latest}`}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-text-muted">{newer ? "ready to install" : "in-place updates"}</span>
          )}
        </div>
        {checkErr && <div className="w-full rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-xs text-warn">{checkErr}</div>}
      </div>

      {/* Links — a horizontal wrap of chips (was a tall stacked list) to use the
          full width and shave vertical height. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Row label="Help & documentation" href="https://github.com/fru-dev3/prevail-desktop#readme" />
        <Row label="Update log" href="https://github.com/fru-dev3/prevail-desktop/releases" />
        <Row label="Report an issue" href="https://github.com/fru-dev3/prevail-desktop/issues/new" />
        <Row label="Prevail CLI" href="https://github.com/fru-dev3/prevail-cli" />
        <Row label="Official website" href="https://prevail.sh" />
      </div>

      {/* Alpha / liability disclaimer */}
      <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
        <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Alpha software</div>
        <p className="text-xs leading-relaxed text-text-secondary">
          Prevail is an early, experimental alpha released for demonstration and testing. It is provided "as is",
          without warranty of any kind, express or implied, and you use it at your own risk. The authors are not liable
          for any data loss, costs, or damages arising from its use. It runs third-party AI tools and, unless Bunker
          Mode is on, may send data to cloud providers. Always review anything important yourself. Feedback and bug
          reports are very welcome, they directly shape what comes next.
        </p>
        <a
          href="https://github.com/fru-dev3/prevail-desktop/issues/new"
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
        >
          <MessageSquare className="h-3.5 w-3.5" /> Share feedback
        </a>
      </div>

      {/* Config — export / import / reset */}
      <div className="mt-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Configuration</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportConfig}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Export config…</button>
          <button onClick={importConfig}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">Import config…</button>
          <button onClick={resetConfig}
            className="rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-warn hover:bg-warn/20">Reset all to defaults</button>
        </div>
        <div className="mt-2 text-xs text-text-secondary">Backs up / restores all app preferences (not your vault). Reset clears every preference and reloads.</div>
      </div>

      {/* Diagnostics — a real health check, one row per thing Prevail needs. */}
      <div className="mt-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Health check</div>
          <div className="flex gap-2">
            <button onClick={runDiagnosis} disabled={diagRunning}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">{diagRunning ? "Checking…" : "Run check"}</button>
            {checks && (
              <button onClick={() => { navigator.clipboard.writeText(diagText()).catch(() => {}); setDiagCopied(true); window.setTimeout(() => setDiagCopied(false), 1500); }}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">{diagCopied ? "Copied" : "Copy report"}</button>
            )}
          </div>
        </div>
        <p className="mb-3 text-xs text-text-muted">Verifies everything Prevail depends on is healthy. Copy the report when filing an issue.</p>
        {checks && (
          <div className="flex flex-col gap-1.5">
            {checks.map((c) => (
              <div key={c.label} className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-background px-3 py-2">
                <span className={`mt-0.5 shrink-0 font-mono text-sm font-bold ${
                  c.status === "ok" ? "text-ok" : c.status === "fail" ? "text-warn" : c.status === "warn" ? "text-warn" : "text-text-muted"
                }`}>{c.status === "ok" ? "✓" : c.status === "fail" ? "✗" : c.status === "warn" ? "!" : "·"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-text-primary">{c.label}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary" title={c.detail}>{c.detail}</span>
                  </div>
                  <div className="text-[11px] leading-snug text-text-muted">{c.why}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone — uninstall (never touches the vault) */}
      <div className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-4">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-warn">Danger zone</div>
        <div className="mb-3 text-xs text-text-secondary">Removes the app and its data. Your vault is never deleted.</div>
        <div className="flex flex-col gap-2">
          <button onClick={() => uninstall("app")}
            className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-text-primary hover:border-warn/50">
            <div className="font-medium">Uninstall the app</div>
            <div className="text-xs text-text-secondary">Remove /Applications/Prevail.app. Keeps all config, chats, and secrets.</div>
          </button>
          <button onClick={() => uninstall("data")}
            className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-left text-sm text-warn hover:bg-warn/20">
            <div className="font-medium">Uninstall everything (keep vault)</div>
            <div className="text-xs">Remove the app, all app data, caches, and stored secrets. Your vault folder stays.</div>
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 px-1 text-[11px] text-text-muted">
        <span>GPL-3.0 licensed · Open source</span>
        <span>Local-first · Vault stays on this Mac</span>
      </div>
    </div>
  );
}
