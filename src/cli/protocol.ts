import { promises as fs } from "node:fs";
import { Effect } from "effect";
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

const successEnvelopeSchema = z.object({
  ok: z.literal(true),
  command: z.string(),
  data: z.unknown(),
});

const failureEnvelopeSchema = z.object({
  ok: z.literal(false),
  command: z.string().optional(),
  error: z.object({
    type: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export function readJsonInputEffect(source: string): Effect.Effect<unknown, CliInputError> {
  return Effect.tryPromise({
    try: () => readInputText(source),
    catch: (error) =>
      new CliInputError("Input could not be read", {
        source,
        reason: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: (error) =>
          new CliInputError("Input is not valid JSON", {
            source,
            reason: error instanceof Error ? error.message : String(error),
          }),
      }),
    ),
  );
}

export function decodeJsonInputEffect<T>(
  source: string,
  schema: z.ZodType<T>,
): Effect.Effect<T, CliInputError> {
  return readJsonInputEffect(source).pipe(
    Effect.flatMap((value) => {
      const parsed = schema.safeParse(value);
      if (parsed.success) {
        return Effect.succeed(parsed.data);
      }

      return Effect.fail(
        new CliInputError("Input failed schema validation", {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
            code: issue.code,
          })),
        }),
      );
    }),
  );
}

export function renderSuccess(command: string, data: unknown): string {
  const envelope = successEnvelopeSchema.parse({
    ok: true,
    command,
    data,
  } satisfies SuccessEnvelope);

  return JSON.stringify(envelope, null, 2);
}

export function renderFailure(command: string | undefined, error: unknown): string {
  const envelope = failureEnvelopeSchema.parse({
    ok: false,
    ...(command ? { command } : {}),
    error: toErrorDetails(error),
  } satisfies FailureEnvelope);

  return JSON.stringify(envelope, null, 2);
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
