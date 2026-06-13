// Markdown rendering subsystem, extracted from App.tsx so the chat/doc render
// path lives in one small module. Self-contained: depends only on React and
// react-markdown — no app-specific helpers.
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders LLM output as proper markdown — headings, lists, bold, inline code,
// fenced blocks, tables. Wraps each block element in `prose`-like Tailwind so
// the spacing reads.
// Code-fence renderer for ReactMarkdown — multi-line blocks get a card with a
// language label + copy button at the top-right; inline `code` stays as a plain
// <code>. Stable component identity (declared at module scope) so React doesn't
// reuse stale closures.
function MarkdownCode(props: React.HTMLAttributes<HTMLElement> & { className?: string; children?: React.ReactNode }) {
  const { className, children, ...rest } = props;
  // ReactMarkdown gives us a className like "language-ts" for fenced blocks and
  // no className for inline code. We use the presence of a newline in the body
  // as a backup signal because some prompts emit triple-backtick blocks with no
  // language.
  const text = typeof children === "string"
    ? children
    : Array.isArray(children)
      ? children.map((c) => (typeof c === "string" ? c : "")).join("")
      : "";
  const lang = (className ?? "").replace(/^language-/, "") || "code";
  const isBlock = (className && className.startsWith("language-")) || text.includes("\n");
  if (!isBlock) {
    return <code className={className} {...rest}>{children}</code>;
  }
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border-subtle bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-warm px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{lang}</span>
        <button
          onClick={() => { void navigator.clipboard.writeText(text); }}
          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted transition-colors hover:border-accent-border hover:text-accent"
        >
          copy
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-text-primary">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const MARKDOWN_COMPONENTS = { code: MarkdownCode } as const;

export const Markdown = React.memo(function Markdown({ source, compact = false }: { source: string; compact?: boolean }) {
  // Two flavors: default (chat reply) and compact (state/decisions/journal).
  // Compact mode is denser, sans-serif headings, smaller bullets, no emoji
  // bloat — looks like a real doc, not AI slop.
  //
  // Memoized so that re-rendering a parent doesn't force ReactMarkdown to
  // reparse the source string. During streaming, each new chunk creates a new
  // source string anyway — that's intentional. But sibling re-renders (hover
  // state, neighbor message updates) no longer redo the parse.
  return (
    <div
      className={`prose-prevail max-w-none ${compact ? "prose-prevail--compact" : ""}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{source}</ReactMarkdown>
    </div>
  );
});

// While a reply is STREAMING we render its text plainly instead of pushing the
// whole growing string through ReactMarkdown on every chunk. Re-parsing a
// markdown AST per token is O(n^2) in the reply length and a major heap churner
// on long/runaway replies (audit finding #2). The bubble switches to the full
// Markdown renderer once the turn finalizes (streaming flips false), so the
// finished message looks identical — only the live, mid-stream view is plain.
export const StreamingPlain = React.memo(function StreamingPlain({ source }: { source: string }) {
  return (
    <div className="prose-prevail max-w-none whitespace-pre-wrap break-words">{source}</div>
  );
});
