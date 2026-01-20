# VPS-Claude

> AI-powered development environments as a service

VPS-Claude is a platform that creates isolated development environments ("boxes") with built-in Claude AI integration. Each box runs on Sprites (Fly.io) and comes pre-configured with VS Code, and an AI agent that can autonomously process emails and help with development tasks.

## What is VPS-Claude?

Traditional development environments require manual setup, configuration, and maintenance. VPS-Claude automates this by deploying fully-configured VMs on-demand, each with:

- **Code-Server**: Browser-based VS Code IDE with Claude Code CLI pre-installed
- **Email-to-AI**: Inbound emails trigger autonomous Claude AI sessions that can read code, make changes, and respond
- **Custom Skills**: Install package bundles (apt/npm/pip) and configuration files
- **User Secrets**: Environment variables injected across all your boxes
- **Isolated Environments**: Each box runs as its own VM with persistent storage
- **Auto-Sleep**: Boxes automatically sleep when idle and wake on demand

Boxes are deployed via Sprites (Fly.io) API and accessible through unique URLs.

## How It Works

```
1. User creates box via web UI
   | (name, password, skills)

2. Deployment worker creates VM
   | (Sprites API)

3. Sprite starts with environment
   | (code-server :8080, box-agent :9999)

4. User accesses via HTTPS
   | (https://{subdomain}.sprites.dev)

5. Email arrives -> AI processes -> responds
   | (webhook -> box-agent -> Claude session -> reply)
```

## Architecture

```
+--------------+     +---------------+     +----------------+
|   Web UI     |---->|  API Server   |---->|  Sprites API   |
|  (Next.js)   |     |    (Hono)     |     |   (Fly.io)     |
+--------------+     +-------+-------+     +--------+-------+
                             |                      |
                     +-------v--------+     +-------v--------+
                     | BullMQ Queue   |     |   Box Fleet    |
                     |   (Workers)    |     |   (Sprites)    |
                     +----------------+     +--------+-------+
                                                    |
                                            +-------v-------+
                                            |  Box-Agent    |
                                            |   (Email)     |
                                            +-------+-------+
                                            +-------v-------+
                                            | code-server   |
                                            |  (VS Code)    |
                                            +---------------+
```

**Core Components:**

- **apps/web**: Next.js frontend for box management
- **apps/server**: Hono API server with ORPC endpoints
- **apps/box-agent**: In-VM service handling email -> AI integration
- **packages/api**: Routers, services, and BullMQ workers
- **packages/sprites**: Sprites (Fly.io) client for VM deployment
- **packages/db**: Drizzle ORM schema (PostgreSQL)
- **packages/queue**: BullMQ job definitions
- **packages/email**: Resend email client

## Features

### Platform Features

- **One-Click Deployment**: Create boxes with custom skills and secrets
- **Email Integration**: Receive emails in-box, process with Claude AI
- **Skills System**: Pre-install packages and configuration files
- **User Secrets**: Inject environment variables across all boxes
- **Status Tracking**: Monitor deployment and health
- **Auto-Sleep/Wake**: Sprites automatically manage VM lifecycle

### Tech Stack

- **TypeScript** - Type safety across the entire stack
- **Next.js** - Full-stack React framework
- **TailwindCSS** + **shadcn/ui** - UI components
- **Hono** - Lightweight, performant API server
- **ORPC** - End-to-end type-safe APIs
- **Bun** - Runtime and package manager
- **Drizzle** - TypeScript ORM
- **PostgreSQL** - Relational database
- **Redis** - BullMQ job queue
- **Better-Auth** - Authentication
- **Turborepo** - Monorepo build system
- **Sprites (Fly.io)** - VM deployment

## Getting Started

### Prerequisites

- Bun runtime
- Sprites token from https://sprites.dev (for box deployment)
- Docker (for local PostgreSQL only)

### Installation

```bash
# Install dependencies
bun install

# Start PostgreSQL via docker-compose
bun run db:start

# Apply database schema
bun run db:generate
bun run db:push

# Start development servers
bun run dev
```

**Development URLs:**

- Web UI: http://localhost:33001
- API Server: http://localhost:33000
- Drizzle Studio: `bun run db:studio`

### Environment Variables

Copy `.env.example` to `.env` in `apps/server/` and `apps/web/`:

**Critical variables:**

- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection (BullMQ)
- `SPRITES_TOKEN` - Sprites API token from https://sprites.dev
- `RESEND_API_KEY` - Email service
- `ANTHROPIC_API_KEY` - Claude AI (for box-agent)

See `.env.example` files for complete list.

## Project Structure

```
vps-claude/
+-- apps/
|   +-- web/           # Next.js frontend (port 33001)
|   +-- server/        # Hono API server (port 33000)
|   +-- box-agent/     # In-VM agent (email, AI sessions)
+-- packages/
    +-- api/           # ORPC routers, services, workers
    +-- auth/          # better-auth configuration
    +-- db/            # Drizzle schema + client
    +-- sprites/       # Sprites (Fly.io) client
    +-- queue/         # BullMQ job definitions
    +-- email/         # Email client (Resend)
    +-- logger/        # Pino logger factory
    +-- redis/         # Redis client factory
    +-- shared/        # TypeIDs, SERVICE_URLS, constants
    +-- config/        # Shared tsconfig
```

## Available Scripts

```bash
# Development
bun run dev              # Start all apps (web + server)
bun run dev:web          # Start web only
bun run dev:server       # Start server only

# Build
bun run build            # Build all apps
bun run typecheck        # TypeScript check across monorepo

# Code Quality
bun run check            # Biome lint + format
bun run fix              # Auto-fix lint issues
bun run fix:unsafe       # Auto-fix including unsafe fixes

# Testing
bun run test             # Run tests
bun run test:watch       # Run tests in watch mode

# Database
bun run db:start         # Start Postgres via docker-compose
bun run db:stop          # Stop Postgres
bun run db:clean         # Remove Postgres data
bun run db:generate      # Generate migrations
bun run db:studio        # Open Drizzle Studio
```

## Documentation

For detailed documentation on architecture, API structure, and implementation patterns, see:

- **[CLAUDE.md](./CLAUDE.md)** - Comprehensive architecture guide
  - Box lifecycle (creation -> deployment -> running)
  - Email system architecture
  - Box-agent internals
  - Skills system
  - Two-tier API authentication
  - Database schema
  - Workers & background jobs

## Contributing

This project uses [Ultracite](https://github.com/biomejs/ultracite) for code quality:

```bash
bun x ultracite check    # Check for issues
bun x ultracite fix      # Auto-fix issues
```

## License

MIT

---

**Built with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack)**
