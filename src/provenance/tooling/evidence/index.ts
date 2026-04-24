export {
  DEFAULT_LOCAL_EVIDENCE_BYTE_LIMIT,
  DEFAULT_LOCAL_EVIDENCE_SOURCE_LIMIT,
  LOCAL_EVIDENCE_SOURCE_VALUES,
  LOCAL_EVIDENCE_STATUS_VALUES,
  loadLocalPathEvidence,
  loadLocalSpanTraceEvidence,
} from "../../local-evidence.ts";
export type {
  LocalEvidenceMatch,
  LocalEvidenceSourceName,
  LocalEvidenceSourceResult,
  LocalEvidenceStatus,
  LocalMessageEvidenceItem,
  LocalPathEvidenceAnchor,
  LocalPathEvidenceOptions,
  LocalPathEvidenceRanking,
  LocalPathEvidenceResult,
  LocalSpanTraceEvidenceItem,
  LocalSpanTraceEvidenceOptions,
  LocalSpanTraceEvidenceResult,
  LocalSpanTraceEvidenceSourceResult,
  LocalSpanTraceMatchKind,
  LocalSpanTraceMatchMode,
  LocalSpanTraceRange,
  LocalTraceContributorSnapshot,
  LocalTraceContributorType,
  LocalTraceEvidenceItem,
  LocalWorkItemEvidenceItem,
} from "../../local-evidence.ts";

import type {
  LocalEvidenceMatch,
  LocalMessageEvidenceItem,
  LocalTraceEvidenceItem,
  LocalWorkItemEvidenceItem,
} from "../../local-evidence.ts";
import type { ProvenanceEvidenceSource } from "../contracts.ts";

export function toProvenanceEvidenceSource(item: LocalEvidenceMatch): ProvenanceEvidenceSource {
  if (item.kind === "message") {
    return toMessageEvidenceSource(item);
  }

  if (item.kind === "work_item") {
    return toWorkItemEvidenceSource(item);
  }

  return toTraceEvidenceSource(item);
}

export function toProvenanceEvidenceSources(
  items: readonly LocalEvidenceMatch[],
): ProvenanceEvidenceSource[] {
  return items.map((item) => toProvenanceEvidenceSource(item));
}

function toMessageEvidenceSource(item: LocalMessageEvidenceItem): ProvenanceEvidenceSource {
  return {
    kind: "message",
    id: item.id,
    path: item.packet,
    label: `${item.phase}:${item.type}`,
    detail: item.summary,
  };
}

function toWorkItemEvidenceSource(item: LocalWorkItemEvidenceItem): ProvenanceEvidenceSource {
  return {
    kind: "work_item",
    id: item.workItemID ?? item.id,
    path: item.path,
    label: item.title,
    detail: `${item.phase} | ${item.acceptance.completed}/${item.acceptance.total} criteria complete`,
  };
}

function toTraceEvidenceSource(item: LocalTraceEvidenceItem): ProvenanceEvidenceSource {
  return {
    kind: "trace",
    id: item.id,
    path: item.traceFile,
    ref: item.recordID,
    label: item.matchedPath,
    detail: item.sessionID ? `session ${item.sessionID}` : item.timestamp,
  };
}
