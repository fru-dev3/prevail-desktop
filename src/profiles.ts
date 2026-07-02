// Profiles (Phase 4 of the 2026 redesign). A profile is a named identity backed
// by its OWN vault folder, so switching profiles gives complete isolation —
// separate domains, threads, loops, notes, everything — because the whole app
// reads from the active vaultPath and nothing reaches across vaults.
//
// The registry is MACHINE-LOCAL: it lists where each profile's vault lives, plus
// an optional passcode gate. It must NOT replicate through the cross-device UI
// prefs blob (vault paths are device-specific; the passcode hash is a
// credential), so `prevail.profiles` is in storage's UI_PREFS_EXCLUDE_PREFIX.
//
// Note on security: the passcode here is a soft UX gate. Real at-rest protection
// is the existing per-vault encryption (LockScreen) — a passcode-gated profile
// should also use an encrypted vault for true isolation.
import { lsGet, lsSet } from "./storage";

export interface Profile {
  id: string;
  label: string;       // display name (e.g. "Personal")
  email?: string;      // optional identifier shown under the name
  vaultPath: string;   // the profile's isolated vault folder
  color?: string;      // avatar tint (hex) — used when there's no image
  image?: string;      // optional avatar image, stored as a small data URL
  passHash?: string;   // optional SHA-256 hex of the passcode (soft gate)
}

// Downscale a picked image file to a small square data URL so it fits
// comfortably in the (machine-local) profile registry. Center-crops to a
// square, then encodes as JPEG.
export function imageFileToDataUrl(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const KEY = "prevail.profiles";
const ACTIVE_KEY = "prevail.profiles.activeId";
// The DEFAULT (startup) profile — distinct from the currently-active one. When
// no profile is active yet (a fresh boot, or the active id went stale),
// ensureDefaultProfile prefers this one. It is a soft preference: an already
// resolved active session is not forced back to the default mid-run.
const DEFAULT_KEY = "prevail.profiles.defaultId";

// Distinct avatar tints, assigned round-robin as profiles are created.
export const PROFILE_COLORS = ["#C4A35A", "#3CD8FF", "#7C8CF8", "#6FCF97", "#EB7BC0", "#F2994A"];

export function loadProfiles(): Profile[] {
  try {
    const raw = lsGet(KEY);
    const list = raw ? (JSON.parse(raw) as Profile[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && p.id && p.vaultPath) : [];
  } catch {
    return [];
  }
}

export function saveProfiles(list: Profile[]): void {
  lsSet(KEY, JSON.stringify(list));
}

export function getActiveId(): string | null {
  return lsGet(ACTIVE_KEY) || null;
}

export function setActiveId(id: string): void {
  lsSet(ACTIVE_KEY, id);
}

// The default/startup profile id (the one preferred when nothing is active yet).
export function getDefaultId(): string | null {
  return lsGet(DEFAULT_KEY) || null;
}

export function setDefaultId(id: string): void {
  lsSet(DEFAULT_KEY, id);
}

export function getActiveProfile(): Profile | null {
  const id = getActiveId();
  if (!id) return null;
  return loadProfiles().find((p) => p.id === id) ?? null;
}

// The default/startup profile object (the one the user has taken ownership of by
// switching to it). Used at boot to honor that profile's vault instead of
// reverting to the sample sandbox. Null when nothing has been made the default.
export function getDefaultProfile(): Profile | null {
  const id = getDefaultId();
  if (!id) return null;
  return loadProfiles().find((p) => p.id === id) ?? null;
}

// The profile whose vault should be honored at boot (demo mode). Prefer the
// pinned default; otherwise, if the user has engaged with profiles beyond the
// single auto-adopted "Personal", honor the active one. Returns null for a
// fresh single-profile sandbox so it still re-seeds fresh sample data. This is
// what stops the "my profile changes every time" revert.
export function getOwnedProfile(): Profile | null {
  const def = getDefaultProfile();
  if (def) return def;
  return loadProfiles().length > 1 ? getActiveProfile() : null;
}

export function newProfileId(): string {
  return `p_${Date.now().toString(36)}_${Math.floor(performance.now() % 1e6).toString(36)}`;
}

export function upsertProfile(p: Profile): Profile[] {
  const list = loadProfiles();
  const idx = list.findIndex((x) => x.id === p.id);
  if (idx === -1) list.push(p);
  else list[idx] = p;
  saveProfiles(list);
  return list;
}

export function removeProfile(id: string): Profile[] {
  const list = loadProfiles().filter((p) => p.id !== id);
  saveProfiles(list);
  if (getActiveId() === id) {
    if (list[0]) setActiveId(list[0].id);
    else lsSet(ACTIVE_KEY, "");
  }
  // Don't leave a dangling default pointing at a removed profile.
  if (getDefaultId() === id) lsSet(DEFAULT_KEY, list[0]?.id ?? "");
  return list;
}

// Ensure at least one profile exists. On first run we adopt the current vault as
// a "Personal" default so existing users keep working with zero setup. Returns
// the active profile.
export function ensureDefaultProfile(currentVaultPath: string | null): Profile | null {
  let list = loadProfiles();
  if (list.length === 0) {
    if (!currentVaultPath) return null;
    const p: Profile = { id: newProfileId(), label: "Personal", vaultPath: currentVaultPath, color: PROFILE_COLORS[0] };
    list = upsertProfile(p);
    setActiveId(p.id);
    return p;
  }
  let active = getActiveProfile();
  if (!active) {
    // Stale/missing active id — prefer the chosen default, then the profile
    // matching the current vault, then the first.
    const defId = getDefaultId();
    active =
      (defId && list.find((p) => p.id === defId)) ||
      (currentVaultPath && list.find((p) => p.vaultPath === currentVaultPath)) ||
      list[0];
    setActiveId(active.id);
  }
  return active;
}

// SHA-256 hex of a passcode (SubtleCrypto is available in the Tauri webview).
export async function hashPasscode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPasscode(profile: Profile, code: string): Promise<boolean> {
  if (!profile.passHash) return true; // no gate set
  return (await hashPasscode(code)) === profile.passHash;
}

export function initials(p: Profile): string {
  const base = (p.label || p.email || "?").trim();
  return base.slice(0, 1).toUpperCase();
}
