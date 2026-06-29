---
id: fetch-watch-history
runner: browser-agent
trigger: refresh
goal: "Sign in to Netflix and download my viewing activity and billing history; do not play, rate, or change anything."
domain_allow:
  - netflix.com
  - www.netflix.com
outputs:
  - { path: data/netflix-watch-history-${date}.json, kind: replace }
  - { path: data/netflix-billing-${date}.json, kind: replace }
---
# Pull Netflix Viewing Activity
The shows you actually watch and your half-finished evenings, pulled in read-only.
1. **Open viewing activity.** Navigate to Account > Viewing Activity for the active profile (and others if accessible).
2. **Capture titles.** Record each title, type (series/film), episode where shown, and the date watched.
3. **Capture billing.** Open billing/membership history and record plan, monthly charge, and renewal date.
4. **Normalize.** Write activity to netflix-watch-history-${date}.json and billing to netflix-billing-${date}.json; never play, rate, or change settings.
Output: read-only JSON snapshots of Netflix viewing activity and billing.
