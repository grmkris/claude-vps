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
  api/          → ORPC routers, services, workers (BullMQ)
  auth/         → better-auth config
  db/           → Drizzle schema + client (PostgreSQL)
  ssh-bastion/  → SSH reverse proxy (sshpiper sync service)
  docker/       → Deprecated (moved to coolify/box-base/)
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

### Three-Level Router Organization

VPS-Claude uses a three-tier API architecture with different authentication methods per tier:

| Level    | Prefix       | Auth             | Routers                  | Clients                    |
| -------- | ------------ | ---------------- | ------------------------ | -------------------------- |
| User     | `/rpc/`      | Session          | box, secret, skill       | Web UI (authenticated users) |
| Platform | `/platform/` | INTERNAL_API_KEY | platform (ssh endpoints) | SSH bastion, internal services |
| Box      | `/box/`      | Per-box token    | boxApi (email)           | box-agent (in containers)  |

#### User Tier (`/rpc/*`)

**Purpose:** User-facing API for managing boxes, secrets, and skills

**Authentication:** Session-based via better-auth
- Header: `Cookie: session=...`
- Middleware: `protectedProcedure` extracts `context.session.user`
- File: `packages/api/src/protected-procedure.ts`

**Endpoints:**
- `POST /rpc/box/create` - Create new box
- `GET /rpc/box/list` - List user's boxes
- `GET /rpc/box/byId` - Get box details
- `POST /rpc/box/deploy` - Deploy existing box
- `DELETE /rpc/box/delete` - Delete box
- `GET /rpc/box/getUrl` - Get box HTTPS URL
- `POST /rpc/secret/create` - Create environment secret
- `GET /rpc/secret/list` - List user secrets
- `POST /rpc/skill/create` - Create custom skill
- `GET /rpc/skill/list` - List available skills

**Implementation:** `packages/api/src/routers/` (box.router.ts, secret.router.ts, skill.router.ts)

#### Platform Tier (`/platform/*`)

**Purpose:** Internal service-to-service communication

**Authentication:** `INTERNAL_API_KEY` via Bearer token
- Header: `Authorization: Bearer ${INTERNAL_API_KEY}`
- Middleware: `internalProcedure` validates key
- File: `packages/api/src/internal-procedure.ts`

**Endpoints:**
- `GET /platform/ssh/boxes` - List all running boxes (for SSH bastion sync)
  - Returns: `{ boxes: Array<{ subdomain, containerName }> }`
- `GET /platform/ssh/lookup?subdomain={subdomain}` - Lookup container by subdomain
  - Returns: `{ containerName: string }`

**Clients:**
- SSH bastion sync service (`packages/ssh-bastion/src/sync.ts`)
- Potential future internal services

**Implementation:** `packages/api/src/routers/platform.router.ts`

#### Box Tier (`/box/*`)

**Purpose:** Box-to-server communication (email sending, future features)

**Authentication:** Per-box token (agentSecret)
- Header: `Authorization: Bearer ${BOX_API_TOKEN}`
- Middleware: `boxProcedure` calls `getBoxByAgentSecret(token)`
- File: `packages/api/src/box-procedure.ts`

**Token Generation:** Created during deployment via `emailService.getOrCreateSettings(boxId)`
- Stored in `box_email_settings.agentSecret`
- 64-char hex string (crypto.randomBytes(32))
- Unique per box

**Endpoints:**
- `POST /box/email/send` - Send outbound email from box
  - Input: `{ to, subject, body, inReplyTo? }`
  - Queues send job via `emailService.sendFromBox()`

**Clients:**
- box-agent running inside containers (`apps/box-agent`)

**Implementation:** `packages/api/src/routers/box-api.router.ts`

### Procedures (`packages/api/src/`)

