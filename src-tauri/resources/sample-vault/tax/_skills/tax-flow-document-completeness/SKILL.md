---
name: aireadylife-tax-flow-document-completeness
type: flow
trigger: called-by-op
description: >
  Checks the expected tax document checklist for the current tax year against files
  actually received in vault/tax/00_current/ and flags anything expected but not
  yet received. Expected documents are determined from active income sources, entities,
  and investments configured in config.md. Document types: W-2, 1099-NEC, 1099-MISC,
  1099-B, 1099-DIV, 1099-INT, 1099-R, K-1, 1098, and entity returns. Enforces
  consistent file naming convention across all documents.
---

# aireadylife-tax-document-completeness

**Trigger:** Called by `aireadylife-tax-document-sync` and `aireadylife-tax-entity-compliance`
**Produces:** Completeness report at `vault/tax/00_current/YYYY-completeness.md`

## What It Does

Reads the expected document checklist from `vault/tax/00_current/expected-docs.md` — a configuration file that lists every document expected for the current tax year based on active income sources, investments, entities, and properties configured in config.md — and compares it against all files present in `vault/tax/00_current/`.

**Expected document generation.** The expected list is generated from config.md at the start of each tax year and updated when new income sources are added. Categories and their triggers:
- W-2: one per employer active during the tax year (issued by January 31)
- 1099-NEC: one per client or payer that paid ≥$600 for services in the tax year (issued by January 31)
- 1099-MISC: for rent, prizes, royalties ≥$600 (issued by January 31)
- 1099-B: one per brokerage account where securities were sold (issued by mid-February)
- 1099-DIV: one per brokerage/fund that paid dividends ≥$10 (issued by mid-February)
- 1099-INT: one per bank or lender that paid interest ≥$10 (issued by January 31)
- 1099-R: one per retirement account where distributions were taken (issued by January 31)
- 1098: one per mortgage loan (issued by January 31; shows mortgage interest paid)
- K-1 (Schedule K-1): one per partnership, S-Corp, or trust the user is a beneficiary of (March 15 expected; often late)
- 1095-A: one if health coverage was through the Marketplace (ACA)
- Entity returns: S-Corp 1120-S, partnership 1065 (March 15)

**Status classification.** Each expected document is marked:
- RECEIVED: file present in vault with correct naming convention
- PENDING: past the issuer's typical deadline but not yet in vault — flag for follow-up
- NOT YET DUE: issuer deadline hasn't passed — no action needed
- DELINQUENT: more than 30 days past issuer deadline — flag as HIGH severity; may need to contact payer

**File naming convention.** The flow enforces consistent naming so documents are always findable: `W2_{employer-name}_{year}.pdf`, `1099NEC_{payer-name}_{year}.pdf`, `1099B_{institution-name}_{year}.pdf`, `K1_{entity-name}_{year}.pdf`, etc. Files that don't match the convention are flagged as "Naming violation — rename to [correct name]."

**Entity-scoped mode.** When called by `aireadylife-tax-entity-compliance`, the scope narrows to entity-level documents only: K-1s, entity tax returns, payroll summaries (W-2s issued to owner-employees), franchise tax receipts, and annual report confirmations.

## Triggers

- "document completeness check"
- "which tax documents are missing"
- "W-2 tracking"
- "1099 checklist"
- "are all my tax docs in"
- "filing document status"

## Steps

1. Read `vault/tax/config.md` to identify all expected document sources: employers, clients/payers, financial institutions, entities, properties with mortgages
2. Read `vault/tax/00_current/expected-docs.md`; if it doesn't exist, generate it from config.md sources
3. Scan all files in `vault/tax/00_current/YYYY/` directory (current tax year)
4. Match each found file against the expected list using naming convention matching
5. For each unmatched expected document, check today's date against the issuer's typical deadline
6. Classify each expected document: RECEIVED, PENDING, NOT YET DUE, or DELINQUENT
7. Check all received files for naming convention compliance; flag violations with correct name
8. If called by entity compliance: filter scope to entity-level documents only
9. Write completeness report to `vault/tax/00_current/YYYY-completeness.md`
10. Return list of PENDING and DELINQUENT items to calling op for open-loop flag generation

## Input

- `vault/tax/00_current/` — all received document files
- `vault/tax/00_current/expected-docs.md` — expected document checklist
- `vault/tax/01_prior/` — prior period records for trend comparison
- `vault/tax/config.md` — income sources, entities, institutions

## Output Format

Markdown document at `vault/tax/00_current/YYYY-completeness.md`:
- Summary: N expected | N received | N pending | N not yet due | N delinquent
- Status table: Document Type | Payer/Issuer | Expected By | Status | File Name (if received)
- Naming violations section: incorrect file name | correct file name
- Delinquent items section: document, payer, action (call payer or download from portal)

## Configuration

Required in `vault/tax/config.md`:
- `employers` — list of employers active in the tax year (for W-2 tracking)
- `freelance_clients` — list of payers expected to issue 1099-NEC
- `financial_institutions` — banks and brokerages (for 1099-INT, 1099-B, 1099-DIV)
- `retirement_accounts` — accounts where distributions were taken (1099-R)
- `entities` — active LLCs, S-Corps, partnerships (for K-1 tracking)
- `mortgage_lenders` — for 1098 tracking

## Error Handling

- If expected-docs.md doesn't exist: generate it from config.md and note "Generated from config — verify the list covers all expected income sources"
- If the vault documents directory is empty: report "No documents received yet. Place tax documents in vault/tax/00_current/YYYY/ and re-run."
- If a file's format cannot be read: list it by filename with "Contents unreadable — verify file is not corrupt"

## Vault Paths

- Reads from: `~/Documents/aireadylife/vault/tax/01_prior/` — prior period records
- Reads from: `~/Documents/aireadylife/vault/tax/00_current/YYYY/` (received documents)
- Reads from: `~/Documents/aireadylife/vault/tax/00_current/expected-docs.md`
- Reads from: `~/Documents/aireadylife/vault/tax/config.md`
- Writes to: `~/Documents/aireadylife/vault/tax/00_current/YYYY-completeness.md`
