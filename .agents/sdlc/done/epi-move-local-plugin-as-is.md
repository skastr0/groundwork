# Move local epistemology-framework plugin as-is

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: epi-move-local-plugin-as-is

## Context

The current implementation lives in `/Users/guilhermecastro/.config/opencode/plugin/epistemology-framework`. The first EPI project step should move it into this dedicated project without changing behavior.

## Acceptance Criteria

- [x] AC-1: Existing plugin source is moved into this project using the OpenCode plugin template shape where useful.
- [x] AC-2: Existing tests are preserved and runnable from this project.
- [x] AC-3: Build/import checks prove the server plugin loads.
- [x] AC-4: `/Users/guilhermecastro/.config/opencode/opencode.json` references this project after the move.
- [x] AC-5: Old local plugin source is deleted only after the new project loads successfully.

## Notes

[2026-04-24]: Seeded from the opencode plugin cleanup decision. Keep this move boring; extraction comes later.
[2026-04-24]: Moved the local plugin source into `src/`, DAMP-copied the shared Effect runtime, preserved PR comments support under `review/`, added the package/build shell, and pinned OpenCode SDK/Zod versions to `@opencode-ai/plugin@1.3.17` to avoid duplicate type identities. Validation passed: `bun run typecheck`, `bun run test` (153 tests), `bun run build`, and `bun run check:imports`. OpenCode config switch and old local source deletion are intentionally left for the cleanup cutover.
[2026-04-24]: Cleanup cutover completed: `opencode.json` now references `/Users/guilhermecastro/Projects/epistemology-framework`, and the old local `plugin/epistemology-framework*` source was removed from `/Users/guilhermecastro/.config/opencode`.
