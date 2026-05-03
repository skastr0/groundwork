---
name: groundwork
description: Use Groundwork for policy, provenance, context, and risk guardrails through the JSON-first groundwork CLI.
---

# Groundwork

Use the `groundwork` CLI when you need policy, provenance, context, or risk evidence.

Core commands:

- `groundwork doctor`
- `groundwork capabilities`
- `groundwork schema list`
- `groundwork examples list`
- `groundwork risk evaluate-command '{"command":"git reset --hard"}'`
- `groundwork context discover '{"target_path":"src/index.ts"}'`
- `groundwork provenance repo-state '{"limit":10}'`
- `groundwork provenance file-state '{"path":"src/index.ts"}'`

Codex hooks are best-effort guardrails. They can deny supported Bash calls through `PreToolUse`, but they do not intercept every tool path and cannot inject tool-triggered synthetic prompts with full OpenCode parity.
