---
id: returns-and-warranty-tracker
runner: llm
trigger: on-demand
outputs:
  - { path: data/amazon-returns-warranty-${date}.json, kind: replace }
---
# Amazon Returns & Warranty Tracker
Knowing what you own and how long it's covered keeps money from leaking.
1. **Load data.** Read the latest amazon-returns-*.json and amazon-orders-*.json snapshots.
2. **Track returns.** List open returns, pending refunds, and any refund that appears delayed past its expected window.
3. **Map warranties.** For higher-value items, estimate warranty/return windows from purchase date and flag windows closing soon.
4. **Prioritize.** Rank items needing action (claim a refund, register a warranty) without taking any action.
Output: a returns-and-warranty JSON with open returns, pending refunds, and closing warranty windows.
