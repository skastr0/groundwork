// Positive fixture for research-incidents-no-useless-error-scaffolding.
// This file SHOULD trigger the rule because it invents new validation/error
// scaffolding rather than reusing existing doctrine.
export function buildErrorScaffold(input: unknown): void {
  scaffold();
  const validation = new ValidationLayer();
  validation.check(input);
}

function scaffold(): void {}
class ValidationLayer {
  check(_input: unknown): void {}
}
