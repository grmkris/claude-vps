# Implementation Plan: Docker Engine API + Security Hardening

> Add lightweight Docker deployment option alongside Coolify (both systems coexist)

## Overview

**Approach:** Build Docker Engine API deployment system in parallel with Coolify
- ✅ Keep Coolify running (no removal)
- ✅ Add new `docker-engine` package
- ✅ Environment-aware deployment client (Coolify OR Docker)
- ✅ Security hardening (network isolation, proxy, read-only, caps)
- ✅ Easy local dev (docker-compose)
- ✅ Gradual migration path

## Architecture

```
┌──────────────────────────────────────────────┐
│  Deployment Client (Environment-Aware)       │
│                                              │
│  if (DEPLOY_MODE === 'coolify')             │
│    → Use existing Coolify client            │
│  else if (DEPLOY_MODE === 'docker')         │
│    → Use new Docker Engine client           │
└──────────────────────────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
    ┌────▼─────┐    ┌────▼──────┐
    │ Coolify  │    │  Docker   │
    │ (Keep)   │    │  (New)    │
    └──────────┘    └───────────┘
```

## Security Hardening (Based on Claude Security Doc)

Implementing patterns from [Claude AI Agent Security Guide](https://platform.claude.com/docs/en/agent-sdk/secure-deployment):

### 1. Network Isolation
```
Box containers: --network none
       ↓
   Unix socket only
       ↓
  Proxy (on host)
       ↓
 Injects credentials + enforces allowlists
       ↓
   External APIs
```

### 2. Container Hardening
```bash
--cap-drop ALL                   # No Linux capabilities
--security-opt no-new-privileges # No setuid escalation
--read-only                      # Immutable root filesystem
--tmpfs /tmp:rw,noexec          # Writable temp (no exec)
--user 1000:1000                # Non-root user
--pids-limit 100                # Prevent fork bombs
--memory 2g --cpus 1.5          # Resource limits
```

### 3. Credential Management
- Agent NEVER sees API keys
- Proxy injects credentials into requests
- Secrets stored outside container boundary

### 4. Filesystem Controls
- Code mounted read-only
- Writable tmpfs for workspace
- No access to ~/.ssh, ~/.aws, ~/.config

## Phase 1: Foundation (Week 1)

### 1.1 Create docker-engine Package

**Structure:**
```
packages/
  docker-engine/
    package.json
    tsconfig.json
    src/
      index.ts              # Environment-aware factory
      docker-client.ts      # Hardened Docker implementation
      traefik-labels.ts     # Traefik label generation
      proxy-config.ts       # Proxy configuration
      security.ts           # Security defaults
```

### 1.2 Local Development Setup

**File:** `docker-compose.dev.yml`

```yaml
version: '3.8'

services:
  # Test box (simulates deployed box)
  test-box:
    build: ./packages/coolify/box-base
    container_name: vps-claude-dev-box
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=100m
      - /home/coder/workspace:rw,size=500m
    volumes:
      - dev-config:/home/coder/.config
      - dev-cache:/home/coder/.cache
      - dev-inbox:/home/coder/.inbox
      - ./proxy.sock:/var/run/proxy.sock:ro
    ports:
      - "2222:22"      # SSH
      - "8080:8080"    # code-server
      - "9999:9999"    # box-agent
    environment:
      - PASSWORD=dev123
      - BOX_AGENT_SECRET=dev-secret
      - BOX_API_TOKEN=dev-secret
      - BOX_API_URL=http://host.docker.internal:33000/box
      - BOX_SUBDOMAIN=test-box-dev
      - HTTP_PROXY=unix:///var/run/proxy.sock
      - HTTPS_PROXY=unix:///var/run/proxy.sock
    extra_hosts:
      - "host.docker.internal:host-gateway"
    user: "1000:1000"
    mem_limit: 2g
    cpus: 1.5
    pids_limit: 100

  # Proxy (credentials injection + allowlist)
  proxy:
    image: envoyproxy/envoy:v1.28-latest
    volumes:
      - ./infrastructure/proxy/envoy.yaml:/etc/envoy/envoy.yaml:ro
      - ./proxy.sock:/var/run/proxy.sock
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - RESEND_API_KEY=${RESEND_API_KEY}

volumes:
  dev-config:
  dev-cache:
  dev-inbox:
```

**Usage:**
```bash
# Start local development environment
docker-compose -f docker-compose.dev.yml up -d

# Access test box
ssh coder@localhost -p 2222  # password: dev123
open http://localhost:8080   # code-server

# Test box-agent
curl http://localhost:9999/health
```

### 1.3 Proxy Configuration

**File:** `infrastructure/proxy/envoy.yaml`

```yaml
static_resources:
  listeners:
  - name: listener_0
    address:
      pipe:
        path: /var/run/proxy.sock
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: ingress_http
          route_config:
            name: local_route
            virtual_hosts:
            - name: backend
              domains: ["*"]
              routes:
              # Anthropic API
              - match:
                  prefix: "/v1/"
                  headers:
                  - name: ":authority"
                    string_match:
                      exact: "api.anthropic.com"
                route:
                  cluster: anthropic_api
                typed_per_filter_config:
                  envoy.filters.http.credential_injector:
                    "@type": type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector
                    credential:
                      name: anthropic_key
                      header:
                        name: "x-api-key"
              # Resend API (email)
              - match:
                  prefix: "/emails"
                  headers:
                  - name: ":authority"
                    string_match:
                      exact: "api.resend.com"
                route:
                  cluster: resend_api
                typed_per_filter_config:
                  envoy.filters.http.credential_injector:
                    "@type": type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector
                    credential:
                      name: resend_key
                      header:
                        name: "Authorization"
                        value_prefix: "Bearer "
              # Deny all other domains
              - match:
                  prefix: "/"
                route:
                  cluster: deny_all
          http_filters:
          - name: envoy.filters.http.credential_injector
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.credential_injector.v3.CredentialInjector
          - name: envoy.filters.http.router

  clusters:
  - name: anthropic_api
    type: LOGICAL_DNS
    dns_lookup_family: V4_ONLY
    load_assignment:
      cluster_name: anthropic_api
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: api.anthropic.com
                port_value: 443
    transport_socket:
      name: envoy.transport_sockets.tls
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
        sni: api.anthropic.com

  - name: resend_api
    type: LOGICAL_DNS
    dns_lookup_family: V4_ONLY
    load_assignment:
      cluster_name: resend_api
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: api.resend.com
                port_value: 443
    transport_socket:
      name: envoy.transport_sockets.tls
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext
        sni: api.resend.com

  - name: deny_all
    type: STATIC
    load_assignment:
      cluster_name: deny_all
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: 127.0.0.1
                port_value: 1  # Unreachable

# Inject credentials from environment
overload_manager:
  refresh_interval: 0.25s
  resource_monitors:
  - name: "envoy.resource_monitors.fixed_heap"
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.resource_monitors.fixed_heap.v3.FixedHeapConfig
      max_heap_size_bytes: 268435456

# Secrets from environment variables
layered_runtime:
  layers:
  - name: static_layer
    static_layer:
      credential_secrets:
        anthropic_key:
          inline_string: "${ANTHROPIC_API_KEY}"
        resend_key:
          inline_string: "${RESEND_API_KEY}"
```

**What this does:**
- ✅ Only allows requests to `api.anthropic.com` and `api.resend.com`
- ✅ Injects credentials automatically (agent never sees them)
- ✅ Denies all other domains
- ✅ Listens on Unix socket (no network interface needed in container)

## Phase 2: Docker Client Implementation (Week 2)

### 2.1 Docker Client (`docker-client.ts`)

```typescript
import Docker from 'dockerode';
import { generateTraefikLabels } from './traefik-labels';
import { getSecurityDefaults } from './security';

export function createDockerClient() {
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });

  return {
    async buildImage(contextPath: string, tag: string) {
      const tar = require('tar-fs').pack(contextPath);
      const stream = await docker.buildImage(tar, { t: tag });

      return new Promise((resolve, reject) => {
        docker.modem.followProgress(stream,
          (err, res) => err ? reject(err) : resolve(res)
        );
      });
    },

    async createBox({
      name,
      image,
      subdomain,
      cpuCores = 1.5,
      memoryGB = 2,
      envVars,
      proxySocket = '/var/run/proxy.sock'
    }) {
      // Create volumes
      const volumes = {
        config: `${name}-config`,
        cache: `${name}-cache`,
        inbox: `${name}-inbox`,
      };

      for (const vol of Object.values(volumes)) {
        await docker.createVolume({ Name: vol }).catch(() => {});
      }

      const container = await docker.createContainer({
        name,
        Image: image,
        Env: Object.entries(envVars).map(([k, v]) => `${k}=${v}`),
        Labels: generateTraefikLabels(name, subdomain),
        ExposedPorts: {
          '22/tcp': {},
          '8080/tcp': {},
          '9999/tcp': {},
        },
        HostConfig: {
          // Security: Read-only root filesystem
          ReadonlyRootfs: true,

          // Writable locations (tmpfs - in-memory only)
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=100m',
            '/home/coder/workspace': 'rw,size=500m',
          },

          // Persistent volumes
          Mounts: [
            { Type: 'volume', Source: volumes.config, Target: '/home/coder/.config' },
            { Type: 'volume', Source: volumes.cache, Target: '/home/coder/.cache' },
            { Type: 'volume', Source: volumes.inbox, Target: '/home/coder/.inbox' },
            // Proxy socket for credential injection
            { Type: 'bind', Source: proxySocket, Target: '/var/run/proxy.sock', ReadOnly: true },
          ],

          // Security: Drop all capabilities
          CapDrop: ['ALL'],

          // Security: Prevent privilege escalation
          SecurityOpt: ['no-new-privileges'],

          // Security: Network isolation (proxy via Unix socket only)
          NetworkMode: 'none',

          // Resource limits
          NanoCpus: Math.floor(cpuCores * 1e9),
          Memory: memoryGB * 1024**3,
          PidsLimit: 100,

          // Restart policy
          RestartPolicy: { Name: 'unless-stopped' },
        },

        // Security: Run as non-root user
        User: '1000:1000',

        // Health check
        Healthcheck: {
          Test: ['CMD-SHELL', 'curl -f --unix-socket /var/run/proxy.sock http://localhost/health || exit 1'],
          Interval: 30_000_000_000,  // 30s
          Timeout: 3_000_000_000,     // 3s
          Retries: 3,
          StartPeriod: 10_000_000_000, // 10s
        },
      });

      await container.start();
      const info = await container.inspect();

      return {
        id: info.Id,
        name: info.Name,
        status: info.State.Status,
        health: info.State.Health?.Status || 'none',
      };
    },

    async deleteBox(name: string) {
      const container = docker.getContainer(name);
      await container.stop({ t: 10 }).catch(() => {});
      await container.remove({ v: true }); // Remove volumes
    },

    async getContainerStatus(name: string) {
      const container = docker.getContainer(name);
      const info = await container.inspect();

      return {
        status: info.State.Status,
        health: info.State.Health?.Status || 'none',
        running: info.State.Running,
      };
    },

    async waitForHealth(name: string, timeoutMs = 120000) {
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        const status = await this.getContainerStatus(name);

        if (status.health === 'healthy') {
          return { success: true, status };
        }

        if (status.health === 'unhealthy') {
          throw new Error(`Container ${name} is unhealthy`);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      throw new Error(`Timeout waiting for ${name} to become healthy`);
    },
  };
}
```

### 2.2 Environment-Aware Factory

**File:** `packages/docker-engine/src/index.ts`

```typescript
import { type Environment } from '@vps-claude/shared';
import { createDockerClient } from './docker-client';
import { createCoolifyClient } from '@vps-claude/coolify';

export function createDeploymentClient(env: Environment, config: any) {
  const deployMode = process.env.DEPLOY_MODE || 'coolify';

  if (deployMode === 'docker') {
    console.log('[Deployment] Using Docker Engine API');
    return createDockerClient();
  }

  if (deployMode === 'docker-dev') {
    console.log('[Deployment] Using Docker Compose (local dev)');
    return new LocalDockerComposeClient();
  }

  // Default: use Coolify
  console.log('[Deployment] Using Coolify');
  return createCoolifyClient(config);
}

// For local development (references docker-compose services)
class LocalDockerComposeClient {
  async buildImage() {
    console.log('[Dev] Image build skipped (using docker-compose)');
    return { success: true };
  }

  async createBox(params: any) {
    console.log('[Dev] Using docker-compose test box');
    return {
      id: 'vps-claude-dev-box',
      name: 'vps-claude-dev-box',
      status: 'running',
      health: 'healthy',
    };
  }

  async deleteBox(name: string) {
    console.log('[Dev] Would delete', name);
  }

  async getContainerStatus() {
    return { status: 'running', health: 'healthy', running: true };
  }

  async waitForHealth() {
    return { success: true, status: { status: 'running', health: 'healthy', running: true } };
  }
}
```

### 2.3 Update Deploy Worker

**File:** `packages/api/src/workers/deploy-box.worker.ts`

```typescript
import { createDeploymentClient } from '@vps-claude/docker-engine';

// Initialize deployment client based on DEPLOY_MODE
const deploymentClient = createDeploymentClient(APP_ENV, {
  // Coolify config (if DEPLOY_MODE=coolify)
  env: APP_ENV,
  apiToken: process.env.COOLIFY_API_TOKEN!,
  projectUuid: process.env.COOLIFY_PROJECT_UUID!,
  serverUuid: process.env.COOLIFY_SERVER_UUID!,
  environmentName: process.env.COOLIFY_ENV_NAME!,
  environmentUuid: process.env.COOLIFY_ENV_UUID!,
  agentsDomain: process.env.AGENTS_DOMAIN!,
  logger,
});

async function deployBox(job: Job) {
  const { boxId, userId, subdomain, password, skills } = job.data;

  // Same as before: fetch skills, aggregate packages
  const skillRecords = await skillService.getByIds(skills, userId);
  const skillPackages = aggregateSkillPackages(skillRecords);

  // Build Dockerfile (same as before)
  const dockerfile = buildDockerfile({
    skillPackages,
    skillMdFiles,
    // ...
  });

  // Build image
  const imageName = `box-${boxId}`;
  if (process.env.DEPLOY_MODE === 'docker') {
    await deploymentClient.buildImage('/tmp/build-context', imageName);
  }

  // Prepare env vars (same as before)
  const userSecrets = await secretService.getAll(userId);
  const emailSettings = await emailService.getOrCreateSettings(boxId);

  const envVars = {
    ...userSecrets,
    PASSWORD: password,
    BOX_AGENT_SECRET: emailSettings.agentSecret,
    BOX_API_TOKEN: emailSettings.agentSecret,
    BOX_API_URL: `${serverUrl}/box`,
    BOX_SUBDOMAIN: subdomain,
    // Proxy configuration
    HTTP_PROXY: 'unix:///var/run/proxy.sock',
    HTTPS_PROXY: 'unix:///var/run/proxy.sock',
  };

  // Create box
  const container = await deploymentClient.createBox({
    name: `box-${subdomain}`,
    image: imageName,
    subdomain,
    cpuCores: 1.5,
    memoryGB: 2,
    envVars,
  });

  // Update database
  await boxService.setCoolifyUuid(boxId, container.id);
  await boxService.setContainerInfo(boxId, container.name, hashedPassword);

  // Wait for health
  await deploymentClient.waitForHealth(container.name);

  // Update status
  await boxService.updateStatus(boxId, 'running');
}
```

## Phase 3: Production Setup (Week 3)

### 3.1 Traefik for Production

**File:** `infrastructure/traefik/docker-compose.yml`

```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    command:
      - --api.insecure=true
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.letsencrypt.acme.email=admin@grm.wtf
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --log.level=INFO
    ports:
      - "80:80"
      - "443:443"
      - "8081:8080"  # Dashboard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - traefik-public
    restart: unless-stopped

  # Proxy for credential injection
  proxy:
    image: envoyproxy/envoy:v1.28-latest
    volumes:
      - ../proxy/envoy.yaml:/etc/envoy/envoy.yaml:ro
      - /var/run/proxy.sock:/var/run/proxy.sock
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - RESEND_API_KEY=${RESEND_API_KEY}
    restart: unless-stopped

networks:
  traefik-public:
    external: true
```

### 3.2 Deployment Instructions

```bash
# Create network
docker network create traefik-public

# Create proxy socket directory
mkdir -p /var/run

# Start Traefik + Proxy
cd infrastructure/traefik
docker-compose up -d

# Set deployment mode
export DEPLOY_MODE=docker

# Deploy first test box
bun run deploy-test-box
```

## Environment Variables

**Add to `.env`:**

```bash
# Deployment mode
DEPLOY_MODE=coolify  # or 'docker' or 'docker-dev'

# Proxy configuration
PROXY_SOCKET_PATH=/var/run/proxy.sock
PROXY_ALLOWED_DOMAINS=api.anthropic.com,api.resend.com

# Keep existing Coolify vars (for fallback)
COOLIFY_API_TOKEN=...
# ...
```

## Migration Strategy

### Week 1: Local Development
- ✅ docker-compose.dev.yml working
- ✅ Can test boxes locally
- ✅ Proxy credential injection working

### Week 2: Build Packages
- ✅ packages/docker-engine complete
- ✅ Environment-aware client working
- ✅ Workers support both modes

### Week 3: Production Setup
- ✅ Traefik deployed
- ✅ Proxy deployed
- ✅ Create 1 test box with DEPLOY_MODE=docker
- ✅ Validate security (network isolation, credentials, etc.)

### Week 4: Gradual Rollout
- ✅ New boxes → Docker (DEPLOY_MODE=docker)
- ✅ Existing boxes → Coolify (unchanged)
- ✅ Monitor resource usage
- ✅ Compare performance

### Future: Optional Removal
- When confident, remove Coolify
- For now: **Keep both systems**

## Testing Checklist

### Local Development
- [ ] `docker-compose up` starts test box
- [ ] SSH works (localhost:2222)
- [ ] code-server works (localhost:8080)
- [ ] box-agent works (localhost:9999)
- [ ] Proxy injects credentials
- [ ] Network isolation enforced (can only reach allowed domains)

### Production
- [ ] Traefik routing works
- [ ] HTTPS + Let's Encrypt works
- [ ] Box creation via API
- [ ] Health checks pass
- [ ] Email delivery works
- [ ] SSH via bastion works
- [ ] Resource limits enforced
- [ ] Security hardening verified

## Files to Create

```
infrastructure/
  proxy/
    envoy.yaml                # Proxy config
  traefik/
    docker-compose.yml        # Traefik + Proxy

packages/
  docker-engine/
    package.json
    tsconfig.json
    src/
      index.ts               # Environment-aware factory
      docker-client.ts       # Hardened Docker client
      traefik-labels.ts      # Label generation
      security.ts            # Security defaults

docker-compose.dev.yml        # Local test environment
.env.example                  # Add DEPLOY_MODE
```

## Files to Modify

```
packages/
  api/
    src/
      workers/
        deploy-box.worker.ts  # Support both modes
        delete-box.worker.ts  # Support both modes

apps/
  server/
    .env.example             # Add new env vars
```

## Files NOT Changed

```
packages/
  coolify/                   # KEEP AS-IS
```

## Security Benefits

Based on [Claude AI Agent Security Guide](https://platform.claude.com/docs/en/agent-sdk/secure-deployment):

✅ **Network isolation** - `--network none` + Unix socket proxy
✅ **Credential injection** - Proxy adds keys, agent never sees them
✅ **Filesystem controls** - Read-only root, tmpfs workspace
✅ **Capability dropping** - `--cap-drop ALL`
✅ **Privilege prevention** - `--security-opt no-new-privileges`
✅ **Resource limits** - Memory, CPU, PIDs
✅ **Non-root user** - `--user 1000:1000`
✅ **Defense in depth** - Multiple security layers

## Next Steps

1. Review this plan
2. Start with docker-compose.dev.yml (Week 1)
3. Test locally
4. Build docker-engine package (Week 2)
5. Deploy to staging (Week 3)
6. Gradual production rollout (Week 4)

---

**Status:** Ready to implement
**Timeline:** 4 weeks
**Risk:** Low (Coolify stays as fallback)
