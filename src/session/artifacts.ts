import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  createSessionKernelState,
  type FrameworkJsonObject,
  type FrameworkJsonValue,
  type FrameworkPendingToolCall,
  type FrameworkSessionKernelState,
} from "../kernel/state.ts";

export const SESSION_ARTIFACT_SCHEMA_VERSION = "groundwork-session-artifacts/v1";
const STATE_FILE = "state.json";
const EVENTS_FILE = "events.jsonl";
const TRACES_FILE = "traces.jsonl";
const LOCK_STALE_MS = 30_000;

export const SessionArtifactRootInputSchema = z
  .object({
    root_dir: z.string().min(1).optional(),
  })
  .strict();

export const SessionGetInputSchema = SessionArtifactRootInputSchema.extend({
  session_id: z.string().min(1),
}).strict();

export const SessionSkillLoadedInputSchema = SessionArtifactRootInputSchema.extend({
  session_id: z.string().min(1),
  skills: z.array(z.string().min(1)).min(1),
}).strict();

export const SessionOverrideInputSchema = SessionArtifactRootInputSchema.extend({
  session_id: z.string().min(1),
  reason: z.string().min(1),
  rule_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const SessionRememberActionInputSchema = SessionArtifactRootInputSchema.extend({
  session_id: z.string().min(1),
  key: z.string().min(1),
  source: z.string().min(1),
  action: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const SessionPutPendingToolInputSchema = SessionArtifactRootInputSchema.extend({
  session_id: z.string().min(1),
  call_id: z.string().min(1),
  tool_name: z.string().min(1),
  phase: z.enum(["before", "after"]).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  targets: z.array(z.record(z.string(), z.unknown())).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const SessionAppendTraceInputSchema = SessionArtifactRootInputSchema.extend({
  session_id: z.string().min(1),
  trace: z.record(z.string(), z.unknown()),
}).strict();

export const SessionCleanupInputSchema = SessionArtifactRootInputSchema.extend({
  older_than_days: z.number().int().positive().optional(),
  session_id: z.string().min(1).optional(),
}).strict();

export type SessionGetInput = z.infer<typeof SessionGetInputSchema>;
export type SessionSkillLoadedInput = z.infer<typeof SessionSkillLoadedInputSchema>;
export type SessionOverrideInput = z.infer<typeof SessionOverrideInputSchema>;
export type SessionRememberActionInput = z.infer<typeof SessionRememberActionInputSchema>;
export type SessionPutPendingToolInput = z.infer<typeof SessionPutPendingToolInputSchema>;
export type SessionAppendTraceInput = z.infer<typeof SessionAppendTraceInputSchema>;
export type SessionCleanupInput = z.infer<typeof SessionCleanupInputSchema>;

export interface SessionArtifactState {
  schemaVersion: typeof SESSION_ARTIFACT_SCHEMA_VERSION;
  session: FrameworkSessionKernelState;
  policy: {
    confirmedSkills: string[];
    overrides: Array<{
      id: string;
      reason: string;
      ruleId?: string;
      createdAt: string;
      metadata?: FrameworkJsonObject;
    }>;
  };
  actions: Record<
    string,
    {
      source: string;
      action: string;
      firstSeenAt: string;
      lastSeenAt: string;
      count: number;
      metadata?: FrameworkJsonObject;
    }
  >;
}

export function resolveArtifactRoot(rootDir?: string): string {
  return path.join(path.resolve(rootDir ?? process.cwd()), ".groundwork");
}

export async function getSessionArtifact(input: SessionGetInput) {
  const state = await readSessionState(input.root_dir, input.session_id);
  return toSessionArtifactResult(input.root_dir, input.session_id, state);
}

export async function markSessionSkillsLoaded(input: SessionSkillLoadedInput) {
  return withSessionLock(input.root_dir, input.session_id, async () => {
    const now = new Date().toISOString();
    const state = await readSessionState(input.root_dir, input.session_id);
    const skills = new Set(state.policy.confirmedSkills);
    for (const skill of input.skills) {
      skills.add(normalizeSkillName(skill));
    }
    state.policy.confirmedSkills = [...skills].sort();
    state.session.updatedAt = now;
    await writeSessionState(input.root_dir, input.session_id, state);
    await appendSessionEvent(input.root_dir, input.session_id, {
      type: "skill-loaded",
      timestamp: now,
      skills: input.skills.map(normalizeSkillName).sort(),
    });
    return toSessionArtifactResult(input.root_dir, input.session_id, state);
  });
}

export async function recordSessionOverride(input: SessionOverrideInput) {
  return withSessionLock(input.root_dir, input.session_id, async () => {
    const now = new Date().toISOString();
    const state = await readSessionState(input.root_dir, input.session_id);
    const override = {
      id: `override-${now}`,
      reason: input.reason,
      ruleId: input.rule_id,
      createdAt: now,
      metadata: toJsonObject(input.metadata),
    };
    state.policy.overrides.push(override);
    state.session.updatedAt = now;
    await writeSessionState(input.root_dir, input.session_id, state);
    await appendSessionEvent(input.root_dir, input.session_id, {
      type: "override",
      timestamp: now,
      override,
    });
    return toSessionArtifactResult(input.root_dir, input.session_id, state);
  });
}

export async function rememberSessionAction(input: SessionRememberActionInput) {
  return withSessionLock(input.root_dir, input.session_id, async () => {
    const now = new Date().toISOString();
    const state = await readSessionState(input.root_dir, input.session_id);
    const existing = state.actions[input.key];
    state.actions[input.key] = {
      source: input.source,
      action: input.action,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      count: (existing?.count ?? 0) + 1,
      metadata: toJsonObject(input.metadata),
    };
    state.session.updatedAt = now;
    await writeSessionState(input.root_dir, input.session_id, state);
    await appendSessionEvent(input.root_dir, input.session_id, {
      type: "action-remembered",
      timestamp: now,
      key: input.key,
      duplicate: existing !== undefined,
    });
    return {
      ...toSessionArtifactResult(input.root_dir, input.session_id, state),
      duplicate: existing !== undefined,
    };
  });
}

export async function putPendingSessionTool(input: SessionPutPendingToolInput) {
  return withSessionLock(input.root_dir, input.session_id, async () => {
    const now = new Date().toISOString();
    const state = await readSessionState(input.root_dir, input.session_id);
    const pending: FrameworkPendingToolCall = {
      callID: input.call_id,
      toolName: input.tool_name,
      phase: input.phase ?? "before",
      capturedAt: now,
      args: toJsonObject(input.args),
      targets: (input.targets ?? []).map((target) => ({
        path: typeof target["path"] === "string" ? target["path"] : "",
        metadata: toJsonObject(target),
      })),
      data: toJsonObject(input.data),
    };
    state.session.pendingTools.calls[input.call_id] = pending;
    state.session.updatedAt = now;
    await writeSessionState(input.root_dir, input.session_id, state);
    await appendSessionEvent(input.root_dir, input.session_id, {
      type: "pending-tool",
      timestamp: now,
      callID: input.call_id,
      toolName: input.tool_name,
    });
    return toSessionArtifactResult(input.root_dir, input.session_id, state);
  });
}

export async function appendSessionTrace(input: SessionAppendTraceInput) {
  return withSessionLock(input.root_dir, input.session_id, async () => {
    const now = new Date().toISOString();
    const state = await readSessionState(input.root_dir, input.session_id);
    state.session.updatedAt = now;
    await writeSessionState(input.root_dir, input.session_id, state);
    await appendJsonLine(resolveSessionFile(input.root_dir, input.session_id, TRACES_FILE), {
      timestamp: now,
      trace: input.trace,
    });
    return {
      session_id: input.session_id,
      artifact_root: resolveArtifactRoot(input.root_dir),
      trace_file: path.relative(
        path.resolve(input.root_dir ?? process.cwd()),
        resolveSessionFile(input.root_dir, input.session_id, TRACES_FILE),
      ),
    };
  });
}

export async function cleanupSessionArtifacts(input: SessionCleanupInput) {
  const root = resolveArtifactRoot(input.root_dir);
  const sessionsDir = path.join(root, "sessions");

  if (input.session_id) {
    const directory = resolveSessionDirectory(input.root_dir, input.session_id);
    const removed = await removeDirectoryIfExists(directory);
    return { artifact_root: root, removed: removed ? [input.session_id] : [] };
  }

  const olderThanMs = (input.older_than_days ?? 30) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - olderThanMs;
  const entries = await safeReadDir(sessionsDir);
  const removed: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(sessionsDir, entry.name);
    const stat = await fs.stat(directory).catch(() => null);
    if (!stat || stat.mtimeMs > cutoff) continue;
    if (await removeDirectoryIfExists(directory)) {
      removed.push(entry.name);
    }
  }

  return { artifact_root: root, removed: removed.sort() };
}

async function readSessionState(
  rootDir: string | undefined,
  sessionID: string,
): Promise<SessionArtifactState> {
  const filePath = resolveSessionFile(rootDir, sessionID, STATE_FILE);
  const raw = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!raw) {
    return createEmptySessionArtifactState(sessionID);
  }

  const parsed = JSON.parse(raw) as Partial<SessionArtifactState>;
  if (parsed.schemaVersion !== SESSION_ARTIFACT_SCHEMA_VERSION || !parsed.session) {
    return createEmptySessionArtifactState(sessionID);
  }

  return {
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    session: parsed.session,
    policy: {
      confirmedSkills: [...(parsed.policy?.confirmedSkills ?? [])].sort(),
      overrides: parsed.policy?.overrides ?? [],
    },
    actions: parsed.actions ?? {},
  };
}

async function writeSessionState(
  rootDir: string | undefined,
  sessionID: string,
  state: SessionArtifactState,
) {
  const filePath = resolveSessionFile(rootDir, sessionID, STATE_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function createEmptySessionArtifactState(sessionID: string): SessionArtifactState {
  return {
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    session: createSessionKernelState(sessionID),
    policy: {
      confirmedSkills: [],
      overrides: [],
    },
    actions: {},
  };
}

function toSessionArtifactResult(
  rootDir: string | undefined,
  sessionID: string,
  state: SessionArtifactState,
) {
  return {
    session_id: sessionID,
    artifact_root: resolveArtifactRoot(rootDir),
    state,
  };
}

async function appendSessionEvent(
  rootDir: string | undefined,
  sessionID: string,
  event: Record<string, unknown>,
) {
  await appendJsonLine(resolveSessionFile(rootDir, sessionID, EVENTS_FILE), event);
}

async function appendJsonLine(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function resolveSessionFile(rootDir: string | undefined, sessionID: string, fileName: string) {
  return path.join(resolveSessionDirectory(rootDir, sessionID), fileName);
}

function resolveSessionDirectory(rootDir: string | undefined, sessionID: string) {
  return path.join(resolveArtifactRoot(rootDir), "sessions", encodeSessionID(sessionID));
}

function encodeSessionID(sessionID: string): string {
  const digest = createHash("sha256").update(sessionID).digest("hex").slice(0, 16);
  const display = sessionID.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 48) || "session";
  return `${display}-${digest}`;
}

function normalizeSkillName(skill: string): string {
  return skill.trim().toLowerCase();
}

function toJsonObject(value: unknown): FrameworkJsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as FrameworkJsonObject;
}

async function removeDirectoryIfExists(directory: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) {
      return false;
    }
    await fs.rm(directory, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function withSessionLock<T>(
  rootDir: string | undefined,
  sessionID: string,
  run: () => Promise<T>,
): Promise<T> {
  const directory = resolveSessionDirectory(rootDir, sessionID);
  await fs.mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, ".lock");
  const acquired = await acquireLock(lockPath);
  try {
    return await run();
  } finally {
    if (acquired) {
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}

async function acquireLock(lockPath: string): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
        "utf8",
      );
      await handle.close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      await removeStaleLock(lockPath);
      await sleep(10 + attempt);
    }
  }

  throw new Error(`Timed out waiting for session artifact lock '${lockPath}'.`);
}

async function removeStaleLock(lockPath: string) {
  const stat = await fs.stat(lockPath).catch(() => null);
  if (!stat) return;
  if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadDir(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}
