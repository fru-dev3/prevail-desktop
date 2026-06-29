// Quick Capture — a slide-out ribbon pinned to the right edge for capturing a
// note in seconds, from anywhere in the app. Collapsed by default (just a mic
// tab) so it's never busy. Expand → name it, type, or hit record and speak;
// speech is transcribed live (Web Speech API) and only the TEXT is saved into
// the shared Notes store. Notes are stream-of-consciousness capture — the raw
// material that later feeds context/strategy analysis.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Mic, Square, X } from "lucide-react";
import { addNote } from "./notesstore";

// Web Speech API is unprefixed on some engines, webkit-prefixed on others.
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

export function QuickCapture({ vaultPath }: { vaultPath: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const committedRef = useRef("");
  const speechSupported = !!getSpeechRecognition();

  const stopRec = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    recRef.current = null;
    setRecording(false);
  }, []);

  // Stop any recording if the ribbon closes or unmounts.
  useEffect(() => () => stopRec(), [stopRec]);
  useEffect(() => { if (!open) stopRec(); }, [open, stopRec]);

  const startRec = () => {
    setError(null);
    const SR = getSpeechRecognition();
    if (!SR) { setError("Voice capture isn't available here."); return; }
    let r: SpeechRecognitionLike;
    try { r = new SR(); } catch { setError("Couldn't start the microphone."); return; }
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    committedRef.current = body ? body.trimEnd() + " " : "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        if (e.results[i].isFinal) committedRef.current += seg + " ";
        else interim += seg;
      }
      setBody((committedRef.current + interim).replace(/\s+/g, " ").trimStart());
    };
    r.onerror = (e) => {
      setError(e?.error === "not-allowed" || e?.error === "service-not-allowed"
        ? "Microphone permission was denied."
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
      await addNote(vaultPath, { title, body: text, source: committedRef.current ? "voice" : "quick" });
      setTitle(""); setBody(""); committedRef.current = "";
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) { setError(`Couldn't save: ${e}`); } finally { setSaving(false); }
  };

  // Collapsed: a slim mic tab on the right edge.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Quick note — capture a thought by typing or voice"
        className="fixed right-0 top-1/3 z-40 flex h-12 w-9 items-center justify-center rounded-l-lg border border-r-0 border-border bg-surface text-text-secondary shadow-md transition-colors hover:bg-accent hover:text-background"
      >
        <Mic className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="fixed right-3 top-20 z-50 w-80 rounded-xl border border-border bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <span className="flex items-center gap-2 font-display text-sm font-semibold text-text-primary"><Mic className="h-4 w-4 text-accent" /> Quick note</span>
        <button onClick={() => setOpen(false)} title="Collapse" className="rounded p-1 text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-2 p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Name (optional)"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-accent-border focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={recording ? "Listening… speak your note" : "Type a thought, or hit record and speak…"}
          rows={5}
          className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed focus:border-accent-border focus:outline-none"
        />
        {error && <div className="text-[11px] text-err">{error}</div>}
        {recording && <div className="flex items-center gap-1.5 text-[11px] text-accent"><span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-err" /> Recording — transcribing live</div>}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {recording ? (
            <button onClick={stopRec} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-text-secondary hover:bg-surface-warm"><Square className="h-3.5 w-3.5" /> Stop</button>
          ) : (
            <button onClick={startRec} disabled={!speechSupported} title={speechSupported ? "Record & transcribe" : "Voice capture isn't available in this build"} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-text-secondary hover:bg-surface-warm disabled:opacity-50"><Mic className="h-3.5 w-3.5" /> Record</button>
          )}
          <button onClick={() => void save()} disabled={saving || (!body.trim() && !title.trim())} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
            {savedFlash ? <><Check className="h-3.5 w-3.5" /> Saved</> : saving ? "Saving…" : "Save to Notes"}
          </button>
        </div>
        {!speechSupported && <p className="text-[10px] text-text-muted">Voice capture needs a speech-capable webview + mic permission; typing always works.</p>}
      </div>
    </div>
  );
}