```typescript
publicProcedure; // No auth
protectedProcedure; // User session required
internalProcedure; // INTERNAL_API_KEY (platform services)
boxProcedure; // Per-box token (box-agent)
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

---

## Box Lifecycle

### Creation Flow

1. **User Request** → `POST /rpc/box/create`
   - Input: `{ name, password, skills: SkillId[] }`
   - Router: `packages/api/src/routers/box.router.ts:26`

2. **Box Service** → `boxService.create(userId, input)`
   - File: `packages/api/src/services/box.service.ts`
   - Generates subdomain: `{slug}-{4-char-random}` (e.g., "my-project-a7x2")
   - Validates uniqueness
   - Creates database record with status: `"deploying"`
   - Inserts skill associations in `box_skill` table
   - Queues deployment job

3. **Database State** → `box` table
   ```typescript
   {
     id: BoxId,
     name: string,
     subdomain: string (unique),
     status: "deploying", // Initial state
     userId: UserId,
     coolifyApplicationUuid: null, // Set during deployment
     containerName: null,           // Set during deployment
     passwordHash: null,            // Set during deployment
     errorMessage: null,
     createdAt: DateTime,
     updatedAt: DateTime
   }
   ```

4. **Queue Job** → `deployQueue.add("deploy", { boxId, userId, subdomain, password, skills })`

### Deployment Worker Process

**File:** `packages/api/src/workers/deploy-box.worker.ts`

**Steps:**

1. **Fetch Skills**
   - Calls `skillService.getByIds(skillIds, userId)`
   - Aggregates packages: `{ aptPackages[], npmPackages[], pipPackages[] }`
   - Extracts SKILL.md files

2. **Create Coolify Application**
   - Builds custom Dockerfile via `buildDockerfile()` in `packages/coolify/src/dockerfile-builder.ts`
   - Base image: `ghcr.io/grmkris/box-base:latest`
   - Installs skill packages (apt, npm, pip)
   - Writes SKILL.md files to `/home/coder/.claude/skills/{slug}/SKILL.md`
   - POSTs to Coolify: `/applications/dockerfile`
   - Returns `{ uuid, fqdn, containerName }`

3. **Store Coolify Data**
   - `boxService.setCoolifyUuid(boxId, uuid)`
   - `boxService.setContainerInfo(boxId, containerName, hashedPassword)`

4. **Prepare Environment Variables**
   - Fetch user secrets: `secretService.getAll(userId)`
   - Create/fetch email settings: `emailService.getOrCreateSettings(boxId)`
   - Build env object:
     ```typescript
     {
       ...userSecrets,              // From user_secret table
       PASSWORD: password,           // SSH/code-server password
       BOX_AGENT_SECRET: agentSecret, // Validates inbound requests
       BOX_API_TOKEN: agentSecret,    // Authenticates outbound requests
       BOX_API_URL: "${serverUrl}/box",
       BOX_SUBDOMAIN: subdomain
     }
     ```

5. **Inject Variables & Deploy**
   - `coolifyClient.updateApplicationEnv(uuid, envVars)`
   - `coolifyClient.deployApplication(uuid)` → returns `deploymentUuid`

6. **Wait for Build**
   - Polls `/deployments/{uuid}` every 5s (max 5min)
   - Status progression: `queued` → `in_progress` → `finished`/`failed`/`cancelled`

7. **Wait for Health**
   - Polls `/applications/{uuid}` every 5s (max 2min)
   - Checks container status: `running*` = healthy
   - Detects failures: `restarting*` or `exited`

8. **Update Status**
   - Success: `boxService.updateStatus(boxId, "running")`
   - Failure: `boxService.updateStatus(boxId, "error", errorMessage)`

### Container Anatomy

**Base Dockerfile:** `packages/coolify/box-base/Dockerfile`

**Ports:**
- `22` - SSH server (sshd)
- `8080` - code-server (VS Code in browser)
- `3000` - User workspace dev server
- `9999` - box-agent HTTP API (internal)

**Processes:**
- `sshd` - SSH daemon
- `code-server` - VS Code Server (entrypoint)
- `box-agent` - Background service (compiled Bun binary at `/usr/local/bin/box-agent`)

**Volumes (persistent):**
- `/home/coder/workspace` - User files
- `/home/coder/.config` - Configuration
- `/home/coder/.local` - Local data
- `/home/coder/.cache` - Cache
- `/home/coder/.inbox` - Email storage (box-agent)
- `/home/coder/.box-agent` - Session database (SQLite)

**Pre-installed Tools:**
- Claude Code CLI
- Node.js 20, Bun, Python 3
- TypeScript, ast-grep
- git, curl, wget, vim, tmux, fzf, ripgrep, jq, htop

**User:** `coder` (sudoer, password set via PASSWORD env var)

---

## Email System Architecture

### Inbound Email Flow

```
1. Email arrives at Resend
   ↓
2. Webhook POST → /webhooks/inbound-email
   ↓ (apps/server/src/server.ts)
