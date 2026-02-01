/**
 * Generate Traefik labels for container routing
 *
 * Routes:
 * - *.{baseDomain} -> container port 8080 (nginx -> box-agent/agent-app)
 */
export interface TraefikLabelConfig {
  /** Container/service name for routing rules */
  serviceName: string;
  /** Subdomain for this container */
  subdomain: string;
  /** Base domain (e.g., agents.example.com) */
  baseDomain: string;
  /** Internal port to route to (default: 8080) */
  port?: number;
  /** Docker network Traefik uses (default: "traefik") */
  network?: string;
}

export function generateTraefikLabels(
  config: TraefikLabelConfig
): Record<string, string> {
  const {
    serviceName,
    subdomain,
    baseDomain,
    port = 8080,
    network = "traefik",
  } = config;
  const routerName = serviceName.replace(/[^a-zA-Z0-9]/g, "-");
  const host = `${subdomain}.${baseDomain}`;

  return {
    "traefik.enable": "true",
    // Docker network for Traefik to use
    "traefik.docker.network": network,
    // HTTP Router
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${host}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: "websecure",
    [`traefik.http.routers.${routerName}.tls`]: "true",
    [`traefik.http.routers.${routerName}.tls.certresolver`]: "letsencrypt",
    // Service
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]:
      String(port),
  };
}

/**
 * Generate public URL for a container
 */
export function getContainerUrl(subdomain: string, baseDomain: string): string {
  return `https://${subdomain}.${baseDomain}`;
}
