# @skastr0/groundwork-opencode-plugin

OpenCode runtime wrapper for Groundwork.

This package exports the OpenCode plugin entrypoint from `dist/server.js` and uses `@skastr0/groundwork-core` for shared policy, provenance, context, risk, and session behavior. The wrapper stays focused on OpenCode runtime integration while the reusable Groundwork foundations live in the core package.

## Build

```sh
bun run --cwd packages/opencode-plugin build
```

The build emits `packages/opencode-plugin/dist/server.js`. OpenCode development configs can point at this package after the workspace build has completed.
