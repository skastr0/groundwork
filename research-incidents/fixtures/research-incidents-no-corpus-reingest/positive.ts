// Positive fixture for research-incidents-no-corpus-reingest.
// This file SHOULD trigger the rule because it re-ingests or scans the entire
// corpus instead of using a targeted query.
export async function runImporter(): Promise<void> {
  await ingestAll();
  await parseCorpus();
  await reingest();
  await fullScan();
}
