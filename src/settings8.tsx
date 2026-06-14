// Settings sections extracted from App.tsx: Appearance (theme + palette), Demo
// Mode (sample-vault sandbox), and Vault settings (path + the backup-automation
// card).
import { Fragment, useEffect, useState } from "react";
import { confirm as tauriConfirm, open } from "@tauri-apps/plugin-dialog";
import { ArrowRight, Check, Download, Folder, Loader2, Monitor, Moon, RotateCw, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { invoke } from "./bridge";
import { PALETTES } from "./constants";
import { formatFreshness } from "./format";
import { bytesHuman } from "./helpers";
import { LS, lsGet, lsSet } from "./storage";
import { SettingRow } from "./panels";
import { PaletteCard } from "./panels3";
import { useAppearance } from "./hooks";
import { SettingsHeader } from "./sectionutil";
import { BACKUP_CFG, backupVaultNow } from "./backup";
import type { BackupResult, Mode } from "./types";

export function AppearanceSection({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  return (
    <section className="mt-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Appearance</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Mode controls brightness; theme controls the accent palette and surface styling.
          </p>
        </div>
      </div>

      {/* Color Mode segmented control */}
      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Color Mode</div>
            <div className="mt-1 text-sm text-text-secondary">
              Pick a fixed mode or let Prevail follow your system setting.
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center rounded-md border border-border bg-background p-1 text-xs">
            {[
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "System", icon: Monitor },
            ].map((m) => {
              const Icon = m.icon;
              const active = appearance.mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => appearance.setMode(m.id as Mode)}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-accent text-background shadow-sm"
                      : "text-text-secondary hover:bg-surface-warm"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Theme palette cards */}
      <div className="mt-6">
        <div className="mb-1 font-medium">Theme</div>
        <p className="mb-4 text-sm text-text-secondary">
          Desktop palettes. The selected mode is applied on top.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PALETTES.map((p) => (
            <PaletteCard
              key={p.id}
              palette={p}
              active={appearance.palette === p.id}
              onSelect={() => appearance.setPalette(p.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}


// Council config — its own first-class section. You pick the EXACT models on the
// default panel (per-provider, multiple models allowed) and which one chairs.

export function DemoModeSection({ vaultPath, onVaultMoved, onSetupDomains }: { vaultPath: string; onVaultMoved?: (path: string) => void; onSetupDomains?: () => void }) {
  const [appMode, setAppMode] = useState<"demo" | "production" | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [packs, setPacks] = useState<{ file: string; name: string; version: string; description: string | null; domains: string[] }[]>([]);
  const [importingPack, setImportingPack] = useState<string | null>(null);
  const [importedPacks, setImportedPacks] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  // The remembered production vault path, so switching demo<->production never
  // re-asks for the folder, and both locations can be shown.
  const [prodVault, setProdVault] = useState<string>(() => lsGet(LS.vaultProduction) || "");
  useEffect(() => {
    const loadMode = () =>
      invoke<{ mode: "demo" | "production" }>("engine_appmode_get").then((m) => setAppMode(m.mode)).catch(() => {});
    loadMode();
    invoke<typeof packs>("engine_pack_list").then(setPacks).catch(() => {});
    window.addEventListener("prevail:appmode", loadMode);
    return () => window.removeEventListener("prevail:appmode", loadMode);
  }, []);
  // When we're in production, the current vaultPath IS the production vault —
  // remember it (covers vaults set up before this round-trip logic existed).
  useEffect(() => {
    if (appMode === "production" && vaultPath && !vaultPath.includes("/.prevail/demo-vault")) {
      if (vaultPath !== prodVault) { setProdVault(vaultPath); lsSet(LS.vaultProduction, vaultPath); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, vaultPath]);

  // Point the app at a chosen folder as the production vault. `runOnboarding`
  // is false when a starter pack already populated it — the pack IS the start.
  async function enterProduction(picked: string, runOnboarding: boolean) {
    // Snapshot before clearing the demo sandbox (a pre-event backup).
    await backupVaultNow(vaultPath);
    await invoke<{ vault: string; demoCleared: boolean }>("engine_production_init", { vault: picked, clearDemo: vaultPath });
    await invoke("engine_appmode_set", { mode: "production", vault: picked }).catch(() => {});
    setProdVault(picked); lsSet(LS.vaultProduction, picked);
    setAppMode("production");
    window.dispatchEvent(new Event("prevail:appmode"));
    onVaultMoved?.(picked);
    if (runOnboarding) onSetupDomains?.();
  }

  // Leave the demo sandbox for your own vault. If a production vault is already
  // remembered, just switch back to it (no re-pick, no onboarding); otherwise
  // pick a fresh folder and run setup.
  async function switchToProduction() {
    // Already have a production vault on disk? Round-trip straight back to it.
    if (prodVault) {
      const ok = await invoke<boolean>("vault_exists", { path: prodVault }).catch(() => false);
      if (ok) {
        setSwitchingMode(true); setNote(null);
        try {
          await invoke("engine_appmode_set", { mode: "production", vault: prodVault }).catch(() => {});
          setAppMode("production");
          window.dispatchEvent(new Event("prevail:appmode"));
          onVaultMoved?.(prodVault);
          setNote(`Back in your own vault (${prodVault}).`);
        } catch (e) { setNote(`Could not switch: ${String(e)}`); }
        finally { setSwitchingMode(false); }
        return;
      }
    }
    const confirmOk = await tauriConfirm(
      "Ready to set up your own vault? You'll choose a folder for it, then set up your domains. The demo sample data is cleared.",
      { title: "Use your own vault", kind: "info", okLabel: "Choose my vault folder", cancelLabel: "Stay in demo" },
    );
    if (!confirmOk) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder for your own vault" });
    if (!picked || typeof picked !== "string") return;
    setSwitchingMode(true);
    setNote(null);
    try {
      await enterProduction(picked, true);
    } catch (e) {
      setNote(`Could not set up your vault: ${String(e)}`);
    } finally {
      setSwitchingMode(false);
    }
  }
  // Return to the demo sandbox: repoint the app at the demo vault (re-seeding
  // the bundled sample data) and flip the flag. The production vault is
  // remembered, untouched, and one click away.
  async function switchToDemo() {
    setSwitchingMode(true);
    setNote(null);
    try {
      const demoPath = await invoke<string>("import_sample_vault");
      await invoke("engine_appmode_set", { mode: "demo", vault: demoPath }).catch(() => {});
      await invoke("engine_appmode_mark_demo", { vault: demoPath }).catch(() => {});
      setAppMode("demo");
      window.dispatchEvent(new Event("prevail:appmode"));
      onVaultMoved?.(demoPath);
      setNote("You're back in the demo sandbox. Your own vault is remembered and one click away.");
    } catch (e) {
      setNote(`Could not switch: ${String(e)}`);
    } finally {
      setSwitchingMode(false);
    }
  }
  async function importPack(p: { name: string; domains: string[] }) {
    // In demo mode, importing is an intent to keep something — trigger vault setup first,
    // then import the pack into the new vault once it's ready.
    if (appMode === "demo") {
      const ok = await tauriConfirm(
        `Starter packs are saved to your own vault. You're in demo: set up your vault now and "${p.name}" will be imported there.`,
        { title: "Set up your own vault first", kind: "info", okLabel: "Set up my vault", cancelLabel: "Keep exploring" },
      );
      if (!ok) return;
      const picked = await open({ directory: true, multiple: false, title: "Choose a folder for your own vault" });
      if (!picked || typeof picked !== "string") return;
      setSwitchingMode(true);
      setImportingPack(p.name);
      setNote(null);
      try {
        // The pack populates the vault, so skip domain onboarding entirely.
        await enterProduction(picked, false);
        const r = await invoke<{ created: string[]; skipped: string[] }>("engine_pack_import", { vault: picked, pack: p.name, overwrite: false });
        const parts: string[] = [];
        if (r.created.length) parts.push(`added ${r.created.join(", ")}`);
        if (r.skipped.length) parts.push(`kept ${r.skipped.join(", ")}`);
        setImportedPacks((s) => new Set(s).add(p.name));
        setNote(`Vault set up and ${p.name} imported: ${parts.join(" · ") || "no new domains"}.`);
        window.dispatchEvent(new Event("prevail:domains-changed"));
      } catch (e) {
        setNote(`Could not set up vault: ${String(e)}`);
      } finally {
        setSwitchingMode(false);
        setImportingPack(null);
      }
      return;
    }
    // Production mode — import directly into the current vault.
    setImportingPack(p.name);
    setNote(null);
    try {
      const r = await invoke<{ created: string[]; skipped: string[] }>("engine_pack_import", { vault: vaultPath, pack: p.name, overwrite: false });
      const parts: string[] = [];
      if (r.created.length) parts.push(`added ${r.created.join(", ")}`);
      if (r.skipped.length) parts.push(`kept ${r.skipped.join(", ")}`);
      setImportedPacks((s) => new Set(s).add(p.name));
      setNote(`Imported ${p.name}: ${parts.join(" · ") || "no new domains"}. Find them in your sidebar.`);
      window.dispatchEvent(new Event("prevail:domains-changed"));
    } catch (e) {
      setNote(`Import failed: ${String(e)}`);
    } finally {
      setImportingPack(null);
    }
  }
  const isDemo = appMode === "demo";
  return (
    <>
      <SettingsHeader
        title="Demo Mode"
        subtitle="Explore Prevail with sample data, then set up your own vault when you're ready."
      />
      {/* Visual stage: Demo -> Your Vault. The current stage glows. */}
      <div className="mb-5 flex items-stretch gap-3">
        <div className={`flex-1 rounded-xl border p-4 text-center transition-colors ${isDemo ? "border-accent-border bg-accent-soft ring-2 ring-accent/30" : "border-border bg-surface opacity-60"}`}>
          <Sparkles className={`mx-auto h-6 w-6 ${isDemo ? "text-accent" : "text-text-muted"}`} />
          <div className={`mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] ${isDemo ? "text-accent" : "text-text-muted"}`}>Demo</div>
          <div className="mt-0.5 text-xs text-text-secondary">Sample data to explore</div>
          {isDemo && <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">You are here</div>}
        </div>
        <div className="flex items-center text-text-muted"><ArrowRight className="h-5 w-5" /></div>
        <div className={`flex-1 rounded-xl border p-4 text-center transition-colors ${!isDemo && appMode ? "border-border bg-surface-warm ring-2 ring-text-muted/20" : "border-border bg-surface opacity-60"}`}>
          <ShieldCheck className={`mx-auto h-6 w-6 ${!isDemo && appMode ? "text-text-primary" : "text-text-muted"}`} />
          <div className={`mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] ${!isDemo && appMode ? "text-text-primary" : "text-text-muted"}`}>Your Vault</div>
          <div className="mt-0.5 text-xs text-text-secondary">Your own private workspace</div>
          {!isDemo && appMode && <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider text-text-secondary">You are here</div>}
        </div>
      </div>
      {/* Where each vault lives — demo (read-only) and production (the real
          data, a danger zone). Always visible so the two are never confused. */}
      <div className="mb-5 space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">Demo vault</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary" title={isDemo ? vaultPath : "~/.prevail/demo-vault"}>{isDemo ? vaultPath : "~/.prevail/demo-vault"}</span>
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted">sample · re-seeded</span>
        </div>
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${prodVault ? "border-warn/40 bg-warn/5" : "border-dashed border-border bg-surface"}`}>
          <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${prodVault ? "text-warn" : "text-text-muted"}`} />
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">Your vault</span>
          {prodVault ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary" title={prodVault}>{prodVault}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">not set up yet</span>
          )}
          {prodVault && <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-warn">real data · do not move/delete</span>}
        </div>
        {prodVault && (
          <p className="px-1 text-[10px] text-text-muted">
            This folder holds your real vault. Switching to demo never touches it; do not delete or move it from Finder, or Prevail will lose track of it.
          </p>
        )}
      </div>
      {/* Action: in demo, the 3-step setup; in your own vault, a quiet way back. */}
      {isDemo && prodVault ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-warm p-4">
          <p className="text-sm text-text-secondary">You have your own vault set up. Switch back to it any time, no re-setup.</p>
          <button
            onClick={switchToProduction}
            disabled={switchingMode}
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {switchingMode ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {switchingMode ? "Switching…" : "Switch to my vault"}
          </button>
        </div>
      ) : isDemo ? (
        <div className="mb-4 rounded-xl border border-accent-border bg-accent-soft p-4">
          <div className="mb-3 text-sm font-semibold text-text-primary">Setting up your own vault takes three steps:</div>
          <div className="mb-4 flex items-stretch gap-2">
            {[
              { n: 1, label: "Choose your vault folder" },
              { n: 2, label: "Set up your domains" },
              { n: 3, label: "Start for real, demo data cleared" },
            ].map((step, i) => (
              <Fragment key={step.n}>
                {i > 0 && (
                  <div className="flex shrink-0 items-center text-accent">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                )}
                <div className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border border-accent-border bg-background/60 p-2.5 text-center">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-background">{step.n}</span>
                  <span className="text-xs leading-tight text-text-secondary">{step.label}</span>
                </div>
              </Fragment>
            ))}
          </div>
          <button
            onClick={switchToProduction}
            disabled={switchingMode}
            className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {switchingMode ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {switchingMode ? "Setting up…" : "Set up my own vault"}
          </button>
        </div>
      ) : appMode ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-warm p-4">
          <p className="text-sm text-text-secondary">You're in your own vault. You can explore the demo sandbox any time.</p>
          <button
            onClick={switchToDemo}
            disabled={switchingMode}
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50"
          >
            {switchingMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {switchingMode ? "Switching…" : "Explore demo sandbox"}
          </button>
        </div>
      ) : null}
      {packs.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Starter packs
          </div>
          <p className="mb-3 text-xs text-text-muted">
            Import a ready-made set of domains for your situation. Import one at a time; existing domains are always kept, never overwritten.
          </p>
          {/* Visible result right where you're looking, not just a footer. */}
          {note && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-accent-border bg-accent-soft px-3 py-2 text-xs text-text-primary">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span>{note}</span>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {packs.map((p) => {
              const imported = importedPacks.has(p.name);
              const busy = importingPack === p.name;
              return (
                <div key={p.file} className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${imported ? "border-accent-border bg-accent-soft" : "border-border bg-surface"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      {p.name}
                      {imported && <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-background"><Check className="h-3 w-3" /> Imported</span>}
                    </div>
                    {p.description && <div className="mt-0.5 text-xs text-text-muted">{p.description}</div>}
                    <div className="mt-1 font-mono text-[10px] text-text-secondary">{p.domains.join(" · ")}</div>
                  </div>
                  <button
                    onClick={() => importPack(p)}
                    disabled={importingPack !== null || imported}
                    className={`shrink-0 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50 ${imported ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-background hover:bg-surface-warm"}`}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : imported ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                    {busy ? "Importing…" : imported ? "Imported" : "Import"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Footer so the page closes cleanly instead of ending abruptly. */}
      <div className="mt-6 flex items-center gap-2 border-t border-border-subtle pt-4 text-xs text-text-muted">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span>
          {isDemo
            ? "You're in demo mode. Importing a pack sets up your own vault and moves you out of demo: or use the button above to set up your vault first."
            : "You're in your own vault. Import a starter pack any time to add ready-made domains."}
        </span>
      </div>
    </>
  );
}

export function BackupAutomationCard({ vault, onChange }: { vault: string; onChange?: () => void }) {
  const [enabled, setEnabled] = useState(() => lsGet(BACKUP_CFG.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
  const [changeThreshold, setChangeThreshold] = useState(() => lsGet(BACKUP_CFG.changeThreshold, "0"));
  const [backups, setBackups] = useState<{ name: string; path: string; bytes: number; mtime: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const refresh = () =>
    invoke<{ name: string; path: string; bytes: number; mtime: number }[]>("vault_backups_list", { destDir: lsGet(BACKUP_CFG.dest) || null })
      .then((b) => setBackups(Array.isArray(b) ? b : []))
      .catch(() => {});
  useEffect(() => {
    refresh();
    const f = () => refresh();
    window.addEventListener("prevail:backup-done", f);
    return () => window.removeEventListener("prevail:backup-done", f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const last = Number(lsGet(BACKUP_CFG.lastRun, "0")) || 0;
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <RotateCw className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-semibold tracking-tight">Automatic backups</div>
          <div className="text-xs text-text-secondary">
            Snapshots the whole vault on a schedule (and before risky operations like encryption or a mode switch), kept outside the vault. Old ones are pruned automatically.
            {enabled && last > 0 && ` Last backup ${formatFreshness(Math.max(0, (Date.now() - last) / 1000))} ago.`}
          </div>
        </div>
        <select value={freq} onChange={(e) => { setFreq(e.target.value); lsSet(BACKUP_CFG.freq, e.target.value); }} disabled={!enabled}
          className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary disabled:opacity-40">
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
        </select>
        <label className="flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
          or every
          <input
            type="number" min="0" value={changeThreshold}
            onChange={(e) => { setChangeThreshold(e.target.value); lsSet(BACKUP_CFG.changeThreshold, e.target.value); }}
            disabled={!enabled}
            title="Also back up after this many vault changes (0 = off)"
            className="w-14 rounded-md border border-border bg-background px-2 py-1 text-right text-[11px] disabled:opacity-40"
          />
          changes
        </label>
        <button onClick={() => { const v = !enabled; setEnabled(v); lsSet(BACKUP_CFG.enabled, v ? "1" : "0"); }}
          className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${enabled ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:border-accent-border hover:text-accent"}`}>
          {enabled ? "On" : "Off"}
        </button>
        <button onClick={async () => { setBusy(true); setNote(null); const ok = await backupVaultNow(vault); setNote(ok ? "Backup created." : "Backup failed."); setBusy(false); }}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
          {busy ? "…" : "Back up now"}
        </button>
      </div>
      {note && <div className="mt-2 text-xs text-text-secondary">{note}</div>}
      {backups.length > 0 && (
        <details className="mt-3 rounded-lg border border-border-subtle bg-background px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            Restore points · {backups.length}
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            {backups.map((b) => (
              <div key={b.path} className="flex items-center gap-2 px-1 py-1">
                <span className="flex-1 truncate font-mono text-[11px] text-text-secondary" title={b.path}>{b.name.replace("prevail-backup-", "").replace(".tar.gz", "")}</span>
                <span className="shrink-0 font-mono text-[10px] text-text-muted">{bytesHuman(b.bytes)}</span>
                <button
                  onClick={async () => {
                    const ok = await tauriConfirm(
                      "Restore this backup over your current vault? Your current state is backed up first, so this is reversible.",
                      { title: "Restore vault", kind: "warning", okLabel: "Restore", cancelLabel: "Cancel" },
                    );
                    if (!ok) return;
                    setBusy(true); setNote(null);
                    try {
                      await backupVaultNow(vault); // snapshot current state first
                      await invoke("vault_restore_archive", { vault, archive: b.path });
                      setNote("Restored. Reloading…");
                      onChange?.();
                      setTimeout(() => window.location.reload(), 900);
                    } catch (e) { setNote(`Restore failed: ${String(e)}`); }
                    finally { setBusy(false); }
                  }}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
                  Restore
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function VaultSettings({ vaultPath, onChange, onSetupDomains, onVaultMoved }: { vaultPath: string; onChange: () => void; onSetupDomains?: () => void; onVaultMoved?: (path: string) => void }) {
  const [backingUp, setBackingUp] = useState(false);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  // "Move vault into the app" — copy the current vault into the app-owned
  // location (~/.prevail/vault) via the engine, non-destructively, then repoint.
  const [moving, setMoving] = useState(false);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const embedded = vaultPath.replace(/\/+$/, "").endsWith("/.prevail/vault");
  async function moveIntoApp() {
    setMoving(true);
    setMoveNote(null);
    try {
      const r = await invoke<{ dest: string; alreadyEmbedded: boolean; copied: number; sourceFiles: number; ok: boolean }>(
        "engine_vault_embed",
        { vault: vaultPath },
      );
      if (r.alreadyEmbedded) {
        setMoveNote("Vault is already inside the app.");
      } else if (r.ok) {
        setMoveNote(`Moved ${r.copied} file${r.copied === 1 ? "" : "s"} into the app. Your original folder is left untouched.`);
        onVaultMoved?.(r.dest);
      } else {
        setMoveNote(`Move incomplete (${r.copied}/${r.sourceFiles} files). Your original folder is untouched; nothing was changed.`);
      }
    } catch (e) {
      setMoveNote(`Move failed: ${String(e)}`);
    } finally {
      setMoving(false);
    }
  }
  async function backupVault() {
    setBackingUp(true);
    setBackupNote(null);
    try {
      const res = await invoke<BackupResult>("engine_vault_backup", { vault: vaultPath, domainOpt: null });
      if (res.ok) {
        const nDomains = res.domains?.length ?? 0;
        const files = res.file_count ?? 0;
        setBackupNote(
          `Backed up ${nDomains} domain${nDomains === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"} · ${bytesHuman(res.bytes ?? 0)}${res.archive_path ? ` → ${res.archive_path}` : ""}`,
        );
      } else {
        setBackupNote(`Backup failed: ${res.error ?? "unknown error"}`);
      }
    } catch (e) {
      setBackupNote(`Backup failed: ${String(e)}`);
    } finally {
      setBackingUp(false);
    }
  }
  return (
    <>
      <SettingsHeader title="Vault" subtitle="Where Prevail reads + writes your domain folders. Each child folder with a state.md becomes a life domain." />
      <SettingRow label="Vault folder" desc="Currently selected workspace.">
        <button
          onClick={onChange}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm"
        >
          <Folder className="h-3.5 w-3.5" />
          Change
        </button>
      </SettingRow>
      {onSetupDomains && (
        <SettingRow label="Domains" desc="Let Prevail recommend a starter set of life domains, or add more.">
          <button
            onClick={onSetupDomains}
            className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-background"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Set up domains
          </button>
        </SettingRow>
      )}
      <div className="mt-1 rounded-lg border border-border bg-surface p-4 font-mono text-xs text-text-primary">
        {vaultPath}
      </div>
      {!embedded && (
        <SettingRow label="Move vault into the app" desc="Copy this vault into the app-owned location so there's no loose folder to manage. Your original folder is copied, never moved or deleted.">
          <button
            onClick={moveIntoApp}
            disabled={moving}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50"
          >
            {moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Folder className="h-3.5 w-3.5" />}
            {moving ? "Moving…" : "Move into app"}
          </button>
        </SettingRow>
      )}
      {moveNote && (
        <div className="mt-1 rounded-lg border border-border-subtle bg-surface px-4 py-2 text-xs text-text-secondary">{moveNote}</div>
      )}
      <SettingRow label="Back up vault" desc="Write a compressed archive of the entire vault. Nothing is deleted.">
        <button
          onClick={backupVault}
          disabled={backingUp}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50"
        >
          {backingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {backingUp ? "Backing up…" : "Back up vault"}
        </button>
      </SettingRow>
      {backupNote && (
        <div className="mt-1 break-all rounded-lg border border-border-subtle bg-surface px-3 py-2 font-mono text-[11px] text-text-secondary">
          {backupNote}
        </div>
      )}
      <BackupAutomationCard vault={vaultPath} onChange={onChange} />
    </>
  );
}
