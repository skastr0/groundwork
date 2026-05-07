# Source Guidance

Groundwork source code is organized by foundation. Keep shared behavior in foundation services and keep harness integrations thin.

Use these boundaries:

- `policy/`: policy loading and tool-call/result decisions.
- `context/`: inherited instruction discovery and touched-path reminders.
- `provenance/`: repo state and `gw_*` tool behavior.
- `risk/`: destructive command risk rules and evaluation.
- `session/`: durable Groundwork session artifact state.
- `cli/`: JSON-first command protocol, schemas, Codex installer, and Codex hook entrypoint.

When changing CLI protocol behavior, preserve JSON input modes, deterministic JSON envelopes, schema discoverability, and typed error output.

When changing policy or risk behavior, check harness parity and add targeted tests for both allowed and blocked paths.
