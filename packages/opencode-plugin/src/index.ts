import type { Plugin } from "@opencode-ai/plugin";
import { createFrameworkContextLayer } from "@skastr0/groundwork-core/context";
import { createSessionKernelStore } from "@skastr0/groundwork-core/kernel";
import { createGroundworkLayer, GROUNDWORK_LAYER_META } from "@skastr0/groundwork-core/layer";
import { initLogger, logger } from "@skastr0/groundwork-core/logger";
import { createFrameworkPolicyLayer } from "@skastr0/groundwork-core/policy";
import { createFrameworkProvenanceLayer } from "@skastr0/groundwork-core/provenance";
import { createFrameworkRiskLayer } from "@skastr0/groundwork-core/risk";

export const GroundworkPlugin: Plugin = async ({ $, client, directory, worktree }) => {
  initLogger(client);
  logger.info(
    "Groundwork composition root initialized",
    GROUNDWORK_LAYER_META,
  );

  const sessionStore = createSessionKernelStore();

  const policy = await createFrameworkPolicyLayer({
    client,
    directory,
    ownSessionCleanup: false,
    sessionStore,
    worktree,
  });
  const context = await createFrameworkContextLayer({
    client,
    directory,
    ownSessionCleanup: true,
    sessionStore,
    worktree,
  });
  const provenance = await createFrameworkProvenanceLayer({
    directory,
    ownSessionCleanup: false,
    sessionStore,
    shell: $,
    rootDir: worktree,
  });
  const mutationRisk = await createFrameworkRiskLayer({
    client,
    directory,
    ownSessionCleanup: false,
    sessionStore,
    worktree,
  });

  return createGroundworkLayer({
    policy,
    context,
    provenance,
    "risk": mutationRisk,
  }) as unknown as Awaited<ReturnType<Plugin>>;
};

export default GroundworkPlugin;
