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
  /** Enable TLS with Let's Encrypt (default: false for local dev) */
  useTls?: boolean;
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
    useTls = false,
  } = config;
  const routerName = serviceName.replace(/[^a-zA-Z0-9]/g, "-");
  const host = `${subdomain}.${baseDomain}`;

  const labels: Record<string, string> = {
    "traefik.enable": "true",
    "traefik.docker.network": network,
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${host}\`)`,
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]:
      String(port),
  };

  if (useTls) {
    labels[`traefik.http.routers.${routerName}.entrypoints`] = "websecure";
    labels[`traefik.http.routers.${routerName}.tls`] = "true";
    labels[`traefik.http.routers.${routerName}.tls.certresolver`] =
      "letsencrypt";
  } else {
    labels[`traefik.http.routers.${routerName}.entrypoints`] = "web";
  }

  return labels;
}

/**
 * Generate public URL for a container
 */
export function getContainerUrl(
  subdomain: string,
  baseDomain: string,
  useTls = false
): string {
  const protocol = useTls ? "https" : "http";
  return `${protocol}://${subdomain}.${baseDomain}`;
}
