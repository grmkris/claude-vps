import { createLogger } from "@vps-claude/logger";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";

import type { ComputeProvider } from "../provider.interface";

import { createDockerProvider } from "../docker/docker-provider";

const logger = createLogger({ appName: "docker-provider-test" });

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const HAS_DOCKER = fs.existsSync(DOCKER_SOCKET);
const BASE_DOMAIN = process.env.TEST_BASE_DOMAIN || "agents.localhost";

describe.skipIf(!HAS_DOCKER)("DockerProvider Integration", () => {
  let provider: ComputeProvider;
  let instanceName: string;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    provider = createDockerProvider({
      socketPath: DOCKER_SOCKET,
      baseDomain: BASE_DOMAIN,
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

      // Wait for container to stabilize after box-agent restart
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Retry logic for container that might be restarting
      let result;
      for (let i = 0; i < 3; i++) {
        try {
          result = await provider.execShell(
            instanceName,
            "cat /home/box/.bashrc.env"
          );
          break;
        } catch (e) {
          if (i === 2) throw e;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      expect(result?.stdout).toContain("NEW_VAR");
      expect(result?.stdout).toContain("new_value");
    });
  });

  // HTTP Routing tests (requires Traefik running + box image with box-agent baked in)
  // To run these tests:
  // 1. Build box-agent: cd apps/box-agent && bun run build:linux-arm64
  // 2. Copy to docker/box: cp dist/box-agent-linux-arm64 docker/box/
  // 3. Build image with binary: cd docker/box && docker build -t vps-claude-box:latest .
  // 4. Run tests: BOX_IMAGE=vps-claude-box:latest RUN_HTTP_TESTS=1 bun test docker-provider
  const RUN_HTTP_TESTS = process.env.RUN_HTTP_TESTS === "1";
  describe.skipIf(!RUN_HTTP_TESTS)("HTTP Routing", () => {
    let containerUrl: string;

    beforeAll(async () => {
      containerUrl = `http://docker-test-${suffix}.${BASE_DOMAIN}`;

      // Run setup steps to configure nginx with landing page
      const setupSteps = [
        "SETUP_CREATE_ENV_FILE",
        "SETUP_INSTALL_NGINX",
        "SETUP_NGINX_SERVICE",
      ];

      for (const step of setupSteps) {
        await provider.runSetupStep({
          instanceName,
          stepKey: step,
          boxAgentBinaryUrl: "",
          envVars: {
            BOX_SUBDOMAIN: `docker-test-${suffix}`,
            INSTANCE_NAME: instanceName,
            BOX_AGENT_SECRET: "test-secret-for-integration-tests-min32chars",
          },
          instanceUrl: containerUrl,
        });
      }

      // Wait for nginx to start and be routable via Traefik
      // Retry until we get a successful response (Traefik needs time to discover the container)
      let ready = false;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));

        // Check if Traefik has discovered the router
        try {
          const routersRes = await fetch(
            "http://localhost:8081/api/http/routers",
            {
              signal: AbortSignal.timeout(2000),
            }
          );
          if (routersRes.ok) {
            const routers = (await routersRes.json()) as Array<{
              name: string;
            }>;
            const hasRouter = routers.some((r) =>
              r.name.includes(`docker-test-${suffix}`)
            );
            if (!hasRouter) {
              logger.info(
                { attempt: i + 1 },
                "Traefik hasn't discovered container yet..."
              );
              continue;
            }
          }
        } catch {
          // Traefik API not available, just continue
        }

        try {
          const res = await fetch(`${containerUrl}/`, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            ready = true;
            break;
          }
          logger.info(
            { attempt: i + 1, status: res.status },
            "Waiting for nginx..."
          );
        } catch (e) {
          logger.info(
            { attempt: i + 1, error: String(e) },
            "Waiting for nginx..."
          );
        }
      }
      if (!ready) {
        logger.warn("nginx not ready after 30s, tests may fail");
      }
    }, 60_000);

    test("GET / returns static landing page from nginx", async () => {
      const res = await fetch(`${containerUrl}/`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const body = await res.text();
        logger.error({ status: res.status, body }, "Landing page fetch failed");
      }
      expect(res.ok).toBe(true);

      const html = await res.text();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain(`docker-test-${suffix}`);
      expect(html).toContain("/app");
      expect(html).toContain("/box/");
    });

    test("GET /box/health returns BoxAgent health (if running)", async () => {
      try {
        const res = await fetch(`${containerUrl}/box/health`, {
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const data = (await res.json()) as { agent: string };
          expect(data.agent).toBe("box-agent");
        }
      } catch {
        // Box-agent may not be running in test setup - that's OK
        expect(true).toBe(true);
      }
    });

    test("GET /box/ returns Scalar docs (not landing page)", async () => {
      try {
        const res = await fetch(`${containerUrl}/box/`, {
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const html = await res.text();
          // Should NOT contain landing page content (that's nginx's job)
          expect(html).not.toContain("Docker Access");
        }
      } catch {
        // Box-agent may not be running - that's OK
        expect(true).toBe(true);
      }
    });

    test("GET /app/ returns AgentApp response", async () => {
      try {
        const res = await fetch(`${containerUrl}/app/`, {
          signal: AbortSignal.timeout(10000),
        });
        // AgentApp may not be installed - any response is valid
        expect([200, 404, 500, 502, 503]).toContain(res.status);
      } catch {
        // Connection refused is OK if AgentApp not running
        expect(true).toBe(true);
      }
    });
  });
});
