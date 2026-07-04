// Positive fixture for research-incidents-redact-secrets.
// This file SHOULD trigger the rule because it prints secret-bearing env vars
// to the console.
export function debugConfig(): void {
  console.log(process.env.INGEST_TOKEN);
  console.error(process.env.INGEST_TOKEN);
  console.info(process.env.INGEST_TOKEN);
  console.log(process.env.API_KEY);
  console.error(process.env.API_KEY);
  console.log(process.env.MCP_TOKEN);
  console.error(process.env.MCP_TOKEN);
}
