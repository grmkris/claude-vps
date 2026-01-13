import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { DockerEngineClient } from "../src/docker-client";
import {
  TEST_IMAGE,
  cleanupTestBox,
  createTestBoxConfig,
  ensureTestImage,
} from "./fixtures/test-helpers";

describe("DockerEngineClient (real Docker)", () => {
  let dockerClient: DockerEngineClient;
  const createdContainers: string[] = [];
  const createdConfigs: Array<{ userId: string; boxId: string }> = [];

  beforeAll(async () => {
    // Ensure test image exists
    dockerClient = new DockerEngineClient({
      agentsDomain: "test.local",
      baseDir: "/tmp/vps-claude-tests",
      skipSeccomp: true, // Skip seccomp profile for tests
      skipTraefik: true, // Skip traefik network for tests
      skipHealthcheck: true, // Use Dockerfile healthcheck for tests
    });

    // Clean up any leftover test networks from previous runs
    try {
      const networks = await dockerClient.docker.listNetworks({
        filters: { name: ["box-test-"] },
      });
      for (const network of networks) {
        try {
          await dockerClient.docker.getNetwork(network.Id).remove();
        } catch {}
      }
    } catch {}

    await ensureTestImage(dockerClient);
  }, 60_000); // 60s timeout for building image

  afterEach(async () => {
    // Clean up all containers created in tests
    for (let i = 0; i < createdContainers.length; i++) {
      const containerId = createdContainers[i];
      const config = createdConfigs[i];
      await cleanupTestBox(
        dockerClient,
        containerId,
        config?.userId,
        config?.boxId
      );
    }
    createdContainers.length = 0;
    createdConfigs.length = 0;
  }, 30_000); // 30s timeout for cleanup

  describe("createBox", () => {
    test("creates and starts container with real Docker", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);

      // Track for cleanup
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      // Verify container exists and is running
      expect(result.id).toMatch(/^[a-f0-9]+$/); // Docker container ID format
      expect(result.name).toBe(config.name);
      expect(result.status).toBe("running");

      // Verify container with Docker API
      const container = dockerClient.docker.getContainer(result.id);
      const inspect = await container.inspect();

      expect(inspect.State.Running).toBe(true);
      expect(inspect.Config.User).toBe("1000:1000");
      expect(inspect.HostConfig.ReadonlyRootfs).toBe(true);
      expect(inspect.HostConfig.CapDrop).toContain("ALL");
    }, 15_000);

    test("container has correct resource limits (default: 1 CPU, 2GB RAM)", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      const container = dockerClient.docker.getContainer(result.id);
      const inspect = await container.inspect();

      // Default: 1 CPU, 2GB RAM
      expect(inspect.HostConfig.NanoCpus).toBe(1_000_000_000);
      expect(inspect.HostConfig.Memory).toBe(2 * 1024 * 1024 * 1024);
    }, 15_000);

    test("container has environment variables", async () => {
      const config = createTestBoxConfig({
        envVars: { CUSTOM_VAR: "custom_value", ANOTHER: "test" },
      });

      const result = await dockerClient.createBox(config);
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      const container = dockerClient.docker.getContainer(result.id);
      const inspect = await container.inspect();

      const envVars = inspect.Config.Env || [];
      expect(
        envVars.some((env) => env.includes("CUSTOM_VAR=custom_value"))
      ).toBe(true);
      expect(envVars.some((env) => env.includes("ANOTHER=test"))).toBe(true);
    }, 15_000);

    test("creates isolated network for box", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      // Verify network exists
      const networkName = `box-${config.subdomain}-network`;
      const networks = await dockerClient.docker.listNetworks({
        filters: { name: [networkName] },
      });

      expect(networks.length).toBe(1);
      expect(networks[0].Name).toBe(networkName);
    }, 15_000);

    test("container uses correct image", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      const container = dockerClient.docker.getContainer(result.id);
      const inspect = await container.inspect();

      expect(inspect.Config.Image).toBe(TEST_IMAGE);
    }, 15_000);
  });

  describe("deleteBox", () => {
    test("stops and removes container", async () => {
      const config = createTestBoxConfig();

      // Create box
      const result = await dockerClient.createBox(config);
      const containerId = result.id;

      // Delete box
      await dockerClient.deleteBox(containerId, config.userId, config.boxId);

      // Verify container is gone
      try {
        const container = dockerClient.docker.getContainer(containerId);
        await container.inspect();
        throw new Error("Container should not exist");
      } catch (error: unknown) {
        expect((error as { statusCode?: number }).statusCode).toBe(404);
      }
    }, 20_000);

    test("cleans up network", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);
      const networkName = `box-${config.subdomain}-network`;

      // Network should exist
      let networks = await dockerClient.docker.listNetworks({
        filters: { name: [networkName] },
      });
      expect(networks.length).toBe(1);

      // Delete box
      await dockerClient.deleteBox(result.id, config.userId, config.boxId);

      // Network should be removed
      networks = await dockerClient.docker.listNetworks({
        filters: { name: [networkName] },
      });
      expect(networks.length).toBe(0);
    }, 20_000);

    test("handles non-existent container gracefully", async () => {
      // Should not throw when deleting non-existent container
      await dockerClient.deleteBox("nonexistent", "usr_test", "box_test");
      // If we get here without throwing, the test passes
      expect(true).toBe(true);
    }, 10_000);
  });

  describe("waitForHealth", () => {
    test("returns true when container is running and healthy", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      // Wait for health (our test image has quick healthcheck)
      // Note: Alpine healthcheck may take longer than expected
      const healthy = await dockerClient.waitForHealth(result.id, 30_000);
      expect(healthy).toBe(true);
    }, 40_000);

    test("returns false when container is stopped", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      // Stop container immediately
      await dockerClient.docker.getContainer(result.id).stop();

      // Should timeout (not healthy because stopped)
      const healthy = await dockerClient.waitForHealth(result.id, 3_000);
      expect(healthy).toBe(false);
    }, 15_000);
  });

  describe("getBoxStats", () => {
    test("returns CPU and memory stats", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      // Wait a bit for stats to be available
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const stats = await dockerClient.getBoxStats(result.id);

      expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(stats.memoryUsageMB).toBeGreaterThanOrEqual(0);
      expect(stats.memoryLimitMB).toBeGreaterThan(0);
      expect(stats.memoryPercent).toBeGreaterThanOrEqual(0);
      expect(stats.networkRxBytes).toBeGreaterThanOrEqual(0);
      expect(stats.networkTxBytes).toBeGreaterThanOrEqual(0);
    }, 20_000);

    test("returns stats for stopped container", async () => {
      const config = createTestBoxConfig();

      const result = await dockerClient.createBox(config);
      createdContainers.push(result.id);
      createdConfigs.push({ userId: config.userId, boxId: config.boxId });

      // Stop container
      await dockerClient.docker.getContainer(result.id).stop();

      // Docker can return stats for stopped containers
      const stats = await dockerClient.getBoxStats(result.id);
      expect(stats).toBeDefined();
      // Stopped containers may have NaN values, just check structure
      expect(stats).toHaveProperty("cpuPercent");
      expect(stats).toHaveProperty("memoryUsageMB");
    }, 15_000);
  });

  describe("buildImage", () => {
    test("builds image from Dockerfile context", async () => {
      const testImageName = "test-build-image:latest";

      // Use existing test image directory
      const contextPath = `${__dirname}/fixtures/test-image`;

      await dockerClient.buildImage(contextPath, testImageName);

      // Verify image exists
      const image = dockerClient.docker.getImage(testImageName);
      const inspect = await image.inspect();

      expect(inspect.RepoTags).toContain(testImageName);

      // Cleanup (force remove in case containers are still using it)
      try {
        await image.remove({ force: true });
      } catch {
        // Ignore cleanup errors
      }
    }, 60_000);
  });
});
