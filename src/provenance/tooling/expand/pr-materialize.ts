import type { ProvenanceMode } from "../contracts.ts";
import {
  resolveLocalRepoState,
  toProvRepoStateData,
  type CreateStateToolsOptions,
  type LocalRepoState,
} from "../state/index.ts";
import {
  resolveFallback,
  resolveLocalBranchContext,
} from "./pr-local-context.ts";
import { resolveRemoteContext } from "./pr-remote-context.ts";
import type { PrToolName } from "./pr-types.ts";
import type { ProvPrMaterializeData } from "./schemas.ts";

export async function materializePrContext(
  options: CreateStateToolsOptions,
  toolName: PrToolName,
  args: {
    pr?: number;
    base?: string;
    mode: ProvenanceMode;
    limit?: number;
    max_bytes?: number;
  },
): Promise<ProvPrMaterializeData> {
  let repo: ProvPrMaterializeData["repo"];
  let localBranch: ProvPrMaterializeData["localBranch"];
  let repoState: LocalRepoState | undefined;

  if (args.mode !== "remote") {
    repoState = await resolveLocalRepoState({
      shell: options.shell,
      explicitBase: args.base,
    });
    repo = toProvRepoStateData(repoState, args.limit);
    localBranch = await resolveLocalBranchContext({
      shell: options.shell,
      repoState,
      limit: args.limit,
    });
  }

  const remote = await resolveRemoteContext({
    shell: options.shell,
    toolName,
    mode: args.mode,
    pr: args.pr,
    limit: args.limit,
    maxBytes: args.max_bytes,
  });

  return {
    repo,
    localBranch,
    remote,
    fallback: resolveFallback(args.mode, localBranch, remote),
  };
}
