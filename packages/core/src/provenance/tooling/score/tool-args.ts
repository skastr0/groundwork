import { z } from "zod";
import {
  createBoundedNumberArg,
  provenancePathArg,
} from "../args.ts";
import {
  ANALYSIS_LIMIT_OPTIONS,
  DIRECTORY_DEPTH_OPTIONS,
  DEFAULT_AUTHORITY_WINDOW_DAYS,
  DEFAULT_STABILITY_BASELINE_WINDOW_DAYS,
  DEFAULT_STABILITY_RECENT_WINDOW_DAYS,
  HISTORY_COMMIT_LIMIT_OPTIONS,
  MAX_WINDOW_COUNT,
} from "./constants.ts";

export const analysisLimitArg = createBoundedNumberArg({
  ...ANALYSIS_LIMIT_OPTIONS,
  description: "Max ranked hotspot rows and authors to return",
});

export const historyMaxCommitsArg = createBoundedNumberArg({
  ...HISTORY_COMMIT_LIMIT_OPTIONS,
  description: "Max historical commits to scan per analysis",
});

export const directoryDepthArg = createBoundedNumberArg({
  ...DIRECTORY_DEPTH_OPTIONS,
  description: "Directory depth to aggregate when grouping hotspots by path",
});

export const optionalPathArg = provenancePathArg
  .optional()
  .describe("Workspace-relative or absolute path anchor to inspect (default: .)");

export const hotspotWindowsArg = z
  .array(z.number().int().min(1).max(3650))
  .min(1)
  .max(MAX_WINDOW_COUNT)
  .optional()
  .describe("Lookback windows in whole days, anchored to HEAD authored time (default: 7, 30, 90)");

export const authorityWindowArg = z
  .number()
  .int()
  .min(1)
  .max(3650)
  .optional()
  .describe("Lookback window in whole days, anchored to HEAD authored time (default: 90)");

export const recentWindowArg = z
  .number()
  .int()
  .min(1)
  .max(3650)
  .optional()
  .describe("Recent lookback window in whole days, anchored to HEAD authored time (default: 14)");

export const baselineWindowArg = z
  .number()
  .int()
  .min(1)
  .max(3650)
  .optional()
  .describe("Baseline lookback window in whole days, anchored to HEAD authored time (default: 90)");

export const hotspotGroupByArg = z
  .enum(["file", "directory"])
  .optional()
  .describe("Aggregate hotspots by file or by directory path (default: file)");
