# Epistemology Framework

Dedicated OpenCode plugin project for the epistemology framework.

This project is a behavior-preserving move of the previous local plugin from:

```text
/Users/guilhermecastro/.config/opencode/plugin/epistemology-framework
```

## Layout

- `src/` contains the moved plugin source, tests, and `src/server.ts` OpenCode entrypoint.
- `shared/effect-runtime.ts` is a DAMP copy of the small process/filesystem helper the local plugin used from `plugin/shared`.
- `.agents/sdlc/` tracks follow-up work for EPI provenance and review-tool salvage.

## Scripts

```sh
bun install
bun run typecheck
bun run test
bun run build
bun run check:imports
bun run verify
```

## Cutover

Do not delete the old local plugin source or change `opencode.json` until the cutover work item explicitly does it.
