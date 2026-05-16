import { spawn as spawnChildProcess } from "node:child_process";
import { type Dirent, promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import { Effect } from "effect";

export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
export const DEFAULT_FILESYSTEM_TIMEOUT_MS = 5_000;
export const DEFAULT_EFFECT_CONCURRENCY = 4;
export const DEFAULT_COMMAND_MAX_OUTPUT_BYTES = 512_000;
export const PROCESS_RUNNER = Symbol.for("opencode.processRunner");

type TextEncoding = BufferEncoding;
export type ProcessCommand = readonly [string, ...string[]];
export type ProcessStreamKind = "stdout" | "stderr";
export type ProcessRunner = (options: {
  cmd: ProcessCommand;
  timeoutMs: number;
  maxOutputBytes: number;
  cwd?: string;
}) => Promise<string>;
export type ProcessRunnerCarrier = {
  [PROCESS_RUNNER]: ProcessRunner;
};

type SpawnProcessTextOptions = {
  cmd: ProcessCommand;
  timeoutMs: number;
  maxOutputBytes: number;
  cwd?: string;
};

type ProcessTextSpawnContext = SpawnProcessTextOptions & {
  command: string;
  controller: AbortController;
  didTimeOut: () => boolean;
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
};

class CommandFailedError extends Error {
  readonly _tag = "CommandFailedError";
  readonly code?: string;
  readonly originalError: unknown;

  constructor(
    readonly command: string,
    error: unknown,
  ) {
    super(`Command failed: ${command}: ${toErrorMessage(error)}`);
    this.name = "CommandFailedError";
    this.code = toErrorCode(error);
    this.originalError = error;
  }
}

class CommandTimedOutError extends Error {
  readonly _tag = "CommandTimedOutError";

  constructor(
    readonly command: string,
    readonly timeoutMs: number,
  ) {
    super(`Command timed out after ${timeoutMs}ms: ${command}`);
    this.name = "CommandTimedOutError";
  }
}

class CommandOutputLimitError extends Error {
  readonly _tag = "CommandOutputLimitError";

  constructor(
    readonly command: string,
    readonly maxOutputBytes: number,
    readonly stream: ProcessStreamKind,
  ) {
    super(`Command ${stream} exceeded ${maxOutputBytes} bytes: ${command}`);
    this.name = "CommandOutputLimitError";
  }
}

class FileSystemError extends Error {
  readonly _tag = "FileSystemError";
  readonly code?: string;
  readonly originalError: unknown;

  constructor(
    readonly operation: string,
    readonly target: string,
    error: unknown,
  ) {
    super(`Filesystem ${operation} failed for '${target}': ${toErrorMessage(error)}`);
    this.name = "FileSystemError";
    this.code = toErrorCode(error);
    this.originalError = error;
  }
}

class FileSystemTimedOutError extends Error {
  readonly _tag = "FileSystemTimedOutError";

  constructor(
    readonly operation: string,
    readonly target: string,
    readonly timeoutMs: number,
  ) {
    super(`Filesystem ${operation} timed out after ${timeoutMs}ms for '${target}'`);
    this.name = "FileSystemTimedOutError";
  }
}

export type CommandRuntimeError =
  | CommandFailedError
  | CommandTimedOutError
  | CommandOutputLimitError;
export type FileSystemRuntimeError = FileSystemError | FileSystemTimedOutError;

export type ReadDirectoryResult =
  | { status: "available"; entries: Dirent[] }
  | { status: "missing" }
  | { status: "error"; error: FileSystemRuntimeError };

export type ReadFileResult =
  | { status: "available"; content: string }
  | { status: "missing" }
  | { status: "error"; error: FileSystemRuntimeError };

function withPromiseTimeout<T>(options: {
  run: () => Promise<T>;
  timeoutMs: number;
  onTimeout: () => Error;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(options.onTimeout());
    }, options.timeoutMs);

    options.run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function hasProcessRunner(value: unknown): value is ProcessRunnerCarrier {
  return (
    value !== null &&
    (typeof value === "function" || typeof value === "object") &&
    PROCESS_RUNNER in value
  );
}

function formatProcessCommand(cmd: ProcessCommand): string {
  return cmd.join(" ");
}

async function readWebStreamText(options: {
  stream: ReadableStream<Uint8Array> | null | undefined;
  command: string;
  streamKind: ProcessStreamKind;
  maxOutputBytes: number;
  controller: AbortController;
}): Promise<string> {
  if (!options.stream) {
    return "";
  }

  const reader = options.stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let usedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      usedBytes += value.byteLength;
      if (usedBytes > options.maxOutputBytes) {
        options.controller.abort();
        throw new CommandOutputLimitError(
          options.command,
          options.maxOutputBytes,
          options.streamKind,
        );
      }

      output += decoder.decode(value, { stream: true });
    }

    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function readNodeStreamText(options: {
  stream: NodeJS.ReadableStream | null | undefined;
  command: string;
  streamKind: ProcessStreamKind;
  maxOutputBytes: number;
  controller: AbortController;
}): Promise<string> {
  if (!options.stream) {
    return Promise.resolve("");
  }

  const stream = options.stream;

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let usedBytes = 0;
    let settled = false;

    const cleanup = () => {
      stream.removeListener("data", onData);
      stream.removeListener("error", onError);
      stream.removeListener("end", onEnd);
      stream.removeListener("close", onEnd);
    };

    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };

    const onData = (chunk: string | Buffer) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
      usedBytes += buffer.byteLength;
      if (usedBytes > options.maxOutputBytes) {
        options.controller.abort();
        finishReject(
          new CommandOutputLimitError(options.command, options.maxOutputBytes, options.streamKind),
        );
        return;
      }
      chunks.push(buffer);
    };

    const onError = (error: Error) => {
      finishReject(error);
    };

    const onEnd = () => {
      finishResolve();
    };

    stream.on("data", onData);
    stream.on("error", onError);
    stream.on("end", onEnd);
    stream.on("close", onEnd);
  });
}

