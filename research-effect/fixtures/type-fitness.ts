import { Effect } from "effect"

// ---------------------------------------------------------------------------
// type-fitness-no-any-error
// ---------------------------------------------------------------------------

export const explicitAnyError: Effect.Effect<string, any, never> = Effect.succeed("hello") // violation: type-fitness-no-any-error

declare function brokenErrorEffect(): Effect.Effect<string, any, never>
export const propagatedAnyError = brokenErrorEffect() // violation: type-fitness-no-any-error

// ok: type-fitness-no-any-error
export const typedError: Effect.Effect<string, Error, never> = Effect.fail(new Error("boom"))

// ---------------------------------------------------------------------------
// type-fitness-no-any-requirement
// ---------------------------------------------------------------------------

export const explicitAnyRequirement: Effect.Effect<string, Error, any> = Effect.succeed("hello") // violation: type-fitness-no-any-requirement

// ok: type-fitness-no-any-requirement
export const noRequirement: Effect.Effect<string, Error, never> = Effect.succeed("hello")

// ---------------------------------------------------------------------------
// type-fitness-no-unknown-requirement
// ---------------------------------------------------------------------------

export const explicitUnknownRequirement: Effect.Effect<string, Error, unknown> = Effect.succeed("hello") // violation: type-fitness-no-unknown-requirement

// ok: type-fitness-no-unknown-requirement
export const concreteRequirement: Effect.Effect<string, Error, never> = Effect.succeed("hello")