3. emailService.processInbound(subdomain, emailData)
   ↓ (validates box is running, extracts subdomain from to: address)
4. Insert into box_email table (status: "received")
   ↓
5. Queue delivery job → deliverEmailQueue.add()
   ↓
6. email-delivery.worker.ts processes job
   ↓ (fetches box containerName and agentSecret)
7. POST http://{containerName}:9999/email/receive
   ↓ (with X-Box-Secret header)
8. Box-agent receives email
   ↓ (apps/box-agent/src/routers/email.router.ts)
9. Write email JSON to ~/.inbox/{emailId}.json
   ↓
10. Spawn Claude AI session (async, fire-and-forget)
    ↓ (uses @anthropic-ai/claude-agent-sdk)
11. Claude reads email, analyzes, takes actions
    ↓
12. (Optional) Claude calls /email/send to reply
```

### Outbound Email Flow

```
1. Claude Agent or user calls box-agent: POST /email/send
   ↓ (within container)
2. Box-agent proxies to main API: POST /box/email/send
   ↓ (with Authorization: Bearer ${BOX_API_TOKEN})
3. boxProcedure validates token (getBoxByAgentSecret)
   ↓ (packages/api/src/box-procedure.ts)
4. emailService.sendFromBox(boxId, recipient, subject, body)
   ↓
5. Queue send job → sendEmailQueue.add()
   ↓
6. email-send.worker.ts processes job
   ↓
7. Resend API sends email
```

### Email Storage

**Database:** `box_email` table
```typescript
{
  id: EmailId,
  boxId: BoxId,
  messageId: string,
  from: string,
  to: string,
  subject: string,
  textBody: string | null,
  htmlBody: string | null,
  status: "received" | "delivered" | "failed",
  receivedAt: DateTime,
  deliveredAt: DateTime | null
}
```

**Filesystem:** `~/.inbox/{emailId}.json` (in container)
- Written by box-agent on delivery
- Archived to `~/.inbox/.archive/` when marked as read

### Claude AI Integration

**Box-Agent Session Management:**
- File: `apps/box-agent/src/routers/email.router.ts:56-89`
- Uses `@anthropic-ai/claude-agent-sdk` V2
- Session persistence: SQLite at `/home/coder/.box-agent/sessions.db`
- Resumable sessions per email context
- Model: `claude-sonnet-4-5-20250929`

**Prompt Template:**
```typescript
You have received an email in your inbox.

From: ${email.from}
Subject: ${email.subject}

${email.textBody}

The email has been saved to: ${filepath}

Please read the email, analyze it, and take appropriate action.
```

---

## Box-Agent Service

### What It Does

In-container HTTP server that bridges email delivery, Claude AI sessions, and outbound communication.

**Core Responsibilities:**
1. Receive emails from main API (delivery worker)
2. Store emails as JSON files in `~/.inbox/`
3. Spawn autonomous Claude AI sessions for email processing
4. Provide email management API (list, read, archive)
5. Proxy outbound emails to main API

### Deployment

**Build Process:** Multi-stage Dockerfile (`packages/coolify/box-base/Dockerfile:32-43`)

```dockerfile
# Copy source files
COPY package.json bun.lock /tmp/build/
COPY packages/config /tmp/build/packages/config
COPY apps/box-agent /tmp/build/apps/box-agent

# Compile to standalone binary
RUN cd /tmp/build \
    && bun install --filter=box-agent \
    && cd apps/box-agent \
    && bun build --compile --minify ./src/server.ts \
       --outfile /usr/local/bin/box-agent \
    && chmod +x /usr/local/bin/box-agent
