import { Effect } from "effect"

// --- core-runtime-yield-star-required ---
const badYield = Effect.gen(function* () {
  const x = yield Effect.succeed(1) // violation: core-runtime-yield-star-required
  return x
})

const goodYield = Effect.gen(function* () {
  const x = yield* Effect.succeed(1) // ok: core-runtime-yield-star-required
  return x
})

// --- core-runtime-no-throw-in-gen ---
const badThrow = Effect.gen(function* () {
  throw new Error("boom") // violation: core-runtime-no-throw-in-gen
})

const goodThrow = Effect.gen(function* () {
  return yield* Effect.succeed(42) // ok: core-runtime-no-throw-in-gen
})

// --- core-runtime-try-promise-needs-catch ---
const badTryPromise = Effect.tryPromise({ try: () => fetch("/api") }) // violation: core-runtime-try-promise-needs-catch

const goodTryPromise = Effect.tryPromise({
  // ok: core-runtime-try-promise-needs-catch
  try: () => fetch("/api"),
  catch: () => new Error("network failed"),
})

// --- core-runtime-prefer-try-promise-over-promise ---
const badPromise = Effect.promise(() => fetch("/api")) // violation: core-runtime-prefer-try-promise-over-promise

const goodTryPromise2 = Effect.tryPromise({
  // ok: core-runtime-prefer-try-promise-over-promise
  try: () => fetch("/api"),
  catch: () => new Error("network failed"),
})

// --- core-runtime-no-console-in-effect ---
const badConsole = Effect.gen(function* () {
  console.log("hello") // violation: core-runtime-no-console-in-effect
  return 1
})

const goodLog = Effect.gen(function* () {
  yield* Effect.log("hello") // ok: core-runtime-no-console-in-effect
  return 1
})

// --- core-runtime-no-promise-chain-after-run-promise ---
const badChain = Effect.runPromise(badYield).then((x) => x) // violation: core-runtime-no-promise-chain-after-run-promise

async function goodBoundary() {
  const result = await Effect.runPromise(goodYield) // ok: core-runtime-no-promise-chain-after-run-promise
  return result
}
