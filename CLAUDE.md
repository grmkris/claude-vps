# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Start all apps (web:33001, server:33000)
bun run dev:web          # Start web only
bun run dev:server       # Start server only
bun run build            # Build all apps
bun run typecheck        # TypeScript check across monorepo
bun run check            # Biome lint + format
bun run fix              # Auto-fix lint issues
bun run fix:unsafe       # Auto-fix including unsafe fixes
bun run test             # Run tests
bun run test:watch       # Run tests in watch mode

# Database (packages/db)
bun run db:start         # Start Postgres via docker-compose
bun run db:stop          # Stop Postgres
bun run db:clean         # Remove Postgres data
bun run db:generate      # Generate migrations
bun run db:studio        # Open Drizzle Studio
```

## Architecture

**Monorepo (Turborepo + Bun workspaces)**

```
apps/
  server/       → Hono API on port 33000
  web/          → Next.js on port 33001
  box-agent/    → In-container agent (runs inside deployed boxes)

packages/
  api/          → ORPC routers, services, workers
  auth/         → better-auth config
  db/           → Drizzle schema + client
  ssh-bastion/  → SSH reverse proxy (sshpiper sync)
  docker/       → Box base Dockerfiles
  queue/        → BullMQ job definitions
  email/        → Email client (Resend)
  coolify/      → Coolify API client
  logger/       → Pino logger factory
  redis/        → Redis client factory
  shared/       → SERVICE_URLS, TypeIDs, constants
  config/       → Shared tsconfig
```

**URL Config:** All service URLs centralized in `packages/shared/src/services.schema.ts` via `SERVICE_URLS[APP_ENV]`.

## API Architecture

### Three-Level Router Organization

| Level    | Prefix       | Auth             | Routers                  |
| -------- | ------------ | ---------------- | ------------------------ |
| User     | `/rpc/`      | Session          | box, secret, skill       |
| Platform | `/platform/` | INTERNAL_API_KEY | platform (ssh endpoints) |
| Box      | `/box/`      | Per-box token    | boxApi (email)           |

### Procedures (`packages/api/src/`)

```typescript
publicProcedure      // No auth
protectedProcedure   // User session required
internalProcedure    // INTERNAL_API_KEY (platform services)
boxProcedure         // Per-box token (box-agent)
```

### Services (`packages/api/src/services/`)

- `box.service.ts` - Box CRUD, deployment queuing
- `email.service.ts` - Inbound/outbound email, delivery
- `secret.service.ts` - User environment secrets
- `skill.service.ts` - Custom skill management

### Workers (`packages/api/src/workers/`)

- `deploy-box.worker.ts` - Deploys boxes via Coolify
- `email-delivery.worker.ts` - Delivers email to box-agent

## Request Flow

1. **Server** (`apps/server/src/server.ts`): Hono app, routes to auth/ORPC handlers
2. **Context** (`packages/api/src/context.ts`): Creates context with session, services
3. **Routers** (`packages/api/src/routers/`): Define endpoints using procedures
4. **Services**: Business logic, DB access, queue jobs

## Frontend Patterns

- **ORPC client**: `apps/web/src/utils/orpc.ts`
- **Auth client**: `apps/web/src/lib/auth-client.ts`

```tsx
import { orpc } from "@/utils/orpc";
const { data } = orpc.box.list.useQuery();
```

## Adding Features

**New ORPC endpoint:**

1. Add to router in `packages/api/src/routers/`
2. Use appropriate procedure (protected, internal, box)
3. Frontend: `orpc.routerName.endpoint.useQuery()`

**New DB table:**

1. Schema in `packages/db/src/schema/{name}/`
2. Export from `packages/db/src/schema/index.ts`
3. Run `bun run db:generate` then `bun run db:push`

**New service:**

1. Create `packages/api/src/services/{name}.service.ts`
2. Add to Services interface in `context.ts`
3. Initialize in `apps/server/src/server.ts`

## Deployment

Dockerfiles: `apps/web/Dockerfile`, `apps/server/Dockerfile`

Env vars: See `.env.example` in each app.
