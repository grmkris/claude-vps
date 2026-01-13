import fs from "node:fs/promises";
import path from "node:path";

import type { DockerEngineClient } from "../../src/docker-client";

export const TEST_IMAGE = "box-test:latest";
export const TEST_BASE_DIR = "/tmp/vps-claude-tests";

export async function ensureTestImage(dockerClient: DockerEngineClient) {
  // Build test image if not exists
  try {
    await dockerClient.docker.getImage(TEST_IMAGE).inspect();
  } catch {
    // Build from __tests__/fixtures/test-image/
    const contextPath = path.join(__dirname, "test-image");
    await dockerClient.buildImage(contextPath, TEST_IMAGE);
  }
}

export async function cleanupTestBox(
  dockerClient: DockerEngineClient,
  containerId?: string,
  userId?: string,
  boxId?: string
) {
  // Stop and remove container
  if (containerId) {
    try {
      const container = dockerClient.docker.getContainer(containerId);
      await container.stop({ t: 1 });
      await container.remove({ force: true });
    } catch {}
  }

  // Clean up directories
  if (userId && boxId) {
    const boxDir = path.join(TEST_BASE_DIR, userId, "agents", boxId);
    try {
      await fs.rm(boxDir, { recursive: true, force: true });
    } catch {}
  }

  // Clean up networks (box-test-* prefix)
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
}

export function createTestBoxConfig(overrides = {}) {
  return {
    userId: `usr_test_${Date.now()}`,
    boxId: `box_test_${Date.now()}`,
    name: `test-box-${Date.now()}`,
    subdomain: `test-${Math.random().toString(36).slice(2, 6)}`,
    image: TEST_IMAGE,
    plan: "hobby" as const,
    envVars: { TEST_VAR: "test_value" },
    exposedPorts: [3000],
    ...overrides,
  };
}
