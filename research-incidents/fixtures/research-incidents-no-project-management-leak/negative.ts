// Negative fixture for research-incidents-no-project-management-leak.
// This file should NOT trigger the rule: it stays within the embedding/domain
// boundary and has no project-management terms.
export function computeEmbedding(text: string): number[] {
  return text.split("").map((c) => c.charCodeAt(0));
}
