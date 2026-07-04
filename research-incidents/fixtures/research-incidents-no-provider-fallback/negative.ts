// Negative fixture for research-incidents-no-provider-fallback.
// This file should NOT trigger the rule. It uses a single, hard-coded provider
// with no environment switches, fallback paths, or alternate providers.
export function resolveEmbeddingProvider(): string {
  return "openai";
}
