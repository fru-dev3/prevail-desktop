// Map: the loader. Gathers real vault data via Tauri and hands it to the pure
// builder (mapbuild.ts). Kept thin so the merge/scoring logic stays testable.

import { invoke } from "./bridge";
import { buildMapModel, seedOnlyModel, type RawApp, type RawDomain, type Probe } from "./mapbuild";
import type { MapModel } from "./map";
import { appStatus } from "./appspanel";
import type { EngineApp, Domain } from "./types";

// Map the app's 5-state appStatus() to a probe result the builder understands.
// ONLY a genuinely "connected" app (configured AND has actually synced) counts
// as wired. "authorized" is the state a just-added or credentials-entered app
// has BEFORE any successful sync - treating it as connected made freshly-added
// browser/API tools jump a domain to 100% (they are added, not wired). So
// authorized/connecting/disconnected fall back to the tool's declared
// integration reach (api = scriptable, browser = manual), and the user still
// sees a Connect action. "attention" means present but failing -> broken.
export function probeFromApp(app: EngineApp): Probe {
  const s = appStatus(app);
  if (s === "connected") return { appId: app.id, ok: true };
  if (s === "attention") return { appId: app.id, ok: false };
  return { appId: app.id }; // authorized / connecting / disconnected -> declared base
}

function toRawApp(app: EngineApp): RawApp {
  return {
    id: app.id,
    name: app.title || app.id,
    integration: app.integration,
    domains: app.domains ?? [],
    enabled: app.enabled ?? undefined,
    account: app.account ? { label: app.account.label } : null,
    autonomy: app.autonomy ?? undefined,
  };
}

export interface LoadOpts {
  includeSuggestions?: boolean;
}

export interface MapLoad {
  model: MapModel;
  // Raw apps keyed by id, so the panel can open the real connect surface for a
  // tool (dispatch prevail:open-app with the full EngineApp).
  appsById: Record<string, EngineApp>;
}

// Load the full Map model for a vault, snapshotting THIS machine's auth state.
export async function loadMapModel(vaultPath: string, opts: LoadOpts = {}): Promise<MapLoad> {
  const host = await currentHost();
  const asOf = new Date().toISOString();

  const [apps, domainsRaw] = await Promise.all([
    invoke<EngineApp[]>("engine_apps_list", { vault: vaultPath }).catch(() => [] as EngineApp[]),
    invoke<Domain[]>("scan_vault", { path: vaultPath }).catch(() => [] as Domain[]),
  ]);

  const appsById: Record<string, EngineApp> = {};
  for (const a of apps || []) appsById[a.id] = a;

  // Real user domains, hiding the machine-managed pseudo-domains (leading _).
  const domains: RawDomain[] = (domainsRaw || [])
    .filter((d) => d && d.name && !d.name.startsWith("_"))
    .map((d) => ({ slug: d.name, label: undefined, category: d.name }));

  if (domains.length === 0) {
    // brand-new / empty vault: show the recommended library so it is never blank.
    return { model: seedOnlyModel(asOf, host), appsById };
  }

  const rawApps = (apps || []).map(toRawApp);
  const probes = (apps || []).map(probeFromApp);

  const model = buildMapModel({
    domains,
    apps: rawApps,
    probes,
    asOf,
    host,
    includeSuggestions: opts.includeSuggestions ?? true,
  });
  return { model, appsById };
}

async function currentHost(): Promise<string> {
  try {
    return (await invoke<string>("machine_host")) || "this machine";
  } catch {
    return "this machine";
  }
}
