// Settings sections extracted from App.tsx: Providers (API-key activation +
// OpenRouter catalog) and Models (the per-provider model catalog), plus the
// refreshDiscoveredModels helper they share (imported from helpers2).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Clock, Globe, Layers, Loader2, RotateCw, Sparkles, Zap } from "lucide-react";
import { invoke } from "./bridge";
import { CollapsibleSection } from "./collapsible";
import { DISCOVERED_MODELS, MODELS } from "./constants";
import { refreshDiscoveredModels } from "./helpers2";
import { LS, lsGet, lsSet } from "./storage";
import { track } from "./telemetry";

// T18: map a provider id to the telemetry enum vocabulary (anything off-list →
// "other"), so the event records THAT a provider was configured without leaking
// a novel vendor name. Inert until keys exist; default-OFF.
const TELEMETRY_PROVIDERS = new Set(["openrouter", "anthropic", "openai", "google", "ollama", "lmstudio", "bedrock"]);
const telemetryProvider = (id: string): string => (TELEMETRY_PROVIDERS.has(id) ? id : "other");
import { SettingsHeader } from "./sectionutil";
import { autoVerifyClis, setCliVerify, useCliVerifyLive } from "./verify";
import { ProviderMark } from "./marks";
import { AgentsSection } from "./settings6";
import { OrVendorMark, orVendorOf } from "./providermarks";
import type { CliInfo } from "./types";

// Auto-refresh cadence: how often model lists re-discover and providers
// re-validate. Stored as a preset key OR "custom:<days>" for an arbitrary
// interval, so the user is never boxed into the presets.
const REFRESH_PRESETS: { value: string; label: string }[] = [
  { value: "launch", label: "Every launch" },
  { value: "daily", label: "Daily" },
  { value: "3days", label: "Every 3 days" },
  { value: "weekly", label: "Weekly" },
  { value: "2weeks", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "manual", label: "Manual only" },
];
const DAY_MS = 86_400_000;
const LEGACY_REFRESH_LABEL: Record<string, string> = {
  "2days": "Every other day",
  "3months": "Every 3 months",
  "6months": "Every 6 months",
};
const LEGACY_REFRESH_MS: Record<string, number> = {
  "2days": 2 * DAY_MS,
  "3months": 91 * DAY_MS,
  "6months": 182 * DAY_MS,
};

export function refreshPeriodMs(p: string): number {
  if (p === "launch") return 0;
  if (p === "manual") return Infinity;
  const custom = /^custom:(\d+)$/.exec(p);
  if (custom) return Math.max(1, parseInt(custom[1], 10)) * DAY_MS;
  const presetMs: Record<string, number> = {
    daily: DAY_MS, "3days": 3 * DAY_MS, weekly: 7 * DAY_MS, "2weeks": 14 * DAY_MS, monthly: 30 * DAY_MS,
  };
  return presetMs[p] ?? LEGACY_REFRESH_MS[p] ?? 0;
}

function refreshPeriodLabel(p: string): string {
  const preset = REFRESH_PRESETS.find((x) => x.value === p);
  if (preset) return preset.label;
  const custom = /^custom:(\d+)$/.exec(p);
  if (custom) { const n = parseInt(custom[1], 10); return `Every ${n} day${n === 1 ? "" : "s"}`; }
  return LEGACY_REFRESH_LABEL[p] ?? p;
}

