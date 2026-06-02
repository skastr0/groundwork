import {
  clearFrameworkCacheEntry,
  getFrameworkCacheEntry,
  setFrameworkCacheEntry,
} from "../kernel/helpers.ts";
import type { FrameworkSessionKernelState } from "../kernel/state.ts";
import { POLICY_CONTENT_MATCH_CACHE_BUCKET } from "./runtime-types.ts";

export function readContentMatchCache(
  state: FrameworkSessionKernelState,
  ruleId: string,
  normalizedPath: string,
): boolean | undefined {
  const entry = getFrameworkCacheEntry(
    state,
    POLICY_CONTENT_MATCH_CACHE_BUCKET,
    createContentMatchCacheKey(ruleId, normalizedPath),
  );
  return typeof entry?.value === "boolean" ? entry.value : undefined;
}

export function writeContentMatchCache(
  state: FrameworkSessionKernelState,
  now: string,
  ruleId: string,
  normalizedPath: string,
  value: boolean,
): void {
  setFrameworkCacheEntry(state, {
    bucket: POLICY_CONTENT_MATCH_CACHE_BUCKET,
    key: createContentMatchCacheKey(ruleId, normalizedPath),
    now,
    value,
  });
}

export function invalidateContentMatchCache(
  state: FrameworkSessionKernelState,
  now: string,
  normalizedPaths: string[],
): void {
  const entries = state.caches.buckets[POLICY_CONTENT_MATCH_CACHE_BUCKET]?.entries;
  if (!entries) {
    return;
  }

  for (const key of Object.keys(entries)) {
    if (normalizedPaths.some((normalizedPath) => key.endsWith(`::${normalizedPath}`))) {
      clearFrameworkCacheEntry(state, {
        bucket: POLICY_CONTENT_MATCH_CACHE_BUCKET,
        key,
        now,
      });
    }
  }
}

function createContentMatchCacheKey(ruleId: string, normalizedPath: string): string {
  return `${ruleId}::${normalizedPath}`;
}
