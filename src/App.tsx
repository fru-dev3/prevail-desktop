import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  Folder,
  Github,
  MessageSquare,
  Scale,
  Sparkles,
  Terminal,
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

type TabId = "chat" | "council" | "benchmark";
const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "council", label: "Council", icon: Scale },
  { id: "benchmark", label: "Benchmark", icon: Sparkles },
];

const LS_VAULT = "prevail.desktop.vaultPath";

function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      Prev<span className="text-ai">ai</span>l
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Root

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(() =>
    localStorage.getItem(LS_VAULT),
  );
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [tab, setTab] = useState<TabId>("chat");
  const [vaultError, setVaultError] = useState<string | null>(null);

  useEffect(() => {
    invoke<CliInfo[]>("detect_clis").then(setClis).catch(() => setClis([]));
  }, []);

  useEffect(() => {
    if (!vaultPath) return;
    invoke<Domain[]>("scan_vault", { path: vaultPath })
      .then((d) => {
        setDomains(d);
        setVaultError(null);
        if (d.length > 0 && !selectedDomain) {
          setSelectedDomain(d[0].name);
        }
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
      localStorage.setItem(LS_VAULT, dir);
      setSelectedDomain(null);
    }
  }

  if (!vaultPath) {
    return <VaultWizard onPick={pickVault} />;
  }

  return (
    <div className="flex h-screen flex-col bg-background text-text-primary">
      <div
        className="titlebar-pad flex h-11 shrink-0 items-center justify-between border-b border-border-subtle bg-background pr-4 font-mono text-xs text-text-muted"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3" data-tauri-drag-region>
          <span className="text-accent">◈</span>
          <Brand className="text-text-primary" />
          <span>v0.1.0</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="truncate">{vaultPath}</span>
          <button
            onClick={pickVault}
            className="rounded border border-border px-2 py-0.5 text-text-muted hover:border-accent-border hover:text-accent"
          >
            change vault
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border-subtle bg-surface">
          <div className="border-b border-border-subtle px-4 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
            <span className="text-accent">◆</span> domains · {domains.length}
          </div>
          <div className="flex-1 overflow-y-auto">
            {vaultError && (
              <div className="m-3 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
                {vaultError}
              </div>
            )}
            {domains.length === 0 && !vaultError && (
              <div className="p-4 text-xs text-text-muted">
                no domains found. domains are folders containing a{" "}
                <code className="text-accent">state.md</code> file.
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
                      <span className="mr-2 text-text-muted">
                        {d.name === selectedDomain ? "▸" : "·"}
                      </span>
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
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-px bg-accent" />
                  )}
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
            {tab === "chat" && <ChatPanel domain={selectedDomain} clis={clis} />}
            {tab === "council" && <CouncilPanel domain={selectedDomain} clis={clis} />}
            {tab === "benchmark" && <BenchmarkPanel vaultPath={vaultPath} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function VaultWizard({ onPick }: { onPick: () => void }) {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center bg-background text-text-primary"
      data-tauri-drag-region
    >
      <div className="max-w-xl px-8 text-center">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          ◆ first launch
        </div>
        <h1 className="mt-6 font-display text-5xl font-bold tracking-tight">
          Welcome to <Brand />.
        </h1>
        <p className="mt-6 text-text-secondary">
          Pick a folder to use as your vault. Each direct child folder with a{" "}
          <code className="text-accent">state.md</code> file becomes a life domain.
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
        <div className="mt-6 font-mono text-xs text-text-muted">
          v0.1.0 · vault stays local · no cloud
        </div>
      </div>
    </div>
  );
}

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
            <span className={c.available ? "text-ok" : "text-text-muted"}>
              {c.available ? "✓" : "·"}
            </span>
            <span className={c.available ? "text-text-secondary" : "text-text-muted"}>
              {c.label.toLowerCase()}
            </span>
          </span>
        ))}
      </div>
    </div>
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

