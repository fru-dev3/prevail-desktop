// Self-contained Settings sections extracted from App.tsx: Shortcuts, Frameworks
// & Lenses, Remote/WebUI, and Ingestion. Each renders shared panel components and
// the SettingsHeader; none close over App root state.
import { Fragment, useEffect, useState } from "react";
import { Aperture, ArrowRight, Diamond, Globe, MessageSquare } from "lucide-react";
import { invoke, listen } from "./bridge";
import { FRAMEWORKS, LENSES } from "./constants";
import { PREF, getPref, setPref } from "./storage";
import { Toggle } from "./ui";
import { IngestionAuditPanel, SettingsRowLite } from "./panels";
import { IngestionBrowserRunner, PreambleColumn } from "./panels2";
import { IngestionTierCard } from "./panels3";
import { useFrameworkLens } from "./hooks";
import { SettingsHeader } from "./sectionutil";
import type { IngestionArtifact, IngestionMcpServer, IngestionTierStatus } from "./types";
import type { UnlistenFn } from "./bridge";

export function ShortcutsSection() {
  type Entry = { keys: string[]; label: string; desc: string };
  const groups: Array<{ name: string; entries: Entry[] }> = [
    {
      name: "Navigation",
      entries: [
        { keys: ["⌘", "K"], label: "New chat", desc: "Drops the current domain + thread, lands on the no-domain dashboard." },
        { keys: ["⌘", "P"], label: "Quick switcher", desc: "Fuzzy finder over every domain and every saved thread." },
        { keys: ["⌘", "B"], label: "Toggle sidebar", desc: "Collapses or expands the domain rail." },
        { keys: ["⌘", ","], label: "Open Settings", desc: "Jumps to the settings panel from anywhere." },
      ],
    },
    {
      name: "Composer",
      entries: [
        { keys: ["↵"], label: "Send (Enter mode)", desc: "Default. Switch to ⌘+↵ in Settings → General → Send messages with." },
        { keys: ["⇧", "↵"], label: "New line", desc: "Insert a hard newline without sending." },
        { keys: ["↑"], label: "Recall last prompt", desc: "Walk backward through this domain's prompt history." },
        { keys: ["↓"], label: "Recall next prompt", desc: "Walk forward; ↓ past the newest clears the composer." },
        { keys: ["/"], label: "Skill autocomplete", desc: "Type / and a few letters to fuzzy-match a skill in this domain." },
      ],
    },
    {
      name: "Thread rail",
      entries: [
        { keys: ["double-click"], label: "Rename", desc: "Edit the thread's title inline. ↵ to confirm." },
        { keys: ["+"], label: "New thread", desc: "Creates an empty thread file immediately: rename it before typing." },
      ],
    },
  ];

  const Key = ({ children }: { children: React.ReactNode }) => (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[11px] font-medium text-text-primary shadow-sm">
      {children}
    </kbd>
  );

  return (
    <>
      <SettingsHeader title="Shortcuts" subtitle="Keyboard surface for common actions. Most are global: they work even while you're typing." />
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.name} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">
              {g.name}
            </div>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {g.entries.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text-primary">{e.label}</div>
                    <div className="mt-0.5 text-xs text-text-secondary">{e.desc}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {e.keys.map((k, j) => (
                      <Fragment key={j}>
                        <Key>{k}</Key>
                        {j < e.keys.length - 1 && e.keys.length > 1 && k.length === 1 && e.keys[j+1].length === 1 && (
                          <span className="text-[11px] text-text-muted">+</span>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export function FrameworksSection() {
  const fwLens = useFrameworkLens();
  const activeFramework = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const activeLens = LENSES.find((l) => l.id === fwLens.lens);
  return (
    <>
      <SettingsHeader
        title="Frameworks & Lenses"
        subtitle="The bracketed preamble Prevail prepends to every prompt. A framework shapes the structure of the answer; a lens shapes the perspective it comes from."
      />

      {/* No collapse: everything on one page. A compact "how it works" strip, then
          Frameworks + Lenses side by side (two columns). */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2 text-[12px] text-text-secondary">
        <MessageSquare className="h-4 w-4 shrink-0 text-text-muted" />
        <span>Your question</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-accent">◆ Framework + ◇ Lens</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span>sharper answer.</span>
        <span className="ml-auto text-[11px] text-text-muted">structure × perspective</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <Diamond className="h-4 w-4 shrink-0 text-accent" />
            <h3 className="text-sm font-semibold text-text-primary">Frameworks</h3>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-text-muted">{activeFramework?.label ?? "Off"}</span>
          </div>
          <div className="mb-2 text-[11px] text-text-muted">Structure: how the answer is shaped.</div>
          <PreambleColumn headerless glyph="◆" title="Frameworks" options={FRAMEWORKS}
            active={activeFramework} selectedId={fwLens.framework} onSelect={fwLens.setFramework} />
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <Aperture className="h-4 w-4 shrink-0 text-accent" />
            <h3 className="text-sm font-semibold text-text-primary">Lenses</h3>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-text-muted">{activeLens?.label ?? "Off"}</span>
          </div>
          <div className="mb-2 text-[11px] text-text-muted">Perspective: the angle the answer comes from.</div>
          <PreambleColumn headerless glyph="◇" title="Lenses" options={LENSES}
            active={activeLens} selectedId={fwLens.lens} onSelect={fwLens.setLens} />
        </div>
      </div>

      {/* Custom + feedback — a quiet one-line footer, not a section. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3 text-[12px] text-text-muted">
        <span>Custom frameworks &amp; lenses are coming.</span>
        <a href="https://github.com/fru-dev3/prevail-desktop/issues/new" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent"><MessageSquare className="h-3 w-3" /> Suggest one</a>
        <a href="https://prevail.sh" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent"><Globe className="h-3 w-3" /> prevail.sh</a>
      </div>
    </>
  );
}





// Stable color picker for the first-letter skill avatars. Same skill
// name always lands on the same swatch so the grid feels consistent.

export function RemoteSection() {
  const [running, setRunning] = useState(false);
  const [port, setPort] = useState(() => getPref(PREF.webuiPort, "8787"));
  const [user, setUser] = useState(() => getPref(PREF.webuiUser, "admin"));
  const [pass, setPass] = useState(() => {
    let p = getPref(PREF.webuiPass, "");
    if (!p) { p = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); setPref(PREF.webuiPass, p); }
    return p;
  });
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    invoke<{ running: boolean }>("webui_status").then((s) => setRunning(!!s.running)).catch(() => {});
  }, []);
  async function toggle(on: boolean) {
    setErr("");
    try {
      if (on) {
        await invoke("webui_start", { port: Number(port) || 8787, user, pass });
        setRunning(true);
      } else {
        await invoke("webui_stop");
        setRunning(false);
      }
    } catch (e) { setErr(String(e)); }
  }
  return (
    <>
      <SettingsHeader title="Remote (WebUI)" subtitle="Serve this exact app to a browser: same UI, no rebuild. Then reach it from your phone or laptop, anywhere, via Tailscale or Cloudflare." />
      <div className="rounded-lg border border-border bg-surface px-5">
        <SettingsRowLite title="Enable WebUI" desc="Run the bridge server so a browser can use Prevail. This Mac must stay on."
          control={<Toggle on={running} onChange={toggle} />} />
        <SettingsRowLite title="Port" desc="Local port the WebUI listens on."
          control={<input type="number" value={port} disabled={running} onChange={(e) => { setPort(e.target.value); setPref(PREF.webuiPort, e.target.value); }} className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />} />
        <SettingsRowLite title="Username" desc="Login for the WebUI."
          control={<input value={user} disabled={running} onChange={(e) => { setUser(e.target.value); setPref(PREF.webuiUser, e.target.value); }} className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />} />
        <SettingsRowLite title="Password" desc="Keep this private: anyone with it and the URL can use your agent."
          control={
            <div className="flex items-center gap-2">
              <input type={showPass ? "text" : "password"} value={pass} disabled={running} onChange={(e) => { setPass(e.target.value); setPref(PREF.webuiPass, e.target.value); }} className="w-40 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm focus:border-accent-border focus:outline-none disabled:opacity-50" />
              <button onClick={() => setShowPass((v) => !v)} className="font-mono text-[11px] text-text-muted hover:text-accent">{showPass ? "hide" : "show"}</button>
            </div>
          } />
      </div>
      {running && (
        <div className="mt-4 rounded-lg border border-accent-border bg-accent-soft px-5 py-4">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Live</div>
          <div className="text-sm text-text-primary">Open <a href={`http://localhost:${port}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">http://localhost:{port}</a> in a browser, or from another device use this Mac's Tailscale/LAN address on port {port}.</div>
        </div>
      )}
      {err && <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}
    </>
  );
}

// The MCP "expose" config is pasted into Claude Desktop and used long-term, so
// it must reference a STABLE absolute path - not the transient location the app
// happens to be running from. When launched straight off the mounted DMG
// (/Volumes/…) or under macOS App Translocation (/private/var/folders/…), the
// bundled-sidecar path would vanish the moment the volume ejects. Normalize
// those to the canonical installed location. (feedback v0.4.1 B9)

export function IngestionSection() {
  const [tiers, setTiers] = useState<IngestionTierStatus[]>([]);
  const [mcp, setMcp] = useState<IngestionMcpServer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<IngestionArtifact[]>([]);
  const [ingestionTab, setIngestionTab] = useState<"api" | "composio" | "browser">("api");

  async function refresh() {
    try {
      const [t, m] = await Promise.all([
        invoke<IngestionTierStatus[]>("ingestion_status"),
        invoke<IngestionMcpServer[]>("ingestion_mcp_list"),
      ]);
      setTiers(t);
      setMcp(m);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    let unl: UnlistenFn | null = null;
    (async () => {
      unl = await listen<IngestionArtifact>(
        "ingestion:artifact",
        (e) => setArtifacts((cur) => [e.payload, ...cur].slice(0, 50)),
      );
    })();
    return () => { window.clearInterval(id); if (unl) unl(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openMcpConfig() {
    try {
      const p = await invoke<string>("ingestion_mcp_config_init");
      await invoke("open_in_finder", { path: p });
    } catch (e) { console.error(e); }
  }
  async function reloadMcp() {
    try {
      await invoke("ingestion_mcp_reload");
      await refresh();
    } catch (e) { console.error(e); }
  }

  return (
    <>
      <SettingsHeader
        title="Ingestion"
        subtitle="Triple-tier data engine. Pull artifacts from MCP servers, the Composio gateway, or a headed browser into the right domain folder: without leaving the app."
      />
      {err && (
        <div className="mb-4 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>
      )}

      {/* Separate the tiers into clear tabs by HOW they connect, so the page is
          one focused mode at a time instead of a long mixed stack: programmatic
          (API/MCP), the Composio tool gateway, or a headed browser. */}
      {(() => {
        const TABS = [
          { id: "api", label: "API & MCP", match: (id: string) => /mcp|cli/.test(id), hint: "Programmatic connectors and MCP servers." },
          { id: "composio", label: "Composio", match: (id: string) => /composio/.test(id), hint: "The Composio tool gateway: one integration, many apps." },
          { id: "browser", label: "Browser", match: (id: string) => /browser/.test(id), hint: "Manual, headed browser automation." },
        ] as const;
        const active = ingestionTab;
        const activeDef = TABS.find((t) => t.id === active) ?? TABS[0];
        const shown = tiers.filter((t) => activeDef.match(t.id));
        return (
          <div className="space-y-4">
            <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
              {TABS.map((t) => {
                const count = tiers.filter((x) => t.match(x.id)).length;
                const on = t.id === active;
                return (
                  <button
                    key={t.id}
                    onClick={() => setIngestionTab(t.id)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${on ? "bg-accent-soft text-accent" : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"}`}
                  >
                    {t.label}{count > 0 && <span className="ml-1.5 font-mono text-[10px] text-text-muted">{count}</span>}
                  </button>
                );
              })}
            </div>
            <p className="px-1 text-xs text-text-muted">{activeDef.hint}</p>
            {shown.map((t) => (
              <IngestionTierCard
                key={t.id}
                tier={t}
                mcp={t.id === "tier_a_mcp" ? mcp : undefined}
                onRefresh={refresh}
                onOpenMcpConfig={openMcpConfig}
                onReloadMcp={reloadMcp}
              />
            ))}
            {tiers.length === 0 && (
              <div className="rounded border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                Loading tier status…
              </div>
            )}
            {tiers.length > 0 && shown.length === 0 && active !== "browser" && (
              <div className="rounded border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
                Nothing configured in this tier yet.
              </div>
            )}
            {active === "browser" && <IngestionBrowserRunner />}
          </div>
        );
      })()}

      <div className="mt-6 space-y-6">
        <IngestionAuditPanel />

        {artifacts.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="font-display text-base font-semibold tracking-tight">Recent artifacts</div>
              <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] text-text-secondary">{artifacts.length}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {artifacts.map((a, i) => (
                <li key={`${a.path}_${i}`} className="flex items-center gap-3 rounded-md border border-border-subtle bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-sm text-text-primary">{a.original}</span>
                      <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] text-accent">{a.domain}</span>
                      <span className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] text-text-secondary">{a.source}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
                      {a.path} · {a.sha256.slice(0, 12)}… · {(a.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    onClick={() => invoke("open_in_finder", { path: a.path })}
                    className="shrink-0 rounded border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                  >
                    reveal
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
