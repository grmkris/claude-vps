import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createBoxService, type BoxService } from "../services/box.service";

describe("BoxAgentConfig", () => {
  let testEnv: TestSetup;
  let boxService: BoxService;

  beforeAll(async () => {
    testEnv = await createTestSetup();
    boxService = createBoxService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
  }, 30_000);

  afterAll(async () => {
    await testEnv.close();
  });

  test("box creation auto-creates default agent config", async () => {
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: "config-test-box",
    });
    const box = boxResult._unsafeUnwrap();

    const configsResult = await boxService.listAgentConfigs(box.id);
    const configs = configsResult._unsafeUnwrap();

    expect(configs.length).toBe(1);
    expect(configs[0]!.triggerType).toBe("default");
    expect(configs[0]!.boxId).toBe(box.id);
  });

  test("getAgentConfig returns default config values", async () => {
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: "config-defaults-box",
    });
    const box = boxResult._unsafeUnwrap();

    const configResult = await boxService.getAgentConfig(box.id, "default");
    const config = configResult._unsafeUnwrap();

    expect(config.model).toBe("claude-sonnet-4-5-20250929");
    expect(config.permissionMode).toBe("bypassPermissions");
    expect(config.maxTurns).toBe(50);
    expect(config.maxBudgetUsd).toBe("1.00");
    expect(config.persistSession).toBe(true);
    // ai-tools MCP server should always be included
    expect(config.mcpServers).toHaveProperty("ai-tools");
  });

  test("getAgentConfig falls back to default for missing trigger type", async () => {
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: "config-fallback-box",
    });
    const box = boxResult._unsafeUnwrap();

    // Request "email" trigger type config (doesn't exist)
    const configResult = await boxService.getAgentConfig(box.id, "email");
    const config = configResult._unsafeUnwrap();

    // Should fall back to default values
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
    expect(config.permissionMode).toBe("bypassPermissions");
  });

  test("updateAgentConfig modifies config fields", async () => {
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: "config-update-box",
    });
    const box = boxResult._unsafeUnwrap();

    // Get the default config
    const configsResult = await boxService.listAgentConfigs(box.id);
    const configs = configsResult._unsafeUnwrap();
    const configId = configs[0]!.id;

    // Update the config
    const updateResult = await boxService.updateAgentConfig(configId, {
      model: "claude-opus-4-5-20251101",
      maxTurns: 100,
      appendSystemPrompt: "Custom prompt",
    });
    updateResult._unsafeUnwrap();

    // Verify update
    const updatedResult = await boxService.getAgentConfig(box.id, "default");
    const updated = updatedResult._unsafeUnwrap();

    expect(updated.model).toBe("claude-opus-4-5-20251101");
    expect(updated.maxTurns).toBe(100);
    expect(updated.appendSystemPrompt).toBe("Custom prompt");
  });

  test("updateAgentConfig merges MCP servers with defaults", async () => {
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: "config-mcp-box",
    });
    const box = boxResult._unsafeUnwrap();

    const configsResult = await boxService.listAgentConfigs(box.id);
    const configs = configsResult._unsafeUnwrap();
    const configId = configs[0]!.id;

    // Add a custom MCP server
    await boxService.updateAgentConfig(configId, {
      mcpServers: {
        "my-server": {
          command: "/usr/bin/my-mcp",
          args: ["--flag"],
        },
      },
    });

    const configResult = await boxService.getAgentConfig(box.id, "default");
    const config = configResult._unsafeUnwrap();

    // Should have both ai-tools (default) and my-server (custom)
    expect(config.mcpServers).toHaveProperty("ai-tools");
    expect(config.mcpServers).toHaveProperty("my-server");
  });

  test("delete box cascades to agent config", async () => {
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: "config-delete-box",
    });
    const box = boxResult._unsafeUnwrap();

    // Verify config exists
    const configsBeforeResult = await boxService.listAgentConfigs(box.id);
    expect(configsBeforeResult._unsafeUnwrap().length).toBe(1);

    // Delete the box
    await boxService.delete(box.id, testEnv.users.authenticated.id);

    // Config should be deleted (cascade)
    const configsAfterResult = await boxService.listAgentConfigs(box.id);
    expect(configsAfterResult._unsafeUnwrap().length).toBe(0);
  });
});