// On-brand cadence picker: a chip that opens a styled popover of presets plus a
// "every N days" custom field. Replaces the native <select> (no OS dropdown, and
// any interval is reachable).
function RefreshCadence({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(() => { const m = /^custom:(\d+)$/.exec(value); return m ? m[1] : "3"; });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const commitCustom = () => {
    const n = Math.max(1, Math.min(365, parseInt(days, 10) || 1));
    onChange(`custom:${n}`); setDays(String(n)); setOpen(false);
  };
  const isCustom = /^custom:/.test(value);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="How often model lists auto-refresh and providers re-validate"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
      >
        <Clock className="h-3 w-3" />
        {refreshPeriodLabel(value)}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="border-b border-border-subtle px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Auto-refresh cadence</div>
          <ul className="p-1">
            {REFRESH_PRESETS.map((p) => (
              <li key={p.value}>
                <button
                  onClick={() => { onChange(p.value); setOpen(false); }}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent-soft"
                >
                  <span className={value === p.value ? "font-semibold text-accent" : "text-text-secondary"}>{p.label}</span>
                  {value === p.value && <Check className="h-3.5 w-3.5 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
          <div className={`flex items-center gap-2 border-t border-border-subtle px-3 py-2 ${isCustom ? "bg-accent-soft/40" : ""}`}>
            <span className="text-[12px] text-text-muted">Every</span>
            <input
              type="number" min={1} max={365} value={days}
              onChange={(e) => setDays(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitCustom(); }}
              className="w-14 rounded border border-border bg-background px-2 py-1 text-[13px] text-text-primary outline-none focus:border-accent-border"
            />
            <span className="text-[12px] text-text-muted">days</span>
            <button onClick={commitCustom} className="ml-auto rounded border border-accent-border bg-accent px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-background hover:opacity-90">Set</button>
          </div>
        </div>
      )}
    </div>
  );
}

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
      track("provider_configured", { provider: "openrouter" });
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
      <CollapsibleSection
        icon={Layers}
        title="OpenRouter"
        summary={configured ? `Recommended · configured${last4 ? ` · ····${last4}` : ""}` : "Recommended · one key, 200+ models"}
        storageKey="prevail.settings.aggregator.openrouter"
        defaultOpen
      >
      <div className="rounded-lg border border-border bg-surface p-5">
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
      </CollapsibleSection>
      {/* Other aggregators - one key, many models - landing next. Shown so the
          roadmap is visible; each is a disabled "coming soon" card like OpenRouter. */}
      <ComingSoonAggregators />
    </>
  );
}

// Aggregators (one key -> many hosted models) on the roadmap. Rendered as
// disabled cards beneath OpenRouter so the user sees what's coming.
const COMING_SOON_AGGREGATORS: { name: string; blurb: string }[] = [
  { name: "AWS Bedrock", blurb: "Anthropic, Llama, Mistral, Titan via your AWS account." },
  { name: "Google Vertex AI", blurb: "Gemini + partner models on Google Cloud." },
  { name: "Azure AI Foundry", blurb: "OpenAI + open models on Azure." },
  { name: "Together AI", blurb: "Fast hosted open models (Llama, Qwen, DeepSeek)." },
  { name: "Fireworks AI", blurb: "Low-latency open-model inference." },
  { name: "Groq", blurb: "Ultra-fast inference on LPUs." },
];

