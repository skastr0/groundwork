# Contributing

Groundwork is a preview-stage, solo-maintained project. The preferred contribution path is issues-first: report reproducible bugs, documentation corrections, or scoped proposals before implementation work begins.

## What Helps

- Reproducible bug reports with exact commands and JSON input
- Documentation corrections
- Small fixes after maintainer confirmation
- Scoped proposals that explain policy, provenance, context, risk, or harness-integration impact

## What Is Out Of Scope

- Large rewrites without prior discussion
- Changes that make harness integrations thick instead of keeping shared behavior in Groundwork foundations
- Broad feature work that substantially increases support burden
- Public security reports; use the private reporting path in SECURITY.md

## Local Workflow

```sh
bun install
bun run verify
bun run pack:dry-run
```

Use the existing JSON-first CLI protocol, deterministic JSON envelopes, and typed schema discovery patterns. Preserve Codex/OpenCode harness parity when changing policy, risk, provenance, context, or session behavior.

## Pull Requests

Pull requests are reviewed when they are linked to an accepted issue or requested by the maintainer. Include verification results and the command or package surface affected. Unsolicited implementation PRs may be closed to preserve scope, compatibility, or product direction.

By contributing, you agree that your contribution is licensed under the MIT license used by this project.
