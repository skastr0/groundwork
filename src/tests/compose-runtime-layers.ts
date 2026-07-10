import type { PluginInput } from "@opencode-ai/plugin";
import { createFrameworkContextLayer } from "../../packages/core/src/context/index.ts";
import { createSessionKernelStore } from "../../packages/core/src/kernel/index.ts";
import { createGroundworkLayer } from "../../packages/core/src/layer/index.ts";
import { createFrameworkPolicyLayer } from "../../packages/core/src/policy/index.ts";
import { createFrameworkProvenanceLayer } from "../../packages/core/src/provenance/index.ts";
import { createFrameworkRiskLayer } from "../../packages/core/src/risk/index.ts";

/** Compose the same layer stack the old OpenCode plugin used (for unit tests). */
export async function composeRuntimeLayers(context: PluginInput) {
  const sessionStore = createSessionKernelStore();
  const policy = await createFrameworkPolicyLayer({
    client: context.client as never,
    directory: context.directory,
    ownSessionCleanup: false,
    sessionStore,
    worktree: context.worktree,
  });
  const contextLayer = await createFrameworkContextLayer({
    client: context.client as never,
    directory: context.directory,
    ownSessionCleanup: true,
    sessionStore,
    worktree: context.worktree,
  });
  const provenance = await createFrameworkProvenanceLayer({
    directory: context.directory,
    ownSessionCleanup: false,
    sessionStore,
    shell: context.$ as never,
    rootDir: context.worktree,
  });
  const risk = await createFrameworkRiskLayer({
    client: context.client as never,
    directory: context.directory,
    ownSessionCleanup: false,
    sessionStore,
    worktree: context.worktree,
  });
  return createGroundworkLayer({
    policy,
    context: contextLayer,
    provenance,
    risk,
  }) as never;
}
