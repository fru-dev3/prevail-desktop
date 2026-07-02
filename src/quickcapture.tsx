// Quick Capture — a slide-out ribbon pinned to the right edge for capturing a
// note in seconds, from anywhere. Collapsed by default to a mic tab (never
// busy). Expand → name it, type, or hit record and speak; speech is transcribed
// live (Web Speech API) and only the TEXT is saved into the shared Notes store.
// Notes are stream-of-consciousness capture — raw material for later context
// and strategy analysis.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Mic, Settings2, Sparkles, Square, X } from "lucide-react";
import { addNote } from "./notesstore";

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
}
function mmss(s: number): string { return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

export function QuickCapture({ vaultPath }: { vaultPath: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const committedRef = useRef("");
  const usedVoiceRef = useRef(false);
  const speechSupported = !!getSpeechRecognition();
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  const stopRec = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    recRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => () => stopRec(), [stopRec]);
  useEffect(() => { if (!open) stopRec(); }, [open, stopRec]);
  // F8: the global capture hotkey (Cmd/Ctrl+Shift+Space) reveals the window and
  // fires this event; open the ribbon so the user can capture immediately.
  useEffect(() => {
    const onSummon = () => setOpen(true);
    window.addEventListener("prevail:quick-capture", onSummon);
    return () => window.removeEventListener("prevail:quick-capture", onSummon);
  }, []);
  // Recording timer.
  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const startRec = () => {
    setError(null);
    const SR = getSpeechRecognition();
    if (!SR) { setError("Voice capture isn't available in this build."); return; }
    let r: SpeechRecognitionLike;
    try { r = new SR(); } catch { setError("Couldn't start the microphone."); return; }
    r.continuous = true; r.interimResults = true; r.lang = navigator.language || "en-US";
    committedRef.current = body ? body.trimEnd() + " " : "";
    usedVoiceRef.current = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        if (e.results[i].isFinal) committedRef.current += seg + " "; else interim += seg;
      }
      setBody((committedRef.current + interim).replace(/\s+/g, " ").trimStart());
    };
    r.onerror = (e) => {
      setError(e?.error === "not-allowed" || e?.error === "service-not-allowed"
        ? "Microphone access is off. Enable it in System Settings → Privacy & Security → Microphone, then try again."
        : `Voice capture error${e?.error ? `: ${e.error}` : ""}.`);
      setRecording(false);
    };
    r.onend = () => { setBody(committedRef.current.trim()); setRecording(false); };
    try { r.start(); recRef.current = r; setRecording(true); }
    catch { setError("Couldn't start the microphone."); }
  };

  const save = async () => {
    const text = body.trim();
    if (!text && !title.trim()) return;
    if (recording) stopRec();
    setSaving(true);
    try {
      await addNote(vaultPath, { title, body: text, source: usedVoiceRef.current ? "voice" : "quick" });
      setTitle(""); setBody(""); committedRef.current = ""; usedVoiceRef.current = false;
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) { setError(`Couldn't save: ${e}`); } finally { setSaving(false); }
  };

  // Collapsed: a refined mic tab on the right edge.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Quick note - capture a thought by typing or voice"
        className="group fixed right-0 top-1/3 z-40 flex h-14 w-10 items-center justify-center rounded-l-2xl border border-r-0 border-border bg-surface/90 text-text-secondary shadow-lg backdrop-blur transition-all hover:w-11 hover:bg-accent hover:text-background"
      >
        <Mic className="h-[18px] w-[18px] transition-transform group-hover:scale-110" />
      </button>
    );
  }

  return (
    <div className="fixed right-4 top-20 z-50 w-[368px] overflow-hidden rounded-2xl border border-border/70 bg-surface/95 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border-subtle bg-gradient-to-r from-accent-soft/60 to-transparent px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-background shadow-sm"><Mic className="h-4 w-4" /></span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="font-display text-sm font-bold text-text-primary">Quick note</span>
          <span className="text-[10px] text-text-muted">Type or speak - saved to Notes</span>
        </div>
        <button onClick={() => setOpen(false)} title="Collapse" className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-primary"><X className="h-4 w-4" /></button>
      </div>

      <div className="space-y-3 p-4">
        {/* Title — borderless, prominent */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled note"
          className="w-full bg-transparent font-display text-[17px] font-semibold text-text-primary placeholder:text-text-muted/40 focus:outline-none"
        />

        {/* Body, or the recording visualizer */}
        {recording ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-accent-border/40 bg-accent-soft/25 py-7">
            <style>{"@keyframes qcbar{0%,100%{transform:scaleY(0.35)}50%{transform:scaleY(1)}}"}</style>
            <div className="flex h-10 items-end gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} className="w-1.5 rounded-full bg-accent" style={{ height: "100%", transformOrigin: "bottom", animation: "qcbar 0.9s ease-in-out infinite", animationDelay: `${i * 0.09}s` }} />
              ))}
            </div>
            <div className="font-mono text-2xl tabular-nums text-accent">{mmss(seconds)}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent/80">Listening</div>
            {body && <p className="line-clamp-3 px-5 text-center text-[12px] leading-relaxed text-text-secondary">{body}</p>}
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Capture a thought… or hit record and speak."
            rows={6}
            className="w-full resize-y rounded-xl border border-border-subtle bg-background/60 px-3 py-2.5 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted/50 transition-colors focus:border-accent-border focus:outline-none"
          />
        )}

        {/* Friendly, actionable error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-err/30 bg-err/5 px-3 py-2 text-[12px] text-err">
            <Settings2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">
              <span>{error}</span>
              {speechSupported && <button onClick={startRec} className="ml-1 font-semibold underline hover:no-underline">Try again</button>}
            </div>
          </div>
        )}

        {/* Footer: record (focal) + meta + save */}
        <div className="flex items-center gap-3 pt-0.5">
          {recording ? (
            <button onClick={stopRec} title="Stop" className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-err text-white shadow-md transition-transform hover:scale-105">
              <span className="pulse-soft absolute inset-0 rounded-full ring-2 ring-err/40" />
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={startRec} disabled={!speechSupported} title={speechSupported ? "Record & transcribe" : "Voice capture isn't available in this build"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-inset ring-accent-border/50 transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100">
              <Mic className="h-[18px] w-[18px]" />
            </button>
          )}

          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{recording ? "Recording…" : speechSupported ? "Tap to dictate" : "Voice unavailable"}</span>
            {words > 0 && <span className="text-[10px] text-text-muted/70">{words} word{words === 1 ? "" : "s"}</span>}
          </div>

          <button
            onClick={() => void save()}
            disabled={saving || (!body.trim() && !title.trim())}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition-all disabled:opacity-50 ${savedFlash ? "bg-[var(--color-ok,#2e9e5b)] text-white" : "bg-accent text-background hover:bg-accent-hover"}`}
          >
            {savedFlash ? <><Check className="h-3.5 w-3.5" /> Saved</> : saving ? "Saving…" : "Save"}
          </button>
        </div>

        {/* Quiet footer hint */}
        <div className="flex items-center gap-1.5 border-t border-border-subtle pt-2.5 text-[10px] text-text-muted">
          <Sparkles className="h-3 w-3 text-accent/60" />
          Saved to Notes - feeds your context over time.
        </div>
      </div>
    </div>
  );
}
