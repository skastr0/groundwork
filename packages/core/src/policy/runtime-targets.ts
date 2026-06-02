import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  FrameworkJsonObject,
  FrameworkToolTarget,
} from "../kernel/state.ts";
import {
  cloneLineRanges,
  collectPatchPayloads,
  mergeChangeTarget,
} from "./change-targets.ts";
import type { GuardrailChangeTarget } from "./config.ts";
import { extractChangeTargets } from "./config.ts";

export function materializeGuardrailTargets(
  rootDir: string,
  targets: readonly FrameworkToolTarget[],
  args?: unknown,
): GuardrailChangeTarget[] {
  const merged = new Map<string, GuardrailChangeTarget>();

  for (const target of targets) {
    const normalizedPath = target.normalizedPath ?? target.afterPath ?? target.beforePath;
    if (!normalizedPath) {
      continue;
    }

    mergeChangeTarget(merged, {
      normalizedPath,
      beforeContent: readTargetBeforeContent(target),
      changedLineRanges: cloneLineRanges(target.changedLineRanges),
      deletedLineRanges: cloneLineRanges(target.deletedLineRanges),
    });
  }

  for (const patchText of collectPatchPayloads(args)) {
    for (const patchTarget of extractChangeTargets(rootDir, { patchText })) {
      if (!merged.has(patchTarget.normalizedPath)) {
        continue;
      }

      mergeChangeTarget(merged, patchTarget);
    }
  }

  return Array.from(merged.values());
}

function readTargetBeforeContent(target: FrameworkToolTarget): string | null | undefined {
  const beforeContent = target.metadata && target.metadata.beforeContent;
  return typeof beforeContent === "string" || beforeContent === null ? beforeContent : undefined;
}

export async function snapshotFrameworkTargets(
  rootDir: string,
  targets: readonly FrameworkToolTarget[],
): Promise<FrameworkToolTarget[]> {
  return Promise.all(
    targets.map(async (target) => {
      const beforeContentPath = target.beforePath ?? target.normalizedPath ?? target.afterPath;
      const metadata: FrameworkJsonObject = target.metadata ? structuredClone(target.metadata) : {};

      if (!beforeContentPath) {
        metadata.beforeContent = null;
      } else {
        try {
          metadata.beforeContent = await fs.readFile(
            path.resolve(rootDir, beforeContentPath),
            "utf8",
          );
        } catch {
          metadata.beforeContent = null;
        }
      }

      return {
        ...target,
        changedLineRanges: cloneLineRanges(target.changedLineRanges),
        deletedLineRanges: cloneLineRanges(target.deletedLineRanges),
        metadata,
      };
    }),
  );
}
