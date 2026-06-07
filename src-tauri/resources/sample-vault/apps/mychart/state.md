# MyChart — Alex Rivera (Demo)

> **SYNTHETIC DATA — Demo only.**

**Used by domains:** health, insurance, calendar
**Provider:** Epic MyChart (UCSF) | **Login:** SSO via 1Password
**Last refresh:** 2026-04-10 — 2 days ago

## What's Inside

- **PCP:** Dr. Mira Patel — last visit 2026-03-22 (annual physical)
- **Labs:** Comprehensive metabolic + lipid panel from Mar 22 — 1 flag (LDL 142)
- **Imaging:** none in last 12 months
- **Active medications:** lisinopril 10mg (refill due 2026-05-15)
- **Upcoming appointments:** none scheduled — cardiology consult OPEN

## Recent Notable Flags

- LDL 142 (above target <130) — Dr. Patel recommended cardiology consult,
  not yet scheduled (intentionally deferred until after Apr 15 tax wire)
- HRV trend declining over last 14 days (cross-ref vault/health/state.md)

## When to Use This App

- Pull latest lab results without logging into the portal manually
- Get refill timing for active prescriptions
- Schedule / reschedule appointments through the MyChart booking flow
- Surface notes from the last visit before the next one

## Open Items

- [ ] Schedule cardiology consult (deferred until after Apr 15)
- [ ] Refill lisinopril by May 15 (90-day script available)
- [ ] Set up MyChart → vault/health/ webhook for lab result delivery
