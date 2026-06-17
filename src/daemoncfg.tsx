// Daemon config builders extracted from App.tsx. Each maps localStorage prefs to
// the snake_case shape the Rust serde structs expect (distill / taskgen / skillgen).
import { PREF, getPref } from "./storage";

export function distillCfgFromPrefs(vaultPath: string) {
  return {
    vault: vaultPath,
    provider: getPref(PREF.memoryProvider, "claude"),
    model: getPref(PREF.distillModel, "claude-haiku-4-5"),
    memory_budget_chars: Number(getPref(PREF.memoryBudgetChars, "4000")) || 4000,
    threshold: Number(getPref(PREF.compressionThreshold, "0.5")) || 0.5,
    target: Number(getPref(PREF.compressionTarget, "0.2")) || 0.2,
    protected_recent: Number(getPref(PREF.protectedRecent, "20")) || 20,
    interval_sec: Number(getPref(PREF.distillIntervalSec, "900")) || 900,
  };
}

export function taskgenCfgFromPrefs(vaultPath: string) {
  return {
    vault: vaultPath,
    provider: getPref(PREF.memoryProvider, "claude"),
    model: getPref(PREF.taskgenModel, "claude-haiku-4-5"),
    interval_sec: Number(getPref(PREF.taskgenIntervalSec, "3600")) || 3600,
    max_tasks_per_domain: Number(getPref(PREF.taskgenMaxPerDomain, "3")) || 3,
  };
}

export function intentDaemonCfgFromPrefs(vaultPath: string) {
  return {
    vault: vaultPath,
    provider: getPref(PREF.memoryProvider, "claude"),
    model: getPref(PREF.distillModel, "claude-haiku-4-5"),
    interval_sec: Number(getPref(PREF.intentDaemonIntervalSec, "1800")) || 1800, // check every 30 min
    min_new_prompts: Number(getPref(PREF.intentDaemonMinNew, "10")) || 10,
    max_age_sec: Number(getPref(PREF.intentDaemonMaxAgeSec, "86400")) || 86400, // daily
    limit: 200,
  };
}

export function skillgenCfgFromPrefs(vaultPath: string) {
  return {
    vault: vaultPath,
    provider: getPref(PREF.memoryProvider, "claude"),
    model: getPref(PREF.skillgenModel, "claude-haiku-4-5"),
    // Skills change slowly - tick every 6h; a per-domain daily cursor caps it
    // to one learning pass per domain per day regardless of tick cadence.
    interval_sec: Number(getPref(PREF.skillgenIntervalSec, "21600")) || 21600,
    max_skills_per_domain: Number(getPref(PREF.skillgenMaxPerDomain, "2")) || 2,
  };
}
