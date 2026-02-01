import { createLogger } from "@vps-claude/logger";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createSpritesClient, type SpritesClient } from "..";

const logger = createLogger({ appName: "vps-claude-server" });

const SPRITES_TOKEN = process.env.SPRITES_TOKEN;

describe.skipIf(!SPRITES_TOKEN)("Filesystem API Integration", () => {
  let client: SpritesClient;
  let spriteName: string;

  beforeAll(async () => {
    client = createSpritesClient({ token: SPRITES_TOKEN!, logger });
    const suffix = Date.now().toString(36);

    const result = await client.createSprite({
      name: `fs-test-${suffix}`,
      userId: "test-user",
      subdomain: `fs-test-${suffix}`,
      envVars: {},
    });
    spriteName = result.spriteName;

    // Wait for sprite initialization
    await new Promise((r) => setTimeout(r, 10_000));
  }, 60_000);

  afterAll(async () => {
    if (spriteName) {
      await client.deleteSprite(spriteName);
    }
  }, 30_000);

  test("writeFile + readFile round-trip (string)", async () => {
    const content = "hello world\n";
    await client.writeFile(spriteName, "/tmp/test.txt", content);
    const result = await client.readFile(spriteName, "/tmp/test.txt");
    expect(result.toString()).toBe(content);
  });

  test("writeFile + readFile round-trip (binary)", async () => {
    const content = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    await client.writeFile(spriteName, "/tmp/binary.bin", content);
    const result = await client.readFile(spriteName, "/tmp/binary.bin");
    expect(Buffer.compare(result, content)).toBe(0);
  });

  test("writeFile with mkdir creates parent dirs", async () => {
    const content = "nested content";
    await client.writeFile(spriteName, "/tmp/a/b/c/nested.txt", content, {
      mkdir: true,
    });
    const result = await client.readFile(spriteName, "/tmp/a/b/c/nested.txt");
    expect(result.toString()).toBe(content);
  });

  test("listDir returns directory contents", async () => {
    // Create a fresh directory for this test
    await client.writeFile(spriteName, "/tmp/listtest/file1.txt", "one", {
      mkdir: true,
    });
    await client.writeFile(spriteName, "/tmp/listtest/file2.txt", "two");

    const entries = await client.listDir(spriteName, "/tmp/listtest");
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("file1.txt");
    expect(names).toContain("file2.txt");
  });

  test("readFile throws on non-existent file", async () => {
    expect.assertions(1);
    try {
      await client.readFile(spriteName, "/tmp/does-not-exist.txt");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
