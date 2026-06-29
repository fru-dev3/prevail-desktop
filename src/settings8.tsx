// Settings sections extracted from App.tsx: Appearance (theme + palette), Demo
// Mode (sample-vault sandbox), and Vault settings (path + the backup-automation
// card).
import { useEffect, useState } from "react";
import { confirm as tauriConfirm, open } from "@tauri-apps/plugin-dialog";
import { Archive, Briefcase, Check, ChevronRight, Database, DatabaseBackup, Download, ExternalLink, Folder, FolderCog, FolderOpen, FolderTree, GraduationCap, Home, Loader2, Monitor, Moon, Package, RotateCw, ShieldCheck, Sparkles, Sun, TrendingUp, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Pick a glyph for a starter pack from its name, so the list reads visually.
function packIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("business")) return Briefcase;
  if (n.includes("family")) return Users;
  if (n.includes("student")) return GraduationCap;
  if (n.includes("income") || n.includes("wealth") || n.includes("invest")) return TrendingUp;
  if (n.includes("home") || n.includes("household")) return Home;
  if (n.includes("general")) return Sparkles;
  return Package;
}
import { invoke } from "./bridge";
import { PALETTES } from "./constants";
import { formatFreshness } from "./format";
import { bytesHuman } from "./helpers";
import { LS, lsGet, lsSet } from "./storage";
import { SettingRow } from "./panels";
import { Toggle } from "./ui";
import { PaletteCard } from "./panels3";
import { useAppearance } from "./hooks";
import { SettingsHeader } from "./sectionutil";
import { BACKUP_CFG, backupFreqMs, backupVaultNow } from "./backup";
import type { Mode } from "./types";

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


// Council config - its own first-class section. You pick the EXACT models on the
// default panel (per-provider, multiple models allowed) and which one chairs.

