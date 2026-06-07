---
name: policygenius
type: app
description: >
  Accesses insurance comparison quotes for term life, disability income, and umbrella liability policies on PolicyGenius. Used by insurance-agent during annual coverage audits to compare existing coverage against current market rates and identify shopping opportunities. No authentication required for most quote flows. Configure coverage targets in vault/insurance/config.md.
---

# PolicyGenius

**Auth:** None required for most quote flows (some require email for full quote delivery)
**URL:** https://www.policygenius.com
**Configuration:** Set coverage targets in `vault/insurance/config.md`

## What It Provides

PolicyGenius is a multi-carrier insurance marketplace specializing in life, disability, and umbrella insurance — exactly the coverage types that are hardest to shop because they require underwriting and carrier comparison. The platform aggregates quotes from multiple carriers simultaneously, shows side-by-side comparisons with carrier ratings (AM Best financial strength), and provides educational content on coverage recommendations.

This skill is used during the annual coverage audit when gaps are identified — specifically, when the gap analysis determines that additional term life, disability, or umbrella coverage is needed and an estimated premium cost is required to make the "cost to close the gap" meaningful. It is also used when evaluating whether existing coverage (particularly term life) is still competitively priced at renewal.

## Data Available

**Term life insurance:**
- Side-by-side quotes from 10-15 carriers (Protective, Pacific Life, AIG, Transamerica, Banner, etc.)
- Premiums for different term lengths (10, 15, 20, 25, 30 years) and face values
- Carrier AM Best financial strength rating
- Underwriting class estimates (super preferred, preferred, standard) based on health inputs
- Application initiation (can start from PolicyGenius — no separate carrier login needed)

**Disability income insurance:**
- Quotes for individual LTD policies (not group disability)
- Own-occupation vs. any-occupation policy comparison
- Monthly benefit amounts and elimination period (waiting period) options
- Benefit period options (to age 65 or 67 is standard)
- Premium ranges for common occupation classes

**Umbrella liability:**
- Basic umbrella quotes for $1M-$5M coverage
- Notes on underlying auto and home liability requirements
- Carrier options and pricing (umbrellas are typically narrow market)

**Homeowners and renters:**
- Quote comparison for homeowners and renters insurance
- Note: auto insurance is NOT available on PolicyGenius — use carrier direct sites for auto

## Configuration

Add to `vault/insurance/config.md`:
```yaml
policygenius:
  life_coverage_target: 1500000     # target face value for term life gap
  life_term_years: 20               # preferred term length
  life_health_class: preferred      # super-preferred / preferred / standard (estimate)
  disability_monthly_benefit: 3000  # monthly benefit target for individual LTD gap
  umbrella_target: 1000000          # target umbrella coverage
```

## Technical Notes

- Quote flows typically require: age, state of residence, tobacco status, health class estimate, and coverage parameters
- Full, bindable quotes from most carriers require starting an application with personal details
- PolicyGenius earns commission when a policy is purchased through the platform — this biases toward their carrier partners, but coverage comparison is still valid
- AM Best rating A or better is the standard carrier quality threshold — avoid B+ or lower for new policies
- For term life quotes: assume "preferred" health class unless specific health conditions suggest otherwise; the actual class is determined by underwriting after application

## Key Quote Pages

```
https://www.policygenius.com/life-insurance/
https://www.policygenius.com/disability-insurance/
https://www.policygenius.com/homeowners-insurance/
```

## Used By

- `aireadylife-insurance-op-coverage-audit` — estimate cost to close life, disability, and umbrella gaps for gap analysis output
- `aireadylife-insurance-flow-analyze-coverage-gaps` — populate premium estimate fields in gap severity ratings

## Vault Output

- `~/Documents/aireadylife/vault/insurance/00_current/quotes/` — saved quote comparisons with date and carrier data
