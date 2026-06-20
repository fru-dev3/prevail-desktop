# Prevail v0.1.141

A big release focused on the Arena (benchmarking), a smarter daily-loop layer, clearer navigation, and a pile of correctness fixes.

## New

- **Model Scout.** A built-in daily loop in your General domain that searches the web for AI models worth benchmarking, covering both open-weight models (Llama, Qwen, DeepSeek, Kimi, Mistral, Gemma) and frontier models (Claude, GPT, Gemini, Grok). It writes a ranked, classified shortlist you can fold into the Arena. Surfaced as a "Model Scout" panel in Arena, with a "Scan now" button.
- **Spark.** A serendipity panel that surfaces AI-generated discoveries from rotating models, each attributed to the model that made it. Generate 1 to 10 at a time, save the good ones, dismiss the rest, open one straight into chat, or turn it into a task or routine. Captures full metadata (date, time, model) for every spark.
- **3D Arena.** Benchmark runtimes on three axes at once: intelligence, speed, and cost-per-token, so the "best" model is the one that fits the job and the budget.
- **Vault Lock.** A simple toggle that restricts the assistant's filesystem access to your vault only, as a distinct dimension from Bunker Mode.
- **App suggestions.** A learning layer that proposes real apps and services to connect per domain (for example Capital One for Wealth, Garmin Connect for Health), grounded in what you actually do, refreshed daily.
- **Live count badges.** Work, Insights, and Loops in the top navigation now show live counts, computed in the background so they are always current.

## Improved

- **Councils, unified.** Benchmark Suites and Councils are now one "Council" concept: a saved group of models you can reuse across the Arena and chat. Councils are editable in place.
- **Live benchmark progress.** A running benchmark now shows the question being answered and advances as each one completes, instead of appearing frozen at 0 of N.
- **Arena polish.** Honest rerun banner, clearer AI-drafted questions (floated to the top with a review badge), archived questions excluded from runs, and the current domain highlighted and led in the Model-by-domain matrix.
- **Council incognito** moved into the Modes menu with a ribbon indicator, consistent with chat.
- **Colorful Work board.** Domains are color-coded and owner icons are filled, so Me vs AI reads at a glance.
- **Recommendations panel** shows the learning daemon's last and next run, with a "Run now" button to force a pass.
- **Trimmed runtime catalog** down to the runtimes that matter, with correct logos.
- **Top navigation** reordered to Work, Insights, Loops as one group, with a cleaner, collapsible cluster.
- **Settings header** redesign, consistent model labels everywhere, and icons for Me vs AI.

## Fixed

- **Work count now appears.** The Work badge was blank even with dozens of open tasks; it now counts open work across every domain directly, independent of the navigation's domain list, so the number is always right.
- **Legible badges.** The count badges were illegible (white on white in one state, near-black in another). They are now AI-teal pills, sized to fit the number, and readable on both selected and unselected tabs in every theme.
- **Benchmark reliability.** Fixed runs that errored or hung at 0 of N: a stale bundled engine, archived questions being counted as runnable, a split between the build and legacy question and run locations, and Cancel not releasing a stuck run.
- **Vault stays clean.** New domains are no longer ever created at the vault root; they always live under data/domains, keeping the vault to just data/ and build/.
- **Usage tab** now populates as you chat.
- Many smaller layout and consistency fixes throughout.
