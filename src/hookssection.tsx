// Hooks (Editor → Connections). Phase 1 stub: the engine has no hook-management
// surface yet, so this is an honest placeholder that explains the concept and
// points at where hooks live today. Real create/edit/enable management lands in
// a later phase once the engine exposes it.
import { Webhook } from "lucide-react";
import { SettingsHeader } from "./sectionutil";

export function HooksSection() {
  return (
    <>
      <SettingsHeader
        title="Hooks"
        icon={Webhook}
        subtitle="Run your own commands at key moments — before/after a chat, when a loop fires, when a task changes. A place to view and manage hooks is coming; today they're configured in the engine."
      />
      <div className="max-w-2xl rounded-lg border border-dashed border-border bg-surface-warm p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Webhook className="h-4 w-4 text-accent" />
          Hook management is on the way
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          Hooks let Prevail trigger your scripts on system events. Managing them
          here — add, edit, enable/disable, and see their run history — is part of
          the redesign and will light up once the engine exposes hook controls.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
          Until then, hooks defined in the engine config still run as configured.
        </p>
      </div>
    </>
  );
}
