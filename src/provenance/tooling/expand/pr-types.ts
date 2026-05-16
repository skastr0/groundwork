import type { ProvenanceConfidence } from "../contracts.ts";
import {
  GW_PR_EXPAND_TOOL,
  GW_PR_MATERIALIZE_TOOL,
  type PrRemoteContext,
} from "./schemas.ts";

export const LOCAL_BRANCH_DIFF_METHOD =
  "git diff --find-renames --unified=0 <base-ref>..HEAD -- .";
export const GH_PR_DETECT_METHOD = "gh pr view --json number --jq '.number'";
export const GH_PR_FETCH_METHOD =
  "gh pr view <pr> --json metadata + gh api pulls/<pr>/files + gh api pulls/<pr>/reviews + gh api pulls/<pr>/comments";
export const MAX_REVIEW_BODY_BYTES = 400;
export const GH_COMMAND_TIMEOUT_MS = 20_000;
export const LOCAL_BRANCH_DIFF_TIMEOUT_MS = 15_000;
export const PR_REMOTE_PARSE_MAX_OUTPUT_BYTES = 256_000;
export const PR_LOCAL_DIFF_PARSE_MAX_OUTPUT_BYTES = 384_000;

export type PrToolName = typeof GW_PR_MATERIALIZE_TOOL | typeof GW_PR_EXPAND_TOOL;

export type GhFailure = {
  code: string;
  message: string;
  retryable: boolean;
  confidence: ProvenanceConfidence;
};

export type GhResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      failure: GhFailure;
    };

export type GhPrMetadata = {
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: string;
  isDraft: boolean;
  author: { login: string } | null;
  baseRefName: string;
  headRefName: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GhPrFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
};

export type RemotePrNumberResolution =
  | {
      success: true;
      requestedNumber: number | null;
      detectionMethod: string;
      prNumber: number;
    }
  | {
      success: false;
      context: PrRemoteContext;
    };

export type RemoteMetadataResolution =
  | {
      success: true;
      metadata: GhPrMetadata;
    }
  | {
      success: false;
      context: PrRemoteContext;
    };
