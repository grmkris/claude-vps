# Repository Guidelines

## Project Structure & Module Organization

This repository is a Bun + Turborepo monorepo.

- `apps/server`: Hono API server (`:33000`), worker bootstrap, box/webhook endpoints.
- `apps/web`: Next.js UI (`:33001`), app routes in `src/app`, shared UI in `src/components`.
- `apps/box-agent`: in-box runtime exposing HTTP and MCP interfaces.
- `packages/*`: shared libraries (`api`, `db`, `auth`, `queue`, `providers`, `shared`, etc.).
- `tests/e2e`: cross-service end-to-end tests.
- `docs/` and `README.md`: architecture and operational reference.

Prefer adding domain logic in `packages/` and keeping `apps/` as integration/composition layers.

## Build, Test, and Development Commands

Run from repository root unless noted.

- `bun run db:start`: start local Postgres + Redis dependencies.
- `bun run dev`: run full local stack with Turbo (server + web).
- `bun run build`: build all workspaces.
- `bun run typecheck`: run workspace type checks.
- `bun run test`: run all tests via Turbo.
- `bun run check`: run Ultracite lint/type-aware checks.
- `bun run fix`: apply safe automated lint/format fixes.
- `bun run --filter=server test`: run server tests only.
- `bun run --filter=@vps-claude/e2e-tests test:api`: run API E2E suite.

## Coding Style & Naming Conventions

- TypeScript + ESM across the repo.
- Formatter: OXC (`.oxfmtrc.jsonc`): 2 spaces, semicolons, double quotes, trailing commas (`es5`), max width 80.
- Linting: `oxlint` with Ultracite presets.
- File naming: kebab-case for modules (for example `box-agent-config.router.ts`).
- Tests: co-locate as `*.test.ts`; use `.integration.test.ts` for integration-heavy cases.

## Testing Guidelines

Use `bun test` (directly or through Turbo). Keep unit tests close to implementation and reserve `tests/e2e` for cross-service behavior. Add tests for new routers, workers, and service-layer logic. No strict coverage gate is currently enforced, but PRs should include tests for behavioral changes.

## Commit & Pull Request Guidelines

Recent history favors concise, imperative commit subjects (for example `Fix Docker health checks`, `Add polling logic to session execution test`).

- Keep commits focused and atomic.
- Reference touched domain in the subject (`api`, `web`, `box-agent`, `db`, etc.) when useful.
- PRs should include: purpose, key changes, test evidence (`bun run test` output summary), and linked issue(s).
- Include UI screenshots/GIFs for `apps/web` changes.

## Security & Configuration Tips

Copy and adapt `.env.example` files (`root`, `apps/server`, `apps/web`) before local runs. Never commit secrets, tokens, or generated credential files. Use `bun run db:generate` after schema changes in `packages/db` and commit generated migrations.
