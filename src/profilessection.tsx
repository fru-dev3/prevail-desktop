// Profiles management (Editor → App → Profiles). Create, edit, and remove the
// isolated profiles you switch between. Each profile points at its own vault
// folder and may have an optional passcode. Switching here (or from the sidebar
// ProfileSwitcher) swaps the active vault — App performs the actual swap.
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { ArrowLeftRight, Check, FolderOpen, Layers, Lock, Pencil, Pin, Plus, Sparkles, Star, Trash2, UserRound, X } from "lucide-react";
import { invoke } from "./bridge";
import { SettingsHeader } from "./sectionutil";
import {
  getActiveId, getDefaultId, hashPasscode, imageFileToDataUrl, loadProfiles, newProfileId, PROFILE_COLORS,
  removeProfile, setActiveId, setDefaultId, upsertProfile, verifyPasscode, type Profile,
} from "./profiles";

type Draft = { id: string; label: string; email: string; vaultPath: string; passcode: string; color: string; image?: string; hadPass: boolean };

function blankDraft(existingCount: number): Draft {
  return { id: newProfileId(), label: "", email: "", vaultPath: "", passcode: "", color: PROFILE_COLORS[existingCount % PROFILE_COLORS.length], image: undefined, hadPass: false };
}

// Small avatar that prefers an uploaded image, falling back to a colored initial.
function Avatar({ p, size }: { p: { label: string; email?: string; color?: string; image?: string }; size: number }) {
  if (p.image) {
    return <img src={p.image} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-background" style={{ width: size, height: size, fontSize: size * 0.42, background: p.color || "#C4A35A" }}>
      {(p.label || p.email || "?").trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ProfilesSection() {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeId, setActive] = useState<string | null>(() => getActiveId());
  const [defaultId, setDefault] = useState<string | null>(() => getDefaultId());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gateId, setGateId] = useState<string | null>(null);
  const [gateCode, setGateCode] = useState("");
  const [gateErr, setGateErr] = useState<string | null>(null);
  // Best-effort domain count per profile vault, filled lazily from disk. A vault
  // that can't be scanned (path gone, not yet created) simply stays absent.
  const [counts, setCounts] = useState<Record<string, number>>({});

  const refresh = () => { setProfiles(loadProfiles()); setActive(getActiveId()); setDefault(getDefaultId()); };
  useEffect(() => {
    const f = () => refresh();
    window.addEventListener("prevail:profiles-changed", f);
    return () => window.removeEventListener("prevail:profiles-changed", f);
  }, []);
  // Fetch domain counts for each profile's vault so the cards can show how much
  // lives in each. Runs on the profile list changing; failures are ignored.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (const p of profiles) {
        try {
          const ds = await invoke<{ name: string }[]>("scan_vault", { path: p.vaultPath });
          if (Array.isArray(ds)) next[p.id] = ds.length;
        } catch { /* vault not scannable yet — leave its count unset */ }
      }
      if (!cancelled) setCounts(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.map((p) => `${p.id}:${p.vaultPath}`).join("|")]);

  // Make a profile the default/startup one. Distinct from switching: it does not
  // change the active session, only which profile is preferred on a fresh boot.
  const makeDefault = (p: Profile) => {
    setDefaultId(p.id);
    setDefault(p.id);
    window.dispatchEvent(new CustomEvent("prevail:profiles-changed"));
  };

  const startAdd = () => { setErr(null); setDraft(blankDraft(profiles.length)); };
  const startEdit = (p: Profile) => {
    setErr(null);
    setDraft({ id: p.id, label: p.label, email: p.email ?? "", vaultPath: p.vaultPath, passcode: "", color: p.color || PROFILE_COLORS[0], image: p.image, hadPass: !!p.passHash });
  };

  const onPickImage = async (file: File | undefined) => {
    if (!file || !draft) return;
    try {
      const dataUrl = await imageFileToDataUrl(file);
      setDraft({ ...draft, image: dataUrl });
    } catch (e) {
      setErr(`Couldn't load that image: ${e}`);
    }
  };

  const [sampling, setSampling] = useState(false);
  const pickFolder = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: "Choose this profile's vault folder" });
      if (typeof picked === "string" && draft) setDraft({ ...draft, vaultPath: picked });
    } catch (e) { console.error("pick vault", e); }
  };
  // One-click: create a fresh, populated vault from the bundled sample and use
  // it as this profile's vault — so a new profile isn't an empty dead end.
  const useSampleData = async () => {
    if (!draft) return;
    setSampling(true);
    setErr(null);
    try {
      const path = await invoke<string>("import_sample_vault");
      if (path) setDraft({ ...draft, vaultPath: path });
    } catch (e) {
      setErr(`Couldn't create a sample vault: ${e}`);
    } finally {
      setSampling(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const label = draft.label.trim();
    if (!label) { setErr("Give the profile a name."); return; }
    if (!draft.vaultPath.trim()) { setErr("Choose a vault folder for this profile."); return; }
    // Disallow two profiles pointing at the same vault (defeats isolation).
    const clash = loadProfiles().find((p) => p.id !== draft.id && p.vaultPath === draft.vaultPath.trim());
    if (clash) { setErr(`That vault is already used by "${clash.label}". Each profile needs its own vault.`); return; }
    const existing = loadProfiles().find((p) => p.id === draft.id);
    let passHash = existing?.passHash;
    if (draft.passcode.trim()) passHash = await hashPasscode(draft.passcode.trim());
    else if (!draft.hadPass) passHash = undefined; // explicitly no passcode on a new profile
    const p: Profile = { id: draft.id, label, email: draft.email.trim() || undefined, vaultPath: draft.vaultPath.trim(), color: draft.color, image: draft.image, passHash };
    upsertProfile(p);
    // First profile created becomes active automatically.
    if (!getActiveId()) setActiveId(p.id);
    setDraft(null);
    window.dispatchEvent(new CustomEvent("prevail:profiles-changed"));
    refresh();
  };

  const clearPasscode = () => { if (draft) setDraft({ ...draft, passcode: "", hadPass: false }); };

  const remove = async (p: Profile) => {
    if (profiles.length <= 1) { setErr("You need at least one profile."); return; }
    const ok = await tauriConfirm(
      `Remove the profile "${p.label}"? This only forgets the profile here. Its vault folder and all its data are left untouched on disk.`,
      { title: "Remove profile", kind: "warning" },
    );
    if (!ok) return;
    removeProfile(p.id);
    window.dispatchEvent(new CustomEvent("prevail:profiles-changed"));
    refresh();
  };

  const doSwitch = async (p: Profile, code?: string) => {
    if (p.id === activeId) return;
    if (p.passHash) {
      const okPass = await verifyPasscode(p, code ?? "");
      if (!okPass) { setGateErr("Wrong passcode"); return; }
    }
    setActiveId(p.id);
    window.dispatchEvent(new CustomEvent("prevail:switch-profile", { detail: { vaultPath: p.vaultPath, profileId: p.id } }));
    window.dispatchEvent(new CustomEvent("prevail:profiles-changed"));
    setGateId(null); setGateCode(""); setGateErr(null);
    refresh();
  };

  const onSwitchClick = (p: Profile) => {
    setGateErr(null);
    if (p.passHash) { setGateId(p.id); setGateCode(""); }
    else void doSwitch(p);
  };

  return (
    <>
      <SettingsHeader
        title="Profiles"
        icon={UserRound}
        subtitle="Separate, fully-isolated identities, each with its own vault, context, domains, and history. Switch profiles to switch everything. Pin a default to choose which one opens on startup. An optional passcode gates a profile before you can open it."
        right={
          !draft ? (
            <button onClick={startAdd} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover">
              <Plus className="h-4 w-4" /> Add profile
            </button>
          ) : undefined
        }
      />

      {/* Editor form (add / edit) */}
      {draft && (
        <div className="mb-4 max-w-xl rounded-lg border border-border bg-surface-warm p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-text-primary">{loadProfiles().some((p) => p.id === draft.id) ? "Edit profile" : "New profile"}</h3>
            <button onClick={() => { setDraft(null); setErr(null); }} className="rounded p-1 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Picture</label>
              <div className="flex items-center gap-3">
                <Avatar p={{ label: draft.label, email: draft.email, color: draft.color, image: draft.image }} size={48} />
                <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-strong hover:text-text-primary">
                  {draft.image ? "Change image" : "Upload image"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { void onPickImage(e.target.files?.[0]); e.currentTarget.value = ""; }} />
                </label>
                {draft.image && (
                  <button onClick={() => setDraft({ ...draft, image: undefined })} className="text-[11px] text-text-muted underline hover:text-err">Remove</button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">Optional. Falls back to a colored initial if no image is set.</p>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Name</label>
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Personal" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Email <span className="text-text-muted/60">(optional label)</span></label>
              <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="you@example.com" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Vault folder</label>
              <div className="flex items-center gap-2">
                <input value={draft.vaultPath} readOnly placeholder="Choose a folder…" className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-text-secondary" />
                <button onClick={() => void pickFolder()} className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-strong hover:text-text-primary"><FolderOpen className="h-4 w-4" /> Browse</button>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[11px] text-text-muted">Each profile needs its own vault folder. That's what makes it isolated.</p>
                <button onClick={() => void useSampleData()} disabled={sampling} className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent hover:underline disabled:opacity-50">
                  <Sparkles className="h-3 w-3" /> {sampling ? "Creating…" : "Start from sample data"}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Passcode <span className="text-text-muted/60">(optional)</span></label>
              <input type="password" value={draft.passcode} onChange={(e) => setDraft({ ...draft, passcode: e.target.value })} placeholder={draft.hadPass ? "•••••• (set, type to change)" : "Set a passcode to gate this profile"} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
              {draft.hadPass && (
                <button onClick={clearPasscode} className="mt-1 text-[11px] text-text-muted underline hover:text-err">Remove passcode</button>
              )}
              <p className="mt-1 text-[11px] text-text-muted">A soft gate before opening. For true at-rest protection, also encrypt this profile's vault.</p>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Color</label>
              <div className="flex gap-1.5">
                {PROFILE_COLORS.map((c) => (
                  <button key={c} onClick={() => setDraft({ ...draft, color: c })} className={`h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-surface-warm ${draft.color === c ? "ring-accent" : "ring-transparent"}`} style={{ background: c }} title={c} />
                ))}
              </div>
            </div>
            {err && <div className="text-xs text-err">{err}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDraft(null); setErr(null); }} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-strong">Cancel</button>
              <button onClick={() => void save()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover">Save profile</button>
            </div>
          </div>
        </div>
      )}

      {/* Profile list — rich, full-width cards. The active one is ringed in accent;
          every card lifts + brightens on hover so the target is obvious. */}
      {!draft && err && <div className="mb-3 text-xs text-err">{err}</div>}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {profiles.map((p) => {
          const isActive = p.id === activeId;
          const isDefault = p.id === defaultId;
          const count = counts[p.id];
          return (
            <li
              key={p.id}
              className={`group relative flex flex-col rounded-xl border p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg ${
                isActive
                  ? "border-2 border-accent bg-accent-soft shadow-sm ring-1 ring-accent/40"
                  : "border border-border-subtle bg-surface hover:border-accent-border hover:bg-surface-warm"
              }`}
            >
              {/* Identity: avatar + name + email + status badges */}
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <Avatar p={p} size={52} />
                  {isActive && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface bg-accent">
                      <Check className="h-2.5 w-2.5 text-background" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-base font-semibold text-text-primary" title={p.label}>{p.label}</span>
                    {p.passHash && <Lock className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                  </div>
                  {p.email && <span className="block truncate text-xs text-text-muted">{p.email}</span>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-background">Active</span>
                    )}
                    {isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-warn">
                        <Star className="h-2.5 w-2.5 fill-current" /> Default
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Meta: vault path + domain count */}
              <div className="mt-3 space-y-1.5 rounded-lg border border-border-subtle bg-background px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-secondary" title={p.vaultPath}>{p.vaultPath}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                  <span className="text-[11px] text-text-muted">
                    {count === undefined ? "domains —" : `${count} domain${count === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-1.5">
                {!isActive && (
                  <button onClick={() => onSwitchClick(p)} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent-border hover:text-accent" title="Switch to this profile">
                    <ArrowLeftRight className="h-3.5 w-3.5" /> Switch
                  </button>
                )}
                {isActive && (
                  <span className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-accent">
                    <Check className="h-3.5 w-3.5" /> In use
                  </span>
                )}
                <button
                  onClick={() => makeDefault(p)}
                  disabled={isDefault}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isDefault
                      ? "cursor-default border-transparent text-text-muted"
                      : "border-border bg-background text-text-secondary hover:border-warn hover:text-warn"
                  }`}
                  title={isDefault ? "This profile opens on startup" : "Open this profile on startup"}
                >
                  {isDefault ? <Star className="h-3.5 w-3.5 fill-current" /> : <Pin className="h-3.5 w-3.5" />}
                  {isDefault ? "Default" : "Set default"}
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => startEdit(p)} className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-text-primary" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => void remove(p)} className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-err/10 hover:text-err" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>

              {/* Inline passcode gate (gated profiles) */}
              {gateId === p.id && (
                <div className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-3">
                  <input autoFocus type="password" value={gateCode} onChange={(e) => { setGateCode(e.target.value); setGateErr(null); }} onKeyDown={(e) => { if (e.key === "Enter") void doSwitch(p, gateCode); if (e.key === "Escape") setGateId(null); }} placeholder="Passcode" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent-border focus:outline-none" />
                  <button onClick={() => void doSwitch(p, gateCode)} className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover">Unlock & switch</button>
                  {gateErr && <span className="shrink-0 text-[10px] text-err">{gateErr}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
