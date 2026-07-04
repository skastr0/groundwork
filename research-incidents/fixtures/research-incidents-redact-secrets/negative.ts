// Negative fixture for research-incidents-redact-secrets.
// This file should NOT trigger the rule: secrets are never emitted to the
// console; only redacted status is logged.
export function debugConfig(): void {
  console.log("config loaded");
}
