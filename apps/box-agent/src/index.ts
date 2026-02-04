import "./db/migrate"; // Run migrations on startup

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "mcp":
    // Run MCP server over stdio for AI tools
    const { startMcpServer } = await import("./mcp");
    await startMcpServer();
    break;

  case "setup-hooks":
    // Setup Claude Code hooks for notifications
    const { setupHooks } = await import("./commands/setup-hooks");
    await setupHooks();
    break;

  case "check-notifications":
    // Check for unread notifications (called by hooks)
    const { checkNotifications } =
      await import("./commands/check-notifications");
    await checkNotifications({
      onStart: args.includes("--on-start"),
      sessionKey: args.find((a) => a.startsWith("--session="))?.split("=")[1],
    });
    break;

  default:
    // Run HTTP server (default behavior)
    const server = (await import("./server")).default;
    Bun.serve(server);
}
