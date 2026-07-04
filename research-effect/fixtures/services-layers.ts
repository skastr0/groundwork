import { Context, Effect, Layer } from "effect"

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class DatabaseError {
  readonly _tag = "DatabaseError"
  constructor(readonly message: string) {}
}

export class DatabaseConnectionError extends DatabaseError {
  readonly _tag = "DatabaseConnectionError"
}

export class QueryError extends DatabaseError {
  readonly _tag = "QueryError"
}

export class ConfigError {
  readonly _tag = "ConfigError"
  constructor(readonly message: string) {}
}

export class NetworkError {
  readonly _tag = "NetworkError"
  constructor(readonly message: string) {}
}

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export interface DatabaseService {
  readonly query: (sql: string) => Effect.Effect<unknown, DatabaseError>
}

export const DatabaseService = Context.Tag<DatabaseService>("DatabaseService")

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class DatabaseServiceImpl implements DatabaseService {
  query(sql: string) {
    return Effect.succeed(sql)
  }
}

// ---------------------------------------------------------------------------
// Eager service construction
// ---------------------------------------------------------------------------

const eagerDatabaseService = new DatabaseServiceImpl() // violation: services-layers-eager-service-construction

export const EagerDatabaseLayer = Layer.succeed(
  DatabaseService,
  eagerDatabaseService
)

// ok: services-layers-eager-service-construction
export const LazyDatabaseLayer = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    return new DatabaseServiceImpl()
  })
)

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

declare function connect(): Promise<{ query: (sql: string) => Promise<unknown> }>

export const DatabaseLayer = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    // ok: services-layers-trypromise-without-catch
    const connection = yield* Effect.tryPromise({
      try: () => connect(),
      catch: (err) => new DatabaseConnectionError(String(err)),
    })

    return {
      query: (sql) =>
        Effect.tryPromise({
          try: () => connection.query(sql),
          catch: (err) => new QueryError(String(err)),
        }),
    } as DatabaseService
  })
)

// ---------------------------------------------------------------------------
// Effect.try / Effect.tryPromise
// ---------------------------------------------------------------------------

declare function parseConfig(): Record<string, unknown>
declare function fetchRemote(): Promise<unknown>

const parsedConfig = Effect.try(() => parseConfig()) // violation: services-layers-try-without-catch

// ok: services-layers-try-without-catch
const typedConfig = Effect.try({
  try: () => parseConfig(),
  catch: (err) => new ConfigError(String(err)),
})

const remoteData = Effect.tryPromise(() => fetchRemote()) // violation: services-layers-trypromise-without-catch

// ok: services-layers-trypromise-without-catch
const typedRemoteData = Effect.tryPromise({
  try: () => fetchRemote(),
  catch: (err) => new NetworkError(String(err)),
})

// ---------------------------------------------------------------------------
// Effect.gen anti-patterns
// ---------------------------------------------------------------------------

const badThrow = Effect.gen(function* () {
  // violation: services-layers-throw-in-gen
  throw new DatabaseError("boom")
})

const goodThrow = Effect.gen(function* () {
  // ok: services-layers-throw-in-gen
  yield* Effect.fail(new DatabaseError("boom"))
})

const badAsyncGen = Effect.gen(async function* () {
  // violation: services-layers-async-gen-in-effect
  const result = await fetchRemote()
  return result
})

const goodAsyncGen = Effect.gen(function* () {
  // ok: services-layers-async-gen-in-effect
  const result = yield* Effect.promise(() => fetchRemote())
  return result
})

const badThen = Effect.gen(function* () {
  // violation: services-layers-promise-then-in-gen
  fetchRemote().then((value) => console.log(value))
})

const goodThen = Effect.gen(function* () {
  // ok: services-layers-promise-then-in-gen
  const value = yield* Effect.tryPromise({
    try: () => fetchRemote(),
    catch: (err) => new NetworkError(String(err)),
  })
  console.log(value)
})

// ---------------------------------------------------------------------------
// Running effects
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const db = yield* DatabaseService
  yield* db.query("SELECT 1")
})

Effect.runPromise(program) // violation: services-layers-runpromise-in-service

// ok: services-layers-runpromise-in-service
export const runnable = Effect.provide(program, DatabaseLayer)
