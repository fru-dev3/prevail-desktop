# Oura Ring — Alex Rivera (Demo)

> **SYNTHETIC DATA — Demo only.**

**Used by domains:** health
**Last sync:** 2026-04-12 07:14 UTC
**Device:** Gen 4

## Yesterday at a Glance

| Metric | Value | 14d trend |
|--------|-------|-----------|
| Sleep score | 78 | ↓ from 82 avg |
| HRV (overnight) | 38 ms | ↓ from 44 avg |
| RHR | 58 bpm | flat |
| Readiness | 71 | ↓ from 78 |

## What This App Is For

- Pull last night's sleep + HRV without opening the Oura app
- Surface multi-day trends to detect overtraining or stress accumulation
- Cross-reference with calendar (heavy meeting day → poor sleep that night?)
- Feed normalized metrics into `vault/health/00_current/wearable/`

## Open Items

- [ ] HRV declining 14d — diagnose (likely interview-prep stress)
- [ ] Replace battery (firmware says 60d remaining)
- [ ] Set up auto-sync to vault/health/ via Oura API