function ComingSoonAggregators() {
  return (
    <div className="mt-3 space-y-2">
      {COMING_SOON_AGGREGATORS.map((a) => (
        <div key={a.name} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface/50 px-4 py-3 opacity-70">
          <Layers className="h-4 w-4 shrink-0 text-text-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-secondary">{a.name}</span>
              <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted">Coming soon</span>
            </div>
            <div className="mt-0.5 text-xs text-text-muted">{a.blurb}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// G1 - Direct Providers. Native single-vendor keys: the user pastes their key
// for any vendor and it works (the engine's DIRECT_PROVIDERS table routes to it;
// the desktop injects PREVAIL_<ID>_KEY from the Keychain). Each row is an
// independent key-entry that saves to the Keychain via provider_key_set, then
// re-detects so the provider shows up live in every model picker.
const DIRECT_PROVIDERS_UI: { id: string; label: string; hint: string }[] = [
  { id: "anthropic", label: "Anthropic", hint: "console.anthropic.com · sk-ant-…" },
  { id: "openai", label: "OpenAI", hint: "platform.openai.com · sk-…" },
  { id: "xai", label: "xAI (Grok)", hint: "console.x.ai · xai-…" },
  { id: "kimi", label: "Kimi (Moonshot)", hint: "platform.moonshot.ai · sk-…" },
  { id: "deepseek", label: "DeepSeek", hint: "platform.deepseek.com · sk-…" },
  { id: "google", label: "Google AI", hint: "aistudio.google.com · AIza…" },
];

function DirectProviderRow({ id, label, hint, onActivated }: {
  id: string; label: string; hint: string; onActivated?: () => Promise<CliInfo[]>;
}) {
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activated, setActivated] = useState<boolean | null>(null);
  useEffect(() => { invoke<boolean>("provider_key_exists", { provider: id }).then((ok) => setConfigured(!!ok)).catch(() => {}); }, [id]);
  async function save() {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await invoke("provider_key_set", { provider: id, key: key.trim() });
      track("provider_configured", { provider: telemetryProvider(id) });
      setConfigured(true);
      setKey("");
      if (onActivated) {
        const list = await onActivated();
        setActivated(list.some((c) => c.id === id && c.available));
        window.setTimeout(() => setActivated(null), 6000);
      }
    } catch (e) { console.error("provider_key_set", e); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try {
      await invoke("provider_key_del", { provider: id });
      setConfigured(false);
      setActivated(null);
      if (onActivated) await onActivated();
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  }
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-semibold text-text-primary">{label}</span>
        {configured
          ? <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ok"><Check className="h-3 w-3" /> key set</span>
          : <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">no key</span>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={configured ? "replace key…" : hint}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-accent-border focus:outline-none"
        />
        <button onClick={save} disabled={busy || !key.trim()}
          className="rounded-md bg-accent px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-background hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "save"}
        </button>
        {configured && (
          <button onClick={remove} disabled={busy}
            className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-danger hover:text-danger disabled:opacity-50">
            remove
          </button>
        )}
      </div>
      {activated === true && <div className="mt-1.5 text-[11px] text-ok">Live: {label} answered with this key. Selectable in Chat, Council, and Benchmark pickers.</div>}
      {activated === false && <div className="mt-1.5 text-[11px] text-warn">Key saved, but {label} didn&apos;t come online. Double-check it.</div>}
    </div>
  );
}

export function DirectProvidersSection({ onActivated }: { onActivated?: () => Promise<CliInfo[]> }) {
  return (
    <div className="space-y-2">
      <p className="mb-1 text-xs text-text-muted">Paste your API key for any vendor. Stored in the OS Keychain, never in plaintext. Once saved, the provider's models appear in every picker.</p>
      {DIRECT_PROVIDERS_UI.map((p) => (
        <DirectProviderRow key={p.id} id={p.id} label={p.label} hint={p.hint} onActivated={onActivated} />
      ))}
    </div>
  );
}

// Connectors - data sources that auto-build per-domain context, routed through
// a connector hub (Composio). Real brand marks (simple-icons) where available,
// else a tinted lucide fallback. Placeholders for now; live wiring next.

export function ModelsSection({
  clis,
  onStartChatWith,
  onActivated,
  vaultPath,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  onActivated?: () => Promise<CliInfo[]>;
  vaultPath?: string;
}) {
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
  // W3 (Monday feedback): default the model-list refresh to "Every launch".
  const [refreshPeriod, setRefreshPeriod] = useState(() => lsGet("prevail.models.refreshPeriod") || "launch");
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
    const ms = refreshPeriodMs(refreshPeriod);
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
        title="Runtimes"
        icon={Layers}
        subtitle="A runtime is a model plus a way to run it — a local CLI, a direct vendor key, or an aggregator. The same model can run several ways, each with its own cost, speed, and privacy. Validated at launch with a real call; expand one to test individual models and set the default new chats open with."
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
        <RefreshCadence
          value={refreshPeriod}
          onChange={(v) => { setRefreshPeriod(v); lsSet("prevail.models.refreshPeriod", v); }}
        />
        <button
          onClick={() => void recheck()}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50"
        >
          <RotateCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          Re-check all
        </button>
      </div>
      {/* Three collapsible groups - all collapsed by default for a clean landing */}
      {([
        {
          id: "clis",
          label: "CLI runtimes",
          icon: Sparkles,
          desc: `local · uses your subscription · ${clis.filter((c) => c.available).length} detected · ${clis.filter((c) => !c.available).length} not installed`,
          content: (
            <AgentsSection
              clis={clis}
              onStartChatWith={onStartChatWith}
              defaultChatCli={defaultChatCli}
              onMakeDefault={setDefaultChatCli}
              vaultPath={vaultPath}
              embedded
            />
          ),
        },
        {
          id: "api",
          label: "Aggregator runtimes",
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
          label: "Direct runtimes",
          icon: Globe,
          desc: "Anthropic, OpenAI, xAI, Kimi, DeepSeek, Google: your own key per vendor",
          content: <DirectProvidersSection onActivated={onActivated} />,
        },
      ] as const).map(({ id, label, icon: Icon, desc, content }) => (
        <CollapsibleSection key={id} icon={Icon} title={label} summary={desc} storageKey={`prevail.settings.models.${id}`}>
          {content}
        </CollapsibleSection>
      ))}
    </>
  );
}