function ChatPanel({ domain, clis }: { domain: string | null; clis: CliInfo[] }) {
  const available = useMemo(() => clis.filter((c) => c.available), [clis]);
  const [selectedCli, setSelectedCli] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const sessionRef = useRef(`s-${Date.now()}`);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedCli && available.length > 0) {
      setSelectedCli(available[0].id);
    }
  }, [available, selectedCli]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{
        session: string;
        cli: string;
        stream: string;
        data: string;
      }>("chat:chunk", (e) => {
        if (e.payload.session !== sessionRef.current) return;
        if (e.payload.stream !== "stdout") return;
        if (!mounted) return;
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last && last.streaming) {
            return [
              ...m.slice(0, -1),
              { ...last, content: last.content + e.payload.data },
            ];
          }
          return m;
        });
      });
      const u2 = await listen<{ session: string; cli: string; code: number }>(
        "chat:done",
        (e) => {
          if (e.payload.session !== sessionRef.current) return;
          if (!mounted) return;
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) {
              return [...m.slice(0, -1), { ...last, streaming: false }];
            }
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
    const userMsg: ChatMessage = {
      role: "user",
      content: input.trim(),
      ts: Date.now(),
    };
    const replyMsg: ChatMessage = {
      role: "assistant",
      cli: selectedCli,
      content: "",
      ts: Date.now(),
      streaming: true,
    };
    setMessages((m) => [...m, userMsg, replyMsg]);
    const promptText = input.trim();
    setInput("");
    sessionRef.current = `s-${Date.now()}`;
    try {
      await invoke("chat_send", {
        args: {
          cli: selectedCli,
          prompt: promptText,
          session_id: sessionRef.current,
        },
      });
    } catch (e) {
      setMessages((m) => [
        ...m.slice(0, -1),
        {
          role: "assistant",
          content: `(error spawning ${selectedCli}: ${e})`,
          ts: Date.now(),
        },
      ]);
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
          {available.length === 0 && (
            <span className="px-3 py-1.5 text-warn">no CLIs detected</span>
          )}
          {available.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCli(c.id)}
              className={`rounded px-3 py-1.5 transition-colors ${
                selectedCli === c.id
                  ? "bg-accent text-background"
                  : "text-text-secondary hover:bg-surface-warm"
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
              Ask <Brand /> anything for{" "}
              {domain ? <code className="text-accent">{domain}</code> : "the selected domain"}.
              The reply streams from{" "}
              <code className="text-accent">{selectedCli ?? "the selected CLI"}</code>.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} msg={m} />
        ))}
      </div>

      <div className="shrink-0 border-t border-border-subtle bg-surface px-6 py-4">
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
        <div className="max-w-2xl rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          {msg.content}
        </div>
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

function CouncilPanel({ domain, clis }: { domain: string | null; clis: CliInfo[] }) {
  const available = useMemo(() => clis.filter((c) => c.available), [clis]);
  const [chairCli, setChairCli] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<"idle" | "panelists" | "synthesizing" | "done">("idle");
  const [replies, setReplies] = useState<Record<string, PanelistReply>>({});
  const [verdict, setVerdict] = useState<string>("");
  const sessionRef = useRef<string>("");
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    if (!chairCli && available.length > 0) {
      setChairCli(available[0].id);
    }
  }, [available, chairCli]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const u1 = await listen<{
        session: string;
        cli: string;
        stream: string;
        data: string;
      }>("chat:chunk", (e) => {
        if (!mounted) return;
        if (!e.payload.session.startsWith(sessionRef.current)) return;
        if (e.payload.stream !== "stdout") return;
        if (e.payload.session.endsWith(":chair")) {
          setVerdict((v) => v + e.payload.data);
          return;
        }
        setReplies((r) => {
          const existing = r[e.payload.cli] ?? {
            cli: e.payload.cli,
            content: "",
            streaming: true,
            startedAt: Date.now(),
          };
          return {
            ...r,
            [e.payload.cli]: { ...existing, content: existing.content + e.payload.data },
          };
        });
      });
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
    () =>
      available.length > 0 &&
      available.every((c) => replies[c.id] && !replies[c.id].streaming),
    [available, replies],
  );

  const triggerChair = useCallback(async () => {
    if (!chairCli) return;
    const synthesisPrompt = buildSynthesisPrompt(prompt, replies, available);
    setPhase("synthesizing");
    try {
      await invoke("chat_send", {
        args: {
          cli: chairCli,
          prompt: synthesisPrompt,
          session_id: `${sessionRef.current}:chair`,
        },
      });
    } catch (e) {
      setVerdict(`(chair error: ${e})`);
      setPhase("done");
    }
  }, [chairCli, prompt, replies, available]);

  useEffect(() => {
    if (phase === "panelists" && allPanelistsDone) {
      triggerChair();
    }
  }, [phase, allPanelistsDone, triggerChair]);

  async function convene() {
    if (!prompt.trim() || available.length === 0) return;
    sessionRef.current = `council-${Date.now()}`;
    setReplies({});
    setVerdict("");
    setPhase("panelists");
    for (const c of available) {
      try {
        await invoke("chat_send", {
          args: {
            cli: c.id,
            prompt: prompt.trim(),
            session_id: `${sessionRef.current}:${c.id}`,
          },
        });
      } catch (e) {
        setReplies((r) => ({
          ...r,
          [c.id]: {
            cli: c.id,
            content: `(error spawning: ${e})`,
            streaming: false,
            startedAt: Date.now(),
          },
        }));
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border-subtle px-6 py-4">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
          ⚖ council — {available.length} panelist{available.length === 1 ? "" : "s"} ready
        </div>
        {domain && (
          <div className="mt-1 font-display text-lg font-semibold">
            <span className="text-accent">◆</span> {domain}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {phase === "idle" && (
          <div className="mx-auto max-w-2xl text-center text-text-muted">
            <Scale className="mx-auto h-8 w-8 opacity-50" />
            <p className="mt-4">
              Type a question and convene the council. Every available CLI will
              answer in parallel, then{" "}
              <code className="text-accent">{chairCli ?? "the chair"}</code> will
              synthesize the verdict.
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
                  <div
                    key={c.id}
                    className="overflow-hidden rounded-lg border border-border bg-surface"
                  >
                    <div className="flex items-center justify-between border-b border-border-subtle bg-surface-warm px-4 py-2 font-mono text-xs">
                      <span>
                        <span className="text-accent">◇</span> {c.label.toLowerCase()}
                      </span>
                      <span className="text-text-muted">
                        {!r && "queued"}
                        {r?.streaming && (
                          <span className="pulse-soft text-accent">streaming</span>
                        )}
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
                  {phase === "synthesizing" && (
                    <span className="pulse-soft">streaming</span>
                  )}
                </div>
                <div className="mt-3 whitespace-pre-wrap text-text-primary">
                  {verdict || "(awaiting chair)"}
                  {phase === "synthesizing" && (
                    <span className="cursor-blink text-accent">▌</span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border-subtle bg-surface px-6 py-4">
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
            disabled={
              !prompt.trim() ||
              available.length === 0 ||
              phase === "panelists" ||
              phase === "synthesizing"
            }
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
  parts.push(
    "WRITE: A 3-paragraph verdict. Paragraph 1: consensus + what to do. Paragraph 2: where panelists disagreed and which framing wins. Paragraph 3: one concrete next action.",
  );
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// BENCHMARK PANEL

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
          <span className="text-accent">◈</span> leaderboard · {runs.length} run
          {runs.length === 1 ? "" : "s"}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {err && (
            <div className="m-2 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
              {err}
            </div>
          )}
          {runs.length === 0 && !err && (
            <div className="p-4 text-xs text-text-muted">
              No scored runs in <code className="text-accent">{vaultPath}/benchmark/runs/</code>.
              Run a benchmark from the CLI to populate this view.
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
                  <span className={active ? "text-accent" : "text-text-muted"}>
                    {active ? "▸" : " "}
                  </span>{" "}
                  {r.label}
                </span>
                <span className="ml-2 shrink-0">
                  <span className="text-accent">
                    {r.judge_avg !== null ? r.judge_avg.toFixed(1) : "—"}
                  </span>
                  <span className="ml-2 text-text-muted">
                    {r.keyword_avg !== null ? Math.round(r.keyword_avg) + "%" : "—"}
                  </span>
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
        {loadingDetail && (
          <div className="p-6 text-sm text-text-muted">loading run…</div>
        )}
        {selected && !loadingDetail && (
          <div className="px-6 py-6">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
              run
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold">
              {selected.score.label}
            </h2>
            <div className="mt-3 flex gap-6 font-mono text-sm">
              <div>
                <span className="text-text-muted">judge: </span>
                <span className="text-accent">
                  {selected.score.judge_avg !== null
                    ? selected.score.judge_avg.toFixed(1)
                    : "—"}
                </span>
                <span className="text-text-muted"> / 10</span>
              </div>
              <div>
                <span className="text-text-muted">keyword: </span>
                <span className="text-text-primary">
                  {selected.score.keyword_avg !== null
                    ? Math.round(selected.score.keyword_avg) + "%"
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-text-muted">questions: </span>
                <span className="text-text-primary">
                  {selected.score.questionScores.length}
                </span>
              </div>
            </div>

            <div className="mt-8 space-y-2">
              {selected.score.questionScores.map((q) => {
                const expanded = expandedQ === q.id;
                const record = selected.records.find((r) => r.id === q.id);
                return (
                  <div
                    key={q.id}
                    className="overflow-hidden rounded-lg border border-border bg-surface"
                  >
                    <button
                      onClick={() => setExpandedQ(expanded ? null : q.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm"
                    >
                      <span className="flex items-center gap-3 font-mono text-sm">
                        <span className="text-text-muted">{expanded ? "▾" : "▸"}</span>
                        <span className="text-text-primary">{q.id}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                        <span className="text-text-muted">
                          {q.keyword_score !== null
                            ? Math.round(q.keyword_score) + "%"
                            : "—"}
                        </span>
                        <span className="text-accent">
                          {q.judge_score !== null ? q.judge_score : "—"}/10
                        </span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="space-y-3 border-t border-border-subtle px-6 py-4 text-sm">
                        <div>
                          <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">
                            question
                          </div>
                          <div className="whitespace-pre-wrap text-text-primary">
                            {record?.prompt ?? "(prompt not in records)"}
                          </div>
                        </div>
                        {record?.expected_decision && (
                          <div>
                            <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">
                              expected decision
                            </div>
                            <div className="whitespace-pre-wrap text-ok">
                              {record.expected_decision}
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">
                            model said
                          </div>
                          <div className="whitespace-pre-wrap text-text-primary">
                            {record?.reply ?? "(no reply)"}
                          </div>
                        </div>
                        <div className="flex gap-6 font-mono text-xs">
                          <div>
                            <span className="text-ok">✓ hit: </span>
                            <span className="text-text-secondary">
                              {q.keyword_hits.join(", ") || "(none)"}
                            </span>
                          </div>
                          <div>
                            <span className="text-warn">✗ miss: </span>
                            <span className="text-text-secondary">
                              {q.keyword_misses.join(", ") || "(none)"}
                            </span>
                          </div>
                        </div>
                        {q.judge_rationale && (
                          <div>
                            <div className="mb-1 font-mono text-xs uppercase tracking-wider text-text-muted">
                              judge rationale ({q.judge_score}/10)
                            </div>
                            <div className="whitespace-pre-wrap text-text-secondary">
                              {q.judge_rationale}
                            </div>
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
