import { describe, expect, test } from "bun:test";

import type { CreateBoxConfig } from "../src/types";

import { buildHardenedConfig } from "../src/container-config";

describe("buildHardenedConfig", () => {
  const baseConfig: CreateBoxConfig = {
    userId: "usr_test123",
    boxId: "box_test456",
    name: "test-box",
    subdomain: "test-a1b2",
    image: "box-base:v1",
    envVars: { PASSWORD: "secret", TEST_VAR: "test" },
    exposedPorts: [3000, 8000],
  };

  test("sets correct container name", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.name).toBe("test-box");
  });

  test("sets correct image", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.Image).toBe("box-base:v1");
  });

  test("sets user to 1000:1000", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.User).toBe("1000:1000");
  });

  test("sets hostname to subdomain", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.Hostname).toBe("test-a1b2");
  });

  test("sets working directory to /home/coder", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.WorkingDir).toBe("/home/coder");
  });

  test("includes environment variables", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.Env).toContain("PASSWORD=secret");
    expect(config.Env).toContain("TEST_VAR=test");
  });

  test("enables readonly root filesystem", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.HostConfig?.ReadonlyRootfs).toBe(true);
  });

  test("drops all capabilities", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.HostConfig?.CapDrop).toEqual(["ALL"]);
  });

  test("applies security options", () => {
    const config = buildHardenedConfig(baseConfig);
    const securityOpts = config.HostConfig?.SecurityOpt || [];

    expect(securityOpts).toContain("no-new-privileges");
    expect(securityOpts.some((opt) => opt.includes("seccomp="))).toBe(true);
    expect(securityOpts.some((opt) => opt.includes("apparmor="))).toBe(true);
  });

  test("mounts required volumes", () => {
    const config = buildHardenedConfig(baseConfig);
    const binds = config.HostConfig?.Binds || [];

    // Workspace
    expect(binds.some((bind) => bind.includes("/workspace:"))).toBe(true);
    // Config
    expect(binds.some((bind) => bind.includes("/.config:"))).toBe(true);
    // Cache
    expect(binds.some((bind) => bind.includes("/.cache:"))).toBe(true);
    // Inbox
    expect(binds.some((bind) => bind.includes("/.inbox:"))).toBe(true);
    // Shared
    expect(binds.some((bind) => bind.includes("/shared:"))).toBe(true);
    // usr-local
    expect(binds.some((bind) => bind.includes("/usr-local:"))).toBe(true);
  });

  test("configures tmpfs mounts", () => {
    const config = buildHardenedConfig(baseConfig);
    const tmpfs = config.HostConfig?.Tmpfs || {};

    expect(tmpfs["/tmp"]).toBeDefined();
    expect(tmpfs["/tmp"]).toContain("noexec");
    expect(tmpfs["/tmp"]).toContain("nosuid");

    expect(tmpfs["/run"]).toBeDefined();
    expect(tmpfs["/run"]).toContain("noexec");
    expect(tmpfs["/run"]).toContain("nosuid");
  });

  test("sets resource limits (default: 1 CPU, 2GB RAM)", () => {
    const config = buildHardenedConfig(baseConfig);

    // 1 CPU = 1,000,000,000 nanocpus
    expect(config.HostConfig?.NanoCpus).toBe(1_000_000_000);

    // 2GB = 2 * 1024 * 1024 * 1024 bytes
    expect(config.HostConfig?.Memory).toBe(2 * 1024 * 1024 * 1024);
    expect(config.HostConfig?.MemorySwap).toBe(2 * 1024 * 1024 * 1024);
  });

  test("sets pids limit", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.HostConfig?.PidsLimit).toBe(200);
  });

  test("sets restart policy", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.HostConfig?.RestartPolicy?.Name).toBe("unless-stopped");
  });

  test("configures logging", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.HostConfig?.LogConfig?.Type).toBe("json-file");
    expect(config.HostConfig?.LogConfig?.Config?.["max-size"]).toBe("10m");
    expect(config.HostConfig?.LogConfig?.Config?.["max-file"]).toBe("3");
  });

  test("configures health check", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.Healthcheck?.Test).toEqual([
      "CMD",
      "curl",
      "-f",
      "http://localhost:8080/healthz",
    ]);
    expect(config.Healthcheck?.Interval).toBe(30_000_000_000); // 30s in nanoseconds
    expect(config.Healthcheck?.Timeout).toBe(10_000_000_000); // 10s
    expect(config.Healthcheck?.Retries).toBe(3);
  });

  test("sets network mode to box-specific network", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.HostConfig?.NetworkMode).toBe("box-test-a1b2-network");
  });

  test("includes Traefik labels", () => {
    const config = buildHardenedConfig(baseConfig, "example.com");
    expect(config.Labels).toBeDefined();
    expect(config.Labels?.["traefik.enable"]).toBe("true");
  });

  test("exposes standard ports", () => {
    const config = buildHardenedConfig(baseConfig);
    expect(config.ExposedPorts).toHaveProperty("22/tcp");
    expect(config.ExposedPorts).toHaveProperty("8080/tcp");
    expect(config.ExposedPorts).toHaveProperty("9999/tcp");
  });
});
