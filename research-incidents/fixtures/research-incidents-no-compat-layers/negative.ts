// Negative fixture for research-incidents-no-compat-layers.
// This file should NOT trigger the rule. It contains no compat/legacy/migration/
// transition/backwards terminology and represents clean consolidation code.
export class ConsolidatedRepository {
  async fetch(): Promise<unknown> {
    return { ok: true };
  }
}
