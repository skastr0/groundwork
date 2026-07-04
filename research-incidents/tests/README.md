# research-incidents fixture tests

This directory contains a standalone test runner for the shippable research-incident
policy rules under `../shippable-now/*.toml`.

## What it does

`test-shippable-policies.ts`:

1. Discovers every `.toml` file in `../shippable-now/`.
2. Parses each file with `Bun.TOML.parse`.
3. For each rule that uses `ast_grep` or `semgrep` content matching:
   - Finds `../fixtures/<rule-id>/positive.*` and `../fixtures/<rule-id>/negative.*` files.
   - Runs `sg` (ast-grep) or `semgrep` against those fixtures using the same
     inline-rule/config shape the Groundwork policy engine uses.
   - Reports `pass`/`fail`/`pending-runtime` per rule.
4. Rules that require full Groundwork runtime behavior (e.g. `changed_lines` scope,
   command/message matching, or missing content matchers) are marked `pending-runtime`.

## Requirements

- [Bun](https://bun.sh/) (the project package manager).
- `sg` (ast-grep CLI) in `PATH` to test `ast_grep` matchers.
- `semgrep` in `PATH` to test `semgrep` matchers.

If `sg` is not installed, install ast-grep (e.g. `brew install ast-grep`) or install
`@ast-grep/napi` and adapt the runner to call the N-API bindings. The current runner
uses the CLI because `sg` is the interface the production Groundwork code spawns.

## Running the tests

From the repository root:

```bash
bun ./research-incidents/tests/test-shippable-policies.ts
```

Or from this directory:

```bash
bun ./test-shippable-policies.ts
```

The script exits with code `1` if any rule is reported as `fail`; otherwise it exits
with code `0`.

## Adding fixtures

For a rule with id `<rule-id>`, create:

- `../fixtures/<rule-id>/positive.<ext>` — files that SHOULD trigger the rule.
- `../fixtures/<rule-id>/negative.<ext>` — files that SHOULD NOT trigger the rule.

Use extensions that ast-grep/semgrep can infer a language from (`.ts`, `.js`, `.py`,
`.go`, etc.). Multiple positive or negative files are supported.

## Interpreting failures

A `fail` result means the rule did not behave as expected against the fixtures. Common
causes:

- The ast-grep/semgrep pattern does not match the intended real-world code.
- A positive fixture is missing or a negative fixture unexpectedly matches.
- The matcher CLI is not installed or exited with an unexpected error.

Fixtures are intended to be honest: if a rule pattern is malformed, the runner surfaces
that as a failure so the rule can be corrected before it is considered truly shippable.
