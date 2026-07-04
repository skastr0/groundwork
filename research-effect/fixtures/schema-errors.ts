import { Effect, ParseResult, Schema } from "effect"

const User = Schema.Struct({
  name: Schema.String,
  age: Schema.NumberFromString,
})

const raw: unknown = { name: "Alice", age: "42" }

// ---------------------------------------------------------------------------
// schema-errors-no-sync-decode
// ---------------------------------------------------------------------------

const badSyncDecode = Effect.gen(function* () {
  const user = Schema.decodeUnknownSync(User)(raw) // violation: schema-errors-no-sync-decode
  return user.name
})

const goodEffectDecode = Effect.gen(function* () {
  const user = yield* Schema.decodeUnknown(User)(raw) // ok: schema-errors-no-sync-decode
  return user.name
})

// ---------------------------------------------------------------------------
// schema-errors-decode-unknown-for-runtime
// ---------------------------------------------------------------------------

const badDecode = Schema.decode(User)(raw) // violation: schema-errors-decode-unknown-for-runtime

const goodDecodeUnknown = Schema.decodeUnknown(User)(raw) // ok: schema-errors-decode-unknown-for-runtime

// ---------------------------------------------------------------------------
// schema-errors-run-promise-decode-needs-catch
// ---------------------------------------------------------------------------

const badRunPromise = Effect.runPromise(Schema.decodeUnknown(User)(raw)) // violation: schema-errors-run-promise-decode-needs-catch

const goodRunPromise = Schema.decodeUnknown(User)(raw).pipe(
  Effect.catchTag("ParseError", (e) =>
    Effect.fail(
      new Error(ParseResult.ArrayFormatter.formatError(e).join(", ")),
    ),
  ),
  Effect.runPromise,
) // ok: schema-errors-run-promise-decode-needs-catch

// ---------------------------------------------------------------------------
// schema-errors-swallow-parse-error
// ---------------------------------------------------------------------------

const badSwallowParse = Schema.decodeUnknown(User)(raw).pipe(
  Effect.catchTag("ParseError", () => Effect.fail(new Error("invalid user"))), // violation: schema-errors-swallow-parse-error
)

const goodPreserveParse = Schema.decodeUnknown(User)(raw).pipe(
  Effect.catchTag("ParseError", (e) =>
    Effect.fail(
      new Error(
        `invalid user: ${ParseResult.ArrayFormatter.formatError(e).join(", ")}`,
      ),
    ),
  ), // ok: schema-errors-swallow-parse-error
)

// ---------------------------------------------------------------------------
// schema-errors-dont-default-on-decode
// ---------------------------------------------------------------------------

const badGetOrNull = Schema.decodeUnknown(User)(raw).pipe(
  Effect.getOrNull,
) // violation: schema-errors-dont-default-on-decode

const badGetOrUndefined = Schema.decodeUnknown(User)(raw).pipe(
  Effect.getOrUndefined,
) // violation: schema-errors-dont-default-on-decode

const badGetOrElse = Schema.decodeUnknown(User)(raw).pipe(
  Effect.getOrElse(() => ({ name: "unknown", age: 0 })),
) // violation: schema-errors-dont-default-on-decode

const goodExplicitHandle = Schema.decodeUnknown(User)(raw).pipe(
  Effect.catchTag("ParseError", (e) =>
    Effect.logError(ParseResult.TreeFormatter.formatError(e)),
  ), // ok: schema-errors-dont-default-on-decode
)

// ---------------------------------------------------------------------------
// schema-errors-no-or-die-on-decode
// ---------------------------------------------------------------------------

const badOrDie = Schema.decodeUnknown(User)(raw).pipe(Effect.orDie) // violation: schema-errors-no-or-die-on-decode

const goodOrDie = Schema.decodeUnknown(User)(raw).pipe(
  Effect.catchTag("ParseError", (e) =>
    Effect.logError(ParseResult.TreeFormatter.formatError(e)),
  ),
) // ok: schema-errors-no-or-die-on-decode

// ---------------------------------------------------------------------------
// schema-errors-preserve-parse-cause
// ---------------------------------------------------------------------------

const badMapError = Schema.decodeUnknown(User)(raw).pipe(
  Effect.mapError(() => new Error("validation failed")),
) // violation: schema-errors-preserve-parse-cause

const goodMapError = Schema.decodeUnknown(User)(raw).pipe(
  Effect.mapError(
    (e) =>
      new Error("validation failed", {
        cause: ParseResult.ArrayFormatter.formatError(e),
      }), // ok: schema-errors-preserve-parse-cause
  ),
)
