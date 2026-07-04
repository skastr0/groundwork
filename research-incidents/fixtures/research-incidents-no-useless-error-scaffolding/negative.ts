// Negative fixture for research-incidents-no-useless-error-scaffolding.
// This file should NOT trigger the rule: it reuses the project's existing
// error-handling primitives.
import { raiseDomainError } from "./errors";

export function validate(input: unknown): void {
  if (!input) {
    raiseDomainError("missing input");
  }
}
