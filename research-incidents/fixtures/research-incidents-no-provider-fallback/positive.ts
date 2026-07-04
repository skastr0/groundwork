// Positive fixture for research-incidents-no-provider-fallback.
// This file SHOULD trigger the rule because it introduces fallback providers and
// environment switches for provider selection.
export function resolveEmbeddingProvider(): string {
  const primary = process.env.EMBEDDING_PROVIDER ?? "openai";
  const quasar = process.env.QUASAR_EMBEDDING_PROVIDER;
  const fallback = process.env.PROVIDER_FALLBACK;
  const gemini = Gemini;
  const provider = fallback ?? quasar ?? primary;
  return provider;
}

function Gemini(): string {
  return "gemini";
}
