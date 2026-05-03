# Groundwork Session Artifacts

Groundwork session artifacts provide durable local state for harnesses that do not share OpenCode's in-memory session kernel.

## Layout

Artifacts live under the project root by default:

```text
.groundwork/
└── sessions/
    └── <display-id>-<hash>/
        ├── state.json
        ├── events.jsonl
        └── traces.jsonl
```

Session directory names include a sanitized display prefix plus a hash of the original session id. This avoids collisions between ids such as `a/b`, `a:b`, and `a_b`.

`state.json` uses schema version `groundwork-session-artifacts/v1` and stores:

- session kernel state
- confirmed skills
- human override records
- action dedupe keys
- pending tool snapshots

`events.jsonl` is append-only operational evidence for state changes.

`traces.jsonl` is append-only trace evidence for hook/tool observations.

State writes use a per-session `.lock` file plus temp file rename. The lock serializes read-modify-write updates from concurrent hook calls, and the rename prevents partial JSON files.

## CLI Commands

All commands accept inline JSON, `@file`, or stdin.

```bash
groundwork session get '{"session_id":"codex-1"}'
groundwork session skill-loaded '{"session_id":"codex-1","skills":["groundwork"]}'
groundwork session override '{"session_id":"codex-1","reason":"human approved","rule_id":"policy.rule"}'
groundwork session remember-action '{"session_id":"codex-1","key":"policy.rule.inject","source":"policy","action":"inject_prompt"}'
groundwork session put-pending-tool '{"session_id":"codex-1","call_id":"call-1","tool_name":"Bash","args":{"command":"echo ok"}}'
groundwork session append-trace '{"session_id":"codex-1","trace":{"id":"trace-1","kind":"hook"}}'
groundwork session cleanup '{"older_than_days":30}'
```

Use `root_dir` to place artifacts somewhere other than the current working directory.

## Privacy And Retention

Session artifacts may contain:

- shell commands
- file paths
- tool arguments
- policy override reasons
- trace metadata

Do not store secrets in override reasons, tool args, or trace payloads. Keep `.groundwork/` out of published packages and public commits unless the project intentionally wants to preserve local harness evidence.

Use `groundwork session cleanup` to remove a specific `session_id` or stale sessions older than a retention window.
