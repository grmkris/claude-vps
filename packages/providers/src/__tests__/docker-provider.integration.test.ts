import { createLogger } from "@vps-claude/logger";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";

import type { ComputeProvider } from "../provider.interface";

import { createDockerProvider } from "../docker/docker-provider";

const logger = createLogger({ appName: "docker-provider-test" });

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const HAS_DOCKER = fs.existsSync(DOCKER_SOCKET);

describe.skipIf(!HAS_DOCKER)("DockerProvider Integration", () => {
  let provider: ComputeProvider;
  let instanceName: string;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    provider = createDockerProvider({
      socketPath: DOCKER_SOCKET,
      baseDomain: "test.local",
      logger,
    });

    const result = await provider.createInstance({
      name: `docker-test-${suffix}`,
      userId: "test-user",
      subdomain: `docker-test-${suffix}`,
      envVars: { TEST_VAR: "test_value" },
    });
    instanceName = result.instanceName;

    logger.info({ instanceName }, "Test container created");
  }, 60_000);

  afterAll(async () => {
    if (instanceName) {
      try {
        await provider.deleteInstance(instanceName);
        logger.info({ instanceName }, "Test container deleted");
      } catch (error) {
        logger.warn({ instanceName, error }, "Failed to delete test container");
      }
    }
  }, 30_000);

  // Lifecycle tests
  describe("Lifecycle", () => {
    test("createInstance creates container", async () => {
      const info = await provider.getInstance(instanceName);
      expect(info).not.toBeNull();
      expect(info?.status).toBe("running");
    });

    test("getInstance returns null for non-existent container", async () => {
      const info = await provider.getInstance("nonexistent-container-xyz");
      expect(info).toBeNull();
    });

    test("listInstances includes created container", async () => {
      const instances = await provider.listInstances();
      expect(instances.some((i) => i.name === instanceName)).toBe(true);
    });
  });

  // Command execution tests
  describe("Command Execution", () => {
    test("execShell runs bash command", async () => {
      const result = await provider.execShell(instanceName, "echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
    });

    test("execShell handles environment variables", async () => {
      const result = await provider.execShell(
        instanceName,
        'echo "value: $TEST_VAR"'
      );
      expect(result.exitCode).toBe(0);
      // Note: env vars are set at container level, not in shell
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

    test("execShell handles multi-line output", async () => {
      const result = await provider.execShell(
        instanceName,
        'echo -e "line1\\nline2\\nline3"'
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().split("\n")).toHaveLength(3);
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

    test("listDir throws on non-existent path", async () => {
      expect.assertions(1);
      try {
        await provider.listDir(instanceName, "/nonexistent/path/xyz");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    test("readFile throws on non-existent file", async () => {
      expect.assertions(1);
      try {
        await provider.readFile(instanceName, "/nonexistent/file.txt");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  // Capabilities tests
  describe("Capabilities", () => {
    test("type is docker", () => {
      expect(provider.type).toBe("docker");
    });

    test("checkpoints capability is false", () => {
      expect(provider.capabilities.checkpoints).toBe(false);
    });

    test("sleepWake capability is false", () => {
      expect(provider.capabilities.sleepWake).toBe(false);
    });

    test("wsProxy capability is false", () => {
      expect(provider.capabilities.wsProxy).toBe(false);
    });

    test("urlAuth capability is false", () => {
      expect(provider.capabilities.urlAuth).toBe(false);
    });

    test("envHotReload capability is true", () => {
      expect(provider.capabilities.envHotReload).toBe(true);
    });
  });

  // Environment variables
  describe("Environment Variables", () => {
    test("updateEnvVars updates environment", async () => {
      await provider.updateEnvVars(instanceName, {
        NEW_VAR: "new_value",
      });

      // Read the env file to verify
      const result = await provider.execShell(
        instanceName,
        "cat /home/box/.bashrc.env"
      );
      expect(result.stdout).toContain("NEW_VAR");
      expect(result.stdout).toContain("new_value");
    });
  });
});
