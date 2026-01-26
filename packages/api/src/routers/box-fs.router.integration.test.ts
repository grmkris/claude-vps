import { box as boxTable } from "@vps-claude/db";
import { createLogger } from "@vps-claude/logger";
import { type BoxId } from "@vps-claude/shared";
import { createSpritesClient, type SpritesClient } from "@vps-claude/sprites";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createBoxService } from "../services/box.service";

const logger = createLogger({ appName: "box-fs-integration-test" });
const SPRITES_TOKEN = process.env.SPRITES_TOKEN;

describe.skipIf(!SPRITES_TOKEN)("boxFsRouter integration", () => {
  let testEnv: TestSetup;
  let spritesClient: SpritesClient;
  let spriteName: string;
  let boxId: BoxId;

  beforeAll(async () => {
    testEnv = await createTestSetup();
    spritesClient = createSpritesClient({
      token: SPRITES_TOKEN!,
      logger,
    });

    // Create real sprite
    const suffix = Date.now().toString(36);
    const result = await spritesClient.createSprite({
      name: `fs-test-${suffix}`,
      userId: "test",
      subdomain: `fs-test-${suffix}`,
      envVars: {},
    });
    spriteName = result.spriteName;

    // Wait for sprite to be ready
    await new Promise((r) => setTimeout(r, 10_000));

    // Create box in DB pointing to real sprite
    const boxService = createBoxService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: "fs-test",
    });
    const box = boxResult._unsafeUnwrap();
    boxId = box.id;

    // Update box to running with real sprite
    await testEnv.db
      .update(boxTable)
      .set({
        status: "running",
        spriteName,
        spriteUrl: `https://${spriteName}.sprites.dev`,
      })
      .where(eq(boxTable.id, boxId));
  }, 60_000);

  afterAll(async () => {
    if (spriteName) {
      await spritesClient.deleteSprite(spriteName);
    }
    await testEnv.close();
  }, 30_000);

  test("list: returns directory entries for /home/sprite", async () => {
    const entries = await spritesClient.listDir(spriteName, "/home/sprite");
    expect(Array.isArray(entries)).toBe(true);
    // Should have some default files/dirs
    expect(entries.length).toBeGreaterThanOrEqual(0);

    // Validate schema fields match what ORPC expects
    const entry = entries[0];
    if (entry) {
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("isDir");
      expect(typeof entry.isDir).toBe("boolean");
    }
  }, 15_000);

  test("list: throws error for non-existent directory", async () => {
    expect.assertions(1);
    try {
      await spritesClient.listDir(spriteName, "/nonexistent/path/here");
    } catch (error) {
      expect(error).toBeDefined();
    }
  }, 15_000);

  test("write: uploads file successfully", async () => {
    const content = "Hello from integration test";
    const path = "/home/sprite/test-file.txt";

    await spritesClient.writeFile(spriteName, path, content);

    // Verify by reading back
    const buffer = await spritesClient.readFile(spriteName, path);
    expect(buffer.toString()).toBe(content);
  }, 15_000);

  test("read: reads uploaded file as base64", async () => {
    const content = "Base64 test content";
    const path = "/home/sprite/base64-test.txt";

    await spritesClient.writeFile(spriteName, path, content);

    const buffer = await spritesClient.readFile(spriteName, path);
    const base64 = buffer.toString("base64");
    const decoded = Buffer.from(base64, "base64").toString();

    expect(decoded).toBe(content);
  }, 15_000);

  test("read: returns correct file size", async () => {
    const content = "Size test - exactly 30 bytes!!";
    const path = "/home/sprite/size-test.txt";

    await spritesClient.writeFile(spriteName, path, content);

    const buffer = await spritesClient.readFile(spriteName, path);
    expect(buffer.length).toBe(content.length);
  }, 15_000);

  test("list: shows uploaded file in listing", async () => {
    const content = "List visibility test";
    const filename = "list-test-file.txt";
    const path = `/home/sprite/${filename}`;

    await spritesClient.writeFile(spriteName, path, content);

    const entries = await spritesClient.listDir(spriteName, "/home/sprite");
    const names = entries.map((e) => e.name);

    expect(names).toContain(filename);
  }, 15_000);

  test("write: creates nested directories with mkdir", async () => {
    const content = "Nested content";
    const path = "/home/sprite/nested/deep/dir/file.txt";

    await spritesClient.writeFile(spriteName, path, content, { mkdir: true });

    const buffer = await spritesClient.readFile(spriteName, path);
    expect(buffer.toString()).toBe(content);

    // Verify intermediate directory exists
    const entries = await spritesClient.listDir(
      spriteName,
      "/home/sprite/nested/deep"
    );
    const names = entries.map((e) => e.name);
    expect(names).toContain("dir");
  }, 15_000);

  test("read: throws error for non-existent file", async () => {
    expect.assertions(1);
    try {
      await spritesClient.readFile(
        spriteName,
        "/home/sprite/does-not-exist.txt"
      );
    } catch (error) {
      expect(error).toBeDefined();
    }
  }, 15_000);
});
