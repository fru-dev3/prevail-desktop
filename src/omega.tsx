// Omega — the app-wide LEARNED knowledge layer (vault/omega.md). The learned
// counterpart to the Ideal State: durable, cross-cutting lessons + preferences
// Prevail distills across every domain, injected into every turn just below the
// Ideal State. This page lets the user distill, view, and hand-edit it.
// See docs/OMEGA-PLAN.md. Engine: src-tauri/src/omega.rs.
import { useCallback, useEffect, useState } from "react";
import { Eye, History, Loader2, PenLine, Sigma, Sparkles } from "lucide-react";
import { invoke } from "./bridge";
import { CollapsibleSection } from "./collapsible";
import { Markdown } from "./Markdown";
import { PREF, getPref } from "./storage";
import { SettingsHeader } from "./sectionutil";

export function OmegaSection({ vaultPath }: { vaultPath: string }) {
  const [body, setBody] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [distilling, setDistilling] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ name: string; path: string }[]>([]);

  const loadVersions = useCallback(() =>
    invoke<{ name: string; path: string }[]>("omega_versions", { vault: vaultPath })
      .then((v) => setVersions(Array.isArray(v) ? v : []))
      .catch(() => {}), [vaultPath]);

  useEffect(() => {
    invoke<string>("read_omega", { vault: vaultPath })
      .then((s) => { setBody(s); setLoaded(true); })
      .catch(() => setLoaded(true));
    void loadVersions();
  }, [vaultPath, loadVersions]);

  async function save() {
    setSaving(true);
    try {
      await invoke("write_omega", { vault: vaultPath, body });
      setSavedAt(Date.now());
      setEditing(false);
      window.dispatchEvent(new Event("prevail:omega-changed"));
      void loadVersions();
    } finally { setSaving(false); }
  }

  async function distill() {
    setDistilling(true);
    setNote(null);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = getPref(PREF.distillModel, "claude-haiku-4-5");
      const merged = await invoke<string>("omega_distill", { vault: vaultPath, provider, model });
      setBody(merged);
      setSavedAt(Date.now());
      window.dispatchEvent(new Event("prevail:omega-changed"));
      void loadVersions();
      setNote("Distilled what's durable across your domains into Omega.");
    } catch (e) {
      setNote(String(e));
    } finally { setDistilling(false); }
  }

  const empty = body.trim() === "";

  return (
    <>
      <SettingsHeader
        title="Omega"
        icon={Sigma}
        subtitle="What Prevail has LEARNED across all your domains: durable lessons, preferences, and patterns that hold everywhere. It's the learned counterpart to your Ideal State, injected into every chat, council, and routine just below it. Distilled from your domains; you can also edit it by hand."
      />

      {/* Action bar: distill + edit/view. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {editing ? "Editing markdown" : "App-wide · highest precedence after the Ideal State"}
        </span>
        <div className="flex items-center gap-2">
          {savedAt && !editing && <span className="font-mono text-[10px] text-ok">✓ saved</span>}
          <button
            onClick={distill}
            disabled={distilling}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-accent hover:bg-accent hover:text-background disabled:opacity-50"
          >
            {distilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {distilling ? "Distilling…" : "Distill now"}
          </button>
          {loaded && !empty && (
            <button
              onClick={() => setEditing((e) => !e)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:border-accent-border hover:text-accent"
            >
              {editing ? <Eye className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
              {editing ? "View" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {note && (
        <div className="mb-3 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs text-text-secondary">{note}</div>
      )}

      {editing ? (
        <div className="rounded-lg border border-border bg-surface">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"## What you've learned about how you work\n\n- Prefer terse, decision-first answers\n\n(or hit “Distill now” to let Prevail draft this from your domains)"}
            rows={20}
            className="w-full resize-y rounded-lg bg-transparent p-4 font-mono text-sm leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-4 py-2">
            <span className="font-mono text-[10px] text-text-muted">{body.length.toLocaleString()} chars · the auto block is rewritten on each distill; edit above it</span>
            <button
              onClick={save}
              disabled={saving || !loaded}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
            >
              {saving ? "saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : !loaded ? null : empty ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
          <Sigma className="h-8 w-8 text-accent" />
          <div className="font-display text-base font-semibold">No learned knowledge yet</div>
          <p className="max-w-md text-sm text-text-secondary">
            Omega fills in as Prevail learns across your domains. Click <span className="font-semibold">Distill now</span> to draft it from what you've done so far, or write the first lines yourself.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={distill} disabled={distilling}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent-hover disabled:opacity-50">
              {distilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {distilling ? "Distilling…" : "Distill now"}
            </button>
            <button onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">
              <PenLine className="h-3.5 w-3.5" /> Write it myself
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed text-text-secondary">
            <Markdown source={body} compact />
          </div>
          {versions.length > 0 && (
            <CollapsibleSection
              icon={History}
              title="History"
              subtitle="Every distill + edit is snapshotted; nothing is lost."
              summary={`${versions.length} version${versions.length === 1 ? "" : "s"}`}
              className="mt-4"
            >
              <div className="flex flex-col gap-1">
                {versions.map((v) => (
                  <div key={v.path} className="flex items-center gap-2 py-1">
                    <span className="flex-1 font-mono text-[11px] text-text-secondary">{v.name.replace("_", " · ")}</span>
                    <button
                      onClick={async () => {
                        try {
                          const old = await invoke<string>("read_text_file", { path: v.path });
                          if (window.confirm("Restore this version? The current text is snapshotted first.")) {
                            setBody(old);
                            await invoke("write_omega", { vault: vaultPath, body: old });
                            setSavedAt(Date.now());
                            window.dispatchEvent(new Event("prevail:omega-changed"));
                            void loadVersions();
                          }
                        } catch (e) { console.error("restore omega", e); }
                      }}
                      className="rounded-md border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted hover:border-accent-border hover:text-accent"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </div>
      )}
    </>
  );
}
