# Deployment Migration Plan: Coolify → Docker Engine API

> Research and implementation plan for migrating from Coolify to a lighter Docker-based deployment system

## Executive Summary

**Goal:** Remove Coolify dependency and use Docker Engine API directly for lighter infrastructure

**Approach:** Hybrid setup
- **Local dev:** Docker Compose for easy testing
- **Production:** Docker Engine API (dockerode) + Traefik

**Timeline:** 4 weeks

**Benefits:**
- Remove ~500MB+ Coolify overhead
- Faster deployments
- Full programmatic control
- Supports future scale (Nomad for > 100 boxes)

---

## Research: Alternatives Evaluated

### Comparison Matrix

| Solution         | Build | Volumes | CPU/RAM | SSH | Proxy | API | Complexity | Weight  | Cost     |
|------------------|-------|---------|---------|-----|-------|-----|------------|---------|----------|
| **Docker Engine API** | ✅    | ✅      | ✅      | ✅  | Manual| ✅  | Med        | **Minimal** | Self     |
| Nomad            | Manual| ✅      | ✅      | ✅  | Manual| ✅  | Med-High   | Light   | Self     |
| Docker Swarm     | ✅    | ✅      | ✅      | ✅  | Manual| ✅  | Low-Med    | Light   | Self     |
| Dokploy          | ✅    | ✅      | ✅      | ~   | ✅    | ~   | Low        | Light   | Self     |
| **Coolify (current)** | ✅    | ✅      | ✅      | ✅  | ✅    | ✅  | Med        | **Heavy** | Self     |
| Fly.io           | ✅    | ~       | ✅      | ~   | ✅    | ✅  | Low        | N/A     | Managed  |
| Railway          | ✅    | ~       | ✅      | ❌  | ✅    | ~   | Low        | N/A     | Managed  |

### Key Findings

**Docker Engine API + Traefik wins because:**
- Lightest possible (just Docker daemon + reverse proxy)
- Perfect fit for our requirements (Dockerfiles, volumes, SSH, CPU/RAM limits)
- Full programmatic control via Node.js (dockerode)
- No PaaS layer overhead

**Why not others:**
- **Nomad/Swarm:** Need multi-host orchestration (not yet)
- **Dokploy:** Modern but still a full PaaS (not lighter)
- **Fly.io/Railway:** Don't support our SSH + volumes pattern
- **Portainer:** Just a UI wrapper around Docker API

### Research Sources

