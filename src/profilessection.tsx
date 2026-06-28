// Profiles management (Editor → App → Profiles). Create, edit, and remove the
// isolated profiles you switch between. Each profile points at its own vault
// folder and may have an optional passcode. Switching here (or from the sidebar
// ProfileSwitcher) swaps the active vault — App performs the actual swap.
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, Lock, Pencil, Plus, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { invoke } from "./bridge";
import { SettingsHeader } from "./sectionutil";
import {
  getActiveId, hashPasscode, initials, loadProfiles, newProfileId, PROFILE_COLORS,
  removeProfile, setActiveId, upsertProfile, verifyPasscode, type Profile,
} from "./profiles";

type Draft = { id: string; label: string; email: string; vaultPath: string; passcode: string; color: string; hadPass: boolean };

function blankDraft(existingCount: number): Draft {
  return { id: newProfileId(), label: "", email: "", vaultPath: "", passcode: "", color: PROFILE_COLORS[existingCount % PROFILE_COLORS.length], hadPass: false };
}

export function ProfilesSection() {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeId, setActive] = useState<string | null>(() => getActiveId());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gateId, setGateId] = useState<string | null>(null);
  const [gateCode, setGateCode] = useState("");
  const [gateErr, setGateErr] = useState<string | null>(null);

  const refresh = () => { setProfiles(loadProfiles()); setActive(getActiveId()); };
  useEffect(() => {
    const f = () => refresh();
    window.addEventListener("prevail:profiles-changed", f);
    return () => window.removeEventListener("prevail:profiles-changed", f);
  }, []);

  const startAdd = () => { setErr(null); setDraft(blankDraft(profiles.length)); };
  const startEdit = (p: Profile) => {
    setErr(null);
    setDraft({ id: p.id, label: p.label, email: p.email ?? "", vaultPath: p.vaultPath, passcode: "", color: p.color || PROFILE_COLORS[0], hadPass: !!p.passHash });
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
    const p: Profile = { id: draft.id, label, email: draft.email.trim() || undefined, vaultPath: draft.vaultPath.trim(), color: draft.color, passHash };
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
      `Remove the profile "${p.label}"? This only forgets the profile here — its vault folder and all its data are left untouched on disk.`,
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
        subtitle="Separate, fully-isolated identities — each with its own vault, context, domains, and history. Switch profiles to switch everything. An optional passcode gates a profile before you can open it."
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
                <p className="text-[11px] text-text-muted">Each profile needs its own vault folder — that's what makes it isolated.</p>
                <button onClick={() => void useSampleData()} disabled={sampling} className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent hover:underline disabled:opacity-50">
                  <Sparkles className="h-3 w-3" /> {sampling ? "Creating…" : "Start from sample data"}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-muted">Passcode <span className="text-text-muted/60">(optional)</span></label>
              <input type="password" value={draft.passcode} onChange={(e) => setDraft({ ...draft, passcode: e.target.value })} placeholder={draft.hadPass ? "•••••• (set — type to change)" : "Set a passcode to gate this profile"} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent-border focus:outline-none" />
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

      {/* Profile list */}
      {!draft && err && <div className="mb-3 text-xs text-err">{err}</div>}
      <ul className="grid max-w-xl grid-cols-1 gap-2">
        {profiles.map((p) => (
          <li key={p.id} className={`rounded-lg border bg-surface p-3 ${p.id === activeId ? "border-accent-border" : "border-border-subtle"}`}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-background" style={{ background: p.color || "#C4A35A" }}>{initials(p)}</span>
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-text-primary">
                  {p.label}
                  {p.passHash && <Lock className="h-3 w-3 text-text-muted" />}
                  {p.id === activeId && <span className="rounded-full bg-accent-soft px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-accent">Active</span>}
                </span>
                {p.email && <span className="truncate text-[11px] text-text-muted">{p.email}</span>}
                <span className="truncate font-mono text-[10px] text-text-muted/80" title={p.vaultPath}>{p.vaultPath}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {p.id !== activeId && (
                  <button onClick={() => onSwitchClick(p)} className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-accent-border hover:text-accent" title="Switch to this profile">
                    <Check className="h-3.5 w-3.5" /> Switch
                  </button>
                )}
                <button onClick={() => startEdit(p)} className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-text-primary" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => void remove(p)} className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-err/10 hover:text-err" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            {gateId === p.id && (
              <div className="mt-2 flex items-center gap-2 border-t border-border-subtle pt-2">
                <input autoFocus type="password" value={gateCode} onChange={(e) => { setGateCode(e.target.value); setGateErr(null); }} onKeyDown={(e) => { if (e.key === "Enter") void doSwitch(p, gateCode); if (e.key === "Escape") setGateId(null); }} placeholder="Passcode" className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent-border focus:outline-none" />
                <button onClick={() => void doSwitch(p, gateCode)} className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover">Unlock & switch</button>
                {gateErr && <span className="text-[10px] text-err">{gateErr}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
