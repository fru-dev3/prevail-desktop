// Settings sections extracted from App.tsx: Providers (API-key activation +
// OpenRouter catalog) and Models (the per-provider model catalog), plus the
// refreshDiscoveredModels helper they share (imported from helpers2).
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Globe, Layers, Loader2, RotateCw, Sparkles, Zap } from "lucide-react";
import { invoke } from "./bridge";
import { DISCOVERED_MODELS, MODELS, SETTINGS_ROW } from "./constants";
import { refreshDiscoveredModels } from "./helpers2";
import { LS, lsGet, lsSet } from "./storage";
import { DirectProviderMark } from "./panels";
import { SettingsHeader } from "./sectionutil";
import { autoVerifyClis, setCliVerify, useCliVerifyLive } from "./verify";
import { ProviderMark } from "./marks";
import { AgentsSection } from "./settings6";
import { DIRECT_PROVIDERS_SOON, OrVendorMark, orVendorOf } from "./providermarks";
import type { CliInfo } from "./types";

export function ProvidersSection({ onActivated, embedded }: { onActivated?: () => Promise<CliInfo[]>; embedded?: boolean }) {
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [last4, setLast4] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  // I10: after a key save we re-detect providers and confirm OpenRouter is now
  // selectable, so the user gets real activation feedback instead of silence.
  const [activated, setActivated] = useState<boolean | null>(null);
  // Live OpenRouter catalog browser (curated shown by default; search reveals all).
  const [orQuery, setOrQuery] = useState("");
  const [, setOrNonce] = useState(0);
  useEffect(() => {
    invoke<boolean>("provider_key_exists", { provider: "openrouter" }).then((ok) => setConfigured(!!ok)).catch(() => {});
    invoke<string | null>("provider_key_last4", { provider: "openrouter" }).then((v) => setLast4(v ?? null)).catch(() => {});
    const h = () => setOrNonce((n) => n + 1);
    window.addEventListener("prevail:models-refreshed", h);
    return () => window.removeEventListener("prevail:models-refreshed", h);
  }, []);
  const orCurated = MODELS.openrouter ?? [];
  const orLive = DISCOVERED_MODELS.openrouter ?? [];
  const orResults = orQuery.trim()
    ? orLive.filter((m) => `${m.id} ${m.label ?? ""}`.toLowerCase().includes(orQuery.trim().toLowerCase())).slice(0, 60)
    : [];
  async function save() {
    try {
      await invoke("provider_key_set", { provider: "openrouter", key: key.trim() });
      setConfigured(!!key.trim());
      setKey("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
      // Re-detect so OpenRouter immediately shows as available in every picker,
      // and report back whether activation took.
      if (onActivated) {
        const list = await onActivated();
        const ok = list.some((c) => c.id === "openrouter" && c.available);
        setActivated(ok);
        window.setTimeout(() => setActivated(null), 6000);
      }
    } catch (e) { console.error("provider_key_set", e); }
  }
  async function remove() {
    try {
      await invoke("provider_key_del", { provider: "openrouter" });
      setConfigured(false);
      setActivated(null);
      if (onActivated) await onActivated();
    } catch (e) { console.error(e); }
  }
  return (
    <>
      {!embedded && <SettingsHeader title="Providers" subtitle="Bring your own models. OpenRouter is one key for 200+ models (Claude, GPT, Gemini, Grok, DeepSeek, Qwen…). Direct providers are coming next." />}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-semibold text-text-primary">OpenRouter</span>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">Recommended</span>
          {configured && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
              <Check className="h-3 w-3" strokeWidth={3} /> Configured{last4 ? ` · ····${last4}` : ""}
            </span>
          )}
        </div>
        <div className="mb-3 text-xs text-text-secondary">One API key unlocks every model. Used by the engine inside any domain. <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-accent hover:underline">Get a key ›</a></div>
        <div className="flex items-center gap-2">
          <input type="password" value={key} placeholder={configured ? "•••••••• (replace)" : "sk-or-v1-…"} onChange={(e) => setKey(e.target.value)}
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm focus:border-accent-border focus:outline-none" />
          <button onClick={save} disabled={!key.trim()} className="rounded-md bg-text-primary px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">{saved ? "Saved" : "Save"}</button>
          {configured && (
            <button
              onClick={async () => {
                setTesting(true); setActivated(null);
                try {
                  await invoke<string>("verify_cli_model", { args: { cli: "openrouter", model: lsGet("prevail.model.openrouter") || null } });
                  setActivated(true);
                  setCliVerify("openrouter", { status: "ok" });
                } catch (e) {
                  setActivated(false);
                  setCliVerify("openrouter", { status: "failed", error: String(e).slice(0, 200) });
                } finally { setTesting(false); }
              }}
              disabled={testing}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-background disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {testing ? "Testing…" : "Test live"}
            </button>
          )}
          {configured && <button onClick={remove} className="rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-warn hover:bg-warn/20">Remove</button>}
        </div>
        {activated === true && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-accent-border bg-accent-soft px-3 py-2 text-xs text-accent">
            <Check className="h-4 w-4" />
            Live call succeeded: OpenRouter answered with this key. Selectable in Chat, Council, and Benchmark pickers.
          </div>
        )}
        {activated === false && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <AlertTriangle className="h-4 w-4" />
            Key saved, but OpenRouter didn&apos;t come online. Double-check the key at openrouter.ai/keys.
          </div>
        )}
        {/* Curated picks shown by default; search reveals the full live catalog. */}
        <div className="mt-4 border-t border-border-subtle pt-3">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
            <Layers className="h-3 w-3 text-accent" /> Prevail defaults
            {orLive.length > 0 && <span className="text-text-muted normal-case tracking-normal">· full live catalog: {orLive.length} models, search to browse</span>}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {orCurated.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary" title={m.id}>
                <OrVendorMark id={m.id} size={12} />{m.label}
              </span>
            ))}
          </div>
          <input
            value={orQuery}
            onChange={(e) => setOrQuery(e.target.value)}
            placeholder={orLive.length > 0 ? `Search all ${orLive.length} live models (e.g. fable, grok, qwen, kimi)…` : "Refresh in Models to load the live catalog…"}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs focus:border-accent-border focus:outline-none"
          />
          {/* The full live catalog, always browsable (icon per vendor). Search
              narrows; otherwise the first 80 are shown so it is never blank. */}
          {orLive.length > 0 && (
            <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border-subtle bg-background">
              {(orQuery.trim() ? orResults : orLive.slice(0, 80)).length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-muted">No models match "{orQuery}".</div>
              ) : (
                (orQuery.trim() ? orResults : orLive.slice(0, 80)).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { navigator.clipboard.writeText(m.id).catch(() => {}); }}
                    title="Click to copy the model id"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-warm"
                  >
                    <OrVendorMark id={m.id} size={16} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary">{m.label && m.label !== m.id ? m.label : m.id}</span>
                    <span className="shrink-0 font-mono text-[9px] text-text-muted">{orVendorOf(m.id) || "model"}</span>
                  </button>
                ))
              )}
              {!orQuery.trim() && orLive.length > 80 && (
                <div className="px-3 py-1.5 font-mono text-[10px] text-text-muted">+{orLive.length - 80} more, search to find them</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Direct providers</div>
        {/* Shared list-row spec (see SETTINGS_ROW): single column, comfortable. */}
        <div className="space-y-2">
          {DIRECT_PROVIDERS_SOON.map((p) => (
            <div key={p.name} className={SETTINGS_ROW}>
              <DirectProviderMark p={p} />
              <span className="flex-1 text-sm text-text-secondary">{p.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Coming soon</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// Connectors — data sources that auto-build per-domain context, routed through
// a connector hub (Composio). Real brand marks (simple-icons) where available,
// else a tinted lucide fallback. Placeholders for now; live wiring next.

export function ModelsSection({
  clis,
  onStartChatWith,
  onActivated,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  onActivated?: () => Promise<CliInfo[]>;
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => setOpenGroups((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const firstAvailable = useMemo(() => clis.find((c) => c.available)?.id ?? "", [clis]);
  const [defaultChatCli, setDefaultChatCli] = useState(() => lsGet(LS.defaultChatCli) || firstAvailable);
  useEffect(() => { if (defaultChatCli) lsSet(LS.defaultChatCli, defaultChatCli); }, [defaultChatCli]);
  useEffect(() => {
    if (!defaultChatCli && firstAvailable) setDefaultChatCli(firstAvailable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAvailable]);
  // Live model discovery: pull each provider's current models so newly released
  // ones appear without a code change. Runs once on launch + a manual Refresh.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [refreshPeriod, setRefreshPeriod] = useState(() => lsGet("prevail.models.refreshPeriod") || "daily");
  const verify = useCliVerifyLive();
  const discover = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshDiscoveredModels(["ollama", "lmstudio", "openrouter"]);
      const now = Date.now();
      setRefreshedAt(now);
      lsSet("prevail.models.lastRefreshed", String(now));
    } finally { setRefreshing(false); }
  }, []);
  // Auto-discover based on schedule: compare last refresh to the chosen period.
  useEffect(() => {
    const periodMs: Record<string, number> = {
      launch: 0,
      daily: 86_400_000,
      "2days": 2 * 86_400_000,
      "3days": 3 * 86_400_000,
      weekly: 7 * 86_400_000,
      "2weeks": 14 * 86_400_000,
      monthly: 30 * 86_400_000,
      "3months": 91 * 86_400_000,
      "6months": 182 * 86_400_000,
      manual: Infinity,
    };
    const ms = periodMs[refreshPeriod] ?? 0;
    if (ms === Infinity) return;
    const last = parseInt(lsGet("prevail.models.lastRefreshed") || "0", 10);
    if (Date.now() - last >= ms) void discover();
  }, [discover, refreshPeriod]);
  // Re-check = re-discover model lists AND re-validate every detected
  // provider; the status badges flip to "checking" live, so the click
  // visibly does something.
  const recheck = useCallback(async () => {
    autoVerifyClis(clis, true);
    await discover();
  }, [clis, discover]);
  const detectedClis = clis.filter((c) => c.available);
  const okCount = detectedClis.filter((c) => verify.get(c.id)?.status === "ok").length;
  return (
    <>
      <SettingsHeader
        title="Models"
        icon={Layers}
        subtitle="Every provider Prevail can use. Each one is validated automatically at launch with a real call: binary, login, and model all have to work. Expand a provider to test individual models and set the default a new chat opens with."
      />
      {/* Validity at a glance: one badged mark per detected provider. */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-border-subtle bg-surface px-4 py-2.5">
        <div className="flex items-center gap-3.5">
          {detectedClis.map((c) => {
            const v = verify.get(c.id)?.status;
            return (
              <span
                key={c.id}
                className="relative"
                title={`${c.label}: ${v === "ok" ? "valid" : v === "failed" ? "not valid" : v === "verifying" ? "checking…" : "not checked"}`}
              >
                <ProviderMark vendor={c.id} size={22} />
                <span className={`absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none ${
                  v === "ok" ? "bg-ok text-background"
                  : v === "failed" ? "bg-warn text-background"
                  : v === "verifying" ? "animate-pulse bg-text-muted text-background"
                  : "bg-surface-strong text-text-muted"
                }`}>
                  {v === "ok" ? "✓" : v === "failed" ? "✗" : v === "verifying" ? "·" : "○"}
                </span>
              </span>
            );
          })}
        </div>
        <span className="font-mono text-[10px] text-text-muted">
          {okCount}/{detectedClis.length} providers valid
          {refreshedAt ? ` · lists updated ${Math.max(1, Math.round((Date.now() - refreshedAt) / 1000))}s ago` : ""}
        </span>
        <select
          value={refreshPeriod}
          onChange={(e) => { setRefreshPeriod(e.target.value); lsSet("prevail.models.refreshPeriod", e.target.value); }}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-text-muted focus:border-accent-border focus:outline-none"
          title="How often model lists auto-refresh"
        >
          <option value="launch">Every launch</option>
          <option value="daily">Daily</option>
          <option value="2days">Every other day</option>
          <option value="3days">Every 3 days</option>
          <option value="weekly">Weekly</option>
          <option value="2weeks">Every 2 weeks</option>
          <option value="monthly">Monthly</option>
          <option value="3months">Every 3 months</option>
          <option value="6months">Every 6 months</option>
          <option value="manual">Manual only</option>
        </select>
        <button
          onClick={() => void recheck()}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50"
        >
          <RotateCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          Re-check all
        </button>
      </div>
      {/* Three collapsible groups — all collapsed by default for a clean landing */}
      {([
        {
          id: "clis",
          label: "Installed CLIs",
          icon: Sparkles,
          desc: `${clis.filter((c) => c.available).length} detected · ${clis.filter((c) => !c.available).length} not installed`,
          content: (
            <AgentsSection
              clis={clis}
              onStartChatWith={onStartChatWith}
              defaultChatCli={defaultChatCli}
              onMakeDefault={setDefaultChatCli}
              embedded
            />
          ),
        },
        {
          id: "api",
          label: "API Providers",
          icon: Layers,
          desc: "OpenRouter, AWS Bedrock: one key for hundreds of models",
          content: (
            <>
              <p className="mb-4 text-xs text-text-muted">Bring your own key, no install. OpenRouter is one key for 200+ hosted models.</p>
              <ProvidersSection onActivated={onActivated} embedded />
            </>
          ),
        },
        {
          id: "direct",
          label: "Direct Providers",
          icon: Globe,
          desc: "Anthropic, OpenAI, Google: native API keys",
          content: (
            <div className="rounded-lg border border-border-subtle bg-surface px-4 py-4 text-xs text-text-muted">
              Native single-vendor keys (Anthropic API, OpenAI API, Google AI) are coming next. Use OpenRouter above to access all of these today with one key.
            </div>
          ),
        },
      ] as const).map(({ id, label, icon: Icon, desc, content }) => {
        const isOpen = openGroups.has(id);
        return (
          <div key={id} className="mb-2 overflow-hidden rounded-lg border border-border-subtle bg-surface">
            <button
              onClick={() => toggleGroup(id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm"
            >
              <Icon className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="flex-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">{label}</span>
              <span className="shrink-0 font-mono text-[10px] text-text-muted/60">{desc}</span>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
            </button>
            {isOpen && <div className="border-t border-border-subtle px-4 py-4">{content}</div>}
          </div>
        );
      })}
    </>
  );
}
