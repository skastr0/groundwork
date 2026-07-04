// Negative fixture for research-incidents-no-corpus-reingest.
// This file should NOT trigger the rule: it performs a targeted lookup using a
// local manifest instead of re-ingesting the corpus.
export class TargetedQuery {
  async byId(id: string): Promise<unknown> {
    const manifest = await this.loadManifest();
    return manifest[id];
  }

  private async loadManifest(): Promise<Record<string, unknown>> {
    return {};
  }
}