```

**Startup:** Entrypoint script runs `/usr/local/bin/box-agent &` (background process)

**Runtime:**
- Port: 9999 (internal, not exposed publicly)
- Logs: stdout (captured by Coolify)
- Session DB: `/home/coder/.box-agent/sessions.db`

### Endpoints

**File:** `apps/box-agent/src/routers/email.router.ts`

#### `POST /email/receive` (protected)
- **Auth:** `X-Box-Secret` header (matches `BOX_AGENT_SECRET` env var)
- **Input:** `InboundEmailSchema` (id, messageId, from, to, subject, body, receivedAt)
- **Process:**
  1. Validates X-Box-Secret header
  2. Writes email to `~/.inbox/{id}.json`
  3. Spawns async Claude session with email prompt
  4. Returns immediately (fire-and-forget AI processing)
- **Returns:** `{ success: true, filepath: string }`

#### `POST /email/send` (public)
- **Input:** `{ to, subject, body, inReplyTo? }`
- **Process:** Proxies to `${BOX_API_URL}/box/email/send` with `BOX_API_TOKEN`
- **Returns:** `{ success: true }`

#### `GET /email/list` (public)
- **Returns:** `{ emails: string[] }` (filenames in ~/.inbox/)

#### `GET /email/{id}` (public)
- **Returns:** `InboundEmailSchema | null`

#### `POST /email/{id}/read` (public)
- **Process:** Moves email to `~/.inbox/.archive/{id}.json`
- **Returns:** `{ success: true }`

#### `GET /health` (public)
- **Returns:** `{ status: "ok", agent: "box-agent" }`

### Authentication

**Two Secrets per Box:**

1. **BOX_AGENT_SECRET** (env var)
   - Purpose: Validates inbound requests FROM main API
   - Used in: `X-Box-Secret` header on `/email/receive`
   - Generated: During deployment via `emailService.getOrCreateSettings()`
   - Stored: `box_email_settings.agentSecret`

2. **BOX_API_TOKEN** (env var, same value as BOX_AGENT_SECRET)
   - Purpose: Authenticates outbound requests TO main API
   - Used in: `Authorization: Bearer ${token}` on `/box/*` endpoints
   - Validated: `boxProcedure` calls `getBoxByAgentSecret(token)`

### Session Persistence

**Schema:** `apps/box-agent/src/db/schema.ts`

```typescript
session_context {
  id: string (primary key),
  sessionId: string,
  context: string, // Serialized session state
  createdAt: DateTime,
  updatedAt: DateTime
}
```

Sessions are resumable - if Claude needs to continue work on an email thread, it can resume the previous session.

---

## SSH Bastion & Networking

### How Users Connect

**SSH Command:**
```bash
ssh my-project-a7x2@ssh.claude-vps.grm.wtf
```

**Connection Flow:**

```
1. DNS lookup: ssh.claude-vps.grm.wtf → Server IP
   ↓
2. TCP connection to server:22 (public port)
   ↓ (mapped to ssh-bastion container)
3. sshpiper receives connection
   ↓ (packages/ssh-bastion - Go binary)
4. Extracts username: "my-project-a7x2"
   ↓
5. Reads config: /etc/sshpiper/workingdir/my-project-a7x2/sshpiper.yaml
   ↓
6. Config specifies:
     host: "my-project-a7x2-{coolifyUuid}"
     port: 22
     username: "coder"
   ↓
7. sshpiper proxies connection to container
   ↓ (via Docker network DNS)
8. Container sshd receives connection
   ↓
9. User enters PASSWORD (from env var)
   ↓
10. Authenticated → shell as coder user
```

### Sync Service

**File:** `packages/ssh-bastion/src/sync.ts`

**Purpose:** Keep sshpiper configs in sync with running boxes

**Process:**
1. Runs every 30s (configurable via `SYNC_INTERVAL_MS`)
2. Calls `GET /platform/ssh/boxes` (uses `INTERNAL_API_KEY`)
3. Receives array: `[{ subdomain, containerName }, ...]`
4. For each box:
   - Creates directory: `/etc/sshpiper/workingdir/{subdomain}/`
   - Writes `sshpiper.yaml`:
     ```yaml
     host: "{containerName}"
     port: 22
     username: "coder"
     ```
5. Removes stale configs (boxes no longer running)

**Authentication:** Uses `internalProcedure` (INTERNAL_API_KEY in Authorization header)

### Platform SSH Endpoints

**File:** `packages/api/src/routers/platform.router.ts`

#### `GET /platform/ssh/boxes`
- **Auth:** INTERNAL_API_KEY
- **Returns:** `{ boxes: Array<{ subdomain, containerName }> }`
- **Used by:** SSH bastion sync service

#### `GET /platform/ssh/lookup?subdomain={subdomain}`
- **Auth:** INTERNAL_API_KEY
- **Returns:** `{ containerName: string }`
- **Validation:** Box must be in "running" status
- **Used by:** Potential custom SSH routing logic

### Docker Network Architecture

**Network:** All containers on same Docker network (Coolify managed)

**Container Naming:** `{subdomain}-{coolifyUuid}` (e.g., "my-project-a7x2-abc123")

**DNS Resolution:** Docker's built-in DNS resolves container names

**Connectivity:**
```
┌─────────────────── COOLIFY DOCKER NETWORK ───────────────────┐
│                                                               │
│  ssh-bastion ──(can reach)──▶ my-project-a7x2-abc123:22     │
│       │                                     │                 │
│       │                                     ├─ :22 (sshd)     │
│       │                                     ├─ :8080 (code)   │
│       └──(can reach)──▶ another-box-xyz:22 ├─ :9999 (agent)  │
│                                             └─ :3000 (user)   │
│                                                               │
│  server ──(can reach)──▶ my-project-a7x2-abc123:9999        │
│    (for email delivery worker)                                │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**Public Access:**
- HTTPS: Via Coolify's Traefik proxy (`https://{subdomain}.agents.grm.wtf`)
- SSH: Via ssh-bastion on port 22

**Internal Access:**
- Box-agent: `http://{containerName}:9999` (email delivery worker)
- Inter-box: Not currently used, but possible

### Network Configuration Note

**`connect_to_docker_network`** commented out in `packages/coolify/src/coolify-client.ts:98`

Reason: Network attachment handled via Coolify UI settings (project-level) or default behavior, not per-application API flag.

---

## Skills System

### What Are Skills?

Skills are package bundles + optional configuration files that customize boxes during deployment.

**Schema:** `packages/db/src/schema/skill/`

```typescript
{
  id: SkillId,
  userId: UserId | null, // null = global skill
  slug: string,          // e.g., "python-data-science"
  name: string,          // "Python Data Science"
  description: string,
  aptPackages: string[], // ["python3-dev", "build-essential"]
  npmPackages: string[], // ["@types/node", "tsx"]
  pipPackages: string[], // ["pandas", "numpy", "matplotlib"]
  skillMdContent: string | null, // Optional SKILL.md file
  createdAt: DateTime,
  updatedAt: DateTime
}
```

### Global vs User Skills

**Global Skills:**
- `userId: null`
- Available to all users
- Managed by platform admins
- Examples: "Claude Code Essentials", "Docker Tools", "Data Science Stack"

**User Skills:**
- `userId: UserId`
- Private to creating user
- Custom toolchains, company-specific packages
- Portable across user's boxes

### How Skills Are Applied

**During Deployment** (`packages/api/src/workers/deploy-box.worker.ts:29-48`):

1. **Fetch Skills:**
   ```typescript
   const skills = await skillService.getByIds(skillIds, userId);
   ```

2. **Aggregate Packages (deduplicated):**
   ```typescript
   const skillPackages = {
     aptPackages: [...new Set(skills.flatMap(s => s.aptPackages))],
     npmPackages: [...new Set(skills.flatMap(s => s.npmPackages))],
     pipPackages: [...new Set(skills.flatMap(s => s.pipPackages))]
   };
   ```

3. **Extract SKILL.md Files:**
   ```typescript
   const skillMdFiles = skills
     .filter(s => s.skillMdContent)
     .map(s => ({ slug: s.slug, content: s.skillMdContent }));
   ```

4. **Build Dockerfile** (`packages/coolify/src/dockerfile-builder.ts`):
   ```dockerfile
   # Install apt packages
   RUN apt-get update && apt-get install -y ${aptPackages.join(' ')}

   # Install npm packages globally
   RUN npm install -g ${npmPackages.join(' ')}

   # Install pip packages
   RUN pip install ${pipPackages.join(' ')}

   # Write SKILL.md files
   RUN mkdir -p /home/coder/.claude/skills/${slug}
   RUN echo "${content}" > /home/coder/.claude/skills/${slug}/SKILL.md
   ```

5. **Claude Code Auto-Loads:**
   - Claude Code CLI scans `~/.claude/skills/` on startup
   - SKILL.md files provide context to AI

### Skill File Locations (in container)

```
/home/coder/
├── .claude/
│   └── skills/
│       ├── python-data-science/
│       │   └── SKILL.md
│       ├── docker-tools/
│       │   └── SKILL.md
│       └── custom-toolchain/
│           └── SKILL.md
└── workspace/
```

### Adding Skills via API

**Endpoint:** `POST /rpc/skill/create`

**Input:**
```typescript
{
  slug: string,
  name: string,
  description: string,
  aptPackages: string[],
  npmPackages: string[],
  pipPackages: string[],
  skillMdContent: string | null
}
```

**Router:** `packages/api/src/routers/skill.router.ts`

---

## Secrets & Environment Variables

### User Secrets

**Table:** `user_secret` (`packages/db/src/schema/secret/`)

```typescript
{
  id: SecretId,
  userId: UserId,
  key: string,    // e.g., "GITHUB_TOKEN"
  value: string,  // e.g., "ghp_xxxx"
  createdAt: DateTime,
  updatedAt: DateTime
}
```

**Injected Into:** All boxes belonging to the user

**API:**
- `GET /rpc/secret/list` - List all user secrets
- `POST /rpc/secret/create` - Create secret
- `PUT /rpc/secret/update` - Update secret
- `DELETE /rpc/secret/delete` - Delete secret

**Deployment Flow** (`packages/api/src/workers/deploy-box.worker.ts:81-84`):
```typescript
const userSecrets = await secretService.getAll(userId);
// Returns: { GITHUB_TOKEN: "ghp_xxx", AWS_ACCESS_KEY: "...", ... }

// Merged into env vars
const envVars = {
  ...userSecrets,
  PASSWORD: password,
  BOX_AGENT_SECRET: agentSecret,
  // ...
};
```

### Per-Box Environment Variables

**Set During Deployment:**

| Variable          | Source                        | Purpose                          |
| ----------------- | ----------------------------- | -------------------------------- |
| PASSWORD          | User input (box creation)     | SSH & code-server password       |
| BOX_AGENT_SECRET  | Generated (agentSecret)       | Validates inbound API calls      |
| BOX_API_TOKEN     | Same as BOX_AGENT_SECRET      | Authenticates outbound API calls |
| BOX_API_URL       | Config (SERVER_URL + "/box")  | Main API endpoint for box-agent  |
| BOX_SUBDOMAIN     | Box subdomain                 | Box identifier                   |
| ...userSecrets    | user_secret table             | All user's env vars              |

**Injection Method** (`packages/coolify/src/coolify-client.ts:431-459`):
```typescript
async updateApplicationEnv(uuid: string, envVars: Record<string, string>) {
  for (const [key, value] of Object.entries(envVars)) {
    await client["/applications/{uuid}/envs"].post({
      params: { uuid },
      json: { key, value, is_preview: false }
    });
  }
}
```

### Box Email Settings

**Table:** `box_email_settings`

```typescript
{
  id: EmailSettingsId,
  boxId: BoxId (unique),
  agentSecret: string, // 64-char hex (crypto.randomBytes(32))
  emailEnabled: boolean,
  createdAt: DateTime,
  updatedAt: DateTime
}
```

**Generated:** During deployment via `emailService.getOrCreateSettings(boxId)`

**Used For:**
- `agentSecret` becomes both `BOX_AGENT_SECRET` and `BOX_API_TOKEN`
- Unique per box
- Rotatable (regenerate to revoke access)

---

## Database Schema Reference

### Core Tables

#### `box`
```typescript
id: BoxId (TypeID)
name: string
subdomain: string (unique)
status: "deploying" | "running" | "error"
userId: UserId (foreign key → user.id)
coolifyApplicationUuid: string | null
containerName: string | null
passwordHash: string | null (SHA-256)
errorMessage: string | null
createdAt: DateTime
updatedAt: DateTime

Indexes: subdomain (unique), userId
Relations: box_skill (one-to-many), box_email_settings (one-to-one), box_email (one-to-many)
```

#### `box_skill` (junction table)
```typescript
id: BoxSkillId
boxId: BoxId (foreign key → box.id, cascade delete)
skillId: SkillId (foreign key → skill.id, cascade delete)
createdAt: DateTime

Indexes: [boxId, skillId] (unique composite)
```

#### `box_email`
```typescript
id: EmailId (TypeID)
boxId: BoxId (foreign key → box.id, cascade delete)
messageId: string
from: string
to: string
subject: string
textBody: string | null
htmlBody: string | null
status: "received" | "delivered" | "failed"
receivedAt: DateTime
deliveredAt: DateTime | null
createdAt: DateTime
updatedAt: DateTime

Indexes: boxId, messageId, status
```

#### `box_email_settings`
```typescript
id: EmailSettingsId (TypeID)
boxId: BoxId (foreign key → box.id, unique, cascade delete)
agentSecret: string (64-char hex, unique)
emailEnabled: boolean (default true)
createdAt: DateTime
updatedAt: DateTime

Indexes: boxId (unique), agentSecret (unique)
```

#### `skill`
```typescript
id: SkillId (TypeID)
userId: UserId | null (foreign key → user.id, cascade delete)
slug: string
name: string
description: string
aptPackages: string[] (JSON)
npmPackages: string[] (JSON)
pipPackages: string[] (JSON)
skillMdContent: string | null
createdAt: DateTime
updatedAt: DateTime

Indexes: [userId, slug] (unique composite)
Relations: box_skill (one-to-many)
```

#### `user_secret`
```typescript
id: SecretId (TypeID)
userId: UserId (foreign key → user.id, cascade delete)
key: string
value: string
createdAt: DateTime
updatedAt: DateTime

Indexes: [userId, key] (unique composite)
```

### Status State Machines

**Box Status:**
```
deploying → running (success)
deploying → error (failure)
running → error (container crash detected)
```

**Email Status:**
```
received → delivered (successful delivery to box-agent)
received → failed (delivery worker error)
```

---

## Workers & Background Jobs

**Queue System:** BullMQ + Redis

**Configuration:** `packages/queue/src/index.ts`

### deploy-box.worker.ts

**File:** `packages/api/src/workers/deploy-box.worker.ts`

**Queue:** `deploy-box`

**Concurrency:** 5 workers

**Timeout:** 300s (5 minutes)

**Job Data:**
```typescript
{
  boxId: BoxId,
  userId: UserId,
  subdomain: string,
  password: string,
  skills: SkillId[]
}
```

**Process** (detailed in Box Lifecycle section):
1. Fetch skills → aggregate packages
2. Create Coolify application (custom Dockerfile)
3. Store Coolify UUID & container info
4. Prepare environment variables (user secrets + box secrets)
5. Inject env vars into Coolify
6. Deploy application
7. Wait for build completion (poll deploymentUuid, max 5min)
8. Wait for container health (poll application status, max 2min)
9. Update box status to "running" or "error"

**Error Handling:**
- Catches all errors
- Updates box.status = "error"
- Sets box.errorMessage with detailed error
- Logs errors via Pino logger

### delete-box.worker.ts

**File:** `packages/api/src/workers/delete-box.worker.ts`

**Queue:** `delete-box`

**Timeout:** 60s (1 minute)

**Job Data:**
```typescript
{
  boxId: BoxId,
  coolifyApplicationUuid: string
}
```

**Process:**
1. Call `coolifyClient.deleteApplication(uuid)`
   - Query params: `delete_configurations: true, delete_volumes: true, docker_cleanup: true`
2. Delete box record from database (cascades to box_skill, box_email, box_email_settings)
3. Log completion

### email-delivery.worker.ts

**File:** `packages/api/src/workers/email-delivery.worker.ts`

**Queue:** `deliver-email`

**Timeout:** 30s

**Job Data:**
```typescript
{
  emailId: EmailId,
  boxId: BoxId
}
```

**Process:**
1. Fetch email from `box_email` table
2. Fetch box (containerName, agentSecret)
3. POST to `http://{containerName}:9999/email/receive`
   - Headers: `X-Box-Secret: {agentSecret}`
   - Body: email data
4. Update `box_email.status = "delivered"`, set `deliveredAt`
5. On error: Update status to "failed", log error

### email-send.worker.ts

**File:** `packages/api/src/workers/email-send.worker.ts`

**Queue:** `send-email`

**Timeout:** 30s

**Job Data:**
```typescript
{
  from: string,
  to: string,
  subject: string,
  textBody: string,
  htmlBody?: string,
  inReplyTo?: string
}
```

**Process:**
1. Call `emailClient.send()` (Resend API)
2. Log success/failure
3. No database updates (fire-and-forget for outbound emails)

### Worker Registration

**File:** `apps/server/src/server.ts`

Workers are initialized during server startup:

```typescript
// Start workers
deployBoxWorker.start();
deleteBoxWorker.start();
emailDeliveryWorker.start();
emailSendWorker.start();

// Graceful shutdown
process.on("SIGTERM", async () => {
  await deployBoxWorker.stop();
  await deleteBoxWorker.stop();
  await emailDeliveryWorker.stop();
  await emailSendWorker.stop();
});
```