async function spawnProcessText(options: SpawnProcessTextOptions): Promise<string> {
  const command = formatProcessCommand(options.cmd);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const context: ProcessTextSpawnContext = {
    ...options,
    command,
    controller,
    didTimeOut: () => timedOut,
  };

  try {
    if (typeof Bun !== "undefined" && typeof Bun.spawn === "function") {
      return await spawnBunProcessText(context);
    }

    return await spawnNodeProcessText(context);
  } catch (error) {
    if (timedOut) {
      throw new CommandTimedOutError(command, options.timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function spawnBunProcessText(options: ProcessTextSpawnContext): Promise<string> {
  const subprocess = Bun.spawn({
    cmd: [...options.cmd],
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: options.controller.signal,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readWebStreamText({
      stream: subprocess.stdout,
      command: options.command,
      streamKind: "stdout",
      maxOutputBytes: options.maxOutputBytes,
      controller: options.controller,
    }),
    readWebStreamText({
      stream: subprocess.stderr,
      command: options.command,
      streamKind: "stderr",
      maxOutputBytes: options.maxOutputBytes,
      controller: options.controller,
    }),
    subprocess.exited,
  ]);

  assertProcessCompleted(options);
  assertSuccessfulExit(exitCode, stderr, "null");
  return stdout;
}

async function spawnNodeProcessText(options: ProcessTextSpawnContext): Promise<string> {
  const subprocess = spawnChildProcess(options.cmd[0], options.cmd.slice(1), {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    signal: options.controller.signal,
    killSignal: "SIGKILL",
  });

  const exitCodePromise = new Promise<number | null>((resolve, reject) => {
    subprocess.on("error", (error: Error) => {
      reject(
        options.didTimeOut()
          ? new CommandTimedOutError(options.command, options.timeoutMs)
          : error,
      );
    });
    subprocess.on("close", (code) => {
      resolve(code);
    });
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readNodeStreamText({
      stream: subprocess.stdout,
      command: options.command,
      streamKind: "stdout",
      maxOutputBytes: options.maxOutputBytes,
      controller: options.controller,
    }),
    readNodeStreamText({
      stream: subprocess.stderr,
      command: options.command,
      streamKind: "stderr",
      maxOutputBytes: options.maxOutputBytes,
      controller: options.controller,
    }),
    exitCodePromise,
  ]);

  assertProcessCompleted(options);
  assertSuccessfulExit(exitCode, stderr, "null");
  return stdout;
}

function assertProcessCompleted(options: ProcessTextSpawnContext): void {
  if (options.didTimeOut()) {
    throw new CommandTimedOutError(options.command, options.timeoutMs);
  }
}

function assertSuccessfulExit(
  exitCode: number | null,
  stderr: string,
  nullExitLabel: string,
): void {
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `exit code ${exitCode ?? nullExitLabel}`);
  }
}

function processTextEffect(options: {
  cmd: ProcessCommand;
  timeoutMs?: number;
  maxOutputBytes?: number;
  shell?: unknown;
  cwd?: string;
}): Effect.Effect<string, CommandRuntimeError> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_COMMAND_MAX_OUTPUT_BYTES;
  const command = formatProcessCommand(options.cmd);

  return Effect.tryPromise({
    try: () => {
      if (hasProcessRunner(options.shell)) {
        const processRunner = options.shell[PROCESS_RUNNER];
        return withPromiseTimeout({
          run: async () => {
            const output = await processRunner({
              cmd: options.cmd,
              timeoutMs,
              maxOutputBytes,
              cwd: options.cwd,
            });
            if (Buffer.byteLength(output, "utf8") > maxOutputBytes) {
              throw new CommandOutputLimitError(command, maxOutputBytes, "stdout");
            }
            return output;
          },
          timeoutMs,
          onTimeout: () => new CommandTimedOutError(command, timeoutMs),
        });
      }

      return spawnProcessText({
        cmd: options.cmd,
        timeoutMs,
        maxOutputBytes,
        cwd: options.cwd,
      });
    },
    catch: (error) =>
      error instanceof CommandTimedOutError || error instanceof CommandOutputLimitError
        ? error
        : new CommandFailedError(command, error),
  });
}

function commandTextEffect(options: {
  command: string;
  exec: () => Promise<string>;
  timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  return Effect.tryPromise({
    try: () =>
      withPromiseTimeout({
        run: options.exec,
        timeoutMs,
        onTimeout: () => new CommandTimedOutError(options.command, timeoutMs),
      }),
    catch: (error) =>
      error instanceof CommandTimedOutError
        ? error
        : new CommandFailedError(options.command, error),
  });
}

function fileSystemEffect<T>(options: {
  operation: string;
  target: string;
  run: () => Promise<T>;
  timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FILESYSTEM_TIMEOUT_MS;

  return Effect.tryPromise({
    try: () =>
      withPromiseTimeout({
        run: options.run,
        timeoutMs,
        onTimeout: () => new FileSystemTimedOutError(options.operation, options.target, timeoutMs),
      }),
    catch: (error) =>
      error instanceof FileSystemTimedOutError
        ? error
        : new FileSystemError(options.operation, options.target, error),
  });
}

function applyTrim(value: string, trim: boolean | undefined): string {
  return trim === false ? value : value.trim();
}

function toAvailableDirectoryResult(entries: Dirent[]): ReadDirectoryResult {
  return {
    status: "available",
    entries,
  };
}

function toMissingDirectoryResult(): ReadDirectoryResult {
  return {
    status: "missing",
  };
}

function toDirectoryErrorResult(error: FileSystemRuntimeError): ReadDirectoryResult {
  return {
    status: "error",
    error,
  };
}

function toAvailableFileResult(content: string): ReadFileResult {
  return {
    status: "available",
    content,
  };
}

function toMissingFileResult(): ReadFileResult {
  return {
    status: "missing",
  };
}

function toFileErrorResult(error: FileSystemRuntimeError): ReadFileResult {
  return {
    status: "error",
    error,
  };
}

export async function runCommandText(options: {
  command: string;
  exec: () => Promise<string>;
  timeoutMs?: number;
  trim?: boolean;
}): Promise<string> {
  const value = await Effect.runPromise(commandTextEffect(options));
  return applyTrim(value, options.trim);
}

export async function runOptionalCommandText(options: {
  command: string;
  exec: () => Promise<string>;
  timeoutMs?: number;
  trim?: boolean;
}): Promise<string> {
  const value = await Effect.runPromise(
    commandTextEffect(options).pipe(
      Effect.catchAll((error: CommandRuntimeError) =>
        error instanceof CommandFailedError ? Effect.succeed("") : Effect.fail(error),
      ),
    ),
  );
  return applyTrim(value, options.trim);
}

export async function runProcessText(options: {
  cmd: ProcessCommand;
  timeoutMs?: number;
  maxOutputBytes?: number;
  trim?: boolean;
  shell?: unknown;
  cwd?: string;
}): Promise<string> {
  const value = await Effect.runPromise(processTextEffect(options));
  return applyTrim(value, options.trim);
}

export async function runOptionalProcessText(options: {
  cmd: ProcessCommand;
  timeoutMs?: number;
  maxOutputBytes?: number;
  trim?: boolean;
  shell?: unknown;
  cwd?: string;
}): Promise<string> {
  const value = await Effect.runPromise(
    processTextEffect(options).pipe(
      Effect.catchAll((error: CommandRuntimeError) =>
        error instanceof CommandFailedError ? Effect.succeed("") : Effect.fail(error),
      ),
    ),
  );
  return applyTrim(value, options.trim);
}

export async function readDirectoryResult(
  directory: string,
  timeoutMs?: number,
): Promise<ReadDirectoryResult> {
  return Effect.runPromise(
    fileSystemEffect({
      operation: "readdir",
      target: directory,
      run: () => fs.readdir(directory, { withFileTypes: true }),
      timeoutMs,
    }).pipe(
      Effect.map((entries: Dirent[]) => toAvailableDirectoryResult(entries)),
      Effect.catchAll((error: FileSystemRuntimeError) => {
        if (error instanceof FileSystemError && error.code === "ENOENT") {
          return Effect.succeed(toMissingDirectoryResult());
        }

        return Effect.succeed(toDirectoryErrorResult(error));
      }),
    ),
  );
}

export async function readFileResult(
  filePath: string,
  options: {
    encoding?: TextEncoding;
    timeoutMs?: number;
  } = {},
): Promise<ReadFileResult> {
  const encoding = options.encoding ?? "utf8";

  return Effect.runPromise(
    fileSystemEffect({
      operation: "readFile",
      target: filePath,
      run: () => fs.readFile(filePath, { encoding }),
      timeoutMs: options.timeoutMs,
    }).pipe(
      Effect.map((content: string) => toAvailableFileResult(content)),
      Effect.catchAll((error: FileSystemRuntimeError) => {
        if (error instanceof FileSystemError && error.code === "ENOENT") {
          return Effect.succeed(toMissingFileResult());
        }

        return Effect.succeed(toFileErrorResult(error));
      }),
    ),
  );
}

export async function readFileString(
  filePath: string,
  options: {
    encoding?: TextEncoding;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const encoding = options.encoding ?? "utf8";

  return Effect.runPromise(
    fileSystemEffect({
      operation: "readFile",
      target: filePath,
      run: () => fs.readFile(filePath, { encoding }),
      timeoutMs: options.timeoutMs,
    }),
  );
}

export async function statPath(targetPath: string, timeoutMs?: number): Promise<Stats> {
  return Effect.runPromise(
    fileSystemEffect({
      operation: "stat",
      target: targetPath,
      run: () => fs.stat(targetPath),
      timeoutMs,
    }),
  );
}

export async function pathExists(targetPath: string, timeoutMs?: number): Promise<boolean> {
  return Effect.runPromise(
    fileSystemEffect({
      operation: "access",
      target: targetPath,
      run: () => fs.access(targetPath),
      timeoutMs,
    }).pipe(
      Effect.as(true),
      Effect.catchAll((error: FileSystemRuntimeError) => {
        if (error instanceof FileSystemError && error.code === "ENOENT") {
          return Effect.succeed(false);
        }

        return Effect.fail(error);
      }),
    ),
  );
}

export async function mkdirAll(targetPath: string, timeoutMs?: number): Promise<void> {
  await Effect.runPromise(
    fileSystemEffect({
      operation: "mkdir",
      target: targetPath,
      run: () => fs.mkdir(targetPath, { recursive: true }),
      timeoutMs,
    }),
  );
}

export async function appendFileString(
  filePath: string,
  content: string,
  timeoutMs?: number,
): Promise<void> {
  await Effect.runPromise(
    fileSystemEffect({
      operation: "appendFile",
      target: filePath,
      run: () => fs.appendFile(filePath, content, "utf8"),
      timeoutMs,
    }),
  );
}

export function attachProcessRunner<T extends object>(
  shell: T,
  options: {
    cwd?: string;
  } = {},
): T & ProcessRunnerCarrier {
  const existingRunner = hasProcessRunner(shell) ? shell[PROCESS_RUNNER] : undefined;
  const runner: ProcessRunner = async ({ cmd, timeoutMs, maxOutputBytes, cwd }) => {
    const effectiveCwd = cwd ?? options.cwd;
    if (existingRunner) {
      return existingRunner({
        cmd,
        timeoutMs,
        maxOutputBytes,
        cwd: effectiveCwd,
      });
    }

    return spawnProcessText({
      cmd,
      timeoutMs,
      maxOutputBytes,
      cwd: effectiveCwd,
    });
  };

  return Object.assign(shell, {
    [PROCESS_RUNNER]: runner,
  });
}

export { toErrorMessage };
