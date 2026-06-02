import type { ProvenanceConfidence, ProvenanceMode } from "../contracts.ts";
import type { CreateStateToolsOptions } from "../state/internal.ts";
import { buildBoundedText } from "./pr-bounds.ts";
import { parseJsonResult, runGhText } from "./pr-gh.ts";
import { resolveRemoteFiles } from "./pr-remote-files.ts";
import { resolveRemoteReviewContext } from "./pr-review-context.ts";
import {
  GH_PR_DETECT_METHOD,
  GH_PR_FETCH_METHOD,
  type GhFailure,
  type GhPrMetadata,
  type PrToolName,
  type RemoteMetadataResolution,
  type RemotePrNumberResolution,
} from "./pr-types.ts";
import type {
  PrRemoteContext,
  PrRemoteFiles,
  PrRemoteReviewContext,
} from "./schemas.ts";

function inferRemoteConfidence(
  files: PrRemoteFiles,
  reviewContext: PrRemoteReviewContext,
): ProvenanceConfidence {
  return files.status === "available" && reviewContext.status === "available" ? "medium" : "low";
}

export async function resolveRemoteContext(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  mode: ProvenanceMode;
  pr: number | undefined;
  limit: number | undefined;
  maxBytes: number | undefined;
}): Promise<PrRemoteContext> {
  if (options.mode === "local") {
    return createRemoteLookupDisabledContext(options.pr);
  }

  const prResolution = await resolveRemotePrNumber(options);
  if (!prResolution.success) {
    return prResolution.context;
  }

  const metadataResolution = await resolveRemoteMetadata({
    shell: options.shell,
    toolName: options.toolName,
    requestedNumber: prResolution.requestedNumber,
    detectionMethod: prResolution.detectionMethod,
    prNumber: prResolution.prNumber,
  });
  if (!metadataResolution.success) {
    return metadataResolution.context;
  }

  const files = await resolveRemoteFiles({
    shell: options.shell,
    toolName: options.toolName,
    prNumber: prResolution.prNumber,
    limit: options.limit,
  });
  const reviewContext = await resolveRemoteReviewContext({
    shell: options.shell,
    toolName: options.toolName,
    prNumber: prResolution.prNumber,
    limit: options.limit,
    maxBytes: options.maxBytes,
  });

  return createAvailableRemoteContext({
    metadata: metadataResolution.metadata,
    requestedNumber: prResolution.requestedNumber,
    detectionMethod: prResolution.detectionMethod,
    files,
    reviewContext,
    maxBytes: options.maxBytes,
  });
}

function createRemoteLookupDisabledContext(pr: number | undefined): PrRemoteContext {
  return {
    status: "unsupported",
    attempted: false,
    requestedNumber: pr ?? null,
    resolvedNumber: null,
    detectionMethod: "remote lookup disabled by local mode",
    confidence: "high",
    code: "REMOTE_LOOKUP_DISABLED",
    message: "Remote PR lookup is disabled in local mode.",
  };
}

async function resolveRemotePrNumber(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  pr: number | undefined;
}): Promise<RemotePrNumberResolution> {
  const requestedNumber = options.pr ?? null;
  const detectionMethod = options.pr ? "explicit pr input" : GH_PR_DETECT_METHOD;

  if (options.pr !== undefined) {
    return {
      success: true,
      requestedNumber,
      detectionMethod,
      prNumber: options.pr,
    };
  }

  const detectResult = await runGhText({
    shell: options.shell,
    toolName: options.toolName,
    command: GH_PR_DETECT_METHOD,
    cmd: ["gh", "pr", "view", "--json", "number", "--jq", ".number"],
  });

  if (!detectResult.success) {
    return {
      success: false,
      context: createUnavailableRemoteContext({
        requestedNumber,
        resolvedNumber: null,
        detectionMethod,
        failure: detectResult.failure,
      }),
    };
  }

  const parsedNumber = Number(detectResult.data.trim());
  if (!detectResult.data.trim() || Number.isNaN(parsedNumber)) {
    return {
      success: false,
      context: createUnavailableRemoteContext({
        requestedNumber,
        resolvedNumber: null,
        detectionMethod,
        failure: {
          confidence: "low",
          code: "PR_NOT_FOUND",
          message:
            "Remote PR context is unavailable: GitHub CLI did not return a pull request number.",
          retryable: false,
        },
      }),
    };
  }

  return {
    success: true,
    requestedNumber,
    detectionMethod,
    prNumber: parsedNumber,
  };
}

async function resolveRemoteMetadata(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  requestedNumber: number | null;
  detectionMethod: string;
  prNumber: number;
}): Promise<RemoteMetadataResolution> {
  const metadataCommand = `gh pr view ${options.prNumber} --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt`;
  const metadataResult = await runGhText({
    shell: options.shell,
    toolName: options.toolName,
    command: metadataCommand,
    cmd: [
      "gh",
      "pr",
      "view",
      String(options.prNumber),
      "--json",
      "number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
    ],
  });

  if (!metadataResult.success) {
    return {
      success: false,
      context: createUnavailableRemoteContext({
        requestedNumber: options.requestedNumber,
        resolvedNumber: options.prNumber,
        detectionMethod: options.detectionMethod,
        failure: metadataResult.failure,
      }),
    };
  }

  const parsedMetadata = parseJsonResult<GhPrMetadata>(
    metadataResult.data,
    `pull request #${options.prNumber}`,
  );
  if (!parsedMetadata.success) {
    return {
      success: false,
      context: createUnavailableRemoteContext({
        requestedNumber: options.requestedNumber,
        resolvedNumber: options.prNumber,
        detectionMethod: options.detectionMethod,
        failure: parsedMetadata.failure,
      }),
    };
  }

  return {
    success: true,
    metadata: parsedMetadata.data,
  };
}

function createUnavailableRemoteContext(options: {
  requestedNumber: number | null;
  resolvedNumber: number | null;
  detectionMethod: string;
  failure: GhFailure;
}): PrRemoteContext {
  return {
    status: "unavailable",
    attempted: true,
    requestedNumber: options.requestedNumber,
    resolvedNumber: options.resolvedNumber,
    detectionMethod: options.detectionMethod,
    confidence: options.failure.confidence,
    code: options.failure.code,
    message: options.failure.message,
    retryable: options.failure.retryable,
  };
}

function createAvailableRemoteContext(options: {
  metadata: GhPrMetadata;
  requestedNumber: number | null;
  detectionMethod: string;
  files: PrRemoteFiles;
  reviewContext: PrRemoteReviewContext;
  maxBytes: number | undefined;
}): PrRemoteContext {
  return {
    status: "available",
    attempted: true,
    requestedNumber: options.requestedNumber,
    resolvedNumber: options.metadata.number,
    detectionMethod: `${options.detectionMethod} + ${GH_PR_FETCH_METHOD}`,
    confidence: inferRemoteConfidence(options.files, options.reviewContext),
    metadata: {
      number: options.metadata.number,
      title: options.metadata.title,
      url: options.metadata.url,
      state: options.metadata.state,
      isDraft: options.metadata.isDraft,
      author: options.metadata.author?.login ?? null,
      baseRefName: options.metadata.baseRefName,
      headRefName: options.metadata.headRefName,
      createdAt: options.metadata.createdAt,
      updatedAt: options.metadata.updatedAt,
    },
    description: buildBoundedText(options.metadata.body, options.maxBytes),
    files: options.files,
    reviewContext: options.reviewContext,
  };
}
