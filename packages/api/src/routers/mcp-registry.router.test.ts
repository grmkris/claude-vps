import { transformToMcpCatalog } from "@vps-claude/shared";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

const MCP_REGISTRY_URL =
  "https://registry.modelcontextprotocol.io/v0.1/servers?limit=100";

// Schema must match mcp-registry.router.ts exactly
const McpEnvVarSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    isRequired: z.boolean().optional(),
    isSecret: z.boolean().optional(),
  })
  .passthrough();

const McpRegistryPackageSchema = z
  .object({
    registryType: z.string(),
    identifier: z.string(),
    transport: z.object({ type: z.string() }).optional(),
    environmentVariables: z.array(McpEnvVarSchema).optional(),
    runtimeArguments: z.array(z.unknown()).optional(),
  })
  .passthrough();

const McpRegistryServerSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    packages: z.array(McpRegistryPackageSchema).optional(),
    remotes: z
      .array(
        z
          .object({
            type: z.string(),
            url: z.string(),
            headers: z
              .array(
                z
                  .object({
                    name: z.string(),
                    description: z.string().optional(),
                    isRequired: z.boolean().optional(),
                    isSecret: z.boolean().optional(),
                  })
                  .passthrough()
              )
              .optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const McpRegistryApiResponseSchema = z.object({
  servers: z.array(
    z.object({
      server: McpRegistryServerSchema,
      _meta: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  metadata: z
    .object({
      nextCursor: z.string().optional(),
      count: z.number().optional(),
    })
    .optional(),
});

describe("MCP Registry Schema", () => {
  test("parses real MCP registry API response", async () => {
    const res = await fetch(MCP_REGISTRY_URL);
    expect(res.ok).toBe(true);

    const json = await res.json();
    const result = McpRegistryApiResponseSchema.safeParse(json);

    if (!result.success) {
      console.error(
        "Parse errors:",
        JSON.stringify(result.error.issues, null, 2)
      );
    }
    expect(result.success).toBe(true);
    expect(result.data?.servers.length).toBeGreaterThan(0);
  });

  test("transforms real API response to catalog format", async () => {
    const res = await fetch(MCP_REGISTRY_URL);
    const json = await res.json();
    const parsed = McpRegistryApiResponseSchema.safeParse(json);
    if (!parsed.success) throw new Error("Parse failed");

    const catalog = transformToMcpCatalog(parsed.data);

    expect(catalog.servers.length).toBeGreaterThan(0);
    expect(typeof catalog.hasMore).toBe("boolean");

    // Verify server structure
    const server = catalog.servers[0];
    if (!server) throw new Error("Expected server");
    expect(typeof server.name).toBe("string");
  });
});

describe("MCP Registry Search & Pagination", () => {
  test("search param filters results", async () => {
    const res = await fetch(
      `${MCP_REGISTRY_URL.replace("limit=100", "limit=30&search=github")}`
    );
    expect(res.ok).toBe(true);

    const json = await res.json();
    const result = McpRegistryApiResponseSchema.safeParse(json);
    expect(result.success).toBe(true);

    // Search should return results (API handles search logic)
    const servers = result.data?.servers ?? [];
    expect(servers.length).toBeGreaterThan(0);

    // At least some results should match the search term
    const matchingServers = servers.filter((entry) => {
      const name = entry.server.name.toLowerCase();
      const desc = entry.server.description?.toLowerCase() ?? "";
      return name.includes("github") || desc.includes("github");
    });
    expect(matchingServers.length).toBeGreaterThan(0);
  });

  test("cursor param paginates results", async () => {
    // Get first page
    const res1 = await fetch(
      `${MCP_REGISTRY_URL.replace("limit=100", "limit=10")}`
    );
    const page1 = McpRegistryApiResponseSchema.parse(await res1.json());
    expect(page1.metadata?.nextCursor).toBeDefined();

    // Get second page using cursor
    const cursor = page1.metadata?.nextCursor;
    const res2 = await fetch(
      `${MCP_REGISTRY_URL.replace("limit=100", `limit=10&cursor=${cursor}`)}`
    );
    const page2 = McpRegistryApiResponseSchema.parse(await res2.json());

    // Pages should have different servers
    const page1Names = new Set(page1.servers.map((s) => s.server.name));
    const page2Names = new Set(page2.servers.map((s) => s.server.name));

    // No overlap between pages
    for (const name of page2Names) {
      expect(page1Names.has(name)).toBe(false);
    }
  });
});

describe("transformToMcpCatalog", () => {
  test("extracts npm package as primaryPackage", () => {
    const rawResponse = {
      servers: [
        {
          server: {
            name: "test/server",
            packages: [
              { registryType: "npm", identifier: "@test/pkg" },
              { registryType: "oci", identifier: "docker.io/test" },
            ],
          },
        },
      ],
    };

    const catalog = transformToMcpCatalog(rawResponse);
    const server = catalog.servers[0];
    if (!server) throw new Error("Expected server");

    expect(server.primaryPackage?.registryType).toBe("npm");
    expect(server.primaryPackage?.identifier).toBe("@test/pkg");
  });

  test("sets hasRemote when remotes exist", () => {
    const rawResponse = {
      servers: [
        {
          server: {
            name: "test/server",
            remotes: [{ type: "http", url: "https://example.com" }],
          },
        },
      ],
    };

    const catalog = transformToMcpCatalog(rawResponse);
    expect(catalog.servers[0]?.hasRemote).toBe(true);
  });

  test("sets hasMore based on nextCursor", () => {
    expect(
      transformToMcpCatalog({ servers: [], metadata: { nextCursor: "x" } })
        .hasMore
    ).toBe(true);
    expect(transformToMcpCatalog({ servers: [], metadata: {} }).hasMore).toBe(
      false
    );
  });
});
