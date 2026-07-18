// Add an app to a specific domain: a focused search picker (not the whole Apps
// space). Search finds apps you already have (adds this domain to them) and apps
// from the catalog (scaffolds them into this domain). If it's not in the library,
// a link takes you to Settings to add a brand-new custom app.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, X, Loader2, ArrowUpRight } from "lucide-react";
import { invoke } from "./bridge";
import { AppRowLogo } from "./panels3";
import { toolIdFor } from "./mapactions";
import type { BrandLogo, CatalogApp, ConnectorCatalog, EngineApp } from "./types";

type Candidate = { id: string; name: string; owned: boolean; integration: string; domains: string[] };

function integrationFromCatalog(c: CatalogApp): string {
  const m = (c.connection_hint?.method || c.via || "").toLowerCase();
  if (m.includes("mcp")) return "mcp";
  if (m.includes("cli")) return "cli";
  if (m.includes("oauth")) return "oauth";
  if (m.includes("api")) return "api";
  return "browser";
}

export function AddAppModal({ vaultPath, domainSlug, domainLabel, onClose, onAdded }: {
  vaultPath: string;
  domainSlug: string;
  domainLabel: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [logos, setLogos] = useState<Record<string, BrandLogo>>({});
  const [owned, setOwned] = useState<EngineApp[]>([]);
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<Record<string, BrandLogo>>("ingestion_connector_logos").then(setLogos).catch(() => {});
    invoke<EngineApp[]>("engine_apps_list", { vault: vaultPath }).then((a) => setOwned(Array.isArray(a) ? a : [])).catch(() => {});
    invoke<ConnectorCatalog>("ingestion_connector_catalog").then((c) => setCatalog(Array.isArray(c?.apps) ? c.apps : [])).catch(() => {});
  }, [vaultPath]);

  const inDomain = useMemo(
    () => new Set(owned.filter((a) => (a.domains || []).some((d) => d.toLowerCase() === domainSlug.toLowerCase())).map((a) => a.id)),
    [owned, domainSlug],
  );

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const cands: Candidate[] = [];
    const seen = new Set<string>();
    // 1. Apps you already have, not yet in this domain (adding just connects them here).
    for (const a of owned) {
      if (inDomain.has(a.id)) continue;
      const name = a.title || a.id;
      if (query && !name.toLowerCase().includes(query)) continue;
      cands.push({ id: a.id, name, owned: true, integration: a.integration, domains: a.domains || [] });
      seen.add(name.toLowerCase());
    }
    // 2. Catalog apps (scaffolded into this domain when picked).
    for (const c of catalog) {
      if (!c.name || seen.has(c.name.toLowerCase())) continue;
      if (query && !c.name.toLowerCase().includes(query)) continue;
      cands.push({ id: toolIdFor(c.name), name: c.name, owned: false, integration: integrationFromCatalog(c), domains: [] });
      seen.add(c.name.toLowerCase());
      if (cands.length >= 60) break;
    }
    return cands;
  }, [q, owned, catalog, inDomain]);

  const add = useCallback(async (c: Candidate) => {
    setBusyId(c.id);
    setErr(null);
    try {
      if (c.owned) {
        const next = Array.from(new Set([...(c.domains || []).map((d) => d.toLowerCase()), domainSlug.toLowerCase()]));
        await invoke("engine_app_set_domains", { id: c.id, domains: next, vault: vaultPath });
      } else {
        await invoke("engine_app_add", { vault: vaultPath, id: c.id, title: c.name, integration: c.integration, domains: [domainSlug], mcpCommand: null, mcpInstall: null });
      }
      window.dispatchEvent(new Event("prevail:apps-changed"));
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [domainSlug, vaultPath, onAdded]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Add an app to {domainLabel}</h2>
          <button onClick={onClose} className="text-text-muted transition-colors hover:text-text-primary"><X className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-border-subtle p-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
            <Search className="h-4 w-4 shrink-0 text-text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps..." className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted" />
          </div>
        </div>
        {err && <div className="mx-3 mt-2 rounded-md border border-err/40 bg-err/10 px-3 py-1.5 text-[12px] text-err">{err}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-2 py-6 text-center text-[13px] text-text-muted">No apps match "{q}".</div>
          ) : (
            results.map((c) => (
              <div key={`${c.owned ? "o" : "c"}-${c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-warm">
                <AppRowLogo app={{ title: c.name, id: c.id }} logos={logos} size={22} fallback="letter" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-text-primary">{c.name}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wide text-text-muted">{c.owned ? "in your apps" : "add new"}</div>
                </div>
                <button disabled={busyId === c.id} onClick={() => void add(c)} className="flex shrink-0 items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent hover:text-background disabled:opacity-60">
                  {busyId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
                </button>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-border-subtle px-4 py-2.5 text-[12px] text-text-muted">
          Can't find it?{" "}
          <button onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "connectors" })); }} className="inline-flex items-center gap-0.5 text-accent underline hover:opacity-80">
            Add a custom app in Settings <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
