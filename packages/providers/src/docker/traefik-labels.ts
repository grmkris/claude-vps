/**
 * Generate Traefik labels for container routing
 *
 * Routes:
 * - / -> nginx:8080 (static landing page)
 * - /app/* -> AgentApp (port 33003, no strip - Next.js basePath handles it)
 * - /box/* -> BoxAgent (port 33002, strip /box)
 */
export interface TraefikLabelConfig {
  /** Container/service name for routing rules */
  serviceName: string;
  /** Subdomain for this container */
  subdomain: string;
  /** Base domain (e.g., agents.example.com) */
  baseDomain: string;
  /** BoxAgent port (default: 33002) */
  boxAgentPort?: number;
  /** AgentApp port (default: 3000) */
  agentAppPort?: number;
  /** Nginx port for static content (default: 8080) */
  nginxPort?: number;
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
    boxAgentPort = 33002,
    agentAppPort = 33003,
    nginxPort = 8080,
    network = "traefik",
    useTls = false,
  } = config;
  const routerName = serviceName.replace(/[^a-zA-Z0-9]/g, "-");
  const host = `${subdomain}.${baseDomain}`;
  const entrypoint = useTls ? "websecure" : "web";

  const labels: Record<string, string> = {
    "traefik.enable": "true",
    "traefik.docker.network": network,

    // Services
    [`traefik.http.services.${routerName}-box.loadbalancer.server.port`]:
      String(boxAgentPort),
    [`traefik.http.services.${routerName}-app.loadbalancer.server.port`]:
      String(agentAppPort),
    [`traefik.http.services.${routerName}-static.loadbalancer.server.port`]:
      String(nginxPort),

    // Middlewares for path stripping
    [`traefik.http.middlewares.${routerName}-strip-box.stripprefix.prefixes`]:
      "/box",

    // Router: root (static landing page from nginx)
    [`traefik.http.routers.${routerName}-root.rule`]: `Host(\`${host}\`) && Path(\`/\`)`,
    [`traefik.http.routers.${routerName}-root.service`]: `${routerName}-static`,
    [`traefik.http.routers.${routerName}-root.priority`]: "1",
    [`traefik.http.routers.${routerName}-root.entrypoints`]: entrypoint,

    // Router: app (AgentApp at /app/*)
    [`traefik.http.routers.${routerName}-app.rule`]: `Host(\`${host}\`) && PathPrefix(\`/app\`)`,
    [`traefik.http.routers.${routerName}-app.service`]: `${routerName}-app`,
    [`traefik.http.routers.${routerName}-app.priority`]: "50",
    [`traefik.http.routers.${routerName}-app.entrypoints`]: entrypoint,

    // Router: box (BoxAgent API at /box/*)
    [`traefik.http.routers.${routerName}-box.rule`]: `Host(\`${host}\`) && PathPrefix(\`/box\`)`,
    [`traefik.http.routers.${routerName}-box.service`]: `${routerName}-box`,
    [`traefik.http.routers.${routerName}-box.middlewares`]: `${routerName}-strip-box@docker`,
    [`traefik.http.routers.${routerName}-box.priority`]: "100",
    [`traefik.http.routers.${routerName}-box.entrypoints`]: entrypoint,
  };

  if (useTls) {
    labels[`traefik.http.routers.${routerName}-root.tls`] = "true";
    labels[`traefik.http.routers.${routerName}-root.tls.certresolver`] =
      "letsencrypt";
    labels[`traefik.http.routers.${routerName}-app.tls`] = "true";
    labels[`traefik.http.routers.${routerName}-app.tls.certresolver`] =
      "letsencrypt";
    labels[`traefik.http.routers.${routerName}-box.tls`] = "true";
    labels[`traefik.http.routers.${routerName}-box.tls.certresolver`] =
      "letsencrypt";
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
