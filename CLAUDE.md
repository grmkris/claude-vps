# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

See `package.json` for all available scripts. Key commands:

- `bun run dev` - Start all apps (web:33001, server:33000)
- `bun run db:start` - Start Postgres via docker-compose
- `bun run db:generate` - Generate migrations after schema changes

## Architecture

**Monorepo (Turborepo + Bun workspaces)**

```
apps/
  server/       → Hono API on port 33000
  web/          → Next.js on port 33001
  box-agent/    → In-container agent (runs inside deployed boxes)

packages/
  api/          → ORPC routers, services, workers (BullMQ)
  auth/         → better-auth config
  db/           → Drizzle schema + client (PostgreSQL)
  ssh-bastion/  → SSH reverse proxy (sshpiper sync service)
  queue/        → BullMQ queue definitions + client factory
  email/        → Email client (Resend)
  coolify/      → Coolify API client + box-base Dockerfile + dockerfile-builder
  logger/       → Pino logger factory
  redis/        → Redis client factory (ioredis)
  shared/       → SERVICE_URLS, TypeIDs, constants, schemas
  config/       → Shared tsconfig
```

**URL Config:** All service URLs centralized in `packages/shared/src/services.schema.ts` via `SERVICE_URLS[APP_ENV]`.

## API Architecture

### Three-Tier Router Organization

| Level    | Prefix       | Auth             | Example Endpoints     | Clients                        |
| -------- | ------------ | ---------------- | --------------------- | ------------------------------ |
| User     | `/rpc/`      | Session          | box, secret, skill    | Web UI (authenticated users)   |
| Platform | `/platform/` | INTERNAL_API_KEY | ssh/boxes, ssh/lookup | SSH bastion, internal services |
| Box      | `/box/`      | Per-box token    | email/send            | box-agent (in containers)      |

**Procedures** (`packages/api/src/`):

- `publicProcedure` - No auth
- `protectedProcedure` - User session required
- `internalProcedure` - INTERNAL_API_KEY (platform services)
- `boxProcedure` - Per-box token (box-agent)

**Routers** (`packages/api/src/routers/`):

- `box.router.ts` - Create/list/delete boxes
- `secret.router.ts` - User environment variables
- `skill.router.ts` - Custom package bundles
- `platform.router.ts` - SSH bastion endpoints
- `box-api.router.ts` - Box-to-server communication

**Services** (`packages/api/src/services/`):

- `box.service.ts` - Box CRUD, deployment queuing
- `email.service.ts` - Inbound/outbound email, delivery
- `secret.service.ts` - User environment secrets
- `skill.service.ts` - Custom skill management

**Workers** (`packages/api/src/workers/`):

- `deploy-box.worker.ts` - Deploys boxes via Coolify
- `delete-box.worker.ts` - Cleanup on deletion
- `email-delivery.worker.ts` - Delivers email to box-agent
- `email-send.worker.ts` - Sends email via Resend

---

## Quick Reference

**Creating a box:**

1. User → POST `/rpc/box/create` → `boxService.create()` → queue deploy job
2. Worker: fetch skills → build Dockerfile → Coolify deploy → wait for health
3. Status: `deploying` → `running` | `error`

**Email inbound:**
Webhook → `emailService.processInbound()` → queue delivery → POST to `box-agent:9999/email/receive`

**Email outbound:**
box-agent → POST `/box/email/send` → queue send → Resend API

**SSH access:**
User → `ssh subdomain@ssh.bastion` → sshpiper reads config → proxy to `container:22`

**Files to know:**

- API routers: `packages/api/src/routers/*.router.ts`
- Services: `packages/api/src/services/*.service.ts`
- Workers: `packages/api/src/workers/*.worker.ts`
- Database schema: `packages/db/src/schema/`
- Box base image: `packages/coolify/box-base/Dockerfile`

---

## Box Lifecycle

**Flow:** User creates → queued → worker deploys → Coolify builds → health check → running

**Files:**

