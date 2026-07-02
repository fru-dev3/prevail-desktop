// Settings sections extracted from App.tsx: the Connectors catalog (with its
// CONNECTOR_GROUPS data) and the Vault encryption card.
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Heart, Landmark, Loader2, Mail, MessageSquare, Plug, Shield } from "lucide-react";
import { siAirtable, siAsana, siCalendly, siCoinbase, siDiscord, siDropbox, siFitbit, siGithub, siGitlab, siGmail, siGooglecalendar, siGoogledrive, siGooglesheets, siHubspot, siLinear, siNotion, siObsidian, siQuickbooks, siReddit, siRobinhood, siShopify, siSpotify, siStrava, siStripe, siTelegram, siTodoist, siTrello, siWhatsapp, siWise, siYoutube, siZoom } from "simple-icons";
import { invoke } from "./bridge";
import { DOMAIN_LABEL, PATTERN_LABEL, PATTERN_TIER, SETTINGS_ROW, SOURCE_ABBR, STATUS_TINT } from "./constants";
import { relTime, titleCase } from "./format";
import { AppLogo, ConnectorIcon, PatternChip } from "./panels";
import { SettingsHeader } from "./sectionutil";
import { backupVaultNow } from "./backup";
import type { Brand, BrandLogo, CatalogApp, Connector, ConnectorCatalog, EngineApp } from "./types";

export const CONNECTOR_GROUPS: { category: string; items: Connector[] }[] = [
  { category: "Finance", items: [
    { name: "Plaid (banks & cards)", domain: "wealth", icon: Landmark, color: "#111111" },
    { name: "Coinbase", domain: "wealth", brand: siCoinbase as Brand },
    { name: "Robinhood", domain: "wealth", brand: siRobinhood as Brand },
    { name: "Wise", domain: "wealth", brand: siWise as Brand },
    { name: "QuickBooks", domain: "business", brand: siQuickbooks as Brand },
    { name: "Stripe", domain: "business", brand: siStripe as Brand },
    { name: "Shopify", domain: "business", brand: siShopify as Brand },
  ]},
  { category: "Email & Calendar", items: [
    { name: "Gmail", domain: "general", brand: siGmail as Brand },
    { name: "Outlook / IMAP", domain: "general", icon: Mail, color: "#0A66C2" },
    { name: "Google Calendar", domain: "calendar", brand: siGooglecalendar as Brand },
    { name: "Calendly", domain: "calendar", brand: siCalendly as Brand },
  ]},
  { category: "Files & Notes", items: [
    { name: "Google Drive", domain: "general", brand: siGoogledrive as Brand },
    { name: "Google Sheets", domain: "general", brand: siGooglesheets as Brand },
    { name: "Dropbox", domain: "general", brand: siDropbox as Brand },
    { name: "Notion", domain: "general", brand: siNotion as Brand },
    { name: "Obsidian", domain: "general", brand: siObsidian as Brand },
  ]},
  { category: "Productivity", items: [
    { name: "Slack", domain: "general", icon: MessageSquare, color: "#4A154B" },
    { name: "Linear", domain: "career", brand: siLinear as Brand },
    { name: "Trello", domain: "general", brand: siTrello as Brand },
    { name: "Asana", domain: "general", brand: siAsana as Brand },
    { name: "Todoist", domain: "general", brand: siTodoist as Brand },
    { name: "Airtable", domain: "general", brand: siAirtable as Brand },
    { name: "Zoom", domain: "general", brand: siZoom as Brand },
    { name: "HubSpot", domain: "business", brand: siHubspot as Brand },
  ]},
  { category: "Developer", items: [
    { name: "GitHub", domain: "career", brand: siGithub as Brand },
    { name: "GitLab", domain: "career", brand: siGitlab as Brand },
  ]},
  { category: "Health & Fitness", items: [
    { name: "Apple Health", domain: "health", icon: Heart, color: "#FF2D55" },
    { name: "Strava", domain: "health", brand: siStrava as Brand },
    { name: "Fitbit", domain: "health", brand: siFitbit as Brand },
  ]},
  { category: "Social & Media", items: [
    { name: "Reddit", domain: "explore", brand: siReddit as Brand },
    { name: "YouTube", domain: "content", brand: siYoutube as Brand },
    { name: "Spotify", domain: "explore", brand: siSpotify as Brand },
    { name: "Discord", domain: "general", brand: siDiscord as Brand },
    { name: "WhatsApp", domain: "general", brand: siWhatsapp as Brand },
    { name: "Telegram", domain: "general", brand: siTelegram as Brand },
  ]},
];


