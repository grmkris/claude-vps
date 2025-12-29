# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Start all apps (web:3001, server:3000)
bun run dev:web          # Start web only
bun run dev:server       # Start server only
bun run build            # Build all apps
bun run check-types      # TypeScript check across monorepo
bun run check            # Run oxlint + oxfmt

# Database (packages/db)
bun run db:start         # Start Postgres via docker-compose
bun run db:push          # Push schema to database
bun run db:generate      # Generate migrations
bun run db:studio        # Open Drizzle Studio
```

## Architecture

**Monorepo (Turborepo + Bun workspaces)**

```
apps/
  server/    → Hono API on port 3000
  web/       → Next.js 16 on port 3001

packages/
  api/       → ORPC routers + procedures
  auth/      → better-auth config
  db/        → Drizzle schema + db client
  env/       → @t3-oss/env validation (server.ts, web.ts)
  config/    → Shared tsconfig, etc
```

## Request Flow

1. **Server** (`apps/server/src/index.ts`): Hono app with CORS, routes auth to `/api/auth/*`, ORPC to `/rpc`
2. **Context** (`packages/api/src/context.ts`): Creates context with session from better-auth
3. **Procedures** (`packages/api/src/index.ts`): `publicProcedure` and `protectedProcedure` (auth middleware)
4. **Routers** (`packages/api/src/routers/`): Define endpoints using procedures

## Frontend Patterns

- **ORPC client**: `apps/web/src/utils/orpc.ts` — exports `orpc` for TanStack Query integration
- **Auth client**: `apps/web/src/lib/auth-client.ts` — better-auth React client
- **Providers**: `apps/web/src/components/providers.tsx` — QueryClient, ThemeProvider

Usage:
```tsx
import { orpc } from "@/utils/orpc";
const { data } = orpc.healthCheck.useQuery();
```

## Adding New Features

**New ORPC endpoint:**
1. Add procedure in `packages/api/src/routers/index.ts` (or create new router file)
2. Use `publicProcedure` or `protectedProcedure`
3. Frontend calls via `orpc.routerName.useQuery()` or `useMutation()`

**New DB table:**
1. Add schema in `packages/db/src/schema/`
2. Export from `packages/db/src/schema/index.ts`
3. Run `bun run db:generate` then `bun run db:push`

## Environment Variables

Server (`apps/server/.env`):
- `DATABASE_URL` - Postgres connection string
- `BETTER_AUTH_SECRET` - Min 32 chars
- `BETTER_AUTH_URL` - Server URL
- `CORS_ORIGIN` - Web app URL

Web (`apps/web/.env`):
- `NEXT_PUBLIC_SERVER_URL` - Server URL

## Linting

Uses **oxlint** + **oxfmt** (not ESLint/Prettier). Run `bun run check` to lint and format.
