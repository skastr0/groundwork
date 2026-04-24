export type TraceVersion = "0.1.0";

export type TraceContributorType = "human" | "ai" | "mixed" | "unknown";

export interface TraceContributor {
  type: TraceContributorType;
  model_id?: string;
}

export interface TraceRange {
  start_line: number;
  end_line: number;
  content_hash?: string;
  contributor?: TraceContributor;
}

export interface TraceRelatedResource {
  type: string;
  url: string;
}

export interface TraceConversation {
  url?: string;
  contributor?: TraceContributor;
  ranges: TraceRange[];
  related?: TraceRelatedResource[];
}

export interface TraceFile {
  path: string;
  conversations: TraceConversation[];
}

export type TraceVcsType = "git" | "jj" | "hg" | "svn";

export interface TraceVcs {
  type: TraceVcsType;
  revision: string;
}

export interface TraceTool {
  name?: string;
  version?: string;
}

export type TraceMetadata = Record<string, unknown>;

export const TRACE_OBSERVED_TOOL_VALUES = ["read", "grep", "glob"] as const;

export type TraceObservedToolName = (typeof TRACE_OBSERVED_TOOL_VALUES)[number];

export type TraceObservedToolStrategy = "path-only" | "path-list";

export interface TraceObservedToolBudget {
  maxBytes: number;
  usedBytes: number;
}

export interface TraceObservedTool {
  tool: TraceObservedToolName;
  callID?: string;
  capturedAt: string;
  strategy: TraceObservedToolStrategy;
  metadata: TraceMetadata;
  budget: TraceObservedToolBudget;
  truncatedFields?: string[];
}

export interface TraceRecord {
  version: TraceVersion;
  id: string;
  timestamp: string;
  vcs?: TraceVcs;
  tool?: TraceTool;
  files: TraceFile[];
  metadata?: TraceMetadata;
}

export interface SessionBufferFile {
  path: string;
  initialContent: string;
  finalContent: string;
  firstSeenAt: string;
  lastUpdatedAt: string;
  toolCalls: number;
  toolCallIDs: string[];
  initialHash?: string;
  finalHash?: string;
  metadata?: TraceMetadata;
}

export interface SessionBufferSnapshot {
  sessionID: string;
  startedAt: string;
  updatedAt: string;
  toolCalls: number;
  toolCounts: Record<string, number>;
  callIDs: string[];
  observedTools: TraceObservedTool[];
  files: SessionBufferFile[];
  metadata?: TraceMetadata;
}
