// Negative fixture for research-incidents-remove-mcp-token-local-loopback.
// This file should NOT trigger the rule: a loopback-local MCP server with no
// token requirement.
export function createLocalMcpServer() {
  return { port: 8080, host: "127.0.0.1" };
}
