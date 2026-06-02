# @skastr0/groundwork-core

Shared Groundwork library for policy, provenance, context, risk, and session foundations.

This package is the reusable foundation layer used by the Groundwork CLI, OpenCode wrapper, and Codex plugin bundle. It exports focused subpaths for consumers that need a specific foundation:

- `@skastr0/groundwork-core/context`
- `@skastr0/groundwork-core/policy`
- `@skastr0/groundwork-core/provenance`
- `@skastr0/groundwork-core/risk`
- `@skastr0/groundwork-core/session`

The root CLI also uses `@skastr0/groundwork-core/cli-support` as its package-owned support boundary.

The package is built as ESM for Node and requires Node matching the package engine.

## Build

```sh
bun run --cwd packages/core build
```

The build emits package JavaScript into `packages/core/dist`.
