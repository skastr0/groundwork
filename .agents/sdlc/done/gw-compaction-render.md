# Groundwork compaction render

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-compaction-render

## Context

OpenCode has `experimental.session.compacting`; Codex does not currently expose a direct compaction context hook. Groundwork should provide an explicit render command and best-effort stop/review nudges instead of claiming parity.

## Acceptance Criteria

- [x] AC-1: Add a CLI command that renders compact Groundwork session context from artifacts.
- [x] AC-2: Include policy locks, skill confirmations, provenance trace summary, and context reminders where available.
- [x] AC-3: Add Codex `Stop` hook guidance only where it can request continuation without pretending to alter compaction.
- [x] AC-4: Tests cover empty and populated artifact stores.
- [x] AC-5: Documentation states Codex compaction parity is unsupported in V1.

## Notes

[2026-05-03]: Depends on `gw-session-artifacts`.
[2026-05-03]: Added `groundwork session render-compaction` with JSON schema/discovery/example support. It renders compact text plus structured summary from durable session artifacts: confirmed skills, policy overrides, active locks, context reminder action state, and recent trace JSONL entries.
[2026-05-03]: Kept Codex `Stop` conservative: it returns JSON success and does not claim compaction hook parity. Updated Codex docs and skill text to point users to the explicit render command and state that Codex compaction parity is unsupported in V1.
[2026-05-03]: Added tests for populated and empty artifact stores. Verification: `bun run test src/tests/cli.test.ts` passed 46 tests; `bun run verify` passed 25 files / 203 tests plus build/import/CLI smoke.
[2026-05-03]: Reviewer Hubble found three issues: trace rendering read the whole trace file, populated tests did not assert active locks/context reminders, and stale cleanup returned encoded directory names for age-based removal. Fixed by bounded tail reads with `trace_limit <= 100`, stronger populated coverage including lock/context summary lines, stale cleanup returning original session ids when readable, and a Stop hook non-continuation assertion. Verification after fixes: `bun run test src/tests/cli.test.ts` passed 48 tests; `bun run verify` passed 25 files / 205 tests plus build/import/CLI smoke.
