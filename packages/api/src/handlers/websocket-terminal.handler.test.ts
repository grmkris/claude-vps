import type { BoxId, UserId } from "@vps-claude/shared";
import type { SpritesClient } from "@vps-claude/sprites";

import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { createBoxService, type BoxService } from "../services/box.service";
import { createWebSocketTerminalHandler } from "./websocket-terminal.handler";

// Mock auth
const mockAuth = {
  api: {
    getSession: mock(() =>
      Promise.resolve(null as { user: { id: string } } | null)
    ),
  },
};

// Mock sprites client
const mockSpritesClient: SpritesClient = {
  createSprite: mock(() =>
    Promise.resolve({ spriteName: "test", url: "https://test.sprites.dev" })
  ),
  listSprites: mock(() => Promise.resolve([])),
  deleteSprite: mock(() => Promise.resolve()),
  getSprite: mock(() => Promise.resolve(null)),
  execCommand: mock(() =>
    Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
  ),
  execShell: mock(() =>
    Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
  ),
  setupSprite: mock(() => Promise.resolve()),
  createCheckpoint: mock(() =>
    Promise.resolve({
      id: "cp-1",
      sprite_name: "test",
      created_at: new Date().toISOString(),
    })
  ),
  listCheckpoints: mock(() => Promise.resolve([])),
  restoreCheckpoint: mock(() => Promise.resolve()),
  getProxyUrl: mock(
    (spriteName: string) =>
      `wss://api.sprites.dev/v1/sprites/${spriteName}/proxy`
  ),
  getToken: mock(() => "test-token"),
  updateEnvVars: mock(() => Promise.resolve()),
  readFile: mock(() => Promise.resolve(Buffer.from(""))),
  writeFile: mock(() => Promise.resolve()),
  listDir: mock(() => Promise.resolve([])),
  setUrlAuth: mock(() => Promise.resolve()),
};

// Mock logger
const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  trace: mock(() => {}),
  fatal: mock(() => {}),
  child: mock(() => mockLogger),
};

describe("WebSocketTerminalHandler", () => {
  let testEnv: TestSetup;
  let boxService: BoxService;
  let handler: ReturnType<typeof createWebSocketTerminalHandler>;

  beforeAll(async () => {
    testEnv = await createTestSetup();
    boxService = createBoxService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
    handler = createWebSocketTerminalHandler({
      boxService,
      spritesClient: mockSpritesClient,
      auth: mockAuth as never,
      logger: mockLogger as never,
    });
  });

  afterAll(async () => {
    await testEnv.close();
  });

  describe("validateUpgrade", () => {
    test("returns null for unauthenticated request", async () => {
      // No session
      mockAuth.api.getSession.mockResolvedValueOnce(null);

      const req = new Request("http://localhost/ws/box/box_123/terminal");
      const result = await handler.validateUpgrade(req, "box_123");

      expect(result).toBeNull();
    });

    test("returns null for non-existent box", async () => {
      // Authenticated user
      mockAuth.api.getSession.mockResolvedValueOnce({
        user: { id: testEnv.users.authenticated.id },
      });

      const req = new Request(
        "http://localhost/ws/box/box_nonexistent/terminal"
      );
      const result = await handler.validateUpgrade(
        req,
        "box_nonexistent" as BoxId
      );

      expect(result).toBeNull();
    });

    test("returns null for non-owner", async () => {
      // Create box owned by authenticated user
      const createResult = await boxService.create(
        testEnv.users.authenticated.id,
        {
          name: "non-owner-test",
        }
      );
      const box = createResult._unsafeUnwrap();

      // Different user trying to access
      mockAuth.api.getSession.mockResolvedValueOnce({
        user: { id: "usr_different_user" },
      });

      const req = new Request(`http://localhost/ws/box/${box.id}/terminal`);
      const result = await handler.validateUpgrade(req, box.id);

      expect(result).toBeNull();
    });

    test("returns null for non-running box", async () => {
      // Create box (status will be "deploying")
      const createResult = await boxService.create(
        testEnv.users.authenticated.id,
        {
          name: "deploying-test",
        }
      );
      const box = createResult._unsafeUnwrap();

      // Owner trying to access
      mockAuth.api.getSession.mockResolvedValueOnce({
        user: { id: testEnv.users.authenticated.id },
      });

      const req = new Request(`http://localhost/ws/box/${box.id}/terminal`);
      const result = await handler.validateUpgrade(req, box.id);

      expect(result).toBeNull();
    });

    test("returns connection data for valid request", async () => {
      // Create a running box with sprite info
      const createResult = await boxService.create(
        testEnv.users.authenticated.id,
        {
          name: "running-test",
        }
      );
      const box = createResult._unsafeUnwrap();

      // Manually set to running with sprite info
      await boxService.setSpriteInfo(
        box.id,
        "test-sprite",
        "https://test-sprite.sprites.dev"
      );
      await boxService.updateStatus(box.id, "running");

      // Owner trying to access
      mockAuth.api.getSession.mockResolvedValueOnce({
        user: { id: testEnv.users.authenticated.id },
      });

      const req = new Request(
        `http://localhost/ws/box/${box.id}/terminal?cols=100&rows=30`
      );
      const result = await handler.validateUpgrade(req, box.id);

      expect(result).not.toBeNull();
      expect(result?.boxId).toBe(box.id);
      expect(result?.userId).toBe(testEnv.users.authenticated.id as UserId);
      expect(result?.spriteName).toBe("test-sprite");
      expect(result?.cols).toBe(100);
      expect(result?.rows).toBe(30);
    });

    test("uses default dimensions if not provided", async () => {
      // Create a running box with sprite info
      const createResult = await boxService.create(
        testEnv.users.authenticated.id,
        {
          name: "default-dims-test",
        }
      );
      const box = createResult._unsafeUnwrap();

      await boxService.setSpriteInfo(
        box.id,
        "default-sprite",
        "https://default-sprite.sprites.dev"
      );
      await boxService.updateStatus(box.id, "running");

      mockAuth.api.getSession.mockResolvedValueOnce({
        user: { id: testEnv.users.authenticated.id },
      });

      const req = new Request(`http://localhost/ws/box/${box.id}/terminal`);
      const result = await handler.validateUpgrade(req, box.id);

      expect(result).not.toBeNull();
      expect(result?.cols).toBe(80);
      expect(result?.rows).toBe(24);
    });
  });

  describe("_buildExecUrl", () => {
    test("builds correct Sprites exec URL", () => {
      const url = handler._buildExecUrl("my-sprite", 120, 40);

      expect(url).toContain("/v1/sprites/my-sprite/exec");
      expect(url).toContain("cmd=bash");
      expect(url).toContain("tty=true");
      expect(url).toContain("cols=120");
      expect(url).toContain("rows=40");
    });
  });
});
