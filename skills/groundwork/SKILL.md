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
- `groundwork policy evaluate-tool-call '{"session_id":"codex","tool":"edit","args":{"path":"src/index.ts"}}'`
- `groundwork policy skill-loaded '{"session_id":"codex","skills":["sdlc"]}'`
- `groundwork context discover '{"target_path":"src/index.ts"}'`
- `groundwork context touched-paths '{"session_id":"codex","tool":"edit","args":{"path":"src/index.ts"}}'`
- `groundwork session render-compaction '{"session_id":"codex"}'`
- `groundwork provenance repo-state '{"limit":10}'`
- `groundwork provenance file-state '{"path":"src/index.ts"}'`

Codex hooks are best-effort guardrails. They can deny supported Bash/apply_patch/Edit/Write calls through `PreToolUse`, capture explicit policy commands from user prompts, and report post-tool policy feedback. They do not intercept every tool path, `PostToolUse` cannot undo side effects, and Codex V1 cannot inject tool-triggered synthetic prompts with full OpenCode parity.
