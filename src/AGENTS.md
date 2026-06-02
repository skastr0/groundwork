# CLI Source Guidance

This `src/` tree owns the root Groundwork CLI protocol, CLI metadata, and tests. Shared foundation behavior lives in `../packages/core/src/`, and harness wrappers live in `../packages/opencode-plugin/` and `../packages/codex/`.

Use these boundaries:

- `cli/`: JSON-first command protocol, schemas, discovery, and command execution.
- `tests/`: CLI, core, and package integration coverage.
- `metadata.ts`: package metadata surfaced by the root CLI package.

When changing CLI protocol behavior, preserve JSON input modes, deterministic JSON envelopes, schema discoverability, and typed error output.

When changing policy or risk behavior, check harness parity and add targeted tests for both allowed and blocked paths.
