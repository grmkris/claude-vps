export function generateTraefikLabels(
  subdomain: string,
  exposedPorts: number[],
  domain: string = process.env.AGENTS_DOMAIN || "localhost"
): Record<string, string> {
  const labels: Record<string, string> = {
    "traefik.enable": "true",
  };

  // code-server on port 8080
  labels[`traefik.http.routers.${subdomain}-web.rule`] =
    `Host(\`${subdomain}.${domain}\`)`;
  labels[`traefik.http.routers.${subdomain}-web.entrypoints`] = "websecure";
  labels[`traefik.http.routers.${subdomain}-web.tls`] = "true";
  labels[`traefik.http.routers.${subdomain}-web.tls.certresolver`] =
    "letsencrypt";
  labels[`traefik.http.services.${subdomain}-web.loadbalancer.server.port`] =
    "8080";

  // User app ports (3000, etc.)
  for (const port of exposedPorts) {
    labels[`traefik.http.routers.${subdomain}-port${port}.rule`] =
      `Host(\`${subdomain}-${port}.${domain}\`)`;
    labels[`traefik.http.routers.${subdomain}-port${port}.entrypoints`] =
      "websecure";
    labels[`traefik.http.routers.${subdomain}-port${port}.tls`] = "true";
    labels[`traefik.http.routers.${subdomain}-port${port}.tls.certresolver`] =
      "letsencrypt";
    labels[
      `traefik.http.services.${subdomain}-port${port}.loadbalancer.server.port`
    ] = `${port}`;
  }

  return labels;
}
