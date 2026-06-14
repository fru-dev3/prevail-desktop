// Subsystem extracted from App.tsx (encapsulated module state).
import { invoke } from "./bridge";
import { LS, lsGet, lsSet } from "./storage";

export const BACKUP_CFG = {
  enabled: "prevail.backup.enabled",
  freq: "prevail.backup.freq", // daily | weekly | monthly
  lastRun: "prevail.backup.lastRun",
  dest: "prevail.backup.dest", // optional custom directory
  changeThreshold: "prevail.backup.changeThreshold", // back up after N vault changes ("0" = off)
  changeCount: "prevail.backup.changeCount", // vault changes since the last backup
};
// Count a vault-affecting change. Fires a change-based backup when the count
// crosses the configured threshold (the user's "every X changes" request).

export const BACKUP_FREQ_MS: Record<string, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
};

// Resolve a backup schedule value to ms, supporting an arbitrary "every N days"
// cadence ("custom:N") on top of the presets. Shared by the card + scheduler.
export function backupFreqMs(freq: string): number {
  const m = /^custom:(\d+)$/.exec(freq);
  if (m) return Math.max(1, parseInt(m[1], 10)) * 86_400_000;
  return BACKUP_FREQ_MS[freq] ?? BACKUP_FREQ_MS.weekly;
}

export let backupSchedTimer: number | null = null;

export function bumpBackupChangeCount() {
  const cur = (Number(lsGet(BACKUP_CFG.changeCount, "0")) || 0) + 1;
  lsSet(BACKUP_CFG.changeCount, String(cur));
  const threshold = Number(lsGet(BACKUP_CFG.changeThreshold, "0")) || 0;
  const vault = lsGet(LS.vault);
  if (lsGet(BACKUP_CFG.enabled, "0") === "1" && threshold > 0 && cur >= threshold && vault) {
    void backupVaultNow(vault); // resets the counter on success
  }
}

export async function backupVaultNow(vault: string): Promise<boolean> {
  if (!vault) return false;
  try {
    const dest = lsGet(BACKUP_CFG.dest) || null;
    await invoke("vault_backup_to", { vault, destDir: dest, keep: 10 });
    lsSet(BACKUP_CFG.lastRun, String(Date.now()));
    lsSet(BACKUP_CFG.changeCount, "0");
    window.dispatchEvent(new Event("prevail:backup-done"));
    return true;
  } catch (e) {
    console.error("vault backup", e);
    return false;
  }
}

export function startBackupScheduler(vault: string) {
  if (backupSchedTimer !== null) window.clearInterval(backupSchedTimer);
  const tick = async () => {
    try {
      if (lsGet(BACKUP_CFG.enabled, "0") !== "1") return;
      const freq = backupFreqMs(lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
      const last = Number(lsGet(BACKUP_CFG.lastRun, "0")) || 0;
      if (Date.now() - last < freq) return;
      await backupVaultNow(vault);
    } catch (e) {
      console.error("backup scheduler", e);
    }
  };
  void tick();
  backupSchedTimer = window.setInterval(() => void tick(), 30 * 60 * 1000);
}
