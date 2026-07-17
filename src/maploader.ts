// Map: the loader. Gathers real vault data via Tauri and hands it to the pure
// builder (mapbuild.ts). Kept thin so the merge/scoring logic stays testable.

import { invoke } from "@tauri-apps/api/core";
import { buildMapModel, seedOnlyModel, type RawApp, type RawDomain, type Probe } from "./mapbuild";
import type { MapModel } from "./map";
import { appStatus } from "./appspanel";
import type { EngineApp, Domain } from "./types";

// Map the app's 5-state appStatus() to a probe result the builder understands:
//   connected/authorized/connecting => reachable now (ok true)
//   attention                       => present but failing (ok false -> broken)
//   disconnected                    => not authenticated (undefined -> declared base)
function probeFromApp(app: EngineApp): Probe {
  const s = appStatus(app);
  if (s === "attention") return { appId: app.id, ok: false };
  if (s === "connected" || s === "authorized" || s === "connecting") return { appId: app.id, ok: true };
  return { appId: app.id }; // disconnected: leave to the declared/derived status
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

// Load the full Map model for a vault, snapshotting THIS machine's auth state.
export async function loadMapModel(vaultPath: string, opts: LoadOpts = {}): Promise<MapModel> {
  const host = await currentHost();
  const asOf = new Date().toISOString();

  const [apps, domainsRaw] = await Promise.all([
    invoke<EngineApp[]>("engine_apps_list", { vault: vaultPath }).catch(() => [] as EngineApp[]),
    invoke<Domain[]>("scan_vault", { path: vaultPath }).catch(() => [] as Domain[]),
  ]);

  // Real user domains, hiding the machine-managed pseudo-domains (leading _).
  const domains: RawDomain[] = (domainsRaw || [])
    .filter((d) => d && d.name && !d.name.startsWith("_"))
    .map((d) => ({ slug: d.name, label: undefined, category: d.name }));

  if (domains.length === 0) {
    // brand-new / empty vault: show the recommended library so it is never blank.
    return seedOnlyModel(asOf, host);
  }

  const rawApps = (apps || []).map(toRawApp);
  const probes = (apps || []).map(probeFromApp);

  return buildMapModel({
    domains,
    apps: rawApps,
    probes,
    asOf,
    host,
    includeSuggestions: opts.includeSuggestions ?? true,
  });
}

async function currentHost(): Promise<string> {
  try {
    return (await invoke<string>("machine_host")) || "this machine";
  } catch {
    return "this machine";
  }
}