// Catalog shapes - mirror resources/connectors/catalog.json. The Rust command
// returns it verbatim, so the frontend owns the type.
// A REAL app as the engine sees it (community/vault app with live state),
// distinct from a catalog entry (a browseable directory listing).
// Real brand SVG (simple-icons) when the app matched one at build time; else a
// pattern-tinted dot. Keeps the row scannable for all 1,400+ apps.

// Each connector PATTERN maps to one ingestion tier. Short label + tint so a
// row scans at a glance without per-brand icons (the catalog has hundreds).

// Friendly domain headings. Falls back to titleCase for anything unmapped.

export function ConnectorsSection({ vaultPath, focusAppId, catalogOnly }: { vaultPath: string; focusAppId?: string; catalogOnly?: boolean }) {
  const [cat, setCat] = useState<ConnectorCatalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  const [engineApps, setEngineApps] = useState<EngineApp[] | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try { setCat(await invoke<ConnectorCatalog>("ingestion_connector_catalog")); }
      catch (e) { setErr(String(e)); }
      try { setLogos(await invoke<Record<string, BrandLogo>>("ingestion_connector_logos")); }
      catch { /* logos optional */ }
      try { setEngineApps(await invoke<EngineApp[]>("engine_apps_list")); }
      catch { setEngineApps([]); }
    })();
  }, []);

  async function testApp(id: string) {
    setProbing(id);
    try {
      const r = await invoke<{ status?: string; message?: string }>("engine_app_probe", { id });
      setProbeResult((m) => ({ ...m, [id]: `${r.status ?? "?"}${r.message ? ": " + r.message : ""}` }));
      setEngineApps(await invoke<EngineApp[]>("engine_apps_list"));
    } catch (e) { setProbeResult((m) => ({ ...m, [id]: `error: ${e}` })); }
    setProbing(null);
  }

  const [expandedApp, setExpandedApp] = useState<string | null>(focusAppId ?? null);
  const [appSkills, setAppSkills] = useState<Record<string, { id: string; runner: string; trigger: string }[]>>({});
  // Sync prop changes (e.g. sidebar click fires a new focusAppId after mount).
  useEffect(() => { if (focusAppId) setExpandedApp(focusAppId); }, [focusAppId]);
  async function toggleApp(id: string) {
    if (expandedApp === id) { setExpandedApp(null); return; }
    setExpandedApp(id);
    if (!appSkills[id]) {
      try {
        const sk = await invoke<{ id: string; runner: string; trigger: string }[]>("engine_app_skills", { id });
        setAppSkills((s) => ({ ...s, [id]: sk }));
      } catch { setAppSkills((s) => ({ ...s, [id]: [] })); }
    }
  }

  async function syncEngineApp(id: string) {
    setProbing("sync:" + id);
    try {
      const r = await invoke<{ ok: boolean; artifacts?: number; error?: string }>("engine_app_sync", { id, vault: vaultPath });
      setProbeResult((m) => ({ ...m, [id]: r.ok ? `synced. ${r.artifacts ?? 0} artifact(s)` : `sync failed: ${r.error}` }));
      setEngineApps(await invoke<EngineApp[]>("engine_apps_list"));
    } catch (e) { setProbeResult((m) => ({ ...m, [id]: `error: ${e}` })); }
    setProbing(null);
  }

  // "Add" a catalog app: scaffold a real engine app folder, then refresh the
  // Connected list so it appears with live status.
  const [adding, setAdding] = useState<string | null>(null);
  const [addMsg, setAddMsg] = useState<Record<string, string>>({});
  async function addApp(a: CatalogApp) {
    const id = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    if (!id) return;
    setAdding(a.name);
    try {
      const r = await invoke<{ ok: boolean; path?: string; error?: string }>("engine_app_add", {
        id, title: a.name, integration: a.pattern, domains: [a.domain],
      });
      setAddMsg((m) => ({ ...m, [a.name]: r.ok ? "added" : (r.error ?? "failed") }));
      if (r.ok) {
        setEngineApps(await invoke<EngineApp[]>("engine_apps_list"));
        // Tell the sidebar (and any other listener) to re-pull its app list so
        // the new app shows up immediately, not just on next launch.
        window.dispatchEvent(new CustomEvent("prevail:apps-changed"));
      }
    } catch (e) { setAddMsg((m) => ({ ...m, [a.name]: `${e}`.replace(/^error:\s*/i, "") || "failed" })); }
    setAdding(null);
  }
  const connectedIds = useMemo(() => new Set((engineApps ?? []).map((a) => a.id)), [engineApps]);
  const [triageOnly, setTriageOnly] = useState(false);
  const needsAttention = useMemo(
    () => (engineApps ?? []).filter((a) => a.status === "error" || a.status === "expired"),
    [engineApps],
  );

  // Reuse the curated brand marks where an app name matches; everything else
  // shows a neutral pattern-tinted dot. Keeps CONNECTOR_GROUPS/ConnectorIcon live.
  const brandByName = useMemo(() => {
    const m: Record<string, Connector> = {};
    for (const g of CONNECTOR_GROUPS) for (const it of g.items) m[it.name.split(" (")[0].toLowerCase()] = it;
    return m;
  }, []);

  const needle = q.trim().toLowerCase();
  // Default to the household-name core (tier 1). Searching or "Show all"
  // widens to the full catalog so nothing is ever truly hidden.
  // An app's tags = its primary domain plus any extra cross-category tags it
  // carries (e.g. Tesla: automotive + tech). Most apps have only their domain,
  // so the chip set stays the union of every domain and every extra tag.
  const allTags = useMemo(() => {
    const keys = new Set<string>();
    for (const a of cat?.apps ?? []) {
      keys.add(a.domain);
      for (const t of a.tags ?? []) keys.add(t);
    }
    return Array.from(keys)
      .map((d) => ({ key: d, label: DOMAIN_LABEL[d] ?? titleCase(d) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cat]);

  const flatApps = useMemo(() => {
    const all = cat?.apps ?? [];
    const base = needle || showAll ? all : all.filter((a) => a.tier === 1);
    const appTags = (a: CatalogApp) => [a.domain, ...(a.tags ?? [])];
    let filtered = needle
      ? base.filter((a) => a.name.toLowerCase().includes(needle) || appTags(a).some((t) => t.toLowerCase().includes(needle) || (DOMAIN_LABEL[t] ?? "").toLowerCase().includes(needle)))
      : base;
    // Tag filter is OR across an app's full tag set, so Tesla appears under
    // both "automotive" and "tech" rather than being forced into one group.
    if (activeTags.size > 0) filtered = filtered.filter((a) => appTags(a).some((t) => activeTags.has(t)));
    return filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [cat, needle, showAll, activeTags]);

  const total = cat?.apps.length ?? 0;
  const coreTotal = useMemo(() => (cat?.apps ?? []).filter((a) => a.tier === 1).length, [cat]);
  const shown = flatApps.length;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of cat?.apps ?? []) c[a.pattern] = (c[a.pattern] ?? 0) + 1;
    return c;
  }, [cat]);

  return (
    <>
      {/* APP-1: when embedded under the top Apps panel's "Advanced", this is the
          CATALOG ONLY - the connected-apps list lives once, in AppsPanel. The
          standalone header + connected/empty blocks are suppressed to kill the
          AllTrails-renders-twice duplication. */}
      {!catalogOnly && (
        <SettingsHeader
          title="Apps"
          subtitle="Every app Prevail can pull from, pre-populated and tagged by how it connects. Pulled data lands in the matching domain's vault and feeds the intent ledger + memory."
        />
      )}

      {/* Connected apps - the REAL apps the engine has wired up (with live auth
          + sync state), distinct from the browseable catalog below. */}
      {!catalogOnly && engineApps && engineApps.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-primary">Connected</span>
            <span className="font-mono text-[10px] text-text-muted/60">{engineApps.length}</span>
            {needsAttention.length > 0 && (
              <button
                onClick={() => setTriageOnly((v) => !v)}
                className={`ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${triageOnly ? "border-warn bg-warn/10 text-warn" : "border-warn/40 text-warn/80 hover:bg-warn/10"}`}
                title="Apps with expired auth or sync errors"
              >
                {needsAttention.length} need attention
              </button>
            )}
          </div>
          <div className="space-y-2">
            {(triageOnly ? needsAttention : engineApps).map((app) => {
              const tint = STATUS_TINT[app.status] ?? "#9aa0a6";
              const open = expandedApp === app.id;
              return (
                <div key={app.id}>
                  <div className={`group ${SETTINGS_ROW} hover:border-accent-border hover:bg-surface-warm`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tint }} title={app.status} />
                    <button onClick={() => toggleApp(app.id)} className="min-w-0 flex-1 text-left" title="Show detail">
                      <div className="flex items-center gap-2">
                        <ChevronRight className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
                        <span className="truncate text-sm font-medium text-text-primary">{app.account?.label ? `${app.title} · ${app.account.label}` : app.title}</span>
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted">{app.integration}</span>
                        {app.domains.length > 0 && <span className="shrink-0 font-mono text-[9px] text-text-muted/70">→ {app.domains.map(titleCase).join(", ")}</span>}
                      </div>
                      <div className="pl-5 font-mono text-[10px] text-text-muted">
                        {app.status}{app.refresh?.every ? ` · ${app.refresh.every}` : ""} · synced {relTime(app.lastSuccessTs)}
                        {probeResult[app.id] && <span className="ml-2 text-text-secondary">{probeResult[app.id]}</span>}
                        {app.lastError && !probeResult[app.id] && <span className="ml-2 text-warn">{app.lastError}</span>}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: app }))}
                        title={`Open ${app.title} - its chat, runs, settings, and domains`}
                        className="rounded border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent"
                      >
                        open
                      </button>
                      <button
                        onClick={() => testApp(app.id)}
                        disabled={probing === app.id}
                        className="rounded border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
                      >
                        {probing === app.id ? "testing" : "test"}
                      </button>
                      <button
                        onClick={() => syncEngineApp(app.id)}
                        disabled={probing === "sync:" + app.id}
                        title="Sync this app now"
                        className="rounded border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50"
                      >
                        {probing === "sync:" + app.id ? "syncing" : "sync"}
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="mb-1 ml-7 mt-1 space-y-2 rounded-lg border border-border-subtle bg-background px-3 py-2 text-xs">
                      {/* Schedule */}
                      {app.refresh?.every && (
                        <div>
                          <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Schedule</div>
                          <div className="font-mono text-[11px] text-text-secondary">
                            every {app.refresh.every} · last synced {relTime(app.lastSuccessTs)}
                          </div>
                        </div>
                      )}
                      {/* Domains and vault write paths */}
                      {app.domains.length > 0 && (
                        <div>
                          <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Vault paths</div>
                          <ul className="space-y-0.5">
                            {app.domains.map((d) => (
                              <li key={d} className="font-mono text-[11px] text-text-secondary">
                                ▸ {titleCase(d)} <span className="text-text-muted/60">→ vault/{d}/</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {/* Skills */}
                      <div>
                        <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">Skills</div>
                        {appSkills[app.id] === undefined ? (
                          <div className="text-text-muted">loading…</div>
                        ) : appSkills[app.id].length === 0 ? (
                          <div className="text-text-muted">No skills yet. Add one under <code className="text-accent">skills/</code> to enable syncing.</div>
                        ) : (
                          <ul className="space-y-0.5">
                            {appSkills[app.id].map((s) => (
                              <li key={s.id} className="font-mono text-[11px] text-text-secondary">▸ {s.id} <span className="text-text-muted">· {s.runner} · {s.trigger}</span></li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {app.lastError && <div className="text-warn">last error: {app.lastError}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!catalogOnly && engineApps && engineApps.length === 0 && (
        <div className="mb-6 rounded-lg border border-border-subtle bg-surface px-4 py-3 text-xs text-text-muted">
          No apps connected yet. Drop a manifest into <code className="text-accent">~/.prevail/apps/&lt;id&gt;/</code> or add one from the catalog below; it then appears here with live status and syncs into its domains.
        </div>
      )}
      {/* Connector hub */}
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
          <Plug className="h-5 w-5 text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">Connector catalog</span>
            <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">{total} apps</span>
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            Each app routes through one of four connector patterns, and each pattern maps to an ingestion tier. A new app just needs a pattern tag, never bespoke code.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(["api", "oauth", "cli", "browser"] as const).map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5">
                <PatternChip pattern={p} />
                <span className="font-mono text-[10px] text-text-muted">{PATTERN_TIER[p].replace(/^Tier [A-D] · /, "")} · {counts[p] ?? 0}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-text-muted">Could not load the catalog: {err}</div>}

      {/* Search + Core/All toggle. Search auto-expands matching domains and
          always spans the full catalog regardless of the toggle. */}
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search all ${total.toLocaleString()} apps…`}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none"
        />
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
          {([["core", "Core"], ["all", "All"]] as const).map(([val, label]) => {
            const active = val === "all" ? showAll : !showAll;
            return (
              <button
                key={val}
                onClick={() => setShowAll(val === "all")}
                className={`px-3 py-2 text-xs font-medium transition-colors ${active ? "bg-accent-soft text-accent" : "bg-background text-text-muted hover:bg-surface-warm"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {/* A3 (Monday feedback): the tag-filter cloud read as noisy/unprofessional.
          Tuck it behind a disclosure (collapsed by default; auto-open when a
          filter is active) so the catalog stays clean. */}
      {allTags.length > 0 && (
        <details className="mb-3 group" open={activeTags.size > 0}>
          <summary className="mb-2 inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">
            Filter by tag{activeTags.size > 0 ? ` · ${activeTags.size}` : ""}
          </summary>
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const active = activeTags.has(t.key);
            return (
              <button
                key={t.key}
                onClick={() => setActiveTags((s) => { const n = new Set(s); if (n.has(t.key)) n.delete(t.key); else n.add(t.key); return n; })}
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${active ? "border-accent bg-accent-soft text-accent" : "border-border bg-background text-text-muted hover:border-accent-border hover:text-text-secondary"}`}
              >
                {t.label}
              </button>
            );
          })}
          {activeTags.size > 0 && (
            <button
              onClick={() => setActiveTags(new Set())}
              className="rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-warn/50 hover:text-warn"
            >
              clear
            </button>
          )}
        </div>
        </details>
      )}
      <div className="mb-4 font-mono text-[10px] uppercase tracking-wider text-text-muted/70">
        {needle
          ? `${shown.toLocaleString()} match${shown === 1 ? "" : "es"}`
          : activeTags.size > 0
            ? `${shown.toLocaleString()} app${shown === 1 ? "" : "s"} in selected categories`
            : showAll
              ? `Showing all ${total.toLocaleString()} apps`
              : `Showing ${coreTotal} essential apps · toggle All for the full ${total.toLocaleString()}`}
      </div>

      {/* Flat alphabetical list - category shown as secondary label on each row */}
      <div className="space-y-1.5">
        {flatApps.map((a) => {
          const brand = brandByName[a.name.toLowerCase()];
          const hasLogo = !!(a.iconSlug && logos[a.iconSlug]);
          return (
            <div key={a.name} className={`group ${SETTINGS_ROW} py-2 hover:border-accent-border hover:bg-surface-warm`}>
              {hasLogo ? (
                <AppLogo app={a} logos={logos} />
              ) : brand ? (
                <ConnectorIcon c={brand} />
              ) : (
                <AppLogo app={a} logos={logos} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {a.name}
                  {a.note && <span className="ml-2 text-[11px] font-normal text-text-muted">{a.note}</span>}
                </span>
                <span className="font-mono text-[10px] text-text-muted/60">
                  {[a.domain, ...(a.tags ?? [])].map((t) => DOMAIN_LABEL[t] ?? titleCase(t)).join(" · ")}
                </span>
              </span>
              {a.via && <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted/70">via {a.via}</span>}
              {a.fallback && <span className="shrink-0 font-mono text-[9px] text-text-muted/50" title={`falls back to ${a.fallback}`}>→ {PATTERN_LABEL[a.fallback] ?? a.fallback}</span>}
              {a.verified && a.sources && a.sources.length > 0 && (
                <span className="shrink-0 font-mono text-[9px] text-accent" title={`Verified connector. Listed by: ${a.sources.join(", ")}`}>
                  ✓ {a.sources.map((s) => SOURCE_ABBR[s] ?? s).join("·")}
                </span>
              )}
              {(() => {
                const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
                const already = connectedIds.has(slug);
                const msg = addMsg[a.name];
                const errored = msg && msg !== "added";
                return already ? (
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent" title="Already a connected app">added</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {errored && (
                      <span className="max-w-[160px] truncate font-mono text-[9px] text-err" title={msg}>{msg}</span>
                    )}
                    <button
                      onClick={() => addApp(a)}
                      disabled={adding === a.name}
                      title={errored ? `Retry. Last error: ${msg}` : "Add as a connectable app"}
                      className={`shrink-0 rounded border bg-background px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-opacity group-hover:opacity-100 disabled:opacity-50 ${errored ? "border-err/50 text-err opacity-100 hover:border-err" : "border-border text-text-muted opacity-0 hover:border-accent-border hover:text-accent"}`}
                    >
                      {adding === a.name ? "…" : errored ? "retry" : "add"}
                    </button>
                  </span>
                );
              })()}
              {a.connection_hint && (
                <span
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${a.connection_hint.privacy === "vendor-cloud" ? "border-warn/40 bg-warn/10 text-warn" : "border-accent-border bg-accent-soft text-accent"}`}
                  title={`Suggested: ${a.connection_hint.method}${a.connection_hint.server ? " · " + a.connection_hint.server : ""}${a.connection_hint.readOnly ? " · read-only" : ""} - ${a.connection_hint.privacy === "vendor-cloud" ? "routes through the vendor's cloud" : "stays on your machine"}${a.connection_hint.note ? `. ${a.connection_hint.note}` : ""}`}
                >
                  {a.connection_hint.privacy === "vendor-cloud" ? "○ cloud" : "● local"}
                </span>
              )}
              <PatternChip pattern={a.pattern} />
            </div>
          );
        })}
        {cat && flatApps.length === 0 && (
          <div className="rounded-lg border border-border-subtle bg-surface px-4 py-6 text-center text-sm text-text-muted">No apps match "{q}".</div>
        )}
      </div>
    </>
  );
}

// App lock (F4 Phase 0) - set/change/remove the passcode that gates opening the
// desktop app. Honest about scope: it locks the UI, it does NOT yet encrypt the
// vault files on disk.

// Vault encryption (F4 Phase 1) - encrypt the vault at rest, or decrypt it back.
// Self-verifying in the engine (auto-rollback if anything is unreadable), and
// shows the one-time recovery code on encryption.

export function VaultEncryptionCard({ vaultPath }: { vaultPath: string }) {
  const [status, setStatus] = useState<{ encrypted: boolean; unlocked: boolean } | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const refresh = async () => {
    try { setStatus(await invoke("engine_vault_status", { vault: vaultPath })); } catch { setStatus(null); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [vaultPath]);
  async function encrypt() {
    if (pass.length < 8) { setNote("Passcode must be at least 8 characters."); return; }
    if (!window.confirm("Encrypt this vault? Make sure you have a backup first. You'll get a one-time recovery code: save it.")) return;
    setBusy(true); setNote(null); setRecovery(null);
    try {
      await backupVaultNow(vaultPath); // automatic pre-encryption snapshot
      const r = await invoke<{ ok: boolean; recoveryCode?: string | null; error?: string }>("engine_vault_encrypt", { vault: vaultPath, passcode: pass });
      if (r.ok) {
        if (r.recoveryCode) setRecovery(r.recoveryCode);
        await invoke("engine_vault_unlock", { vault: vaultPath, passcode: pass }).catch(() => {});
        setNote("Vault encrypted. Save your recovery code somewhere safe.");
        setPass("");
        await refresh();
      } else {
        setNote(r.error ?? "Encryption failed.");
      }
    } catch (e) { setNote(`Failed: ${String(e)}`); } finally { setBusy(false); }
  }
  async function decrypt() {
    setBusy(true); setNote(null);
    try {
      await backupVaultNow(vaultPath); // automatic pre-decryption snapshot
      const r = await invoke<{ ok: boolean; error?: string }>("engine_vault_decrypt", { vault: vaultPath, passcode: pass });
      if (r.ok) { setNote("Vault decrypted back to plaintext. Reloading…"); setPass(""); await refresh(); setTimeout(() => window.location.reload(), 800); }
      else setNote(r.error ?? "Wrong passcode.");
    } catch (e) { setNote(`Failed: ${String(e)}`); } finally { setBusy(false); }
  }
  if (!status) return null;
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
        <Shield className="h-3.5 w-3.5" /> Vault encryption {status.encrypted ? "· on" : "· off"}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {status.encrypted
          ? "Your vault files are encrypted at rest with AES-256-GCM. They're unreadable on disk without your passcode."
          : "Encrypt your vault files at rest so they can't be read off disk. Editing in external apps (Obsidian, Finder) stops working while encrypted."}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={status.encrypted ? "Passcode" : "New passcode (min 8 chars)"}
          className="w-56 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent-border focus:outline-none"
        />
        {status.encrypted ? (
          <button onClick={decrypt} disabled={busy || !pass} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Decrypt vault
          </button>
        ) : (
          <button onClick={encrypt} disabled={busy || pass.length < 8} className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />} Encrypt vault
          </button>
        )}
      </div>
      {recovery && (
        <div className="mt-3 rounded-lg border border-accent-border bg-accent-soft p-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">Recovery code: save this now</div>
          <div className="mt-1 select-all font-mono text-sm text-text-primary">{recovery}</div>
          <div className="mt-1 text-[11px] text-text-muted">If you forget your passcode, this is the only other way to unlock your vault. It won't be shown again.</div>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover"
          >
            I saved it · Restart Prevail
          </button>
          <span className="ml-2 text-[11px] text-text-muted">Restarting re-opens the vault through the unlock screen so every view reads it correctly.</span>
        </div>
      )}
      {note && <div className="mt-2 text-xs text-text-secondary">{note}</div>}
    </div>
  );
}
