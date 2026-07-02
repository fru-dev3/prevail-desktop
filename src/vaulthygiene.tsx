// F5 — surface the vault-hygiene intelligence that already existed in the engine
// with no UI: the normalizer (align variant context filenames to canonical ones
// so the Context panel stops showing blanks) and the consolidator (move stray
// root-level domains/apps into the canonical data/ container). Both are COPY-ONLY
// and never overwrite, so a dry-run preview + one-click apply is safe.
import { useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { invoke } from "./bridge";

interface NormalizeOp { domain: string; from_name: string; to_name: string; applied: boolean }
interface ConsolidateOp { label: string; applied: boolean }
type Kind = "normalize" | "consolidate";

const META: Record<Kind, { title: string; desc: string; planCmd: string; applyCmd: string; empty: string }> = {
  normalize: {
    title: "Normalize context files",
    desc: "Some vaults name files differently (MEMORY.md instead of _memory.md). This copies them to the names Prevail reads, so your Context panel fills in. Originals are kept.",
    planCmd: "vault_normalize_plan",
    applyCmd: "vault_normalize_apply",
    empty: "Every context file already uses its canonical name. Nothing to normalize.",
  },
  consolidate: {
    title: "Consolidate vault layout",
    desc: "Move stray root-level domains and apps into the canonical data/ container. Copies only missing files and never overwrites, so nothing is lost.",
    planCmd: "vault_consolidate_plan",
    applyCmd: "vault_consolidate_apply",
    empty: "Your vault already uses the canonical data/ layout. Nothing to consolidate.",
  },
};

function opLabel(kind: Kind, op: NormalizeOp | ConsolidateOp): string {
  if (kind === "normalize") { const o = op as NormalizeOp; return `${o.domain}: ${o.from_name} → ${o.to_name}`; }
  return (op as ConsolidateOp).label;
}

function HygieneRow({ kind, vaultPath }: { kind: Kind; vaultPath: string }) {
  const meta = META[kind];
  const [ops, setOps] = useState<(NormalizeOp | ConsolidateOp)[] | null>(null);
  const [busy, setBusy] = useState<"plan" | "apply" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function plan() {
    setBusy("plan"); setNote(null);
    try {
      const r = await invoke<(NormalizeOp | ConsolidateOp)[]>(meta.planCmd, { vault: vaultPath });
      setOps(r);
      if (r.length === 0) setNote(meta.empty);
    } catch (e) { setNote(`Could not scan: ${String(e)}`); } finally { setBusy(null); }
  }
  async function apply() {
    setBusy("apply"); setNote(null);
    try {
      const r = await invoke<(NormalizeOp | ConsolidateOp)[]>(meta.applyCmd, { vault: vaultPath });
      setNote(`Applied ${r.length} ${r.length === 1 ? "change" : "changes"}. Originals were kept.`);
      setOps([]);
      window.dispatchEvent(new Event("prevail:domains-changed"));
    } catch (e) { setNote(`Apply failed: ${String(e)}`); } finally { setBusy(null); }
  }

  const count = ops?.length ?? 0;
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">{meta.title}</div>
          <p className="mt-0.5 text-xs text-text-muted">{meta.desc}</p>
        </div>
        <button
          onClick={plan}
          disabled={busy !== null}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-surface-warm disabled:opacity-50"
        >
          {busy === "plan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Preview
        </button>
      </div>
      {ops && count > 0 && (
        <div className="mt-3 rounded-md border border-accent-border bg-accent-soft p-3">
          <div className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">
            {count} {count === 1 ? "change" : "changes"} proposed
          </div>
          <ul className="max-h-40 space-y-0.5 overflow-auto">
            {ops.map((op, i) => (
              <li key={i} className="truncate font-mono text-[11px] text-text-secondary">{opLabel(kind, op)}</li>
            ))}
          </ul>
          <button
            onClick={apply}
            disabled={busy !== null}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            {busy === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Apply {count} {count === 1 ? "change" : "changes"}
          </button>
        </div>
      )}
      {note && <div className="mt-2 text-xs text-text-muted">{note}</div>}
    </div>
  );
}

export function VaultHygieneCard({ vaultPath }: { vaultPath: string }) {
  if (!vaultPath) return null;
  return (
    <div className="mb-7">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-text-secondary">
        <Sparkles className="h-3.5 w-3.5" /> Vault hygiene
      </div>
      <div className="space-y-2">
        <HygieneRow kind="normalize" vaultPath={vaultPath} />
        <HygieneRow kind="consolidate" vaultPath={vaultPath} />
      </div>
    </div>
  );
}
