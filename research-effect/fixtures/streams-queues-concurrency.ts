import { Effect, Hub, Queue, Stream } from "effect"

// ---------------------------------------------------------------------------
// throw vs Effect.fail
// ---------------------------------------------------------------------------

export const badThrow = Effect.gen(function* () {
  const q = yield* Queue.bounded<string>(16)
  if (q == null) {
    throw new Error("queue unavailable") // violation: streams-queues-concurrency-no-throw-in-effect
  }
  return q
})

export const goodFail = Effect.gen(function* () {
  const q = yield* Queue.bounded<string>(16)
  if (q == null) {
    return yield* Effect.fail(new Error("queue unavailable")) // ok: streams-queues-concurrency-no-throw-in-effect
  }
  return q
})

// ---------------------------------------------------------------------------
// Queue capacity
// ---------------------------------------------------------------------------

export const badQueue = Effect.gen(function* () {
  const q = yield* Queue.unbounded<string>() // violation: streams-queues-concurrency-unbounded-queue
  return q
})

export const goodQueue = Effect.gen(function* () {
  const q = yield* Queue.bounded<string>(16) // ok: streams-queues-concurrency-unbounded-queue
  return q
})

// ---------------------------------------------------------------------------
// Hub capacity
// ---------------------------------------------------------------------------

export const badHub = Effect.gen(function* () {
  const h = yield* Hub.unbounded<string>() // violation: streams-queues-concurrency-hub-unbounded
  return h
})

export const goodHub = Effect.gen(function* () {
  const h = yield* Hub.bounded<string>(16) // ok: streams-queues-concurrency-hub-unbounded
  return h
})

// ---------------------------------------------------------------------------
// Fiber forking
// ---------------------------------------------------------------------------

export const badFork = Effect.gen(function* () {
  const fiber = yield* Effect.forkDaemon(Effect.sleep("1 second")) // violation: streams-queues-concurrency-prefer-fork-scoped
  return fiber
})

export const goodFork = Effect.gen(function* () {
  const fiber = yield* Effect.forkScoped(Effect.sleep("1 second")) // ok: streams-queues-concurrency-prefer-fork-scoped
  return fiber
})

// ---------------------------------------------------------------------------
// Stream execution boundaries
// ---------------------------------------------------------------------------

export const badStreamRun = (s: Stream.Stream<string, never, never>) =>
  Stream.runPromise(s) // violation: streams-queues-concurrency-stream-run-at-boundary

export const goodStreamRun = (s: Stream.Stream<string, never, never>) =>
  Stream.runDrain(s) // ok: streams-queues-concurrency-stream-run-at-boundary

// ---------------------------------------------------------------------------
// Queue shutdown
// ---------------------------------------------------------------------------

export const badShutdown = Effect.gen(function* () {
  const q = yield* Queue.bounded<string>(16)
  yield* Queue.shutdown(q) // violation: streams-queues-concurrency-queue-shutdown-scope
})

export const goodShutdown = Effect.gen(function* () {
  const q = yield* Queue.bounded<string>(16) // ok: streams-queues-concurrency-queue-shutdown-scope
  yield* Queue.offer(q, "done")
})

// ---------------------------------------------------------------------------
// Buffering strategy
// ---------------------------------------------------------------------------

export const badBuffer = (s: Stream.Stream<string, never, never>) =>
  Stream.bufferSliding(s, { capacity: 8 }) // violation: streams-queues-concurrency-buffer-sliding-loss

export const goodBuffer = (s: Stream.Stream<string, never, never>) =>
  Stream.buffer(s, { capacity: 8 }) // ok: streams-queues-concurrency-buffer-sliding-loss
