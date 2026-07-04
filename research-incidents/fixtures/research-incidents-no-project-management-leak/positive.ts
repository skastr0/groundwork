// Positive fixture for research-incidents-no-project-management-leak.
// This file SHOULD trigger the rule because it introduces project-management
// concepts into a non-PM domain.
export function computeEmbedding() {
  const projectManagement = true;
  const pmId = "pm-123";
  const projectIdBoundary = pmId;
  const boundarySpec = { projectManagement, pmId, projectIdBoundary };
  return boundarySpec;
}
