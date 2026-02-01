import { ORPCError } from "@orpc/server";
import { transformToMcpCatalog } from "@vps-claude/shared";
import { z } from "zod";

import { publicProcedure } from "../index";

const McpEnvVarSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    isRequired: z.boolean().optional(),
    isSecret: z.boolean().optional(),
  })
  .passthrough();

// Schema for raw MCP Registry API response
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

// Output schema - no passthrough needed
const McpCatalogEnvVarOutputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
});

const McpCatalogRemoteOutputSchema = z.object({
  type: z.string(),
  url: z.string(),
  hasRequiredHeaders: z.boolean(),
});

const McpCatalogServerSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  publisher: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  primaryPackage: z
    .object({
      registryType: z.enum(["npm", "oci"]),
      identifier: z.string(),
      envVars: z.array(McpCatalogEnvVarOutputSchema).optional(),
    })
    .optional(),
  primaryRemote: McpCatalogRemoteOutputSchema.optional(),
  hasRemote: z.boolean().optional(),
});

const McpCatalogResponseSchema = z.object({
  servers: z.array(McpCatalogServerSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
});

export const mcpRouter = {
  catalog: publicProcedure
    .route({ method: "GET", path: "/mcp/catalog" })
    .input(
      z.object({
        search: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().min(1).max(100).optional(),
      })
    )
    .output(McpCatalogResponseSchema)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "mcp.catalog" });

      const params = new URLSearchParams();
      params.set("limit", String(input.limit ?? 30));
      if (input.search) params.set("search", input.search);
      if (input.cursor) params.set("cursor", input.cursor);

      const url = `https://registry.modelcontextprotocol.io/v0.1/servers?${params}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to fetch MCP registry",
        });
      }
      const json = await res.json();
      const parsed = McpRegistryApiResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Invalid MCP registry response",
        });
      }
      const catalog = transformToMcpCatalog(parsed.data);
      return {
        ...catalog,
        nextCursor: parsed.data.metadata?.nextCursor,
      };
    }),
};
