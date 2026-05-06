# Groundwork PR remote context refactor

schema_id: sdlc-core/work-item/v1
owner_plugin: sdlc-core
id: gw-pr-remote-context-refactor

## Context

`taste score --signal TS-LD-02 .` reports `src/provenance/tooling/expand/pr-tools.ts` `resolveRemoteContext` as the top function-size/local-reasoning hotspot at 134 LOC. The function mixes local-mode short-circuiting, PR number detection, metadata command execution, metadata parsing, remote files/review context loading, confidence inference, and response DTO assembly.

## Acceptance Criteria

- [x] AC-1: Split `resolveRemoteContext` into focused remote-context helpers without changing `gw_pr_expand` or `gw_pr_materialize` args or output shape.
- [x] AC-2: Preserve local-mode unsupported responses, explicit/detected PR behavior, GitHub CLI failure envelopes, metadata parse failures, remote files/review context loading, confidence, and description bounding.
- [x] AC-3: Re-run `taste score --signal TS-LD-02 .` and confirm `resolveRemoteContext` is no longer the top TS-LD-02 function outlier.
- [x] AC-4: Run targeted PR provenance validation and full verification, then commit the completed slice.

## Notes

[2026-05-06]: Created from current taste output after `a1418da`; top diagnostic is `resolveRemoteContext` at 134 LOC.
[2026-05-06]: Split `resolveRemoteContext` into local-mode unsupported DTO creation, PR number resolution, metadata resolution, shared unavailable remote DTO creation, and available remote DTO assembly.
[2026-05-06]: Taste evidence: `taste score --signal TS-LD-02 .` no longer reports `resolveRemoteContext`; current top function outlier is `createStabilityReportTool` at 133 LOC.
[2026-05-06]: Targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-pr-tools.test.ts --reporter=verbose` (8 tests); `bun run test src/tests/provenance-pr-tools.test.ts src/tests/cli.test.ts -t "PR provenance|pr context|gw_pr|representative OpenCode provenance" --reporter=verbose` (9 tests).
[2026-05-06]: Full validation passed: `bun run verify` completed 26 files / 247 tests plus build/import/dist CLI/local-install checks.
[2026-05-06]: Verification review follow-up expanded PR provenance characterization for successful implicit PR detection, generic `GH_REMOTE_ERROR` envelopes, available remote confidence, and PR description truncation/bounds.
[2026-05-06]: Follow-up targeted validation passed: `bun run typecheck`; `bun run test src/tests/provenance-pr-tools.test.ts --reporter=verbose` (11 tests); `bun run test src/tests/provenance-pr-tools.test.ts src/tests/cli.test.ts -t "PR provenance|pr context|gw_pr|representative OpenCode provenance" --reporter=verbose` (12 tests).
[2026-05-06]: Follow-up full validation passed: `bun run verify` completed 26 files / 250 tests plus build/import/dist CLI/local-install checks.
