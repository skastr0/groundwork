// Positive fixture for research-incidents-remove-mcp-token-local-loopback.
// This file SHOULD trigger the rule because it requires a token for a
// loopback-local MCP server.
export function createLocalMcpServer() {
  const mcpToken = process.env.MCP_TOKEN;
  const loopbackToken = process.env.LOOPBACK_TOKEN;
  requireMcpToken();
  const mcpAuthToken = MCP_TOKEN ?? LOOPBACK_TOKEN;
  return { mcpAuthToken };
}

function requireMcpToken(): boolean {
  return true;
}
