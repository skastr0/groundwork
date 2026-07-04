import { Effect, Config, Console, Layer } from "effect"
import * as Fs from "@effect/platform-node/Fs"
import * as Command from "@effect/platform/Command"
import * as child_process from "node:child_process"
import * as fs from "node:fs"

class ExitCodeError {
  readonly _tag = "ExitCodeError"
  constructor(readonly code: number) {}
}

class NetworkError {
  readonly _tag = "NetworkError"
  constructor(readonly cause: unknown) {}
}

// ---------------------------------------------------------------------------
// Bad: unsafe runners
// ---------------------------------------------------------------------------
export const runCliBad = <A, E>(program: Effect.Effect<A, E>) =>
  Effect.unsafeRunPromise(program) // violation: platform-cli-testing-no-unsafe-run

export const runCliGood = <A, E>(program: Effect.Effect<A, E>) =>
  Effect.runPromise(program) // ok: platform-cli-testing-no-unsafe-run

// ---------------------------------------------------------------------------
// Bad: raw process.argv access
// ---------------------------------------------------------------------------
const targetBad = process.argv[2] // violation: platform-cli-testing-no-raw-process-argv

const targetGood = Effect.gen(function* () {
  const name = yield* Config.string("CLI_TARGET") // ok: platform-cli-testing-no-raw-process-argv
  return name
})

// ---------------------------------------------------------------------------
// Bad: process.exit inside an effect workflow
// ---------------------------------------------------------------------------
const exitBad = Effect.gen(function* () {
  const ok = yield* Effect.succeed(false)
  if (!ok) process.exit(1) // violation: platform-cli-testing-no-direct-process-exit
  return ok
})

const exitGood = Effect.gen(function* () {
  const ok = yield* Effect.succeed(false)
  if (!ok) return yield* Effect.fail(new ExitCodeError(1)) // ok: platform-cli-testing-no-direct-process-exit
  return ok
})

// ---------------------------------------------------------------------------
// Bad: tryPromise without catch
// ---------------------------------------------------------------------------
const fetchArrowBad = Effect.tryPromise(() => fetch("https://example.com")) // violation: platform-cli-testing-no-try-promise-without-catch

const fetchAsyncBad = Effect.tryPromise(async () => fetch("https://example.com")) // violation: platform-cli-testing-no-try-promise-without-catch

const fetchObjectBad = Effect.tryPromise({ try: () => fetch("https://example.com") }) // violation: platform-cli-testing-no-try-promise-without-catch

const fetchGood = Effect.tryPromise({
  try: () => fetch("https://example.com"),
  catch: (unknown) => new NetworkError(unknown),
}) // ok: platform-cli-testing-no-try-promise-without-catch

// ---------------------------------------------------------------------------
// Bad: console.log inside effectful code
// ---------------------------------------------------------------------------
const logBad = Effect.gen(function* () {
  console.log("starting CLI") // violation: platform-cli-testing-no-console-log-in-effect
  yield* Effect.unit
})

const logGood = Effect.gen(function* () {
  yield* Console.log("starting CLI") // ok: platform-cli-testing-no-console-log-in-effect
})

// ---------------------------------------------------------------------------
// Bad: direct process.env access
// ---------------------------------------------------------------------------
const apiKeyBad = process.env.API_KEY // violation: platform-cli-testing-no-read-env-directly

const apiKeyGood = Effect.gen(function* () {
  const apiKey = yield* Config.string("API_KEY") // ok: platform-cli-testing-no-read-env-directly
  return apiKey
})

// ---------------------------------------------------------------------------
// Bad: blocking synchronous fs calls
// ---------------------------------------------------------------------------
const readConfigBad = Effect.gen(function* () {
  const raw = fs.readFileSync("config.json", "utf8") // violation: platform-cli-testing-no-sync-fs-in-effect
  return raw
})

const readConfigGood = Effect.gen(function* () {
  const fs = yield* Fs.Fs
  const raw = yield* fs.readFileString("config.json") // ok: platform-cli-testing-no-sync-fs-in-effect
  return raw
})

// ---------------------------------------------------------------------------
// Bad: direct child_process exec
// ---------------------------------------------------------------------------
const shellBad = Effect.gen(function* () {
  child_process.exec("git status") // violation: platform-cli-testing-no-direct-child-process-exec
  yield* Effect.unit
})

const shellGood = Effect.gen(function* () {
  const command = Command.make("git", "status")
  const result = yield* Command.string(command) // ok: platform-cli-testing-no-direct-child-process-exec
  return result
})

// ---------------------------------------------------------------------------
// A realistic CLI entry point
// ---------------------------------------------------------------------------
export const cli = Effect.gen(function* () {
  const target = yield* Config.string("TARGET")
  yield* Console.log(`Running for ${target}`)
  return target
})
