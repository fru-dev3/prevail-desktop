import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  Check,
  Folder,
  Github,
  MessageSquare,
  Moon,
  Network,
  Scale,
  Send,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Terminal,
  Wrench,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────
// Types matching the Rust commands in src-tauri/src/lib.rs

interface Domain {
  name: string;
  path: string;
  has_state: boolean;
  state_preview: string | null;
}

interface CliInfo {
  id: string;
  label: string;
  bin: string;
  available: boolean;
}

interface BenchmarkRun {
  label: string;
  run_dir: string;
  judge_avg: number | null;
  keyword_avg: number | null;
  questions: number;
}

interface QuestionScore {
  id: string;
  domain: string;
  keyword_score: number | null;
  keyword_hits: string[];
  keyword_misses: string[];
  judge_score: number | null;
  judge_rationale: string | null;
}

interface RunDetail {
  records: Array<{
    id: string;
    prompt: string;
    reply: string;
    expected_decision?: string;
    expected_verdict_keywords?: string[];
    ms: number;
    cli?: string;
    model?: string;
    ok: boolean;
  }>;
  score: {
    label: string;
    runDir: string;
    questionScores: QuestionScore[];
    keyword_avg: number | null;
    judge_avg: number | null;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Frameworks + Lenses — kept in sync with the CLI's src/framework.ts
// and src/lens.ts. When the user picks one, the instruction gets
// prepended to every prompt as a bracketed preamble before the CLI
// is spawned.

interface Framework {
  id: string;
  label: string;
  blurb: string;
  instruction: string;
}
const FRAMEWORKS: Framework[] = [
  { id: "none", label: "OFF", blurb: "No framework — model's default response shape", instruction: "" },
  { id: "bluf", label: "BLUF", blurb: "Bottom Line Up Front — lead with the answer", instruction: "Apply the BLUF framework. Your first sentence MUST be the bottom line — the single most important conclusion or recommendation. Then provide supporting context in 1-3 short paragraphs. Never bury the conclusion under context." },
  { id: "win", label: "WIN", blurb: "What's Important Now — name the ONE next move", instruction: "Apply the WIN (What's Important Now) framework. Identify the ONE most important next move the user should make. State that move in the first sentence. Drop everything that doesn't directly serve that next step." },
  { id: "scqa", label: "SCQA", blurb: "Situation → Complication → Question → Answer", instruction: "Structure your response as SCQA: a one-line Situation, a one-line Complication, a one-line Question, then a decisive Answer." },
  { id: "sbar", label: "SBAR", blurb: "Situation · Background · Assessment · Recommendation", instruction: "Structure your response as SBAR: Situation, Background, Assessment, Recommendation. Each in 1-2 lines max." },
  { id: "ooda", label: "OODA", blurb: "Observe → Orient → Decide → Act", instruction: "Structure your response as an OODA loop: Observe, Orient, Decide, Act. Each step labelled and one line." },
  { id: "proscons", label: "PROS/CONS", blurb: "Structured trade-off with weight", instruction: "Structure your response as a PROS/CONS analysis. Two columns. End with a one-line Weight verdict naming the winner." },
  { id: "steelman", label: "STEELMAN", blurb: "Strongest version of the other side first", instruction: "Steelman the opposing position first — give it the strongest framing you can. Then give your verdict." },
];

interface Lens {
  id: string;
  label: string;
  blurb: string;
  instruction: string;
}
const LENSES: Lens[] = [
  { id: "none", label: "OFF", blurb: "No lens — single response, default angle", instruction: "" },
  { id: "first-principles", label: "FIRST PRINCIPLES", blurb: "Strip the problem to fundamentals", instruction: "Approach this problem from first principles. Forget conventional wisdom, prior advice, industry best practice, or what 'most people do.' Strip the problem to its fundamental mechanics and rebuild the answer from there." },
  { id: "outsider", label: "OUTSIDER", blurb: "Challenge the thinking; ignore prior context", instruction: "Approach this as a complete outsider with no prior context. Challenge every assumption that the question seems to bake in." },
  { id: "contrarian", label: "CONTRARIAN", blurb: "Argue the strongest case against the obvious answer", instruction: "Argue the strongest possible case against the obvious or expected answer. Don't be devil's advocate — actually pressure-test the consensus until something cracks." },
  { id: "expansionist", label: "EXPANSIONIST", blurb: "What's the bigger version of this question?", instruction: "Don't answer the question as asked. First ask: what's the bigger version of this question? Then answer THAT." },
  { id: "executor", label: "EXECUTOR", blurb: "Skip the framing — literal next step today", instruction: "Skip all framing. The user wants the literal next step they should take today. State the action in one imperative sentence, then list 2-3 concrete tasks." },
  { id: "alien", label: "ALIEN", blurb: "An outsider notices what's obvious to you", instruction: "You are an alien observer with no familiarity with this user's biases. State what is plainly obvious about their situation that they themselves are too close to see." },
  { id: "mom", label: "MOM", blurb: "Plain English — what would she actually do?", instruction: "Answer as a wise mom would — plain English, no jargon, sentimentally honest, practical. What would she actually tell her child to do?" },
  { id: "dad", label: "DAD", blurb: "Hard-nosed — what's the trap you're not seeing?", instruction: "Answer as a hard-nosed dad would — direct, no coddling. Name the trap the user is not seeing. Tell them what they will regret in 10 years if they get this wrong." },
];

// ─────────────────────────────────────────────────────────────────────
// Top-level tabs

type TabId = "chat" | "council" | "benchmark" | "tools" | "settings";
const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "council", label: "Council", icon: Scale },
  { id: "benchmark", label: "Benchmark", icon: Sparkles },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

// ─────────────────────────────────────────────────────────────────────
// localStorage keys + helpers

const LS = {
  vault: "prevail.desktop.vaultPath",
  theme: "prevail.desktop.theme",
  framework: "prevail.desktop.framework",
  lens: "prevail.desktop.lens",
  defaultChatCli: "prevail.desktop.defaultChatCli",
  defaultChairCli: "prevail.desktop.defaultChairCli",
  telegramToken: "prevail.desktop.telegramToken",
  telegramChatId: "prevail.desktop.telegramChatId",
  whatsappNumber: "prevail.desktop.whatsappNumber",
  mcpEnabled: "prevail.desktop.mcpEnabled",
} as const;

function lsGet(key: string, fallback: string = ""): string {
  return localStorage.getItem(key) ?? fallback;
}
function lsSet(key: string, value: string): void {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

// ─────────────────────────────────────────────────────────────────────
// Brand — official Prevail logo, byte-identical to the site

function PrevailLogo({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      alt="Prevail"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      Prev<span className="text-ai">ai</span>l
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Theme — light default, dark on toggle. Persists to localStorage.

type Theme = "light" | "dark";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = lsGet(LS.theme);
    return saved === "dark" ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    lsSet(LS.theme, theme);
  }, [theme]);
  return [theme, setThemeState];
}

// ─────────────────────────────────────────────────────────────────────
// Active framework + lens (shared between Chat and Council)

function useFrameworkLens() {
  const [framework, setFramework] = useState<string>(() => lsGet(LS.framework, "none"));
  const [lens, setLens] = useState<string>(() => lsGet(LS.lens, "none"));
  useEffect(() => { lsSet(LS.framework, framework); }, [framework]);
  useEffect(() => { lsSet(LS.lens, lens); }, [lens]);

  function buildPrompt(raw: string): string {
    const fw = FRAMEWORKS.find((f) => f.id === framework);
    const ln = LENSES.find((l) => l.id === lens);
    const parts: string[] = [];
    if (fw?.instruction) parts.push(`[FRAMEWORK]\n${fw.instruction}`);
    if (ln?.instruction) parts.push(`[LENS]\n${ln.instruction}`);
    parts.push(raw);
    return parts.join("\n\n");
  }

  return { framework, setFramework, lens, setLens, buildPrompt };
}

// ─────────────────────────────────────────────────────────────────────
// App root — vault picker, sidebar, tabs

export default function App() {
  const [theme, setTheme] = useTheme();
  const [vaultPath, setVaultPath] = useState<string | null>(() =>
    localStorage.getItem(LS.vault),
  );
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [tab, setTab] = useState<TabId>("chat");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const fwLens = useFrameworkLens();

  useEffect(() => {
    invoke<CliInfo[]>("detect_clis").then(setClis).catch(() => setClis([]));
  }, []);

  useEffect(() => {
    if (!vaultPath) return;
    invoke<Domain[]>("scan_vault", { path: vaultPath })
      .then((d) => {
        setDomains(d);
        setVaultError(null);
        if (d.length > 0 && !selectedDomain) setSelectedDomain(d[0].name);
      })
      .catch((e) => {
        setVaultError(String(e));
        setDomains([]);
      });
  }, [vaultPath]);

  async function pickVault() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setVaultPath(dir);
      lsSet(LS.vault, dir);
      setSelectedDomain(null);
    }
  }

  if (!vaultPath) return <VaultWizard onPick={pickVault} />;

  return (
    <div className="flex h-screen flex-col bg-background text-text-primary">
      {/* Title bar — official logo, brand, version, theme toggle */}
      <div
        className="titlebar-pad flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-surface pr-3 font-mono text-xs text-text-muted"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2.5" data-tauri-drag-region>
          <PrevailLogo size={22} />
          <Brand className="font-sans text-sm font-semibold text-text-primary" />
          <span>v0.2.0</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden truncate sm:inline" title={vaultPath}>{shortenPath(vaultPath)}</span>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex h-7 w-7 items-center justify-center rounded border border-border text-text-muted hover:bg-surface-warm hover:text-text-primary"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface">
          <div className="border-b border-border-subtle px-4 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
            <span className="text-accent">◆</span> domains · {domains.length}
          </div>
          <div className="flex-1 overflow-y-auto">
            {vaultError && (
              <div className="m-3 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">{vaultError}</div>
            )}
            {domains.length === 0 && !vaultError && (
              <div className="p-4 text-xs text-text-muted">
                no domains found. drop a <code className="text-accent">state.md</code> into any folder under this vault.
              </div>
            )}
            <ul>
              {domains.map((d) => (
                <li key={d.name}>
                  <button
                    onClick={() => setSelectedDomain(d.name)}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left font-mono text-sm transition-colors ${
                      d.name === selectedDomain
                        ? "bg-accent-soft text-accent"
                        : "text-text-secondary hover:bg-surface-warm"
                    }`}
                  >
                    <span>
                      <span className="mr-2 text-text-muted">{d.name === selectedDomain ? "▸" : "·"}</span>
                      {d.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <CliBadges clis={clis} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-background px-4">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative -mb-px flex items-center gap-2 px-4 py-3 text-sm transition-colors ${
                    active ? "text-accent" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                  {active && <span className="absolute bottom-0 left-0 right-0 h-px bg-accent" />}
                </button>
              );
            })}
            <div className="flex-1" />
            <a
              href="https://github.com/fru-dev3/prevail-desktop"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-accent"
            >
              <Github className="h-3.5 w-3.5" />
              github
            </a>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "chat" && <ChatPanel domain={selectedDomain} clis={clis} fwLens={fwLens} />}
            {tab === "council" && <CouncilPanel domain={selectedDomain} clis={clis} fwLens={fwLens} />}
            {tab === "benchmark" && <BenchmarkPanel vaultPath={vaultPath} />}
            {tab === "tools" && <ToolsPanel />}
            {tab === "settings" && (
              <SettingsPanel
                theme={theme}
                onThemeChange={setTheme}
                vaultPath={vaultPath}
                onChangeVault={pickVault}
                clis={clis}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function shortenPath(p: string): string {
  const home = "/Users/" + (p.split("/Users/")[1]?.split("/")[0] ?? "");
  if (p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

// ─────────────────────────────────────────────────────────────────────
// Vault wizard

function VaultWizard({ onPick }: { onPick: () => void }) {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center bg-background text-text-primary"
      data-tauri-drag-region
    >
      <div className="max-w-xl px-8 text-center">
        <div className="mb-6 flex justify-center">
          <PrevailLogo size={88} />
        </div>
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-accent">◆ first launch</div>
        <h1 className="mt-6 font-display text-5xl font-semibold tracking-tight">
          Welcome to <Brand />.
        </h1>
        <p className="mt-6 text-text-secondary">
          Pick a folder to use as your vault. Each child folder with a <code className="text-accent">state.md</code> file becomes a life domain.
        </p>
        <p className="mt-3 text-sm text-text-muted">
          New to <Brand />?{" "}
          <a
            href="https://github.com/fru-dev3/prevail/tree/main/vault-demo"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            grab the demo vault on GitHub
          </a>{" "}
          and point this at it.
        </p>
        <button
          onClick={onPick}
          className="mt-10 inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 font-medium text-background transition-all hover:bg-accent-hover hover:-translate-y-0.5"
        >
          <Folder className="h-4 w-4" /> Pick vault folder
        </button>
        <div className="mt-6 font-mono text-xs text-text-muted">v0.2.0 · vault stays local · no cloud</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CLI badges in sidebar footer

function CliBadges({ clis }: { clis: CliInfo[] }) {
  if (clis.length === 0) {
    return (
      <div className="border-t border-border-subtle px-4 py-3 font-mono text-[10px] text-text-muted">
        detecting CLIs…
      </div>
    );
  }
  return (
    <div className="border-t border-border-subtle px-4 py-3 font-mono text-[10px]">
      <div className="mb-1.5 uppercase tracking-[0.2em] text-text-muted">
        <span className="text-accent">◇</span> CLIs
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {clis.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <span className={c.available ? "text-ok" : "text-text-muted"}>{c.available ? "✓" : "·"}</span>
            <span className={c.available ? "text-text-secondary" : "text-text-muted"}>{c.label.toLowerCase()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FRAMEWORK + LENS CHIPS — shared above both Chat and Council composers

function FwLensRow({
  fwLens,
}: {
  fwLens: ReturnType<typeof useFrameworkLens>;
}) {
  const fw = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const ln = LENSES.find((l) => l.id === fwLens.lens);
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">defaults</span>

      <CycleChip
        label="◆ Framework"
        value={fw?.label ?? "OFF"}
        active={fwLens.framework !== "none"}
        title={fw?.blurb ?? ""}
        onClick={() => {
          const idx = FRAMEWORKS.findIndex((f) => f.id === fwLens.framework);
          fwLens.setFramework(FRAMEWORKS[(idx + 1) % FRAMEWORKS.length].id);
        }}
      />
      <CycleChip
        label="◇ Lens"
        value={ln?.label ?? "OFF"}
        active={fwLens.lens !== "none"}
        title={ln?.blurb ?? ""}
        onClick={() => {
          const idx = LENSES.findIndex((l) => l.id === fwLens.lens);
          fwLens.setLens(LENSES[(idx + 1) % LENSES.length].id);
        }}
      />
      <span className="ml-auto text-[10px] text-text-muted">
        click chips to cycle · these prepend to every prompt
      </span>
    </div>
  );
}

function CycleChip({
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

// ─────────────────────────────────────────────────────────────────────
// CHAT PANEL

interface ChatMessage {
  role: "user" | "assistant";
  cli?: string;
  content: string;
  ts: number;
  streaming?: boolean;
}

function ChatPanel({
  domain,
  clis,
  fwLens,
}: {
  domain: string | null;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
}) {
  const available = useMemo(() => clis.filter((c) => c.available), [clis]);
  const [selectedCli, setSelectedCli] = useState<string | null>(() => {
    const saved = lsGet(LS.defaultChatCli);
    return saved || null;
  });
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const sessionRef = useRef(`s-${Date.now()}`);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedCli && available.length > 0) setSelectedCli(available[0].id);
  }, [available, selectedCli]);

  useEffect(() => {
    if (selectedCli) lsSet(LS.defaultChatCli, selectedCli);
  }, [selectedCli]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{ session: string; cli: string; stream: string; data: string }>(
        "chat:chunk",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (e.payload.stream !== "stdout") return;
          if (!mounted) return;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) {
              return [...m.slice(0, -1), { ...last, content: last.content + e.payload.data }];
            }
            return m;
          });
        },
      );
      const u2 = await listen<{ session: string; cli: string; code: number }>(
        "chat:done",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) return [...m.slice(0, -1), { ...last, streaming: false }];
            return m;
          });
        },
      );
      unlistenRefs.current = [u1, u2];
    })();
    return () => {
      mounted = false;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    if (!input.trim() || !selectedCli) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim(), ts: Date.now() };
    const replyMsg: ChatMessage = { role: "assistant", cli: selectedCli, content: "", ts: Date.now(), streaming: true };
    setMessages((m) => [...m, userMsg, replyMsg]);
    const promptText = fwLens.buildPrompt(input.trim());
    setInput("");
    sessionRef.current = `s-${Date.now()}`;
    try {
      await invoke("chat_send", {
        args: { cli: selectedCli, prompt: promptText, session_id: sessionRef.current },
      });
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `(error spawning ${selectedCli}: ${e})`, ts: Date.now() }]);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b border-border-subtle px-6 py-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
            chat with one model
          </div>
          {domain && (
            <div className="mt-1 font-display text-lg font-semibold">
              <span className="text-accent">◆</span> {domain}
            </div>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1 font-mono text-xs">
          {available.length === 0 && <span className="px-3 py-1.5 text-warn">no CLIs detected</span>}
          {available.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCli(c.id)}
              className={`rounded px-3 py-1.5 transition-colors ${
                selectedCli === c.id ? "bg-accent text-background" : "text-text-secondary hover:bg-surface-warm"
              }`}
            >
              {c.label.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <div className="mx-auto mt-16 max-w-md text-center text-text-muted">
            <Terminal className="mx-auto h-8 w-8 text-text-muted opacity-50" />
            <p className="mt-4 text-sm">
              Ask <Brand /> anything for {domain ? <code className="text-accent">{domain}</code> : "the selected domain"}.
              The reply streams from <code className="text-accent">{selectedCli ?? "the selected CLI"}</code>.
            </p>
            <p className="mt-3 text-xs">
              Pick a <span className="text-accent">◆ Framework</span> + <span className="text-accent">◇ Lens</span> below to shape every reply.
            </p>
          </div>
        )}
        {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
      </div>

      <div className="shrink-0 border-t border-border-subtle bg-surface px-6 py-4">
        <FwLensRow fwLens={fwLens} />
        <div className="flex items-end gap-3 rounded-lg border border-border bg-background p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="ask anything · cmd+enter to send"
            rows={2}
            className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <button
            onClick={send}
            disabled={!input.trim() || !selectedCli}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-all hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
          >
            send <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="mb-6 flex justify-end">
        <div className="max-w-2xl rounded-lg border border-border bg-surface px-4 py-3 text-sm">{msg.content}</div>
      </div>
    );
  }
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 font-mono text-xs text-text-muted">
        <span className="text-accent">◇</span>
        <span className="text-accent">{msg.cli ?? "assistant"}</span>
        {msg.streaming && <span className="pulse-soft text-accent">· streaming</span>}
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
        {msg.content || (msg.streaming ? "…" : "(empty reply)")}
        {msg.streaming && <span className="cursor-blink text-accent">▌</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// COUNCIL PANEL

interface PanelistReply {
  cli: string;
  content: string;
  streaming: boolean;
  startedAt: number;
}

function CouncilPanel({
  domain,
  clis,
  fwLens,
}: {
  domain: string | null;
  clis: CliInfo[];
  fwLens: ReturnType<typeof useFrameworkLens>;
}) {
  const available = useMemo(() => clis.filter((c) => c.available), [clis]);
  const [chairCli, setChairCli] = useState<string | null>(() => lsGet(LS.defaultChairCli) || null);
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<"idle" | "panelists" | "synthesizing" | "done">("idle");
  const [replies, setReplies] = useState<Record<string, PanelistReply>>({});
  const [verdict, setVerdict] = useState<string>("");
  const sessionRef = useRef<string>("");
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    if (!chairCli && available.length > 0) setChairCli(available[0].id);
  }, [available, chairCli]);

  useEffect(() => {
    if (chairCli) lsSet(LS.defaultChairCli, chairCli);
  }, [chairCli]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{ session: string; cli: string; stream: string; data: string }>(
        "chat:chunk",
        (e) => {
          if (!mounted) return;
          if (!e.payload.session.startsWith(sessionRef.current)) return;
          if (e.payload.stream !== "stdout") return;
          if (e.payload.session.endsWith(":chair")) {
            setVerdict((v) => v + e.payload.data);
            return;
          }
          setReplies((r) => {
            const existing = r[e.payload.cli] ?? { cli: e.payload.cli, content: "", streaming: true, startedAt: Date.now() };
            return { ...r, [e.payload.cli]: { ...existing, content: existing.content + e.payload.data } };
          });
        },
      );
      const u2 = await listen<{ session: string; cli: string; code: number }>(
        "chat:done",
        (e) => {
          if (!mounted) return;
          if (!e.payload.session.startsWith(sessionRef.current)) return;
          if (e.payload.session.endsWith(":chair")) {
            setPhase("done");
            return;
          }
          setReplies((r) => {
            const existing = r[e.payload.cli];
            if (!existing) return r;
            return { ...r, [e.payload.cli]: { ...existing, streaming: false } };
          });
        },
      );
      unlistenRefs.current = [u1, u2];
    })();
    return () => {
      mounted = false;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, []);

  const allPanelistsDone = useMemo(
    () => available.length > 0 && available.every((c) => replies[c.id] && !replies[c.id].streaming),
    [available, replies],
  );

  const triggerChair = useCallback(async () => {
    if (!chairCli) return;
    const synthesisPrompt = buildSynthesisPrompt(prompt, replies, available);
    setPhase("synthesizing");
    try {
      await invoke("chat_send", {
        args: { cli: chairCli, prompt: synthesisPrompt, session_id: `${sessionRef.current}:chair` },
      });
    } catch (e) {
      setVerdict(`(chair error: ${e})`);
      setPhase("done");
    }
  }, [chairCli, prompt, replies, available]);

  useEffect(() => {
    if (phase === "panelists" && allPanelistsDone) triggerChair();
  }, [phase, allPanelistsDone, triggerChair]);

  async function convene() {
    if (!prompt.trim() || available.length === 0) return;
    sessionRef.current = `council-${Date.now()}`;
    setReplies({});
    setVerdict("");
    setPhase("panelists");
    const enrichedPrompt = fwLens.buildPrompt(prompt.trim());
    for (const c of available) {
      try {
        await invoke("chat_send", {
          args: { cli: c.id, prompt: enrichedPrompt, session_id: `${sessionRef.current}:${c.id}` },
        });
      } catch (e) {
        setReplies((r) => ({
          ...r,
          [c.id]: { cli: c.id, content: `(error spawning: ${e})`, streaming: false, startedAt: Date.now() },
        }));
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b border-border-subtle px-6 py-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
            ⚖ council — {available.length} panelist{available.length === 1 ? "" : "s"} ready
          </div>
          {domain && (
            <div className="mt-1 font-display text-lg font-semibold">
              <span className="text-accent">◆</span> {domain}
            </div>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">chair:</span>
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1 font-mono">
            {available.map((c) => (
              <button
                key={c.id}
                onClick={() => setChairCli(c.id)}
                className={`rounded px-2.5 py-1 transition-colors ${
                  chairCli === c.id ? "bg-accent text-background" : "text-text-secondary hover:bg-surface-warm"
                }`}
              >
                {c.label.toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {phase === "idle" && (
          <div className="mx-auto max-w-2xl text-center text-text-muted">
            <Scale className="mx-auto h-8 w-8 opacity-50" />
            <p className="mt-4">
              Type a question below and convene the council. Every available CLI will answer in parallel, then{" "}
              <code className="text-accent">{chairCli ?? "the chair"}</code> synthesizes the verdict.
            </p>
          </div>
        )}

        {phase !== "idle" && (
          <>
            <div className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm">
              <span className="text-accent">$</span> {prompt}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {available.map((c) => {
                const r = replies[c.id];
                return (
                  <div key={c.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                    <div className="flex items-center justify-between border-b border-border-subtle bg-surface-warm px-4 py-2 font-mono text-xs">
                      <span>
                        <span className="text-accent">◇</span> {c.label.toLowerCase()}
                      </span>
                      <span className="text-text-muted">
                        {!r && "queued"}
                        {r?.streaming && <span className="pulse-soft text-accent">streaming</span>}
                        {r && !r.streaming && <span className="text-ok">✓ done</span>}
                      </span>
                    </div>
                    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm text-text-primary">
                      {r?.content || <span className="text-text-muted">…</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {(phase === "synthesizing" || phase === "done") && (
              <div className="mt-8 rounded-lg border border-accent-border bg-accent-soft p-6">
                <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-accent">
                  <span>◆</span>
                  <span>verdict · synthesized by {chairCli}</span>
                  {phase === "synthesizing" && <span className="pulse-soft">streaming</span>}
                </div>
                <div className="mt-3 whitespace-pre-wrap text-text-primary">
                  {verdict || "(awaiting chair)"}
                  {phase === "synthesizing" && <span className="cursor-blink text-accent">▌</span>}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border-subtle bg-surface px-6 py-4">
        <FwLensRow fwLens={fwLens} />
        <div className="flex items-end gap-3 rounded-lg border border-border bg-background p-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                convene();
              }
            }}
            placeholder="ask the council · cmd+enter to convene"
            rows={2}
            disabled={phase === "panelists" || phase === "synthesizing"}
            className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={convene}
            disabled={!prompt.trim() || available.length === 0 || phase === "panelists" || phase === "synthesizing"}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-all hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
          >
            <Scale className="h-3.5 w-3.5" />
            convene
          </button>
        </div>
      </div>
    </div>
  );
}

function buildSynthesisPrompt(
  question: string,
  replies: Record<string, PanelistReply>,
  panelists: CliInfo[],
): string {
  const parts: string[] = [
    "You are the chair of a council. The following AI models were each asked the same question. Synthesize a single decisive verdict that captures the consensus, names the key points of disagreement, and recommends a concrete action.",
    "",
    "QUESTION:",
    question,
    "",
    "PANELIST REPLIES:",
  ];
  for (const c of panelists) {
    const r = replies[c.id];
    if (!r) continue;
    parts.push("");
    parts.push(`--- ${c.label} ---`);
    parts.push(r.content.trim());
  }
  parts.push("");
  parts.push("WRITE: A 3-paragraph verdict. Paragraph 1: consensus + what to do. Paragraph 2: where panelists disagreed and which framing wins. Paragraph 3: one concrete next action.");
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// BENCHMARK PANEL — leaderboard + drill-down

function BenchmarkPanel({ vaultPath }: { vaultPath: string }) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<BenchmarkRun[]>("benchmark_runs", { vault: vaultPath })
      .then((r) => {
        setRuns(r);
        setErr(null);
      })
      .catch((e) => setErr(String(e)));
  }, [vaultPath]);

  async function loadRun(runDir: string) {
    setLoadingDetail(true);
    setExpandedQ(null);
    try {
      const detail = await invoke<RunDetail>("benchmark_run_detail", { runDir });
      setSelected(detail);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex w-96 shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="border-b border-border-subtle px-4 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
          <span className="text-accent">◈</span> leaderboard · {runs.length} run{runs.length === 1 ? "" : "s"}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {err && <div className="m-2 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">{err}</div>}
          {runs.length === 0 && !err && (
            <div className="p-4 text-xs text-text-muted">
              No scored runs in <code className="text-accent">{vaultPath}/benchmark/runs/</code>. Run a benchmark from the CLI to populate this view.
            </div>
          )}
          {runs.map((r) => {
            const active = selected?.score.runDir === r.run_dir;
            return (
              <button
                key={r.label}
                onClick={() => loadRun(r.run_dir)}
                className={`mb-1 flex w-full items-center justify-between rounded px-3 py-2 text-left font-mono text-xs transition-colors ${
                  active ? "bg-accent-soft" : "hover:bg-surface-warm"
                }`}
              >
                <span className="truncate">
                  <span className={active ? "text-accent" : "text-text-muted"}>{active ? "▸" : " "}</span> {r.label}
                </span>
                <span className="ml-2 shrink-0">
                  <span className="text-accent">{r.judge_avg !== null ? r.judge_avg.toFixed(1) : "—"}</span>
                  <span className="ml-2 text-text-muted">{r.keyword_avg !== null ? Math.round(r.keyword_avg) + "%" : "—"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selected && !loadingDetail && (
          <div className="flex h-full items-center justify-center text-text-muted">
            <div className="text-center">
              <Sparkles className="mx-auto h-8 w-8 opacity-50" />
              <p className="mt-4 text-sm">Pick a run on the left to drill in.</p>
            </div>
          </div>
        )}
        {loadingDetail && <div className="p-6 text-sm text-text-muted">loading run…</div>}
        {selected && !loadingDetail && (
          <div className="px-6 py-6">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">run</div>
            <h2 className="mt-2 font-display text-2xl font-semibold">{selected.score.label}</h2>
            <div className="mt-3 flex gap-6 font-mono text-sm">
              <div>
                <span className="text-text-muted">judge: </span>
                <span className="text-accent">{selected.score.judge_avg !== null ? selected.score.judge_avg.toFixed(1) : "—"}</span>
                <span className="text-text-muted"> / 10</span>
              </div>
              <div>
                <span className="text-text-muted">keyword: </span>
                <span className="text-text-primary">{selected.score.keyword_avg !== null ? Math.round(selected.score.keyword_avg) + "%" : "—"}</span>
              </div>
              <div>
                <span className="text-text-muted">questions: </span>
                <span className="text-text-primary">{selected.score.questionScores.length}</span>
              </div>
            </div>

            <div className="mt-8 space-y-2">
              {selected.score.questionScores.map((q) => {
                const expanded = expandedQ === q.id;
                const record = selected.records.find((r) => r.id === q.id);
                return (
                  <div key={q.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                    <button
                      onClick={() => setExpandedQ(expanded ? null : q.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm"
                    >
                      <span className="flex items-center gap-3 font-mono text-sm">
                        <span className="text-text-muted">{expanded ? "▾" : "▸"}</span>
                        <span className="text-text-primary">{q.id}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                        <span className="text-text-muted">{q.keyword_score !== null ? Math.round(q.keyword_score) + "%" : "—"}</span>
                        <span className="text-accent">{q.judge_score !== null ? q.judge_score : "—"}/10</span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="space-y-3 border-t border-border-subtle px-6 py-4 text-sm">
                        <div>
                          <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">question</div>
                          <div className="whitespace-pre-wrap text-text-primary">{record?.prompt ?? "(prompt not in records)"}</div>
                        </div>
                        {record?.expected_decision && (
                          <div>
                            <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">expected decision</div>
                            <div className="whitespace-pre-wrap text-ok">{record.expected_decision}</div>
                          </div>
                        )}
                        <div>
                          <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">model said</div>
                          <div className="whitespace-pre-wrap text-text-primary">{record?.reply ?? "(no reply)"}</div>
                        </div>
                        <div className="flex gap-6 font-mono text-xs">
                          <div>
                            <span className="text-ok">✓ hit: </span>
                            <span className="text-text-secondary">{q.keyword_hits.join(", ") || "(none)"}</span>
                          </div>
                          <div>
                            <span className="text-warn">✗ miss: </span>
                            <span className="text-text-secondary">{q.keyword_misses.join(", ") || "(none)"}</span>
                          </div>
                        </div>
                        {q.judge_rationale && (
                          <div>
                            <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">judge rationale ({q.judge_score}/10)</div>
                            <div className="whitespace-pre-wrap text-text-secondary">{q.judge_rationale}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SETTINGS PANEL — vault, theme, defaults, about

function SettingsPanel({
  theme,
  onThemeChange,
  vaultPath,
  onChangeVault,
  clis,
}: {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  vaultPath: string;
  onChangeVault: () => void;
  clis: CliInfo[];
}) {
  return (
    <div className="px-6 py-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-text-secondary">
        Configure <Brand />. Everything is stored locally in this app's preferences — your vault stays untouched.
      </p>

      <SettingsSection title="Vault" subtitle="Where Prevail reads + writes your domain folders.">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-text-muted">current path</div>
            <div className="mt-1 truncate font-mono text-sm text-text-primary" title={vaultPath}>
              {vaultPath}
            </div>
          </div>
          <button
            onClick={onChangeVault}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-warm"
          >
            <Folder className="h-3.5 w-3.5" />
            Change
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="Appearance" subtitle="Light is the default. Toggle dark if you prefer.">
        <div className="flex gap-2">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onThemeChange(t)}
              className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors ${
                theme === t ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-surface text-text-secondary hover:bg-surface-warm"
              }`}
            >
              {t === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Defaults" subtitle="Pre-select the model + reasoning shape Prevail uses across new chats and councils.">
        <DefaultsForm clis={clis} />
      </SettingsSection>

      <SettingsSection title="About">
        <div className="space-y-1 rounded-lg border border-border bg-surface p-4 font-mono text-xs text-text-secondary">
          <div><span className="text-text-muted">version</span> · 0.2.0</div>
          <div><span className="text-text-muted">build</span>  · Tauri 2 · React 19 · Tailwind 4</div>
          <div className="flex gap-3 pt-2">
            <a href="https://github.com/fru-dev3/prevail-desktop" target="_blank" rel="noreferrer" className="text-accent hover:underline">desktop repo</a>
            <a href="https://github.com/fru-dev3/prevail" target="_blank" rel="noreferrer" className="text-accent hover:underline">cli repo</a>
            <a href="https://prevail.sh" target="_blank" rel="noreferrer" className="text-accent hover:underline">prevail.sh</a>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

function SettingsSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DefaultsForm({ clis }: { clis: CliInfo[] }) {
  const fwLens = useFrameworkLens();
  const [defaultChatCli, setDefaultChatCli] = useState(lsGet(LS.defaultChatCli));
  const [defaultChairCli, setDefaultChairCli] = useState(lsGet(LS.defaultChairCli));

  useEffect(() => { lsSet(LS.defaultChatCli, defaultChatCli); }, [defaultChatCli]);
  useEffect(() => { lsSet(LS.defaultChairCli, defaultChairCli); }, [defaultChairCli]);

  const fw = FRAMEWORKS.find((f) => f.id === fwLens.framework);
  const ln = LENSES.find((l) => l.id === fwLens.lens);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs uppercase tracking-wider text-text-muted">default chat CLI</div>
        <select
          value={defaultChatCli}
          onChange={(e) => setDefaultChatCli(e.target.value)}
          className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">first available</option>
          {clis.map((c) => (
            <option key={c.id} value={c.id} disabled={!c.available}>
              {c.label} {!c.available && "(not installed)"}
            </option>
          ))}
        </select>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs uppercase tracking-wider text-text-muted">default council chair</div>
        <select
          value={defaultChairCli}
          onChange={(e) => setDefaultChairCli(e.target.value)}
          className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">first available</option>
          {clis.map((c) => (
            <option key={c.id} value={c.id} disabled={!c.available}>
              {c.label} {!c.available && "(not installed)"}
            </option>
          ))}
        </select>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs uppercase tracking-wider text-text-muted">default framework</div>
        <select
          value={fwLens.framework}
          onChange={(e) => fwLens.setFramework(e.target.value)}
          className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm"
        >
          {FRAMEWORKS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <p className="mt-2 text-xs text-text-muted">{fw?.blurb}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs uppercase tracking-wider text-text-muted">default lens</div>
        <select
          value={fwLens.lens}
          onChange={(e) => fwLens.setLens(e.target.value)}
          className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm"
        >
          {LENSES.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <p className="mt-2 text-xs text-text-muted">{ln?.blurb}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TOOLS PANEL — Telegram, WhatsApp, MCP server

function ToolsPanel() {
  return (
    <div className="px-6 py-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Tools</h1>
      <p className="mt-2 text-text-secondary">
        Integrations and gateways. Your vault stays local; these let you reach it from elsewhere or push verdicts out.
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <TelegramCard />
        <WhatsAppCard />
        <McpCard />
        <BriefingsCard />
      </div>
    </div>
  );
}

function TelegramCard() {
  const [token, setToken] = useState(lsGet(LS.telegramToken));
  const [chatId, setChatId] = useState(lsGet(LS.telegramChatId));
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" });

  useEffect(() => { lsSet(LS.telegramToken, token); }, [token]);
  useEffect(() => { lsSet(LS.telegramChatId, chatId); }, [chatId]);

  async function testSend() {
    if (!token || !chatId) {
      setStatus({ kind: "err", msg: "fill in token + chat ID first" });
      return;
    }
    setStatus({ kind: "idle", msg: "sending…" });
    try {
      const r = await invoke<{ ok: boolean; description?: string }>("telegram_send", {
        token, chatId, text: "◆ Prevail desktop · test message ✓",
      });
      if (r.ok) {
        setStatus({ kind: "ok", msg: "delivered ✓" });
      } else {
        setStatus({ kind: "err", msg: r.description ?? "send failed" });
      }
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#229ED9]/15 text-[#229ED9]">
          <Send className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">Telegram bridge</h3>
          <p className="text-xs text-text-muted">Push verdicts + briefings to a Telegram chat via a bot.</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-text-muted">Bot token</div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABC-XYZ…"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </label>
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-text-muted">Chat ID</div>
          <input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-1001234567890"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </label>
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={testSend}
            disabled={!token || !chatId}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-hover disabled:bg-surface-strong disabled:text-text-muted"
          >
            <Send className="h-3.5 w-3.5" />
            Send test message
          </button>
          {status.kind === "ok" && (
            <span className="text-xs text-ok"><Check className="mr-1 inline h-3 w-3" />{status.msg}</span>
          )}
          {status.kind === "err" && (
            <span className="text-xs text-warn">{status.msg}</span>
          )}
        </div>
        <p className="text-xs text-text-muted">
          New to Telegram bots?{" "}
          <a href="https://core.telegram.org/bots/features#botfather" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Create one via @BotFather
          </a>, then add it to your chat and use{" "}
          <a href="https://api.telegram.org/bot{TOKEN}/getUpdates" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            getUpdates
          </a>{" "}
          to find your chat ID.
        </p>
      </div>
    </div>
  );
}

function WhatsAppCard() {
  const [number, setNumber] = useState(lsGet(LS.whatsappNumber));
  useEffect(() => { lsSet(LS.whatsappNumber, number); }, [number]);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#25D366]/15 text-[#25D366]">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">
            WhatsApp <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">soon</span>
          </h3>
          <p className="text-xs text-text-muted">Same idea as Telegram, via WhatsApp Cloud API. Setup pending Meta business approval.</p>
        </div>
      </div>
      <div className="mt-4">
        <label className="block">
          <div className="text-xs uppercase tracking-wider text-text-muted">Your number (E.164)</div>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+14155552671"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            spellCheck={false}
          />
        </label>
        <p className="mt-3 text-xs text-text-muted">
          We'll email you when WhatsApp Cloud API hookup ships. Until then, this is just stored locally for when it's ready.
        </p>
      </div>
    </div>
  );
}

function McpCard() {
  const [enabled, setEnabled] = useState(lsGet(LS.mcpEnabled) === "1");
  useEffect(() => { lsSet(LS.mcpEnabled, enabled ? "1" : ""); }, [enabled]);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ai/15 text-ai">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">
            MCP server <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">preview</span>
          </h3>
          <p className="text-xs text-text-muted">Expose your vault to Claude Desktop or any MCP client over localhost.</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-background p-3">
        <div>
          <div className="text-sm">MCP server</div>
          <div className="text-xs text-text-muted">
            {enabled ? "Listening on localhost:7842" : "Off"}
          </div>
        </div>
        <button
          onClick={() => setEnabled((e) => !e)}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            enabled ? "bg-accent" : "bg-surface-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      <p className="mt-3 text-xs text-text-muted">
        For full MCP coverage right now, run the <Brand /> CLI's <code className="text-accent">mcp-server</code> command — it ships read-only by default and is parent-process verified.
      </p>
    </div>
  );
}

function BriefingsCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold">
            Briefings <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-warn">soon</span>
          </h3>
          <p className="text-xs text-text-muted">Scheduled morning + evening briefings across your domains, optionally pushed via Telegram.</p>
        </div>
      </div>
      <p className="mt-4 text-xs text-text-muted">
        Briefings on the desktop will reuse the CLI's <code className="text-accent">briefings</code> module — same prompt set, same rendering. Wiring coming in v0.3.
      </p>
    </div>
  );
}
