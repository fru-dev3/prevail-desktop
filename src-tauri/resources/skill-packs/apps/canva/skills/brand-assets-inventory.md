---
id: brand-assets-inventory
runner: llm
trigger: on-demand
outputs:
  - { path: data/canva-brand-inventory-${date}.json, kind: replace }
---
# Brand Assets Inventory
Keep a clean ledger of your brand kit.
1. **Load.** Read the newest `data/canva-brand-assets-*.json`.
2. **Inventory.** Catalog logos, color palettes, and fonts per brand kit.
3. **Gaps.** Flag missing logo variants, undefined colors, and obvious duplicates.
4. **Organize.** Group the inventory by brand kit.
Output: an inventory of brand assets with gap and duplicate flags.
