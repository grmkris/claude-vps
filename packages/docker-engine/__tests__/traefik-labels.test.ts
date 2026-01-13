import { describe, expect, test } from "bun:test";

import { generateTraefikLabels } from "../src/traefik-labels";

describe("generateTraefikLabels", () => {
  test("enables Traefik", () => {
    const labels = generateTraefikLabels("test-box", [], "example.com");
    expect(labels["traefik.enable"]).toBe("true");
  });

  test("creates router for code-server on port 8080", () => {
    const labels = generateTraefikLabels("test-box", [], "example.com");

    expect(labels["traefik.http.routers.test-box-web.rule"]).toBe(
      "Host(`test-box.example.com`)"
    );
    expect(labels["traefik.http.routers.test-box-web.entrypoints"]).toBe(
      "websecure"
    );
    expect(labels["traefik.http.routers.test-box-web.tls"]).toBe("true");
    expect(labels["traefik.http.routers.test-box-web.tls.certresolver"]).toBe(
      "letsencrypt"
    );
    expect(
      labels["traefik.http.services.test-box-web.loadbalancer.server.port"]
    ).toBe("8080");
  });

  test("creates routers for exposed ports", () => {
    const labels = generateTraefikLabels(
      "test-box",
      [3000, 8000],
      "example.com"
    );

    // Port 3000
    expect(labels["traefik.http.routers.test-box-port3000.rule"]).toBe(
      "Host(`test-box-3000.example.com`)"
    );
    expect(labels["traefik.http.routers.test-box-port3000.entrypoints"]).toBe(
      "websecure"
    );
    expect(labels["traefik.http.routers.test-box-port3000.tls"]).toBe("true");
    expect(
      labels["traefik.http.routers.test-box-port3000.tls.certresolver"]
    ).toBe("letsencrypt");
    expect(
      labels["traefik.http.services.test-box-port3000.loadbalancer.server.port"]
    ).toBe("3000");

    // Port 8000
    expect(labels["traefik.http.routers.test-box-port8000.rule"]).toBe(
      "Host(`test-box-8000.example.com`)"
    );
    expect(
      labels["traefik.http.services.test-box-port8000.loadbalancer.server.port"]
    ).toBe("8000");
  });

  test("uses subdomain in routing rules", () => {
    const labels = generateTraefikLabels("my-app-x7z3", [3000], "test.dev");

    expect(labels["traefik.http.routers.my-app-x7z3-web.rule"]).toBe(
      "Host(`my-app-x7z3.test.dev`)"
    );
    expect(labels["traefik.http.routers.my-app-x7z3-port3000.rule"]).toBe(
      "Host(`my-app-x7z3-3000.test.dev`)"
    );
  });

  test("uses custom domain parameter", () => {
    const labels = generateTraefikLabels("app", [], "custom.domain.com");

    expect(labels["traefik.http.routers.app-web.rule"]).toBe(
      "Host(`app.custom.domain.com`)"
    );
  });

  test("defaults to localhost when domain not provided", () => {
    // Clear env var for this test
    const oldEnv = process.env.AGENTS_DOMAIN;
    delete process.env.AGENTS_DOMAIN;

    const labels = generateTraefikLabels("app", []);

    expect(labels["traefik.http.routers.app-web.rule"]).toBe(
      "Host(`app.localhost`)"
    );

    // Restore env var
    if (oldEnv) process.env.AGENTS_DOMAIN = oldEnv;
  });

  test("handles empty exposed ports array", () => {
    const labels = generateTraefikLabels("app", [], "example.com");

    // Should only have code-server router, no port-specific routers
    const labelKeys = Object.keys(labels);
    expect(labelKeys.filter((key) => key.includes("-port"))).toHaveLength(0);
    expect(labelKeys.filter((key) => key.includes("-web"))).toHaveLength(5); // rule, entrypoints, tls, certresolver, port
  });

  test("handles multiple exposed ports", () => {
    const labels = generateTraefikLabels(
      "app",
      [3000, 4000, 5000],
      "example.com"
    );

    // Should have routers for all three ports
    expect(labels["traefik.http.routers.app-port3000.rule"]).toBeDefined();
    expect(labels["traefik.http.routers.app-port4000.rule"]).toBeDefined();
    expect(labels["traefik.http.routers.app-port5000.rule"]).toBeDefined();
  });

  test("enables TLS with Let's Encrypt for all routers", () => {
    const labels = generateTraefikLabels("app", [3000, 8000], "example.com");

    // Check code-server router
    expect(labels["traefik.http.routers.app-web.tls"]).toBe("true");
    expect(labels["traefik.http.routers.app-web.tls.certresolver"]).toBe(
      "letsencrypt"
    );

    // Check exposed port routers
    expect(labels["traefik.http.routers.app-port3000.tls"]).toBe("true");
    expect(labels["traefik.http.routers.app-port3000.tls.certresolver"]).toBe(
      "letsencrypt"
    );
    expect(labels["traefik.http.routers.app-port8000.tls"]).toBe("true");
    expect(labels["traefik.http.routers.app-port8000.tls.certresolver"]).toBe(
      "letsencrypt"
    );
  });

  test("uses websecure entrypoint for all routers", () => {
    const labels = generateTraefikLabels("app", [3000], "example.com");

    expect(labels["traefik.http.routers.app-web.entrypoints"]).toBe(
      "websecure"
    );
    expect(labels["traefik.http.routers.app-port3000.entrypoints"]).toBe(
      "websecure"
    );
  });
});