- `packages/api/src/routers/box.router.ts` - Create/list/delete endpoints
- `packages/api/src/services/box.service.ts` - Business logic, subdomain generation (`{slug}-{4char}`)
- `packages/api/src/workers/deploy-box.worker.ts` - Async deployment (5min timeout, 5 concurrency)
  - Fetch skills → aggregate packages
  - Build Dockerfile → create Coolify app
  - Inject env vars (user secrets + box secrets)
  - Deploy → wait for build → wait for health
- `packages/coolify/src/coolify-client.ts` - Coolify API wrapper
- `packages/coolify/src/dockerfile-builder.ts` - Generates custom Dockerfile with skills

**Database:** `box` table (`packages/db/src/schema/box/`)

- Status states: `deploying` → `running` | `error`
- Fields: subdomain (unique), coolifyApplicationUuid, containerName, passwordHash

**Container:** `packages/coolify/box-base/Dockerfile`

- Base: `codercom/code-server:latest`
- Ports: 22 (SSH), 8080 (code-server), 9999 (box-agent), 3000 (user apps)
- Volumes: `/home/coder/workspace`, `~/.config`, `~/.local`, `~/.cache`, `~/.inbox`
- Pre-installed: Claude Code CLI, Node 20, Bun, Python 3, git, vim, tmux, fzf, ripgrep, jq
- User: `coder` (password set via PASSWORD env var)

**Deployment triggers:**

- `POST /rpc/box/create` (initial)
- `POST /rpc/box/deploy` (redeploy existing)

---

## Email System

**Inbound Flow:**

```
Resend webhook → /webhooks/inbound-email
  → emailService.processInbound(subdomain, emailData)
  → Insert box_email table (status: "received")
  → Queue delivery job
  → Worker POSTs to http://{containerName}:9999/email/receive
  → box-agent saves to ~/.inbox/{emailId}.json
  → Spawns Claude AI session (async)
```

**Outbound Flow:**

```
box-agent → POST /box/email/send
  → boxProcedure validates token
  → emailService.sendFromBox()
  → Queue send job
  → Worker calls Resend API
```

**Files:**

- `apps/server/src/server.ts:147` - Inbound webhook handler
- `packages/api/src/services/email.service.ts` - Email processing logic
- `packages/api/src/workers/email-delivery.worker.ts` - Delivery to box-agent (30s timeout)
- `packages/api/src/workers/email-send.worker.ts` - Send via Resend (30s timeout)
- `apps/box-agent/src/routers/email.router.ts` - In-container email endpoints

**Database:**

- `box_email` - Stores inbound emails (status: received → delivered | failed)
- `box_email_settings` - Per-box agentSecret (used for auth)

**Claude AI Integration:**

- box-agent uses `@anthropic-ai/claude-agent-sdk`
- Sessions stored in SQLite: `/home/coder/.box-agent/sessions.db`
- Resumable sessions per email thread

---

## Box-Agent Service

**Purpose:** In-container HTTP server (port 9999) that:

- Receives emails from main API
- Stores emails as JSON in `~/.inbox/`
- Spawns autonomous Claude AI sessions
- Proxies outbound emails to main API

**Deployment:**

- Compiled to standalone binary during image build: `/usr/local/bin/box-agent`
- Started in background by entrypoint script
- Source: `apps/box-agent/`

**Key Endpoints:**

- `POST /email/receive` - Receive from delivery worker (auth: `X-Box-Secret` header)
- `POST /email/send` - Send via main API (proxies with `BOX_API_TOKEN`)
- `GET /email/list` - List inbox
- `GET /email/{id}` - Read email
- `POST /email/{id}/read` - Archive email

**Authentication:**

- `BOX_AGENT_SECRET` env var - Validates inbound requests
- `BOX_API_TOKEN` env var (same value) - Authenticates outbound requests
- Generated during deployment via `emailService.getOrCreateSettings(boxId)`

---

## SSH Bastion & Networking

**Connection Flow:**

```
User runs: ssh my-project-a7x2@ssh.bastion.domain
  → sshpiper extracts username "my-project-a7x2"
  → Reads config: /etc/sshpiper/workingdir/my-project-a7x2/sshpiper.yaml
  → Proxies to: my-project-a7x2-{uuid}:22 (container on Docker network)
  → Container sshd authenticates with PASSWORD
```

