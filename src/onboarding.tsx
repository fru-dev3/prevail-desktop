// O1 (Monday feedback): a first-run onboarding tour — a 5-6 step welcome that
// shows new users around, fully dismissible. Lightweight custom overlay (no tour
// library) to keep the premium, no-emoji design language. "Seen" persists in
// localStorage; re-runnable from About via the prevail:open-onboarding event.
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Boxes, Compass, Plug, Scale, Sigma, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { lsGet, lsSet } from "./storage";

const SEEN_KEY = "prevail.onboarding.seen";

type Step = { icon: LucideIcon; title: string; body: string };
const STEPS: Step[] = [
  { icon: Sparkles, title: "Welcome to Prevail", body: "Your private AI council, grounded in your real life. It learns you and gets sharper every time you use it. Here's the quick tour: 30 seconds." },
  { icon: Boxes, title: "Domains are your life, in folders", body: "Organize what matters into domains (Wealth, Health, Career…). Each keeps its own state, long-term memory, journal, and decisions, so answers stay grounded in that part of your life. General is for anything cross-cutting." },
  { icon: Scale, title: "A council, not a chatbot", body: "Ask every model at once. Each answers independently, then a chair reads them all and writes one verdict, flagging where they disagree. Pick the exact panel in Settings, Council." },
  { icon: Compass, title: "It compounds over time", body: "Your Ideal State sets the target. Omega distills what's learned across every domain. Intents surface the goal behind your questions, and Loops quietly work to close the gap. Everything feeds the next answer." },
  { icon: Plug, title: "Connect your apps", body: "Bring in real data: connect an app once and make it available to any domain (no duplicates). Reach Prevail from anywhere via the Gateway (Telegram) or the local WebUI under Connections." },
  { icon: Sigma, title: "You're set", body: "You're in the demo sandbox with sample data, safe to explore. Switch to your own vault from Settings, Workspace whenever you're ready. You can replay this tour anytime from About." },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(() => lsGet(SEEN_KEY) !== "1");
  const [i, setI] = useState(0);
  useEffect(() => {
    const reopen = () => { setI(0); setOpen(true); };
    window.addEventListener("prevail:open-onboarding", reopen);
    return () => window.removeEventListener("prevail:open-onboarding", reopen);
  }, []);
  if (!open) return null;
  const done = () => { lsSet(SEEN_KEY, "1"); setOpen(false); };
  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={done}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon className="h-5 w-5" /></span>
          <button onClick={done} title="Skip the tour" className="rounded p-1 text-text-muted hover:bg-surface-warm hover:text-text-primary"><X className="h-4 w-4" /></button>
        </div>
        <h2 className="mt-4 font-display text-xl font-bold tracking-tight text-text-primary">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.body}</p>
        <div className="mt-6 flex items-center gap-1.5">
          {STEPS.map((_, j) => (
            <span key={j} className={`h-1.5 rounded-full transition-all ${j === i ? "w-5 bg-accent" : "w-1.5 bg-border"}`} />
          ))}
          <div className="ml-auto flex items-center gap-2">
            {i > 0 && (
              <button onClick={() => setI((n) => n - 1)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm text-text-secondary hover:border-accent-border hover:text-accent">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            <button onClick={() => (last ? done() : setI((n) => n + 1))} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover">
              {last ? "Get started" : "Next"} {!last && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        {!last && <button onClick={done} className="mt-3 text-[11px] text-text-muted hover:text-text-secondary">Skip the tour</button>}
      </div>
    </div>
  );
}
