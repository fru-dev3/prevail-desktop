// The Prevail wordmark, extracted from App.tsx. Exported as BrandMark (not
// "Brand") so it never collides with the Brand *type* in ./types. Spells the name
// out so the wit (the "AI" hiding in prevAIl) carries the brand; the chevron+star
// mark lives where it has room (app icon, Council hero, empty state).
export function BrandMark({ className = "", fill = false }: { className?: string; fill?: boolean }) {
  if (fill) {
    return (
      <span className={`flex w-full items-center justify-between ${className}`} aria-label="Prevail">
        <span>P</span>
        <span>R</span>
        <span>E</span>
        <span>V</span>
        <span className="text-ai">A</span>
        <span className="text-ai">I</span>
        <span>L</span>
      </span>
    );
  }
  return (
    <span className={className} style={{ letterSpacing: "inherit" }}>
      PREV<span className="text-ai">AI</span>L
    </span>
  );
}
