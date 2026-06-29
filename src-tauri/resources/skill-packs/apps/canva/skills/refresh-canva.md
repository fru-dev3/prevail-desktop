---
id: refresh-canva
runner: llm
trigger: refresh
outputs:
  - { path: data/canva-designs-${date}.json, kind: replace }
  - { path: data/canva-folders-${date}.json, kind: replace }
  - { path: data/canva-brand-assets-${date}.json, kind: replace }
---
# Refresh Canva
Bring your designs and brand assets into the vault so your creative work stays within reach. Strictly read-only, never edit, export, comment, or move a design.
1. **Designs.** Search and list designs, capturing title, type, updated time, owner, and thumbnail/link.
2. **Folders.** List folders and the items inside them.
3. **Brand.** List brand kits and their assets, logos, color palettes, and fonts.
4. **Save.** Write each dataset to its `data/canva-*-${date}.json` file.
Output: a dated snapshot of designs, folders, and brand assets.
