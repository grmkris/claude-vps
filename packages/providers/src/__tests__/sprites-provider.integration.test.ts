import { createLogger } from "@vps-claude/logger";
import { createSpritesClient } from "@vps-claude/sprites";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { ComputeProvider } from "../provider.interface";

import { createSpritesProvider } from "../sprites/sprites-provider";

const logger = createLogger({ appName: "sprites-provider-test" });

const SPRITES_TOKEN = process.env.SPRITES_TOKEN;

describe.skipIf(!SPRITES_TOKEN)("SpritesProvider Integration", () => {
  let provider: ComputeProvider;
  let instanceName: string;
  let instanceUrl: string;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    const spritesClient = createSpritesClient({
      token: SPRITES_TOKEN!,
      logger,
    });

    provider = createSpritesProvider({
      spritesClient,
      logger,
    });

    const result = await provider.createInstance({
      name: `sprites-test-${suffix}`,
      userId: "test-user",
      subdomain: `sprites-test-${suffix}`,
      envVars: { TEST_VAR: "test_value" },
    });
    instanceName = result.instanceName;
    instanceUrl = result.url;

    logger.info({ instanceName, instanceUrl }, "Test sprite created");

    // Wait for sprite initialization
    await new Promise((r) => setTimeout(r, 10_000));
  }, 60_000);

  afterAll(async () => {
    if (instanceName) {
      try {
        await provider.deleteInstance(instanceName);
        logger.info({ instanceName }, "Test sprite deleted");
      } catch (error) {
        logger.warn({ instanceName, error }, "Failed to delete test sprite");
      }
    }
  }, 30_000);

  // Lifecycle tests
  describe("Lifecycle", () => {
    test("createInstance returns instance name and URL", () => {
      expect(instanceName).toBeDefined();
      expect(instanceUrl).toContain("sprites.dev");
    });

    test("getInstance returns instance info", async () => {
      const info = await provider.getInstance(instanceName);
      expect(info).not.toBeNull();
      expect(info?.name).toBe(instanceName);
    });

    test("getInstance returns null for non-existent sprite", async () => {
      const info = await provider.getInstance("nonexistent-sprite-xyz");
      expect(info).toBeNull();
    });

    test("listInstances includes created sprite", async () => {
      const instances = await provider.listInstances();
      expect(instances.some((i) => i.name === instanceName)).toBe(true);
    });
  });

  // Command execution tests
  describe("Command Execution", () => {
    test("execCommand runs command directly", async () => {
      const result = await provider.execCommand(instanceName, "pwd");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("/home/sprite");
    });

    test("execShell runs bash command", async () => {
      const result = await provider.execShell(instanceName, "echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
    });

    test("execShell handles shell syntax", async () => {
      const result = await provider.execShell(
        instanceName,
        "for i in 1 2 3; do echo $i; done"
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain("1");
      expect(result.stdout.trim()).toContain("2");
      expect(result.stdout.trim()).toContain("3");
    });

    test("execShell returns non-zero exit code on failure", async () => {
      const result = await provider.execShell(instanceName, "exit 42");
      expect(result.exitCode).toBe(42);
    });

    test("execShell captures stderr", async () => {
      const result = await provider.execShell(
        instanceName,
        "echo error >&2 && exit 1"
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr.trim()).toBe("error");
    });
  });

  // Filesystem tests
  describe("Filesystem", () => {
    test("writeFile + readFile roundtrip (string)", async () => {
      const content = "hello world\n";
      await provider.writeFile(instanceName, "/tmp/test-string.txt", content);
      const result = await provider.readFile(
        instanceName,
        "/tmp/test-string.txt"
      );
      expect(result.toString()).toBe(content);
    });

    test("writeFile + readFile roundtrip (binary)", async () => {
      const content = Buffer.from([0x00, 0x01, 0x02, 0xff]);
      await provider.writeFile(instanceName, "/tmp/test-binary.bin", content);
      const result = await provider.readFile(
        instanceName,
        "/tmp/test-binary.bin"
      );
      expect(Buffer.compare(result, content)).toBe(0);
    });

    test("writeFile with mkdir creates parent directories", async () => {
      const content = "nested content";
      await provider.writeFile(
        instanceName,
        `/tmp/nested-${suffix}/a/b/c/file.txt`,
        content,
        { mkdir: true }
      );
      const result = await provider.readFile(
        instanceName,
        `/tmp/nested-${suffix}/a/b/c/file.txt`
      );
      expect(result.toString()).toBe(content);
    });

    test("listDir returns directory entries", async () => {
      // Create a test directory with files
      const dir = `/tmp/listdir-${suffix}`;
      await provider.execShell(instanceName, `mkdir -p ${dir}`);
      await provider.writeFile(instanceName, `${dir}/file1.txt`, "content1");
      await provider.writeFile(instanceName, `${dir}/file2.txt`, "content2");
      await provider.execShell(instanceName, `mkdir ${dir}/subdir`);

      const entries = await provider.listDir(instanceName, dir);

      expect(entries.length).toBe(3);
      expect(entries.some((e) => e.name === "file1.txt" && !e.isDir)).toBe(
        true
      );
      expect(entries.some((e) => e.name === "file2.txt" && !e.isDir)).toBe(
        true
      );
      expect(entries.some((e) => e.name === "subdir" && e.isDir)).toBe(true);
    });
  });

  // Capabilities tests
  describe("Capabilities", () => {
    test("type is sprites", () => {
      expect(provider.type).toBe("sprites");
    });

    test("checkpoints capability is true", () => {
      expect(provider.capabilities.checkpoints).toBe(true);
    });

    test("sleepWake capability is true", () => {
      expect(provider.capabilities.sleepWake).toBe(true);
    });

    test("wsProxy capability is true", () => {
      expect(provider.capabilities.wsProxy).toBe(true);
    });

    test("urlAuth capability is true", () => {
      expect(provider.capabilities.urlAuth).toBe(true);
    });

    test("envHotReload capability is true", () => {
      expect(provider.capabilities.envHotReload).toBe(true);
    });
  });

  // Optional methods (Sprites-specific)
  describe("Optional Methods", () => {
    test("getProxyUrl returns websocket URL", () => {
      const url = provider.getProxyUrl?.(instanceName);
      expect(url).toBeDefined();
      expect(url).toContain("wss://");
    });

    test("getProxyToken returns token", () => {
      const token = provider.getProxyToken?.();
      expect(token).toBeDefined();
      expect(token?.length).toBeGreaterThan(0);
    });

    test("createCheckpoint creates checkpoint", async () => {
      const checkpoint = await provider.createCheckpoint?.(instanceName);
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.id).toBeDefined();
      expect(checkpoint?.instanceName).toBe(instanceName);
    }, 30_000);

    test("listCheckpoints returns checkpoints", async () => {
      const checkpoints = await provider.listCheckpoints?.(instanceName);
      expect(checkpoints).toBeDefined();
      expect(Array.isArray(checkpoints)).toBe(true);
    });
  });
});
