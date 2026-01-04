# VPS-Claude Platform Plan - V1

## Overview

Deploy Claude Code environments from `grmkris/agent` repo via Coolify API.
Users get dedicated subdomains at `*.agents.grm.wtf`.

**V1 Scope:** Create → Deploy → Delete. No skills/MCP.

---

## Decisions Summary

| Decision          | Choice                                                               |
| ----------------- | -------------------------------------------------------------------- |
| Data source       | Our DB is source of truth                                            |
| Subdomain         | Auto-generate from name (e.g., "My Workspace" → "my-workspace-x7k9") |
| Actions           | Deploy + Delete only (no stop/start/restart)                         |
| Password          | User sets password                                                   |
| Deploy mechanism  | BullMQ job (polls Coolify until running/error)                       |
| Worker            | Same process as API server                                           |
| Package structure | Separate packages (shared, coolify, queue, redis)                    |
| UI                | Simple table, separate /environments/new page                        |
| Environment names | Globally unique                                                      |
| Infrastructure    | Redis + MinIO in docker-compose                                      |

---

## Current State

### Already Exists

- `packages/api` - oRPC with public/protected procedures
- `packages/auth` - Better-Auth email/password
- `packages/db` - Drizzle + auth schema + docker-compose (PostgreSQL only)
- `packages/env` - T3-style Zod validation
- `packages/config` - Base tsconfig
- `apps/server` - Hono + oRPC handlers
- `apps/web` - Next.js 16 + React 19 + shadcn/ui + dashboard

### Need to Create

- `packages/shared` - TypeId + constants + WORKER_CONFIG
- `packages/redis` - Redis client wrapper
- `packages/queue` - BullMQ queue client + job definitions
- `packages/coolify` - Coolify API client
- Environment schema, service, router, worker
- Environment pages (list + create)
- Redis + MinIO in docker-compose

---

## Implementation Order

1. `packages/shared` - TypeId + constants + WORKER_CONFIG
2. `packages/redis` - Redis client
3. `packages/queue` - BullMQ queue + deploy job schema
4. `packages/coolify` - Coolify API client
5. `packages/db/docker-compose.yml` - Add Redis + MinIO
6. `packages/db/schema/environment.ts` - Environment table
7. `packages/env/src/server.ts` - Add new env vars
8. `packages/api/services/environment.service.ts`
9. `packages/api/workers/deploy-environment.worker.ts`
10. `packages/api/routers/environment.router.ts`
11. `apps/server` - Initialize queue + workers
12. `apps/web/environments` - List + Create pages
13. Run `bun install` + `db:generate`

---

## Environment Variables

```env
# Existing
DATABASE_URL=postgresql://postgres:password@localhost:5432/vps-claude

# New - Redis
REDIS_URL=redis://localhost:6383

# New - Coolify
COOLIFY_API_URL=https://coolify.grm.wtf/api/v1
COOLIFY_API_TOKEN=your-token
COOLIFY_PROJECT_UUID=xxx
COOLIFY_SERVER_UUID=xxx
COOLIFY_ENVIRONMENT_NAME=production

# New - Domain
AGENTS_DOMAIN=agents.grm.wtf
```

---

## Testing Flow

1. Start docker-compose (postgres, redis, minio)
2. Run db:generate + db:push
3. Start server + web
4. Register/login
5. Create environment (name: "Test Workspace", password: "password123")
6. See auto-generated subdomain preview
7. Click Create → see in list with "pending" status
8. Click Deploy → status changes to "deploying"
9. Worker polls Coolify → status changes to "running"
10. Click Open → opens test-workspace-x7k9.agents.grm.wtf
11. Click Delete → removes from Coolify + DB
