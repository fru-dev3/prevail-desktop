// Subsystem extracted from App.tsx (encapsulated module state).
import { useEffect, useState } from "react";
import { invoke } from "./bridge";
import { isLocalCli } from "./helpers";
import { modelsFor } from "./helpers2";
import { isBunkerOn, lsGet, lsSet } from "./storage";
import type { CliVerifyInfo } from "./types";

export const AGENT_VERIFY_KEY = "prevail.council.verifySlots";

export function loadVerifyMap(): Record<string, "ok"> {
  try {
    const raw = lsGet(AGENT_VERIFY_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, "ok">;
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

export function saveVerifyMap(m: Record<string, "ok">) {
  try { lsSet(AGENT_VERIFY_KEY, JSON.stringify(m)); } catch {}
}

// Terminal command that logs each CLI in. Prevail uses the CLIs already on
// the machine and their own credentials - it can't authenticate them - so
// when a verify fails on auth we point the user at the right login command.

export const cliVerifyLive = new Map<string, CliVerifyInfo>();

export function setCliVerify(cliId: string, info: CliVerifyInfo) {
  cliVerifyLive.set(cliId, info);
  window.dispatchEvent(new Event("prevail:verify-changed"));
}

export function useCliVerifyLive(): Map<string, CliVerifyInfo> {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener("prevail:verify-changed", f);
    return () => window.removeEventListener("prevail:verify-changed", f);
  }, []);
  return cliVerifyLive;
}
// Verify a provider by running its default model once (a real end-to-end
// call: binary + auth + model all have to work).

export async function verifyCliDefaultModel(cliId: string): Promise<void> {
  const def = lsGet(`prevail.model.${cliId}`) || modelsFor(cliId)[0]?.id || "";
  setCliVerify(cliId, { status: "verifying" });
  try {
    await invoke<string>("verify_cli_model", { args: { cli: cliId, model: def || null } });
    setCliVerify(cliId, { status: "ok" });
    const map = loadVerifyMap();
    map[`${cliId}:${def}`] = "ok";
    saveVerifyMap(map);
  } catch (e) {
    setCliVerify(cliId, { status: "failed", error: String(e).slice(0, 200) });
  }
}

// "Re-check" from the Runtimes screen. The BROKEN / "won't run" / "not
// installed" status comes from detect_clis (binary probe), which otherwise only
// runs at app launch - so after the user repairs an install, a model-only
// re-verify can't clear it. Re-run detection first (App listens for this event
// and calls refreshClis), then re-verify the end-to-end model for this runtime.
export function recheckCli(cliId: string): void {
  window.dispatchEvent(new Event("prevail:rescan-clis"));
  void verifyCliDefaultModel(cliId);
}

export let cliAutoVerifyStarted = false;

export function autoVerifyClis(clis: { id: string; available: boolean }[], force = false) {
  if (cliAutoVerifyStarted && !force) return;
  cliAutoVerifyStarted = true;
  const cached = loadVerifyMap();
  for (const c of clis) {
    if (!c.available) continue;
    // Bunker Mode: verifying a cloud provider would call the cloud; leave it
    // unknown rather than break the no-network guarantee.
    if (isBunkerOn() && !isLocalCli(c.id)) continue;
    if (!force && Object.keys(cached).some((k) => k.startsWith(`${c.id}:`))) {
      setCliVerify(c.id, { status: "ok" }); // a model of this CLI verified before
      continue;
    }
    void verifyCliDefaultModel(c.id);
  }
}

// The always-visible Bunker Mode status bar. Never disappears while the app
// runs, so the user always knows whether anything can leave their machine.
