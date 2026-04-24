import path from "node:path";
import { appendFileString, mkdirAll } from "../../../shared/effect-runtime.ts";
import type { TraceRecord } from "./types.ts";
import { logger } from "../../logger/index.ts";

export interface JsonlTraceWriterOptions {
  rootDir: string;
  sessionID: string;
  records: TraceRecord[];
}

const TRACE_DIRECTORY = ".agents/traces";
const SAFE_SESSION_ID_PATTERN = /[^A-Za-z0-9_-]/g;

const sanitizeSessionID = (sessionID: string): string => {
  const sanitized = sessionID.replace(SAFE_SESSION_ID_PATTERN, "_");

  return sanitized.length > 0 ? sanitized : "unknown";
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isIsoTimestamp = (value: unknown): value is string =>
  isNonEmptyString(value) && !Number.isNaN(Date.parse(value));

const hasObservedTools = (record: Record<string, unknown>): boolean => {
  const metadata = isObject(record.metadata) ? record.metadata : undefined;
  const session = metadata && isObject(metadata.session) ? metadata.session : undefined;
  return Array.isArray(session?.observedTools) && session.observedTools.length > 0;
};

const validateObservedTools = (record: Record<string, unknown>, issues: string[]): void => {
  const metadata = isObject(record.metadata) ? record.metadata : undefined;
  const session = metadata && isObject(metadata.session) ? metadata.session : undefined;
  const observedTools = session?.observedTools;
  if (!Array.isArray(observedTools)) {
    return;
  }

  observedTools.forEach((observedTool, index) => {
    if (!isObject(observedTool)) {
      issues.push(`metadata.session.observedTools[${index}] must be an object`);
      return;
    }

    if (!isNonEmptyString(observedTool.tool)) {
      issues.push(`metadata.session.observedTools[${index}].tool must be a non-empty string`);
    }

    if (!isIsoTimestamp(observedTool.capturedAt)) {
      issues.push(
        `metadata.session.observedTools[${index}].capturedAt must be a valid ISO-8601 string`,
      );
    }

    if (!isNonEmptyString(observedTool.strategy)) {
      issues.push(`metadata.session.observedTools[${index}].strategy must be a non-empty string`);
    }

    if (!isObject(observedTool.metadata)) {
      issues.push(`metadata.session.observedTools[${index}].metadata must be an object`);
    }

    const budget = observedTool.budget;
    if (!isObject(budget)) {
      issues.push(`metadata.session.observedTools[${index}].budget must be an object`);
    } else {
      if (!isPositiveInteger(budget.maxBytes)) {
        issues.push(
          `metadata.session.observedTools[${index}].budget.maxBytes must be a positive integer`,
        );
      }

      if (!isPositiveInteger(budget.usedBytes)) {
        issues.push(
          `metadata.session.observedTools[${index}].budget.usedBytes must be a positive integer`,
        );
      }

      if (
        isPositiveInteger(budget.maxBytes) &&
        isPositiveInteger(budget.usedBytes) &&
        budget.usedBytes > budget.maxBytes
      ) {
        issues.push(
          `metadata.session.observedTools[${index}].budget.usedBytes must not exceed budget.maxBytes`,
        );
      }
    }

    if (
      observedTool.truncatedFields !== undefined &&
      (!Array.isArray(observedTool.truncatedFields) ||
        observedTool.truncatedFields.some((field) => !isNonEmptyString(field)))
    ) {
      issues.push(
        `metadata.session.observedTools[${index}].truncatedFields must be an array of non-empty strings`,
      );
    }
  });
};

const validateTraceRecord = (record: unknown): string[] => {
  const issues: string[] = [];

  if (!isObject(record)) {
    return ["record must be an object"];
  }

  if (record.version !== "0.1.0") {
    issues.push("version must be '0.1.0'");
  }

  if (!isNonEmptyString(record.id)) {
    issues.push("id must be a non-empty string");
  }

  if (!isIsoTimestamp(record.timestamp)) {
    issues.push("timestamp must be a valid ISO-8601 string");
  }

  const files = record.files;
  if (!Array.isArray(files)) {
    issues.push("files must be a non-empty array");
    return issues;
  }

  if (files.length === 0 && !hasObservedTools(record)) {
    issues.push("files must be a non-empty array");
  }

  validateObservedTools(record, issues);

  files.forEach((file, fileIndex) => {
    if (!isObject(file)) {
      issues.push(`files[${fileIndex}] must be an object`);
      return;
    }

    if (!isNonEmptyString(file.path)) {
      issues.push(`files[${fileIndex}].path must be a non-empty string`);
    }

    const conversations = file.conversations;
    if (!Array.isArray(conversations) || conversations.length === 0) {
      issues.push(`files[${fileIndex}].conversations must be a non-empty array`);
      return;
    }

    conversations.forEach((conversation, conversationIndex) => {
      if (!isObject(conversation)) {
        issues.push(`files[${fileIndex}].conversations[${conversationIndex}] must be an object`);
        return;
      }

      const ranges = conversation.ranges;
      if (!Array.isArray(ranges) || ranges.length === 0) {
        issues.push(
          `files[${fileIndex}].conversations[${conversationIndex}].ranges must be a non-empty array`,
        );
        return;
      }

      ranges.forEach((range, rangeIndex) => {
        if (!isObject(range)) {
          issues.push(
            `files[${fileIndex}].conversations[${conversationIndex}].ranges[${rangeIndex}] must be an object`,
          );
          return;
        }

        if (!isPositiveInteger(range.start_line)) {
          issues.push(
            `files[${fileIndex}].conversations[${conversationIndex}].ranges[${rangeIndex}].start_line must be a positive integer`,
          );
        }

        if (!isPositiveInteger(range.end_line)) {
          issues.push(
            `files[${fileIndex}].conversations[${conversationIndex}].ranges[${rangeIndex}].end_line must be a positive integer`,
          );
        }

        if (
          isPositiveInteger(range.start_line) &&
          isPositiveInteger(range.end_line) &&
          range.end_line < range.start_line
        ) {
          issues.push(
            `files[${fileIndex}].conversations[${conversationIndex}].ranges[${rangeIndex}] has end_line before start_line`,
          );
        }
      });
    });
  });

  return issues;
};

const collectValidRecords = (records: TraceRecord[], sessionID: string): TraceRecord[] => {
  const validRecords: TraceRecord[] = [];

  records.forEach((record, recordIndex) => {
    const issues = validateTraceRecord(record);

    if (issues.length > 0) {
      const recordID = isObject(record) && typeof record.id === "string" ? record.id : undefined;
      logger.warn("Skipping invalid trace record", {
        sessionID,
        recordIndex,
        recordID,
        issueCount: issues.length,
        issues,
      });
      return;
    }

    validRecords.push(record);
  });

  return validRecords;
};

export async function appendTraceRecords(options: JsonlTraceWriterOptions): Promise<void> {
  const { rootDir, sessionID, records } = options;
  const traceDir = path.join(rootDir, TRACE_DIRECTORY);

  await mkdirAll(traceDir);

  if (records.length === 0) return;

  const validRecords = collectValidRecords(records, sessionID);
  if (validRecords.length === 0) return;

  const safeSessionID = sanitizeSessionID(sessionID);
  const filePath = path.join(traceDir, `session-${safeSessionID}.jsonl`);
  const payload = `${validRecords.map((record) => JSON.stringify(record)).join("\n")}\n`;

  await appendFileString(filePath, payload);
}