**Sync Service:**

- File: `packages/ssh-bastion/src/sync.ts`
- Polls `GET /platform/ssh/boxes` every 30s (INTERNAL_API_KEY auth)
- Generates sshpiper configs for each running box
- Cleanup: Removes configs for deleted boxes

**Platform Endpoints:**

- `GET /platform/ssh/boxes` - List running boxes (returns `[{ subdomain, containerName }]`)
- `GET /platform/ssh/lookup?subdomain=X` - Lookup container by subdomain

**Docker Networking:**

- All containers on Coolify's Docker network
- DNS resolution: `{containerName}` → container IP
- ssh-bastion can reach any box via `http://{containerName}:9999`

---

## Skills System

**What:** Package bundles (apt/npm/pip) + optional SKILL.md files

**Schema:** `packages/db/src/schema/skill/`

- Global skills: `userId: null` (available to all)
- User skills: `userId: UserId` (private)

**Application during deployment:**

1. Worker fetches skills by ID (`packages/api/src/workers/deploy-box.worker.ts:29-48`)
2. Aggregates packages (deduplicated)
3. Dockerfile builder installs packages and writes SKILL.md files
4. Files placed in: `/home/coder/.claude/skills/{slug}/SKILL.md`

**Files:**

- `packages/api/src/services/skill.service.ts` - CRUD operations
- `packages/api/src/routers/skill.router.ts` - API endpoints
- `packages/coolify/src/dockerfile-builder.ts` - Applies skills to Dockerfile

---

## Secrets & Environment Variables

**User Secrets:** `user_secret` table (`packages/db/src/schema/secret/`)

- Injected into ALL user's boxes during deployment
- Managed via `/rpc/secret/*` endpoints

**Per-Box Env Vars:**

| Variable         | Source                    | Purpose                          |
| ---------------- | ------------------------- | -------------------------------- |
| PASSWORD         | User input (box creation) | SSH & code-server password       |
| BOX_AGENT_SECRET | Generated (64-char hex)   | Validates inbound API calls      |
| BOX_API_TOKEN    | Same as BOX_AGENT_SECRET  | Authenticates outbound API calls |
| BOX_API_URL      | Config (`SERVER_URL/box`) | Main API endpoint                |
| BOX_SUBDOMAIN    | Box subdomain             | Identifier                       |

**Injection:** `packages/coolify/src/coolify-client.ts:431-459` - POSTs each env var to Coolify

---

## Database Schema

**Core Tables:** `packages/db/src/schema/`

- `box/` - Box records, status, subdomain, Coolify UUID, container name
- `box_skill/` - Junction table (boxId ↔ skillId)
- `box_email/` - Inbound email storage
- `box_email_settings/` - Per-box auth tokens (agentSecret)
- `skill/` - Package bundles + SKILL.md content
- `secret/` - User environment variables
- `user/` - User accounts (better-auth)

**State Machines:**

- Box: `deploying` → `running` | `error`
- Email: `received` → `delivered` | `failed`

---

## Workers (BullMQ)

**Queue:** packages/queue/ - Redis-backed job queue

**Workers:** `packages/api/src/workers/`

- `deploy-box.worker.ts` - Deploy boxes via Coolify (5min timeout, 5 workers)
- `delete-box.worker.ts` - Delete Coolify apps + DB records (1min timeout)
- `email-delivery.worker.ts` - POST emails to box-agent (30s timeout)
- `email-send.worker.ts` - Send via Resend (30s timeout)

**Registration:** `apps/server/src/server.ts` - Workers started on server boot

---

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
3. Run `bun run db:generate`

**New service:**

1. Create `packages/api/src/services/{name}.service.ts`
2. Add to Services interface in `context.ts`
3. Initialize in `apps/server/src/server.ts`

## Deployment

Dockerfiles: `apps/web/Dockerfile`, `apps/server/Dockerfile`

Env vars: See `.env.example` in each app.
