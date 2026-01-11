# VPS-Claude

> AI-powered development environments as a service

VPS-Claude is a platform that creates isolated, containerized development environments ("boxes") with built-in Claude AI integration. Each box comes pre-configured with VS Code, SSH access, and an AI agent that can autonomously process emails and help with development tasks.

## What is VPS-Claude?

Traditional development environments require manual setup, configuration, and maintenance. VPS-Claude automates this by deploying fully-configured containers on-demand, each with:

- **Code-Server**: Browser-based VS Code IDE with Claude Code CLI pre-installed
- **Email-to-AI**: Inbound emails trigger autonomous Claude AI sessions that can read code, make changes, and respond
- **SSH Access**: Secure shell access via a reverse proxy bastion
- **Custom Skills**: Install package bundles (apt/npm/pip) and configuration files
- **User Secrets**: Environment variables injected across all your boxes
- **Isolated Environments**: Each box runs in its own container with persistent storage

Boxes are deployed via [Coolify](https://coolify.io) and accessible through unique subdomains (e.g., `my-project.agents.grm.wtf`).

## How It Works

```
1. User creates box via web UI
   ↓ (name, password, skills)

2. Deployment worker builds container
   ↓ (custom Dockerfile with skills + secrets)

3. Coolify deploys box
   ↓ (SSH :22, code-server :8080, box-agent :9999)

4. User accesses via SSH or HTTPS
   ↓ (ssh my-project@ssh.grm.wtf)

5. Email arrives → AI processes → responds
   ↓ (webhook → box-agent → Claude session → reply)
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Web UI    │────▶│  API Server  │────▶│ Coolify (Deploy)│
│ (Next.js)   │     │   (Hono)     │     │                 │
└─────────────┘     └──────┬───────┘     └────────┬────────┘
                           │                      │
                    ┌──────▼────────┐     ┌───────▼────────┐
                    │  BullMQ Queue │     │   Box Fleet    │
                    │   (Workers)   │     │  (Containers)  │
                    └───────────────┘     └───────┬────────┘
                                                  │
                           ┌──────────────────────┼────────┐
                           │                      │        │
                     ┌─────▼─────┐          ┌────▼────┐   │
                     │SSH Bastion│          │Box-Agent│   │
                     │ (sshpiper)│          │ (Email) │   │
                     └───────────┘          └─────────┘   │
                                                   ┌───────▼──────┐
                                                   │ code-server  │
                                                   │ (VS Code)    │
                                                   └──────────────┘
```

**Core Components:**

- **apps/web**: Next.js frontend for box management
- **apps/server**: Hono API server with ORPC endpoints
- **apps/box-agent**: In-container service handling email → AI integration
- **packages/api**: Routers, services, and BullMQ workers
- **packages/ssh-bastion**: sshpiper reverse proxy for SSH routing
- **packages/coolify**: Coolify API client + Dockerfile builder
- **packages/db**: Drizzle ORM schema (PostgreSQL)
- **packages/queue**: BullMQ job definitions
- **packages/email**: Resend email client

## Features

### Platform Features
- **One-Click Deployment**: Create boxes with custom skills and secrets
- **Email Integration**: Receive emails in-container, process with Claude AI
- **SSH Bastion**: Route connections by subdomain (e.g., `ssh my-box@ssh.domain`)
- **Skills System**: Pre-install packages and configuration files
- **User Secrets**: Inject environment variables across all boxes
- **Status Tracking**: Monitor deployment and health

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

## Getting Started

### Prerequisites
- Bun runtime
- Docker (for local PostgreSQL)
- Coolify instance (for deployment)

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
- `COOLIFY_API_TOKEN` - Coolify API key
- `INTERNAL_API_KEY` - Platform service authentication
- `RESEND_API_KEY` - Email service
- `ANTHROPIC_API_KEY` - Claude AI (for box-agent)

See `.env.example` files for complete list.

## Project Structure

```
vps-claude/
├── apps/
│   ├── web/           # Next.js frontend (port 33001)
│   ├── server/        # Hono API server (port 33000)
│   └── box-agent/     # In-container agent (email, AI sessions)
├── packages/
│   ├── api/           # ORPC routers, services, workers
│   ├── auth/          # better-auth configuration
│   ├── db/            # Drizzle schema + client
│   ├── ssh-bastion/   # SSH reverse proxy (sshpiper sync)
│   ├── docker/        # Box base Dockerfiles
│   ├── queue/         # BullMQ job definitions
│   ├── email/         # Email client (Resend)
│   ├── coolify/       # Coolify API client + Dockerfile builder
│   ├── logger/        # Pino logger factory
│   ├── redis/         # Redis client factory
│   ├── shared/        # TypeIDs, SERVICE_URLS, constants
│   └── config/        # Shared tsconfig
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
  - Box lifecycle (creation → deployment → running)
  - Email system architecture
  - Box-agent internals
  - SSH bastion & networking
  - Skills system
  - Three-tier API authentication
  - Database schema
  - Workers & background jobs

- **[packages/ssh-bastion/README.md](./packages/ssh-bastion/README.md)** - SSH bastion setup and deployment

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
