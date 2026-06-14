// Leaf UI components extracted from App.tsx.
import React, { useEffect, useRef, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { Lightbulb, LucideIcon, MessagesSquare, Monitor, Sparkles } from "lucide-react";
import { invoke, isBrowser } from "./bridge";

export function ResizeHandle({ onChange, ariaLabel }: { onChange: (deltaPx: number) => void; ariaLabel?: string }) {
  const lastX = useRef(0);
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      if (dx !== 0) onChange(dx);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return (
    <div
      onMouseDown={onDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className="group relative w-1 cursor-col-resize bg-transparent hover:bg-accent-border"
    >
      <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent-border/40" />
    </div>
  );
}

export function AppCard({ icon: Icon, label, children, action }: { icon: LucideIcon; label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{label}</span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  );
}

export function AppKV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-28 shrink-0 font-mono text-[11px] text-text-muted">{k}</span>
      <span className="min-w-0 flex-1 text-sm text-text-primary">{children}</span>
    </div>
  );
}

export function FloatingChip({
  chip,
  sx,
  sy,
  reduce,
}: {
  chip: { Icon: LucideIcon; t: string; x: string; y: string; d: number; depth: number };
  sx: ReturnType<typeof useSpring>;
  sy: ReturnType<typeof useSpring>;
  reduce: boolean;
}) {
  const tx = useTransform(sx, (v: number) => v * chip.depth);
  const ty = useTransform(sy, (v: number) => v * chip.depth);
  const { Icon } = chip;
  return (
    <motion.div className="absolute" style={{ left: chip.x, top: chip.y, x: reduce ? 0 : tx, y: reduce ? 0 : ty }}>
      <motion.div
        className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={reduce ? { opacity: 0.9, scale: 1 } : { opacity: 0.92, scale: 1, y: [0, -9, 0] }}
        transition={
          reduce
            ? { duration: 0.4, delay: 0.4 }
            : {
                opacity: { delay: 0.7 + chip.d * 0.15, duration: 0.6 },
                scale: { delay: 0.7 + chip.d * 0.15, duration: 0.6 },
                y: { duration: 4 + chip.d, repeat: Infinity, ease: "easeInOut", delay: chip.d },
              }
        }
      >
        <Icon className="h-3.5 w-3.5 text-accent" />
        {chip.t}
      </motion.div>
    </motion.div>
  );
}

export function CycleChip({
  label,
  value,
  active,
  title,
  onClick,
}: {
  label: string;
  value: string;
  active: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-accent-border bg-accent-soft text-accent"
          : "border-border bg-surface text-text-muted hover:bg-surface-warm"
      }`}
    >
      <span>{label}:</span>
      <span className="font-semibold">{value}</span>
    </button>
  );
}

export function DemoRibbon({ onSwitch }: { onSwitch: () => void }) {
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    const load = () =>
      invoke<{ mode: "demo" | "production" }>("engine_appmode_get")
        .then((m) => setIsDemo(m.mode === "demo"))
        .catch(() => {});
    load();
    window.addEventListener("prevail:appmode", load);
    return () => window.removeEventListener("prevail:appmode", load);
  }, []);
  if (!isDemo) return null;
  return (
    <div className="flex shrink-0 items-center justify-center gap-2.5 border-t border-accent-border bg-accent px-4 py-1.5 text-xs text-background">
      <Sparkles className="h-3.5 w-3.5 shrink-0" />
      <span className="font-mono font-bold uppercase tracking-[0.2em]">Demo Mode</span>
      <span className="opacity-90">You're exploring sample data</span>
      <button onClick={onSwitch} className="font-semibold underline underline-offset-2 hover:opacity-80">
        Set up my own vault →
      </button>
    </div>
  );
}

export function BridgeStatusChips() {
  const [tg, setTg] = useState(false);
  const [web, setWeb] = useState(false);
  useEffect(() => {
    if (isBrowser()) return; // these bridges are a desktop-host concern
    let alive = true;
    async function poll() {
      try { const t = await invoke<{ running: boolean }>("telegram_bridge_status"); if (alive) setTg(!!t.running); } catch { /* ignore */ }
      try { const w = await invoke<{ running: boolean }>("webui_status"); if (alive) setWeb(!!w.running); } catch { /* ignore */ }
    }
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  if (!tg && !web) return null;
  const Chip = ({ Icon, label, title }: { Icon: LucideIcon; label: string; title: string }) => (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/30 bg-emerald-900/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300"
    >
      <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
  return (
    <div className="pointer-events-none absolute bottom-1 left-2 z-20 flex items-center gap-1.5">
      {web && <Chip Icon={Monitor} label="WebUI" title="WebUI is live: reachable in your browser (Settings → Remote)" />}
      {tg && <Chip Icon={MessagesSquare} label="Telegram" title="Telegram bridge is live: messages route to your domains" />}
    </div>
  );
}

export function InsightsDisclosure({
  title, icon: Icon, count, meta, children,
}: { title: string; icon: typeof Lightbulb; count: number; meta?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <span className="text-accent">{open ? "▾" : "▸"}</span>
        <Icon className="h-3 w-3 text-text-muted" />
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">{title}</span>
        <span className="font-mono text-[10px] text-text-muted">· {count}</span>
        {meta && <span className="ml-auto font-mono text-[9px] text-text-muted">{meta}</span>}
      </button>
      {open && <div className="mt-2 border-l border-border-subtle/70 pl-4">{children}</div>}
    </div>
  );
}
