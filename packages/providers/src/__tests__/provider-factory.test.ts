import { describe, expect, mock, test } from "bun:test";

import { createProviderFactory } from "../provider-factory";

// Mock logger
const mockLogger = {
  info: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
  debug: mock(() => {}),
  fatal: mock(() => {}),
  trace: mock(() => {}),
};

// Mock SpritesClient
const mockSpritesClient = {
  createSprite: mock(() =>
    Promise.resolve({ spriteName: "test", url: "https://test.sprites.dev" })
  ),
  deleteSprite: mock(() => Promise.resolve()),
  getSprite: mock(() => Promise.resolve({ name: "test", status: "running" })),
  listSprites: mock(() => Promise.resolve([{ name: "test" }])),
  execCommand: mock(() =>
    Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
  ),
  execShell: mock(() =>
    Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
  ),
  readFile: mock(() => Promise.resolve(Buffer.from(""))),
  writeFile: mock(() => Promise.resolve()),
  listDir: mock(() => Promise.resolve([])),
  runSetupStep: mock(() =>
    Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
  ),
  checkHealth: mock(() => Promise.resolve(true)),
  updateEnvVars: mock(() => Promise.resolve()),
  createCheckpoint: mock(() =>
    Promise.resolve({ id: "cp1", sprite_name: "test", created_at: "" })
  ),
  listCheckpoints: mock(() => Promise.resolve([])),
  restoreCheckpoint: mock(() => Promise.resolve()),
  getProxyUrl: mock(() => "wss://proxy.sprites.dev"),
  getToken: mock(() => "token"),
  setUrlAuth: mock(() => Promise.resolve()),
  setupSprite: mock(() => Promise.resolve()),
};

describe("ProviderFactory", () => {
  test("getProvider returns sprites provider when configured", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      logger: mockLogger,
    });

    const provider = factory.getProvider("sprites");

    expect(provider).toBeDefined();
    expect(provider.type).toBe("sprites");
  });

  test("getProvider throws when sprites not configured", () => {
    const factory = createProviderFactory({
      logger: mockLogger,
    });

    expect(() => factory.getProvider("sprites")).toThrow(
      "SpritesClient not configured"
    );
  });

  test("getProvider throws when docker not configured", () => {
    const factory = createProviderFactory({
      logger: mockLogger,
    });

    expect(() => factory.getProvider("docker")).toThrow(
      "Docker options not configured"
    );
  });

  test("getProvider caches provider instances", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      logger: mockLogger,
    });

    const provider1 = factory.getProvider("sprites");
    const provider2 = factory.getProvider("sprites");

    expect(provider1).toBe(provider2);
  });

  test("getProviderForBox uses box.provider field", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      logger: mockLogger,
    });

    const provider = factory.getProviderForBox({ provider: "sprites" });

    expect(provider.type).toBe("sprites");
  });

  test("getProviderForBox defaults to sprites", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      logger: mockLogger,
    });

    const provider = factory.getProviderForBox({});

    expect(provider.type).toBe("sprites");
  });

  test("getProviderForBox handles null provider", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      logger: mockLogger,
    });

    const provider = factory.getProviderForBox({ provider: null });

    expect(provider.type).toBe("sprites");
  });

  test("getDefaultProvider returns sprites", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      logger: mockLogger,
    });

    const provider = factory.getDefaultProvider();

    expect(provider.type).toBe("sprites");
  });

  test("isProviderAvailable returns true for configured providers", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      logger: mockLogger,
    });

    expect(factory.isProviderAvailable("sprites")).toBe(true);
    expect(factory.isProviderAvailable("docker")).toBe(false);
  });

  test("listAvailableProviders returns configured providers", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      logger: mockLogger,
    });

    const available = factory.listAvailableProviders();

    expect(available).toContain("sprites");
    expect(available).not.toContain("docker");
  });

  test("listAvailableProviders includes docker when configured", () => {
    const factory = createProviderFactory({
      spritesClient: mockSpritesClient as never,
      dockerOptions: { baseDomain: "test.local" },
      logger: mockLogger,
    });

    const available = factory.listAvailableProviders();

    expect(available).toContain("sprites");
    expect(available).toContain("docker");
  });
});