export function DemoModeSection({ vaultPath, onVaultMoved, onSetupDomains, headerless, view }: { vaultPath: string; onVaultMoved?: (path: string) => void; onSetupDomains?: () => void; headerless?: boolean; view?: "cards" | "packs" }) {
  const [appMode, setAppMode] = useState<"demo" | "production" | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [packs, setPacks] = useState<{ file: string; name: string; version: string; description: string | null; domains: string[] }[]>([]);
  const [importingPack, setImportingPack] = useState<string | null>(null);
  const [importedPacks, setImportedPacks] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  // B2-16: per-vault backup toggle on the active card. Backup snapshots the
  // ACTIVE vault, so this reflects/controls BACKUP_CFG.enabled.
  const [backupOn, setBackupOn] = useState(() => lsGet(BACKUP_CFG.enabled, "0") === "1");
  const toggleBackup = (v: boolean) => { setBackupOn(v); lsSet(BACKUP_CFG.enabled, v ? "1" : "0"); window.dispatchEvent(new Event("prevail:bench-sched")); };
  // Backup status surfaced next to the toggle: schedule, next-run, run-now, folder.
  const [backupTick, setBackupTick] = useState(0);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupFreq, setBackupFreqState] = useState(() => lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
  const setBackupFreq = (v: string) => { setBackupFreqState(v); lsSet(BACKUP_CFG.freq, v); window.dispatchEvent(new Event("prevail:bench-sched")); setBackupTick((t) => t + 1); };
  const customDays = /^custom:(\d+)$/.exec(backupFreq)?.[1] ?? "2";
  const backupNextLabel = (() => {
    void backupTick; // re-evaluate after a manual backup
    const last = Number(lsGet(BACKUP_CFG.lastRun, "0")) || 0;
    if (!last) return "on next check";
    const next = last + backupFreqMs(backupFreq);
    return new Date(next).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  })();
  const backupNow = async () => {
    setBackupBusy(true);
    try { await backupVaultNow(vaultPath); setBackupTick((t) => t + 1); } finally { setBackupBusy(false); }
  };
  const openBackupsFolder = async () => {
    try {
      // Prefer an existing backup's folder; fall back to the effective backup dir
      // so this works even before the first backup has been written.
      const list = await invoke<{ path: string }[]>("vault_backups_list", { destDir: lsGet(BACKUP_CFG.dest) || null });
      const p = (Array.isArray(list) && list[0]?.path) || (await invoke<string>("vault_backup_dir", { destDir: lsGet(BACKUP_CFG.dest) || null }));
      if (p) await invoke("open_in_finder", { path: p });
    } catch (e) { console.error("open backups folder", e); }
  };
  // The folder backups are actually written to: a saved override (BACKUP_CFG.dest)
  // or the default app-support/backups. Shown + changeable right on the card.
  const [backupDir, setBackupDir] = useState<string>("");
  const [backupDirCustom, setBackupDirCustom] = useState<boolean>(() => !!lsGet(BACKUP_CFG.dest));
  useEffect(() => {
    invoke<string>("vault_backup_dir", { destDir: lsGet(BACKUP_CFG.dest) || null }).then(setBackupDir).catch(() => {});
  }, [backupTick]);
  const changeBackupDir = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Choose a backup folder" });
    if (typeof picked === "string" && picked) {
      lsSet(BACKUP_CFG.dest, picked);
      setBackupDirCustom(true);
      setBackupTick((t) => t + 1);
      window.dispatchEvent(new Event("prevail:backup-done"));
    }
  };
  const resetBackupDir = () => {
    lsSet(BACKUP_CFG.dest, "");
    setBackupDirCustom(false);
    setBackupTick((t) => t + 1);
    window.dispatchEvent(new Event("prevail:backup-done"));
  };
  // Rescan the workspace: re-read domains/apps from disk (picks up anything added
  // outside the app, or a file that went missing) and refresh every surface.
  const [rescanning, setRescanning] = useState(false);
  const [rescanNote, setRescanNote] = useState<string | null>(null);
  const rescanVault = async () => {
    setRescanning(true); setRescanNote(null);
    try {
      const ds = await invoke<{ name: string }[]>("scan_vault", { path: vaultPath });
      window.dispatchEvent(new Event("prevail:domains-changed"));
      window.dispatchEvent(new Event("prevail:apps-changed"));
      window.dispatchEvent(new Event("prevail:tasks-changed"));
      const n = Array.isArray(ds) ? ds.length : 0;
      setRescanNote(`Rescanned: ${n} domain${n === 1 ? "" : "s"} found.`);
      window.setTimeout(() => setRescanNote(null), 4000);
    } catch (e) {
      setRescanNote(`Rescan failed: ${e}`);
    } finally { setRescanning(false); }
  };
  const BackupStatusLine = () => (
    backupOn ? (
      // Schedule on the left; actions as right-aligned icon buttons (with tooltips)
      // that match the path row's icon-button style for an even, clean layout.
      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-muted">
        {/* Editable schedule, right here: daily / weekly / monthly / every N days
            (every other day = 2, every other week = 14). */}
        <select
          value={/^custom:/.test(backupFreq) ? "custom" : backupFreq}
          onChange={(e) => setBackupFreq(e.target.value === "custom" ? `custom:${customDays}` : e.target.value)}
          title="How often automatic backups run"
          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none"
        >
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
          <option value="custom">every N days</option>
        </select>
        {/^custom:/.test(backupFreq) && (
          <span className="inline-flex items-center gap-1">
            <input type="number" min={1} max={365} value={customDays}
              onChange={(e) => setBackupFreq(`custom:${Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1))}`)}
              className="w-12 rounded border border-border bg-background px-1.5 py-0.5 text-right font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none" />
            <span>days</span>
          </span>
        )}
        <span className="min-w-0 flex-1 truncate" title="Next scheduled backup">· next ~{backupNextLabel}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button onClick={backupNow} disabled={backupBusy} title="Back up now" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40">
            {backupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseBackup className="h-3.5 w-3.5" />}
          </button>
          <button onClick={changeBackupDir} title={`Change backup folder (now: ${backupDir || "default"})`} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
            <FolderCog className="h-3.5 w-3.5" />
          </button>
          <button onClick={openBackupsFolder} title="Open backups folder" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Where backups land — visible + changeable right here. Kept OUTSIDE the
            vault (a backup inside what it backs up is circular). */}
        <div className="flex w-full items-center gap-1.5 text-[9px] text-text-muted">
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={backupDir}>{backupDir || "default location"}{backupDirCustom ? "" : " · default"}</span>
          <button onClick={changeBackupDir} className="shrink-0 uppercase tracking-wider hover:text-accent">change</button>
          {backupDirCustom && <button onClick={resetBackupDir} className="shrink-0 uppercase tracking-wider hover:text-accent">reset</button>}
        </div>
      </div>
    ) : null
  );
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
  // When we're in production, the current vaultPath IS the production vault -
  // remember it (covers vaults set up before this round-trip logic existed).
  useEffect(() => {
    if (appMode === "production" && vaultPath && !vaultPath.includes("/.prevail/demo-vault")) {
      if (vaultPath !== prodVault) { setProdVault(vaultPath); lsSet(LS.vaultProduction, vaultPath); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, vaultPath]);

  // Point the app at a chosen folder as the production vault. `runOnboarding`
  // is false when a starter pack already populated it - the pack IS the start.
  async function enterProduction(picked: string, runOnboarding: boolean) {
    // Snapshot before clearing the demo sandbox (a pre-event backup).
    await backupVaultNow(vaultPath);
    await invoke<{ vault: string; demoCleared: boolean }>("engine_production_init", { vault: picked, clearDemo: vaultPath });
    await invoke("engine_appmode_set", { mode: "production", vault: picked }).catch(() => {});
    setProdVault(picked); lsSet(LS.vaultProduction, picked);
    setAppMode("production");
    window.dispatchEvent(new Event("prevail:appmode"));
    onVaultMoved?.(picked);
    // Only onboard a genuinely EMPTY vault. If the folder you pointed at already
    // has domains, it's ready to use - scan it and skip the setup modal entirely.
    if (runOnboarding) {
      const existing = await invoke<{ name: string }[]>("scan_vault", { path: picked }).catch(() => [] as { name: string }[]);
      if (!existing || existing.length === 0) onSetupDomains?.();
    }
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
  // B2-15: change the vault folder from the card icon — pick a new directory and
  // point the app at it (same path the 3-step setup uses).
  async function changeVaultPath() {
    const picked = await open({ directory: true, multiple: false, title: "Choose your vault folder" });
    if (!picked || typeof picked !== "string") return;
    setSwitchingMode(true);
    setNote(null);
    try { await enterProduction(picked, true); }
    catch (e) { setNote(`Could not switch vault: ${String(e)}`); }
    finally { setSwitchingMode(false); }
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
    // In demo mode, importing is an intent to keep something - trigger vault setup first,
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
    // Production mode - import directly into the current vault.
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
      {/* DEMO-1 / IA-1: "Demo Mode" was a misnomer (it hosts starter packs that
          populate the REAL vault). Renamed "Sandbox" - the throwaway exploration
          space - with starter packs framed as production setup. */}
      {!headerless && view !== "cards" && (
        <SettingsHeader
          icon={Sparkles}
          title="Sandbox"
          subtitle="Explore Prevail with throwaway sample data, then set up your own vault when you're ready. Starter packs below populate your real vault."
        />
      )}
      {/* B2-15: with view="packs" the cards are hidden (they live in the Vault
          section); view="cards" hides packs. Default renders both (back-compat).
          W1: Your Vault vs Demo Vault as MUTUALLY-EXCLUSIVE toggles. */}
      {view !== "packs" && (<>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={`rounded-xl border p-4 transition-all ${!isDemo ? "border-2 border-warn bg-warn/10 shadow-sm" : "border border-border bg-surface opacity-55"}`}>
          {/* Header: shield + title + Active, toggle hard-right. */}
          <div className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 shrink-0 ${!isDemo ? "text-warn" : "text-text-muted"}`} />
            <span className="text-sm font-semibold text-text-primary">Your vault</span>
            {!isDemo && <span className="rounded-full bg-warn px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-background">Active</span>}
            <span className="ml-auto"><Toggle on={!isDemo} disabled={switchingMode} onChange={(v) => { if (v) void switchToProduction(); else void switchToDemo(); }} label="Use my own vault" /></span>
          </div>
          {/* Path + an even, aligned row of icon actions: rescan, change folder, open. */}
          <div className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary" title={prodVault || "not set up yet"}>{prodVault || (isDemo ? "not set up yet - toggle on to set up" : vaultPath)}</span>
            <div className="flex shrink-0 items-center gap-0.5">
              <button onClick={rescanVault} disabled={rescanning} title="Rescan the workspace for the canonical structure" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40"><RotateCw className={`h-3.5 w-3.5 ${rescanning ? "animate-spin" : ""}`} /></button>
              <button onClick={changeVaultPath} disabled={switchingMode} title="Change vault folder" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40"><FolderOpen className="h-3.5 w-3.5" /></button>
              {(prodVault || !isDemo) && (
                <button onClick={() => void invoke("open_in_finder", { path: prodVault || vaultPath }).catch(() => {})} title="Open in Finder" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"><ExternalLink className="h-3.5 w-3.5" /></button>
              )}
            </div>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-text-muted">Real data, backed up. {isDemo && !prodVault ? "Toggling on walks you through a quick 3-step setup." : "Switching to demo never touches it."}</div>
          {rescanNote && <div className="mt-1.5 font-mono text-[10px] text-accent">{rescanNote}</div>}
          {/* Per-vault backup toggle (active vault only). */}
          {!isDemo && (
            <div className="mt-3 border-t border-border-subtle/60 pt-2.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] text-text-secondary">Automatic backups</span>
                <Toggle on={backupOn} onChange={toggleBackup} label="Back up your vault" />
              </div>
              <BackupStatusLine />
            </div>
          )}
        </div>
        <div className={`rounded-xl border p-4 transition-all ${isDemo ? "border-2 border-accent bg-accent-soft shadow-sm" : "border border-border bg-surface opacity-55"}`}>
          <div className="flex items-center gap-2">
            <Sparkles className={`h-4 w-4 ${isDemo ? "text-accent" : "text-text-muted"}`} />
            <span className="text-sm font-semibold text-text-primary">Demo vault</span>
            {isDemo && <span className="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-background">Active</span>}
            <span className="ml-auto"><Toggle on={isDemo} disabled={switchingMode} onChange={(v) => { if (v) void switchToDemo(); else void switchToProduction(); }} label="Explore the demo sandbox" /></span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary" title={isDemo ? vaultPath : "sample data"}>{isDemo ? vaultPath : "throwaway sample data"}</span>
            {isDemo && (
              <button onClick={() => void invoke("open_in_finder", { path: vaultPath }).catch(() => {})} title="Open in Finder" className="shrink-0 rounded p-1 text-text-muted hover:text-accent"><ExternalLink className="h-3.5 w-3.5" /></button>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-text-muted">Sample data, re-seeded. Safe to explore; nothing here is your real data.</div>
          {isDemo && (
            <div className="mt-2 border-t border-border-subtle/60 pt-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[10px] text-text-muted">Automatic backups</span>
                <Toggle on={backupOn} onChange={toggleBackup} label="Back up demo vault" />
              </div>
              <BackupStatusLine />
            </div>
          )}
        </div>
      </div>
      {switchingMode && <div className="mb-4 text-xs text-text-muted">Switching…</div>}
      </>)}
      {view !== "cards" && packs.length > 0 && (
        <div className="mt-4">
          {/* Suppress this inner header when rendered as the Workspace "Starter
              packs" section (view==="packs") — the WorkspaceSubLabel already
              titles it, so showing both read as a duplicate. */}
          {view !== "packs" && (
            <>
              <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Starter packs
              </div>
              <p className="mb-3 text-xs text-text-muted">
                Import a ready-made set of domains for your situation. Import one at a time; existing domains are always kept, never overwritten.
              </p>
            </>
          )}
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
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${imported ? "bg-accent text-background" : "bg-surface-warm text-text-secondary"}`}>
                    {(() => { const PI = packIcon(p.name); return <PI className="h-4 w-4" />; })()}
                  </span>
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
      {view !== "cards" && (
        <div className="mt-6 flex items-center gap-2 border-t border-border-subtle pt-4 text-xs text-text-muted">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span>
            {isDemo
              ? "You're in the sandbox. Importing a pack sets up your own vault and moves you out of the sandbox: or use the button above to set up your vault first."
              : "You're in your own vault. Import a starter pack any time to add ready-made domains."}
          </span>
        </div>
      )}
    </>
  );
}

export function BackupAutomationCard({ vault, onChange }: { vault: string; onChange?: () => void }) {
  const [enabled, setEnabled] = useState(() => lsGet(BACKUP_CFG.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
  const [backups, setBackups] = useState<{ name: string; path: string; bytes: number; mtime: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Where backups are written: a saved override (BACKUP_CFG.dest) or the default.
  // We show the effective resolved path so it's never a mystery.
  const [dest, setDest] = useState<string>(() => lsGet(BACKUP_CFG.dest) || "");
  const [effectiveDir, setEffectiveDir] = useState<string>("");
  const loadDir = () => invoke<string>("vault_backup_dir", { destDir: lsGet(BACKUP_CFG.dest) || null }).then(setEffectiveDir).catch(() => {});
  useEffect(() => { loadDir(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dest]);
  const changeBackupDir = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Choose a backup folder" });
    if (typeof picked === "string" && picked) { lsSet(BACKUP_CFG.dest, picked); setDest(picked); refresh(); }
  };
  const resetBackupDir = () => { lsSet(BACKUP_CFG.dest, ""); setDest(""); refresh(); };
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
        <div className="flex items-center gap-1.5">
          <select value={/^custom:/.test(freq) ? "custom" : freq}
            onChange={(e) => { const v = e.target.value === "custom" ? `custom:${/^custom:(\d+)$/.exec(freq)?.[1] ?? "3"}` : e.target.value; setFreq(v); lsSet(BACKUP_CFG.freq, v); }}
            disabled={!enabled}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary disabled:opacity-40">
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
            <option value="custom">every N days</option>
          </select>
          {/^custom:/.test(freq) && (
            <div className="flex items-center gap-1">
              <input type="number" min={1} max={365} value={/^custom:(\d+)$/.exec(freq)?.[1] ?? "3"} disabled={!enabled}
                onChange={(e) => { const v = `custom:${Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1))}`; setFreq(v); lsSet(BACKUP_CFG.freq, v); }}
                className="w-14 rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-[11px] text-text-secondary disabled:opacity-40" />
              <span className="font-mono text-[10px] text-text-muted">days</span>
            </div>
          )}
        </div>
        {/* D4: minimal - a toggle (peel switch) + schedule selector. The "or every
            N changes" input was the clutter the founder flagged; removed. */}
        <button onClick={async () => { setBusy(true); setNote(null); const ok = await backupVaultNow(vault); setNote(ok ? "Backup created." : "Backup failed."); setBusy(false); }}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
          {busy ? "…" : "Back up now"}
        </button>
        <Toggle on={enabled} onChange={(v) => { setEnabled(v); lsSet(BACKUP_CFG.enabled, v ? "1" : "0"); }} label="Automatic backups" />
      </div>
      {note && <div className="mt-2 text-xs text-text-secondary">{note}</div>}
      {/* Backup location: the effective folder + change / reset. Kept OUTSIDE the
          vault on purpose (a backup inside what it backs up is circular). */}
      <div className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-2.5">
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Backup location {dest ? "" : "· default"}</div>
          <div className="truncate font-mono text-[11px] text-text-secondary" title={effectiveDir}>{effectiveDir || "…"}</div>
        </div>
        <button onClick={changeBackupDir} title="Choose a different backup folder" className="shrink-0 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">Change</button>
        {dest && <button onClick={resetBackupDir} title="Reset to the default location" className="shrink-0 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent">Reset</button>}
      </div>
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

export function VaultSettings({ vaultPath, onChange, onSetupDomains, onVaultMoved, headerless, hideBackups, advancedOnly }: { vaultPath: string; onChange: () => void; onSetupDomains?: () => void; onVaultMoved?: (path: string) => void; headerless?: boolean; hideBackups?: boolean; advancedOnly?: boolean }) {
  // "Move vault into the app" - copy the current vault into the app-owned
  // location (~/.prevail/vault) via the engine, non-destructively, then repoint.
  const [moving, setMoving] = useState(false);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const embedded = vaultPath.replace(/\/+$/, "").endsWith("/.prevail/vault");
  // W4 - "Tidy into a data/ folder": relocate the whole vault under <vault>/data
  // so the root holds no loose files and apps+domains sit together. The engine
  // copies + verifies + repoints; we adopt the new path. Already-tidied vaults
  // (path ends in /data) are a no-op.
  const [tidying, setTidying] = useState(false);
  const [tidyNote, setTidyNote] = useState<string | null>(null);
  const tidied = vaultPath.replace(/\/+$/, "").endsWith("/data");
  async function tidyIntoData() {
    setTidying(true);
    setTidyNote(null);
    try {
      const r = await invoke<{ dataDir: string; ok: boolean; alreadyMigrated?: boolean; copiedFiles?: number; sourceFiles?: number }>(
        "engine_vault_migrate_data",
        { vault: vaultPath },
      );
      if (r.alreadyMigrated) {
        setTidyNote("Vault is already grouped under a data/ folder.");
      } else if (r.ok) {
        setTidyNote(`Grouped ${r.copiedFiles ?? "the"} files under data/. Your original files are kept until you archive them; nothing was deleted.`);
        onVaultMoved?.(r.dataDir);
      } else {
        setTidyNote(`Tidy incomplete (${r.copiedFiles}/${r.sourceFiles} files). Your vault is unchanged; nothing was moved.`);
      }
    } catch (e) {
      setTidyNote(`Tidy failed: ${String(e)}`);
    } finally {
      setTidying(false);
    }
  }
  // B2-12 - "Tidy runtime files into build/": move the General/root SUPPORTING
  // files (ledgers, benchmark, _meta, _threads, usage, …) into <vault>/build/ so
  // the root holds just content + build/. Non-destructive copy + verify; originals
  // are kept until you archive. No repoint needed (resolvers find build/).
  const [tidyingBuild, setTidyingBuild] = useState(false);
  const [tidyBuildNote, setTidyBuildNote] = useState<string | null>(null);
  async function tidyIntoBuild() {
    setTidyingBuild(true);
    setTidyBuildNote(null);
    try {
      const r = await invoke<{ buildDir: string; ok: boolean; copiedFiles?: number; sourceFiles?: number; movedEntries?: string[] }>(
        "engine_vault_migrate_build",
        { vault: vaultPath },
      );
      if (r.ok) {
        const n = r.movedEntries?.length ?? 0;
        setTidyBuildNote(n === 0
          ? "Nothing to tidy: no loose runtime files at the vault root."
          : `Moved runtime files into build/ (${r.copiedFiles ?? "the"} files). Originals are kept until you archive them; nothing was deleted.`);
        onChange();
      } else {
        setTidyBuildNote(`Tidy incomplete (${r.copiedFiles}/${r.sourceFiles} files). Your vault is unchanged; nothing was moved.`);
      }
    } catch (e) {
      setTidyBuildNote(`Tidy failed: ${String(e)}`);
    } finally {
      setTidyingBuild(false);
    }
  }
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
  return (
    <>
      {/* VAULT-1: premium hierarchy - a location card leading with an icon chip,
          the path shown in a styled mono box with an in-app badge + Finder
          reveal; domains/move-into-app grouped as rows; backups cluster below. */}
      {/* B2-15: advancedOnly renders just the Advanced disclosure (the Vault
          location now lives in the Your/Demo vault cards). */}
      {!headerless && !advancedOnly && (
        <SettingsHeader icon={FolderTree} title="Vault" subtitle="Where Prevail reads + writes your domain folders. Each child folder with a state.md becomes a life domain." />
      )}
      {!advancedOnly && (
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><FolderOpen className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-primary">Vault folder</div>
            <div className="text-xs text-text-secondary">The workspace Prevail is reading right now{embedded ? " · stored inside the app" : ""}.</div>
          </div>
          <button onClick={onChange} className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm">
            <Folder className="h-3.5 w-3.5" /> Change
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2">
          <Database className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary" title={vaultPath}>{vaultPath}</span>
          {embedded && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">in app</span>}
          <button onClick={() => void invoke("open_in_finder", { path: vaultPath }).catch(() => {})} title="Reveal in Finder" className="shrink-0 rounded p-1 text-text-muted hover:text-accent">
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      )}
      {/* D4: these are rarely-needed maintenance actions - the founder found them
          clutter on the main view. Tucked behind a collapsed "Advanced" disclosure
          so the Workspace page stays minimal (location card + backups) while the
          actions remain available. */}
      {(onSetupDomains || !embedded || !tidied) && (
        <details className="group mt-3 rounded-xl border border-border bg-surface px-4 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:text-accent">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" /> Advanced
          </summary>
          <div className="pt-1">
          {onSetupDomains && (
            <SettingRow label="Domains" desc="Let Prevail recommend a starter set of life domains, or add more.">
              <button onClick={onSetupDomains} className="inline-flex items-center gap-2 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-sm text-accent hover:bg-accent hover:text-background">
                <Sparkles className="h-3.5 w-3.5" /> Set up domains
              </button>
            </SettingRow>
          )}
          {!embedded && (
            <SettingRow label="Move vault into the app" desc="Copy this vault into the app-owned location so there's no loose folder to manage. Your original folder is copied, never moved or deleted.">
              <button onClick={moveIntoApp} disabled={moving} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50">
                {moving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Folder className="h-3.5 w-3.5" />}
                {moving ? "Moving…" : "Move into app"}
              </button>
            </SettingRow>
          )}
          {!tidied && (
            <SettingRow label="Tidy into a data/ folder" desc="Group apps + domains and move loose files under a single data/ folder so the vault root stays clean. Copied + verified first; your files are kept, never deleted.">
              <button onClick={tidyIntoData} disabled={tidying} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50">
                {tidying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderTree className="h-3.5 w-3.5" />}
                {tidying ? "Tidying…" : "Tidy into data/"}
              </button>
            </SettingRow>
          )}
          <SettingRow label="Tidy runtime files into build/" desc="Move generated runtime files (decision + intent ledgers, _meta, benchmark) into a build/ folder so the root holds just your content. Copied + verified first; originals are kept until you archive, never deleted.">
            <button onClick={tidyIntoBuild} disabled={tidyingBuild} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-surface-warm disabled:opacity-50">
              {tidyingBuild ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderTree className="h-3.5 w-3.5" />}
              {tidyingBuild ? "Tidying…" : "Tidy into build/"}
            </button>
          </SettingRow>
          </div>
        </details>
      )}
      {moveNote && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-surface px-4 py-2 text-xs text-text-secondary">{moveNote}</div>
      )}
      {tidyNote && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-surface px-4 py-2 text-xs text-text-secondary">{tidyNote}</div>
      )}
      {tidyBuildNote && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-surface px-4 py-2 text-xs text-text-secondary">{tidyBuildNote}</div>
      )}
      {/* W2 (Monday feedback): backups can render as their own section in Workspace. */}
      {!hideBackups && <BackupAutomationCard vault={vaultPath} onChange={onChange} />}
    </>
  );
}

// IA-1: "Workspace" is the single umbrella area covering where data lives (vault,
// domains, backups) and how you set it up (starter packs) + the throwaway
// Sandbox. Replaces the separate "Vault" and "Demo Mode" nav entries, composing
// the (headerless) Vault + Sandbox sections under one header with sub-labels.
function WorkspaceSubLabel({ icon: Icon, label, desc }: { icon: LucideIcon; label: string; desc: string }) {
  return (
    <div className="mb-2 mt-1 flex items-center gap-2 px-1">
      <Icon className="h-3.5 w-3.5 text-accent" />
      <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
      <span className="ml-auto text-[11px] text-text-muted">{desc}</span>
    </div>
  );
}

export function WorkspaceSection({ vaultPath, onSetupDomains, onVaultMoved }: { vaultPath: string; onSetupDomains?: () => void; onVaultMoved?: (path: string) => void }) {
  return (
    <>
      <SettingsHeader icon={FolderTree} title="Workspace" subtitle="Where your data lives and how you set it up: your vault, backups, and starter packs." />
      {/* ONE Vault section = the Your/Demo vault cards (inline change+open icons and
          a per-vault backup toggle), plus a copy-safe filename normalizer. */}
      <div className="mb-7">
        <WorkspaceSubLabel icon={FolderOpen} label="Vault" desc="your vault · demo vault · backups" />
        <DemoModeSection vaultPath={vaultPath} onVaultMoved={onVaultMoved} onSetupDomains={onSetupDomains} headerless view="cards" />
      </div>
      {/* Starter packs as its own section. */}
      <div>
        <WorkspaceSubLabel icon={Sparkles} label="Starter packs" desc="ready-made domains for your situation" />
        <DemoModeSection vaultPath={vaultPath} onVaultMoved={onVaultMoved} onSetupDomains={onSetupDomains} headerless view="packs" />
      </div>
    </>
  );
}
