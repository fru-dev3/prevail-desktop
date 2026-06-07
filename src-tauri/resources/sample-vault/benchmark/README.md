# Canonical benchmark — starter pack

These 21 questions ship with the demo vault to give the `prevail bench` tooling something to chew on out of the box. They cover six categories of capability:

| Category | Count | What it tests |
|---|---|---|
| **Binary decisions** | 10 | Pick a side, defend it (mortgage vs invest, leave vs stay, etc.) |
| **Document analysis** | 5 | Read attached financial statements / tax packets / lab reports / contracts / pricing analyses and produce a specific recommendation |
| **Recency / knowledge cutoff** | 1 | Test whether the model knows recent facts (Google's `gemini` → `agy` transition) |
| **Cultural nuance** | 1 | Engage with non-Western cultural reality (immigrant family obligation) without flattening to Western individualist financial advice |
| **Instruction following** | 1 | Brevity test — answer in one sentence, no preamble |
| **Insufficient-info recognition** | 1 | Refuse to recommend without missing facts; ask for the right ones |
| **Bias detection** | 1 | Reject a leading anchor frame instead of answering inside it |
| **Complex tax trap** | 1 | Recognize that a "common-sense" deduction is actually disallowed under §469 |

Each question carries a **ground-truth verdict** the demo persona (Alex Rivera) would stand behind in real life.

## How the scoring works

When you run:

```
prevail bench run --canonical --cli claude
prevail bench score
prevail bench leaderboard
```

each question gets graded two ways:

1. **Mechanical keyword match (0-100%):** how many of the `expected_verdict_keywords` show up in the model's reply.
2. **LLM-as-judge (0-10):** a chair model reads the question, the `expected_decision`, and the model's reply, and scores alignment with a one-line rationale.

A reply that hedges ("it depends on your risk tolerance") will score low on both — these questions are deliberately written so a competent model should pick a clear side.

## Attachments

Five questions use `attachments:` in their frontmatter to reference long-form documents under `attachments/`:

- `wealth-q4-statements.md` — three months of internal P&L for the document-analysis test
- `tax-year-end-packet.md` — draft 1040 summary, W-2, 1099-DIV, brokerage positions
- `health-lab-panel.md` — comprehensive metabolic + lipid + inflammation panel with prior-year comparison
- `legal-msa-draft.md` — full draft Master Services Agreement (consulting contract)
- `business-pricing-analysis.md` — competitor pricing analysis + internal cost model

The bench runner **inlines the markdown contents** of each attachment into the prompt with `[ATTACHMENT: <name>] ... [END ATTACHMENT]` delimiters. This works uniformly across Claude / Codex / Antigravity / Ollama without depending on each CLI's specific attachment syntax. Each attachment is truncated to 16,000 chars per question to keep prompt sizes bounded.

**PDF / image variants:** run `bash scripts/build-bench-attachments.sh` from the repo root to generate companion PDFs from each markdown file (requires `weasyprint`) plus one PNG chart (requires `magick`). The PDFs are for visual inspection only; the bench runner reads the `.md` source.

## Replacing with your own

This is a **starter pack**, not a fixed test. To replace any question with your own:

- **Edit a question file:** open `vault-demo/benchmark/questions/<id>.md` in your editor and rewrite the prompt, context, expected_decision, and verdict keywords. To add attachments, drop a markdown file under `attachments/` and reference it in the question's frontmatter as `attachments: [filename.md]`.
- **Add a new one:** `prevail bench seed --domain wealth` writes a fillable stub.
- **Import from your history:** `prevail bench seed --from-log wealth` walks the most recent council verdict from your domain log and pre-fills a draft from it. This is the highest-value path — your real decisions become your real benchmark.

The goal is to test new models against questions where you *already know* the right answer because you lived it. The starter pack is just scaffolding so the machinery doesn't feel empty on day one.
