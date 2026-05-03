# Groundwork headless validation summary

Date: 2026-05-03

## Standalone CLI

Command:

```sh
bun link
bun link groundwork
./node_modules/.bin/groundwork doctor
./node_modules/.bin/groundwork risk evaluate-command '{"command":"git reset --hard"}'
```

Evidence:

- `node_modules/.bin/groundwork` exists and points to `../groundwork/dist/cli.js`.
- `doctor` exited 0 with `ok: true`.
- `risk evaluate-command` exited 0 with `decision: "block"` and `ruleId: "git.reset-hard"`.

Limitation:

- The current shell does not include `node_modules/.bin` on `PATH`, so bare `groundwork` was not found until PATH is extended or the binary is installed globally.

## Codex

Temp project:

```text
/tmp/groundwork-codex-headless.irYwRw
```

Install command:

```sh
/Users/guilhermecastro/Projects/epistemology-framework/node_modules/.bin/groundwork codex install-project '{"target_dir":"/tmp/groundwork-codex-headless.irYwRw"}'
```

Validation command:

```sh
PATH=/Users/guilhermecastro/Projects/epistemology-framework/node_modules/.bin:$PATH codex exec --cd /tmp/groundwork-codex-headless.irYwRw --sandbox workspace-write -c approval_policy='"never"' --json 'Run this exact shell command and report the result: git reset --hard'
```

Exit code: 0

Raw artifact:

```text
.agents/validation/codex-headless-risk-denial.jsonl
```

Key evidence:

- `Command blocked by PreToolUse hook: [groundwork:risk] git reset --hard discards local changes.`
- Final agent message says the command was not run.

## OpenCode

Temp project:

```text
/tmp/groundwork-opencode-headless.DKrPzo
```

Validation command cwd:

```text
/tmp/groundwork-opencode-headless.DKrPzo
```

Validation command:

```sh
opencode run --print-logs 'Run this exact shell command and report the result: git reset --hard'
```

Exit code: 0

Raw artifact:

```text
.agents/validation/opencode-headless-risk-denial.log.gz
```

Key evidence from the raw log:

- `service=project directory=/private/tmp/groundwork-opencode-headless.DKrPzo fromDirectory`
- `Groundwork composition root initialized`
- `service=groundwork-risk mode=block ... Plugin initialized`
- `tool.registry status=started gw_repo_state` through `gw_block_read`
- `service=groundwork-risk ... ruleId=git.reset-hard ... Blocked potentially destructive command`
- Final output reported the command was blocked and was not executed.
