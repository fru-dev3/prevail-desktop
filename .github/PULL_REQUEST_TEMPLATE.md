<!-- Conventional-commit title, e.g. feat(desktop): … / fix(engine): … -->

## What & why


## Checklist
- [ ] `npx tsc --noEmit` and `npm run build` pass
- [ ] `cargo test` and `cargo clippy` pass (in `src-tauri/`)
- [ ] New on-disk format? Added a Rust round-trip test
- [ ] No secrets committed; no `@tauri-apps/api` imports outside `src/bridge.ts`
- [ ] UI uses lucide icons (no emojis)