- [Coolify alternatives - Northflank](https://northflank.com/blog/coolify-alternatives-in-2025)
- [Coolify vs Dokploy - Medium](https://medium.com/@shubhthewriter/coolify-vs-dokploy-why-i-chose-dokploy-for-vps-deployment-in-2026-ea935c2fe9b5)
- [Portainer vs Coolify - EgyVPS](https://www.egyvps.com/en/article/coolify-vs-portainer-docker-management-or-app-deployment)
- GPT 5.2 (Codex) comprehensive analysis
- Web research on Docker deployment platforms

---

## Recommended Architecture

### Production Setup

```
┌─────────────────┐
│  Hono API       │
│  (port 33000)   │
└────────┬────────┘
         │
         │ dockerode (unix socket)
         ▼
┌─────────────────┐          ┌──────────────┐
│ Docker Engine   │◄─────────┤   Traefik    │
│ (daemon)        │  labels  │ (port 80/443)│
└────────┬────────┘          └──────┬───────┘
         │                          │
         │                          │ reverse proxy
         ▼                          ▼
┌──────────────────────────────────────────┐
│        Box Containers (isolated)         │
│  - Volumes: workspace, config, cache     │
│  - Limits: CPU (NanoCpus), RAM (Memory)  │
│  - Labels: traefik.http.routers.*        │
│  - Ports: 22 (SSH), 8080 (code-server)   │
│  - Network: traefik-public               │
└──────────────────────────────────────────┘
```

### Local Development Setup

```
bun run dev
  ↓
docker-compose up (test boxes)
  ↓
Development server connects to localhost:9999
  ↓
Test features end-to-end locally
```

---

## Implementation Plan

### Phase 1: Local Development (Week 1)

#### 1.1 Create `docker-compose.dev.yml`

```yaml
version: '3.8'

services:
  test-box-1:
    build: ./packages/coolify/box-base
    container_name: test-box-dev-abc123
    volumes:
      - test-workspace:/home/coder/workspace
      - test-config:/home/coder/.config
      - test-cache:/home/coder/.cache
      - test-inbox:/home/coder/.inbox
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
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  test-workspace:
  test-config:
  test-cache:
  test-inbox:
```

**Usage:**
```bash
# Start test box
docker-compose -f docker-compose.dev.yml up -d

# Access box
ssh coder@localhost -p 2222  # password: dev123
open http://localhost:8080   # code-server

# Test box-agent API
curl http://localhost:9999/health
```

### Phase 2: Docker Engine Package (Week 2)

#### 2.1 Package Structure

```
packages/
  docker-engine/
    package.json
    tsconfig.json
    src/
      index.ts                  # Environment-aware factory
      docker-client.ts          # Main dockerode wrapper
      traefik-labels.ts         # Traefik label generator
      volume-manager.ts         # Volume lifecycle
      health-checker.ts         # Container health monitoring
```

#### 2.2 Docker Client (`docker-client.ts`)

```typescript
import Docker from 'dockerode';
import { generateTraefikLabels } from './traefik-labels';

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
      cpuCores,
      memoryGB,
      password,
      envVars
    }) {
      // Create volumes
      const volumes = {
        workspace: `${name}-workspace`,
        config: `${name}-config`,
        cache: `${name}-cache`,
        inbox: `${name}-inbox`,
      };

      for (const vol of Object.values(volumes)) {
        await docker.createVolume({ Name: vol }).catch(() => {});
      }

      // Create container with Traefik labels
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
          Mounts: [
            { Type: 'volume', Source: volumes.workspace, Target: '/home/coder/workspace' },
            { Type: 'volume', Source: volumes.config, Target: '/home/coder/.config' },
            { Type: 'volume', Source: volumes.cache, Target: '/home/coder/.cache' },
            { Type: 'volume', Source: volumes.inbox, Target: '/home/coder/.inbox' },
          ],
          NanoCpus: Math.floor(cpuCores * 1e9),
          Memory: memoryGB * 1024**3,
          RestartPolicy: { Name: 'unless-stopped' },
          NetworkMode: 'traefik-public',
        },
        Healthcheck: {
          Test: ['CMD-SHELL', 'curl -f http://localhost:8080/healthz || exit 1'],
          Interval: 30_000_000_000,  // 30s
          Timeout: 3_000_000_000,     // 3s
          Retries: 3,
        },
      });

      await container.start();
      return container.inspect();
    },

    async deleteBox(name: string) {
      const container = docker.getContainer(name);
      await container.stop({ t: 10 }).catch(() => {});
      await container.remove({ v: true }); // Remove volumes too
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
  };
}
```

#### 2.3 Traefik Labels (`traefik-labels.ts`)

```typescript
export function generateTraefikLabels(containerName: string, subdomain: string) {
  const domain = `${subdomain}.agents.claude-vps.grm.wtf`;

  return {
    'traefik.enable': 'true',
    // HTTP router
    [`traefik.http.routers.${containerName}.rule`]: `Host(\`${domain}\`)`,
    [`traefik.http.routers.${containerName}.entrypoints`]: 'websecure',
    [`traefik.http.routers.${containerName}.tls`]: 'true',
    [`traefik.http.routers.${containerName}.tls.certresolver`]: 'letsencrypt',
    // Service (backend)
    [`traefik.http.services.${containerName}.loadbalancer.server.port`]: '8080',
    // Health check
    [`traefik.http.services.${containerName}.loadbalancer.healthcheck.path`]: '/healthz',
    [`traefik.http.services.${containerName}.loadbalancer.healthcheck.interval`]: '30s',
  };
}
```

#### 2.4 Environment-Aware Factory (`index.ts`)

```typescript
import { Environment } from '@vps-claude/shared';
import { createDockerClient } from './docker-client';

export function createDeploymentClient(env: Environment) {
  if (env === 'development') {
    return new LocalDockerComposeClient();
  }
  return createDockerClient();
}

class LocalDockerComposeClient {
  async createBox(params: any) {
    console.log('Local dev: Using docker-compose test box');
    return {
      id: 'test-box-dev-abc123',
      containerName: 'test-box-dev-abc123',
      fqdn: 'http://localhost:8080',
    };
  }

  async deleteBox(name: string) {
    console.log('Local dev: Would delete', name);
  }

  async getContainerStatus(name: string) {
    return { status: 'running', health: 'healthy', running: true };
  }
}
```

### Phase 3: Traefik Setup (Week 2)

#### 3.1 Create `infrastructure/traefik/docker-compose.yml`

```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    command:
      # API
      - --api.insecure=true
      # Docker provider
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=traefik-public
      # Entrypoints
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      # Let's Encrypt
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.letsencrypt.acme.email=admin@grm.wtf
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      # Logging
      - --log.level=INFO
      - --accesslog=true
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
    labels:
      - "traefik.enable=true"
      # Redirect HTTP to HTTPS
      - "traefik.http.routers.http-catchall.rule=hostregexp(`{host:.+}`)"
      - "traefik.http.routers.http-catchall.entrypoints=web"
      - "traefik.http.routers.http-catchall.middlewares=redirect-to-https"
      - "traefik.http.middlewares.redirect-to-https.redirectscheme.scheme=https"

networks:
  traefik-public:
    external: true
```

#### 3.2 Setup Commands

```bash
# Create network
docker network create traefik-public

# Start Traefik
cd infrastructure/traefik
docker-compose up -d

# Check dashboard
open http://your-server:8081
```

### Phase 4: Update Workers (Week 3)

#### 4.1 Modify `deploy-box.worker.ts`

```typescript
import { createDeploymentClient } from '@vps-claude/docker-engine';

// In worker setup
const deploymentClient = createDeploymentClient(APP_ENV);

// In job handler
async function deployBox(job: Job) {
  const { boxId, userId, subdomain, password, skills } = job.data;

  // Fetch skills (same as before)
  const skillRecords = await skillService.getByIds(skills, userId);
  const skillPackages = aggregateSkillPackages(skillRecords);

  // Build Dockerfile (same as before)
  const dockerfile = buildDockerfile({
    skillPackages,
    skillMdFiles,
    // ...
  });

  // Build image (NEW: use dockerode)
  const imageName = `box-${boxId}`;
  await deploymentClient.buildImage('/tmp/build-context', imageName);

  // Get env vars (same as before)
  const userSecrets = await secretService.getAll(userId);
  const emailSettings = await emailService.getOrCreateSettings(boxId);
  const envVars = {
    ...userSecrets,
    PASSWORD: password,
    BOX_AGENT_SECRET: emailSettings.agentSecret,
    BOX_API_TOKEN: emailSettings.agentSecret,
    BOX_API_URL: `${serverUrl}/box`,
    BOX_SUBDOMAIN: subdomain,
  };

  // Create container (NEW: dockerode)
  const container = await deploymentClient.createBox({
    name: `box-${subdomain}`,
    image: imageName,
    subdomain,
    cpuCores: 1.5,
    memoryGB: 2,
    password,
    envVars,
  });

  // Update database
  await boxService.setCoolifyUuid(boxId, container.id);
  await boxService.setContainerInfo(boxId, container.name, hashedPassword);

  // Wait for health (NEW: poll Docker health)
  await waitForContainerHealth(container.name);

  // Update status
  await boxService.updateStatus(boxId, 'running');
}
```

#### 4.2 Modify `delete-box.worker.ts`

```typescript
import { createDeploymentClient } from '@vps-claude/docker-engine';

async function deleteBox(job: Job) {
  const { boxId, containerName } = job.data;

  const deploymentClient = createDeploymentClient(APP_ENV);

  // Delete container + volumes
  await deploymentClient.deleteBox(containerName);

  // Delete database record (cascades to related tables)
  await db.delete(box).where(eq(box.id, boxId));
}
```

### Phase 5: Testing & Validation (Week 3-4)

#### 5.1 Local Testing Checklist

- [ ] `bun run dev` starts successfully
- [ ] `docker-compose up` creates test box
- [ ] Can SSH to localhost:2222
- [ ] Can access code-server at localhost:8080
- [ ] Box-agent responds at localhost:9999
- [ ] Email delivery works locally
- [ ] Email sending works locally

#### 5.2 Staging Testing Checklist

- [ ] Traefik is running and healthy
- [ ] Can create new box via API
- [ ] Box container starts and becomes healthy
- [ ] HTTPS works (Let's Encrypt certificate)
- [ ] Can SSH via bastion (sshpiper)
- [ ] Code-server accessible via HTTPS
- [ ] Email delivery works end-to-end
- [ ] Resource limits are enforced (CPU/RAM)
- [ ] Box deletion removes container + volumes

#### 5.3 Production Rollout

1. **Deploy Traefik** to production
2. **Test with 1 new box** (keep Coolify running)
3. **Monitor for 24h** (resource usage, errors)
4. **Gradual rollout:** New boxes → Docker Engine, existing → Coolify
5. **Full cutover** after 1 week of stability
6. **Remove Coolify** dependency

---

## Files to Create/Modify

### New Files

```
infrastructure/
  traefik/
    docker-compose.yml          # Traefik setup
    letsencrypt/.gitkeep        # Certificate storage

packages/
  docker-engine/
    package.json
    tsconfig.json
    src/
      index.ts                   # Environment-aware factory
      docker-client.ts           # Main implementation
      traefik-labels.ts          # Label generation
      volume-manager.ts          # Volume lifecycle
      health-checker.ts          # Health monitoring

docker-compose.dev.yml          # Local test boxes
```

### Modified Files

```
packages/
  api/
    src/
      workers/
        deploy-box.worker.ts    # Use Docker client
        delete-box.worker.ts    # Use Docker client
      services/
        box.service.ts          # Update container naming

  shared/
    src/
      services.schema.ts        # Add Docker config

apps/
  server/
    src/
      server.ts                 # Environment detection
```

### Removed Files (After Migration)

```
packages/
  coolify/                      # Remove entire package
```

---

## Scale Considerations

### Current Scale Limits (Single Host)

**Per Docker host:**
- Light boxes (256MB RAM, 0.5 CPU): ~100-150 containers
- Medium boxes (2GB RAM, 1.5 CPU): ~30-50 containers
- Our boxes (code-server + SSH + agent): ~50-100 per host

**For > 100 boxes per region:** Need multi-host orchestration

### Phase 2: HashiCorp Nomad (Future)

When scale demands (> 100 boxes):

1. **Setup Nomad cluster** (3 servers + N clients)
2. **Convert Docker API calls → Nomad job specs**
3. **Deploy via Nomad HTTP API** instead of Docker socket
4. **Nomad schedules** across multiple Docker hosts
5. **Minimal code changes** - just swap backend

**Why Nomad:**
- Much simpler than Kubernetes
- Excellent API
- Natural migration from Docker
- Same Traefik integration pattern

---

## Benefits Summary

### Production Optimizations

✅ **Remove Coolify overhead** (~500MB+ PaaS → 0MB)
✅ **Faster deployments** (no API proxy layer)
✅ **Simpler infrastructure** (Docker + Traefik only)
✅ **Full programmatic control** (dockerode)
✅ **Better resource efficiency**

### Developer Experience

✅ **Easy local dev** (docker-compose for test boxes)
✅ **Same Docker images** (dev/prod parity)
✅ **No complex local setup** (just docker-compose up)
✅ **Can test real deployments** when needed

### Operational

✅ **Gradual migration** (run both systems in parallel)
✅ **Can rollback** to Coolify if issues
✅ **Future-proof** (supports Nomad for scale)
✅ **Clean architecture** (environment-aware abstraction)

---

## Risk Mitigation

**Risks:**

1. **Docker socket security** - Never expose publicly
2. **Health checking** - Need to implement ourselves
3. **Edge cases** - Coolify handles things we might miss

**Mitigations:**

1. **Keep Coolify code** until fully validated
2. **Gradual rollout** - test extensively before full cutover
3. **Monitoring** - watch resource usage, errors
4. **Rollback plan** - can revert to Coolify if needed

---

## Timeline

**Week 1:** Local dev setup
- Create docker-compose.dev.yml
- Test end-to-end locally
- Validate box-agent integration

**Week 2:** Docker Engine package + Traefik
- Build packages/docker-engine
- Setup Traefik in staging
- Unit tests

**Week 3:** Staging deployment
- Deploy to staging environment
- Test all workflows
- Fix issues

**Week 4:** Production rollout
- Deploy Traefik to production
- Test with 1 box
- Gradual rollout
- Monitor and optimize

**Week 5+:** Cleanup
- Remove Coolify dependency
- Documentation updates
- Performance tuning

---

## Next Steps

1. **Review this plan** - Get team approval
2. **Setup local env** - Start with docker-compose.dev.yml
3. **Build docker-engine package** - Core implementation
4. **Deploy to staging** - Full system test
5. **Production rollout** - Gradual migration

---

**Last Updated:** 2026-01-11
**Status:** Ready for implementation
