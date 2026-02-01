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
  runtimeArguments?: string[];
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
  hasRemote?: boolean;
}

export interface McpCatalogResponse {
  servers: McpCatalogServer[];
  hasMore: boolean;
}

/**
 * Transform raw API response to simplified catalog format
 */
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

    return {
      name: server.name,
      title: server.title,
      description: server.description,
      publisher: publisherMeta?.publisher,
      keywords: publisherMeta?.keywords,
      primaryPackage,
      hasRemote: (server.remotes?.length ?? 0) > 0,
    };
  });

  return {
    servers,
    hasMore: !!raw.metadata?.nextCursor,
  };
}
