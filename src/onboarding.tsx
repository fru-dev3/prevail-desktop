// O1 (Monday feedback): a first-run onboarding tour — a welcome with the Prevail
// logo, then a real SPOTLIGHT walkthrough that highlights each section of the app
// (sidebar domains, composer, the Chat/Council/Benchmark tabs, settings). Fully
// dismissible. "Seen" persists in localStorage; re-runnable from About via the
// prevail:open-onboarding event. Lightweight custom overlay (no tour library) to
// keep the premium, no-emoji design language.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { PrevailLogo } from "./PrevailLogo";
import { lsGet, lsSet } from "./storage";

const SEEN_KEY = "prevail.onboarding.seen";

// Each step optionally anchors to a real element (data-tour="…"). When anchored,
// we spotlight that element and float the card beside it; otherwise the card is
// centered (welcome + finish).
type Step = { anchor?: string; eyebrow: string; title: string; body: string };
const STEPS: Step[] = [
  { eyebrow: "Welcome", title: "Welcome to Prevail", body: "Your private AI council, grounded in your real life. It learns you and gets sharper every time you use it. Quick tour — 30 seconds." },
  { anchor: "[data-tour=\"domains\"]", eyebrow: "Step 1", title: "Your life, in domains", body: "Wealth, Health, Career… each domain keeps its own state, memory, journal, and decisions, so answers stay grounded in that part of your life. General is for anything cross-cutting." },
  { anchor: "[data-tour=\"composer\"]", eyebrow: "Step 2", title: "Ask, with real context", body: "Type here to ask. Pull in context with $domain, attach skills with /, and Prevail grounds every answer in that domain's state and your Ideal State." },
  { anchor: "[data-tour=\"nav\"]", eyebrow: "Step 3", title: "Chat, Council, Benchmark", body: "Chat is one model. Council asks several at once and a chair writes one verdict. Benchmark scores models on your real questions, so you know who to trust where." },
  { anchor: "[data-tour=\"settings\"]", eyebrow: "Step 4", title: "Where it compounds", body: "In Settings: your Ideal State and Omega (what's learned across domains), Apps that feed real data, Gateways to reach Prevail from anywhere, and Loops that quietly close the gap to your goals." },
  { eyebrow: "Ready", title: "You're set", body: "You're in the demo sandbox with sample data — safe to explore. Switch to your own vault from Settings → Workspace whenever you're ready. Replay this tour anytime from About." },
];

const CARD_W = 380;
const GAP = 14; // space between the spotlight and the card

export function OnboardingTour() {
  const [open, setOpen] = useState(() => lsGet(SEEN_KEY) !== "1");
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reopen = () => { setI(0); setOpen(true); };
    window.addEventListener("prevail:open-onboarding", reopen);
    return () => window.removeEventListener("prevail:open-onboarding", reopen);
  }, []);

  const step = STEPS[i];

  // Measure the anchored element (and re-measure on resize/step change). If the
  // element isn't on screen, fall back to a centered card (rect = null).
  const measure = useCallback(() => {
    if (!step?.anchor) { setRect(null); return; }
    const el = document.querySelector(step.anchor) as HTMLElement | null;
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    const id = window.setTimeout(measure, 60); // settle after layout/HMR
    return () => { window.removeEventListener("resize", onResize); window.clearTimeout(id); };
  }, [open, i, measure]);

  if (!open) return null;
  const done = () => { lsSet(SEEN_KEY, "1"); setOpen(false); };
  const last = i === STEPS.length - 1;
  const first = i === 0;
  const anchored = !!step.anchor && !!rect;

  // Card placement: centered when not anchored; otherwise placed in the emptiest
  // region around the spotlight so it NEVER overlaps the highlighted element.
  // Pick the side (right/left/below/above) with the most free space that fits the
  // card, position it there, and clamp to the viewport.
  let cardStyle: React.CSSProperties = {};
  if (anchored && rect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const estH = Math.min(cardRef.current?.offsetHeight ?? 280, vh - 2 * GAP);
    const space = {
      right: vw - rect.right,
      left: rect.left,
      below: vh - rect.bottom,
      above: rect.top,
    };
    let left: number, top: number;
    const clampX = (x: number) => Math.max(GAP, Math.min(x, vw - CARD_W - GAP));
    const clampY = (y: number) => Math.max(GAP, Math.min(y, vh - estH - GAP));
    // Horizontal sides first (card beside the element, vertically aligned to it).
    if (space.right >= CARD_W + GAP && space.right >= space.left) {
      left = rect.right + GAP; top = clampY(rect.top);
    } else if (space.left >= CARD_W + GAP) {
      left = rect.left - CARD_W - GAP; top = clampY(rect.top);
    } else if (space.below >= space.above) {
      // Below: centered horizontally on the element, fully under it.
      top = rect.bottom + GAP; left = clampX(rect.left + rect.width / 2 - CARD_W / 2);
    } else {
      // Above: fully above the element (the common case for the bottom composer).
      top = rect.top - estH - GAP; left = clampX(rect.left + rect.width / 2 - CARD_W / 2);
    }
    cardStyle = { position: "fixed", left: clampX(left), top: Math.max(GAP, top), width: CARD_W };
  }

  const card = (
    <div
      ref={cardRef}
      style={anchored ? cardStyle : undefined}
      className={`z-[101] rounded-2xl border border-border bg-surface p-6 shadow-2xl ${anchored ? "" : "w-full max-w-md"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between">
        {first ? (
          <PrevailLogo size={48} />
        ) : (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">{step.eyebrow}</span>
        )}
        <button onClick={done} title="Skip the tour" className="-mr-1 -mt-1 rounded p-1 text-text-muted hover:bg-surface-warm hover:text-text-primary"><X className="h-4 w-4" /></button>
      </div>
      <h2 className="mt-3 font-display text-xl font-bold tracking-tight text-text-primary">{step.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.body}</p>
      <div className="mt-6 flex items-center gap-1.5">
        {STEPS.map((_, j) => (
          <span key={j} className={`h-1.5 rounded-full transition-all ${j === i ? "w-5 bg-accent" : "w-1.5 bg-border"}`} />
        ))}
        <div className="ml-auto flex items-center gap-2">
          {!first && (
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
  );

  // Anchored: a transparent overlay with a spotlight "hole" over the target
  // (box-shadow casts the dim everywhere else) + a highlight ring, then the card
  // floated beside it. Not anchored: a dimmed, centered modal.
  if (anchored && rect) {
    const pad = 6;
    return (
      <div className="fixed inset-0 z-[100]" onClick={done}>
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent transition-all"
          style={{
            left: rect.left - pad, top: rect.top - pad,
            width: rect.width + pad * 2, height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(8,10,14,0.55)",
          }}
        />
        {card}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4" onClick={done}>
      {card}
    </div>
  );
}
