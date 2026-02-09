/**
 * Types for MCP Registry API
 * @see https://registry.modelcontextprotocol.io
 */

export interface McpEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

export interface McpRegistryPackage {
  registryType: string;
  identifier: string;
  transport?: { type: string };
  environmentVariables?: McpEnvVar[];
  runtimeArguments?: unknown[];
}

export interface McpRegistryRemote {
  type: string;
  url: string;
  headers?: Array<{
    name: string;
    description?: string;
    isRequired?: boolean;
    isSecret?: boolean;
  }>;
}

/** Raw server from MCP Registry API */
export interface McpRegistryServer {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  packages?: McpRegistryPackage[];
  remotes?: McpRegistryRemote[];
}

/** Raw API response from MCP Registry */
export interface McpRegistryApiResponse {
  servers: Array<{
    server: McpRegistryServer;
    _meta?: Record<string, unknown>;
  }>;
  metadata?: {
    nextCursor?: string;
    count?: number;
  };
}

/** Simplified remote info for catalog display */
export interface McpCatalogRemote {
  type: string;
  url: string;
  hasRequiredHeaders: boolean;
}

/** Simplified server for catalog display */
export interface McpCatalogServer {
  name: string;
  title?: string;
  description?: string;
  publisher?: string;
  keywords?: string[];
  primaryPackage?: {
    registryType: "npm" | "oci";
    identifier: string;
    envVars?: McpEnvVar[];
  };
  primaryRemote?: McpCatalogRemote;
  hasRemote?: boolean;
}

export interface McpCatalogResponse {
  servers: McpCatalogServer[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Transform raw API response to simplified catalog format
 */
/** MCP server config for runtime - stdio (local command) */
export interface McpServerConfigStdio {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** MCP server config for runtime - SSE (remote URL) */
export interface McpServerConfigSse {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

/** MCP server config for runtime - HTTP (streamable HTTP) */
export interface McpServerConfigHttp {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

/** MCP server config for runtime (matches box-agent-config schema) */
export type McpServerConfig =
  | McpServerConfigStdio
  | McpServerConfigSse
  | McpServerConfigHttp;

/**
 * Convert a registry server to McpServerConfig
 * Supports npm packages (npx -y <identifier>) and remote SSE servers (no auth)
 */
export function registryServerToConfig(
  server: McpCatalogServer
): McpServerConfig | null {
  // Prefer npm package if available
  if (server.primaryPackage?.registryType === "npm") {
    return {
      command: "npx",
      args: ["-y", server.primaryPackage.identifier],
    };
  }

  // Fallback to remote if no required headers
  if (server.primaryRemote && !server.primaryRemote.hasRequiredHeaders) {
    return {
      type: "sse",
      url: server.primaryRemote.url,
    };
  }

  return null;
}

export function transformToMcpCatalog(
  raw: McpRegistryApiResponse
): McpCatalogResponse {
  const servers = raw.servers.map((entry): McpCatalogServer => {
    const { server, _meta } = entry;

    // Safely extract publisher metadata
    const publisherMeta = _meta?.[
      "io.modelcontextprotocol.registry/publisher-provided"
    ] as { keywords?: string[]; publisher?: string } | undefined;

    // Find first npm package as primary
    const npmPackage = server.packages?.find((p) => p.registryType === "npm");
    const primaryPackage = npmPackage
      ? {
          registryType: npmPackage.registryType as "npm" | "oci",
          identifier: npmPackage.identifier,
          envVars: npmPackage.environmentVariables,
        }
      : undefined;

    // Find first remote as primary
    const firstRemote = server.remotes?.[0];
    const primaryRemote = firstRemote
      ? {
          type: firstRemote.type,
          url: firstRemote.url,
          hasRequiredHeaders:
            firstRemote.headers?.some((h) => h.isRequired) ?? false,
        }
      : undefined;

    return {
      name: server.name,
      title: server.title,
      description: server.description,
      publisher: publisherMeta?.publisher,
      keywords: publisherMeta?.keywords,
      primaryPackage,
      primaryRemote,
      hasRemote: (server.remotes?.length ?? 0) > 0,
    };
  });

  return {
    servers,
    hasMore: !!raw.metadata?.nextCursor,
  };
}
