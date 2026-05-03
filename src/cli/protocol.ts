import { promises as fs } from "node:fs";
import { z } from "zod";

export type JsonObject = Record<string, unknown>;

export class CliInputError extends Error {
  override readonly name = "CliInputError";

  constructor(
    message: string,
    readonly details?: JsonObject,
  ) {
    super(message);
  }
}

export interface SuccessEnvelope {
  ok: true;
  command: string;
  data: unknown;
}

export interface FailureEnvelope {
  ok: false;
  command?: string;
  error: {
    type: string;
    message: string;
    details?: unknown;
  };
}

export async function readJsonInput(source: string): Promise<unknown> {
  const raw = await readInputText(source);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CliInputError("Input is not valid JSON", {
      source,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function decodeJsonInput<T>(source: string, schema: z.ZodType<T>): Promise<T> {
  const value = await readJsonInput(source);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CliInputError("Input failed schema validation", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  return parsed.data;
}

export function renderSuccess(command: string, data: unknown): string {
  return JSON.stringify({ ok: true, command, data } satisfies SuccessEnvelope, null, 2);
}

export function renderFailure(command: string | undefined, error: unknown): string {
  return JSON.stringify(
    {
      ok: false,
      ...(command ? { command } : {}),
      error: toErrorDetails(error),
    } satisfies FailureEnvelope,
    null,
    2,
  );
}

export async function executeJsonCommand<T>(
  command: string,
  run: () => Promise<T>,
): Promise<void> {
  try {
    const data = await run();
    process.stdout.write(`${renderSuccess(command, data)}\n`);
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${renderFailure(command, error)}\n`);
  }
}

function toErrorDetails(error: unknown): FailureEnvelope["error"] {
  if (error instanceof CliInputError) {
    return {
      type: error.name,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message,
    };
  }

  return {
    type: "Error",
    message: String(error),
  };
}

async function readInputText(source: string): Promise<string> {
  if (source === "-") {
    return new Response(Bun.stdin.stream()).text();
  }

  if (source.startsWith("@")) {
    return fs.readFile(source.slice(1), "utf8");
  }

  return source;
}
