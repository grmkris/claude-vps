import "./db/migrate"; // Run migrations on startup

const args = process.argv.slice(2);

if (args[0] === "mcp") {
  // Run MCP server over stdio for AI tools
  const { startMcpServer } = await import("./mcp");
  await startMcpServer();
} else {
  // Run HTTP server (default behavior)
  const server = (await import("./server")).default;
  Bun.serve(server);
}
