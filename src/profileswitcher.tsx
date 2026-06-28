// Profile switcher — a compact control pinned in the sidebar that shows the
// active profile and lets you switch between fully-isolated profiles (each its
// own vault). Self-contained: it reads/writes the local profile registry and
// dispatches `prevail:switch-profile` (App performs the vault swap + re-lock).
// Gated profiles require their passcode inline before switching.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Lock, Plus, Settings2 } from "lucide-react";
import { getActiveId, initials, loadProfiles, setActiveId, verifyPasscode, type Profile } from "./profiles";

export function ProfileSwitcher({ collapsed }: { collapsed: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeId, setActive] = useState<string | null>(() => getActiveId());
  const [open, setOpen] = useState(false);
  const [gateId, setGateId] = useState<string | null>(null); // profile awaiting passcode
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = () => { setProfiles(loadProfiles()); setActive(getActiveId()); };
  useEffect(() => {
    const f = () => refresh();
    window.addEventListener("prevail:profiles-changed", f);
    return () => window.removeEventListener("prevail:profiles-changed", f);
  }, []);
  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setGateId(null); setCode(""); setErr(null); }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = profiles.find((p) => p.id === activeId) ?? null;

  const doSwitch = async (p: Profile, passcode?: string) => {
    if (p.id === activeId) { setOpen(false); return; }
    if (p.passHash) {
      const ok = await verifyPasscode(p, passcode ?? "");
      if (!ok) { setErr("Wrong passcode"); return; }
    }
    setActiveId(p.id);
    setActive(p.id);
    window.dispatchEvent(new CustomEvent("prevail:switch-profile", { detail: { vaultPath: p.vaultPath, profileId: p.id } }));
    window.dispatchEvent(new CustomEvent("prevail:profiles-changed"));
    setOpen(false); setGateId(null); setCode(""); setErr(null);
  };

  const onRowClick = (p: Profile) => {
    setErr(null);
    if (p.passHash && p.id !== activeId) { setGateId(p.id); setCode(""); }
    else void doSwitch(p);
  };

  // Nothing to show until a default profile is established (App bootstraps one).
  if (!active) return null;

  const avatar = (p: Profile, size: number) => (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-background"
      style={{ width: size, height: size, fontSize: size * 0.42, background: p.color || "#C4A35A" }}
    >
      {initials(p)}
    </span>
  );

  return (
    <div ref={ref} className="relative border-t border-border-subtle">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Profile: ${active.label}${active.email ? ` (${active.email})` : ""} — click to switch`}
        className={`flex w-full items-center transition-colors hover:bg-surface-warm ${collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2"}`}
      >
        {avatar(active, collapsed ? 28 : 26)}
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
              <span className="truncate text-[13px] font-semibold text-text-primary">{active.label}</span>
              {active.email && <span className="truncate text-[10px] text-text-muted">{active.email}</span>}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-text-muted" />
          </>
        )}
      </button>

      {open && (
        <div className={`absolute bottom-full z-50 mb-1 w-60 rounded-lg border border-border bg-surface p-1 shadow-2xl ${collapsed ? "left-2" : "left-3 right-3 w-auto"}`}>
          <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Profiles</div>
          <ul className="max-h-72 overflow-y-auto">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onRowClick(p)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-warm"
                >
                  {avatar(p, 24)}
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[13px] text-text-primary">{p.label}</span>
                    {p.email && <span className="truncate text-[10px] text-text-muted">{p.email}</span>}
                  </span>
                  {p.passHash && <Lock className="h-3 w-3 shrink-0 text-text-muted" />}
                  {p.id === activeId && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
                {gateId === p.id && (
                  <div className="px-2 pb-1.5 pt-1">
                    <input
                      autoFocus
                      type="password"
                      value={code}
                      onChange={(e) => { setCode(e.target.value); setErr(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") void doSwitch(p, code); if (e.key === "Escape") { setGateId(null); setCode(""); setErr(null); } }}
                      placeholder="Passcode"
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent-border focus:outline-none"
                    />
                    {err && <div className="mt-1 text-[10px] text-err">{err}</div>}
                    <button
                      onClick={() => void doSwitch(p, code)}
                      className="mt-1 w-full rounded-md bg-accent px-2 py-1 text-xs font-semibold text-background hover:bg-accent-hover"
                    >
                      Unlock & switch
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="my-1 h-px bg-border-subtle" />
          <button
            onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "profiles" })); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Add profile
          </button>
          <button
            onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "profiles" })); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary"
          >
            <Settings2 className="h-3.5 w-3.5" /> Manage profiles
          </button>
        </div>
      )}
    </div>
  );
}
