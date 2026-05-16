export const GW_HOTSPOTS_TOOL = "gw_hotspots" as const;
export const GW_AUTHORITY_TOOL = "gw_authority" as const;
export const GW_STABILITY_REPORT_TOOL = "gw_stability_report" as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_WINDOW_COUNT = 6;
export const MAX_SAMPLE_AUTHORS = 3;

export const DEFAULT_HOTSPOT_WINDOWS = [7, 30, 90] as const;
export const DEFAULT_AUTHORITY_WINDOW_DAYS = 90;
export const DEFAULT_STABILITY_RECENT_WINDOW_DAYS = 14;
export const DEFAULT_STABILITY_BASELINE_WINDOW_DAYS = 90;

export const HISTORY_HEAD_ANCHOR_METHOD = "git log -1 --format=%H%x1f%aI HEAD";
export const HISTORY_DETECTION_METHOD =
  "git rev-list --count --no-merges --since=<timestamp> HEAD -- <path> + git log --find-renames --no-merges --numstat -n <limit> --since=<timestamp> --format=%H%x1f%aI%x1f%an%x1f%ae%x1f%s HEAD -- <path>";

export const ANALYSIS_LIMIT_OPTIONS = {
  defaultValue: 5,
  maxValue: 25,
} as const;

export const HISTORY_COMMIT_LIMIT_OPTIONS = {
  defaultValue: 250,
  maxValue: 2000,
} as const;

export const DIRECTORY_DEPTH_OPTIONS = {
  defaultValue: 2,
  maxValue: 8,
  minValue: 1,
} as const;

export const historyParseMaxOutputBytes = 256_000;
