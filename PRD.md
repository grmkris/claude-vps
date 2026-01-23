# Project: Effect-TS Migration

Full migration of vps-claude API to pure Effect-TS stack.

## Tech Stack

- **Runtime**: Bun
- **Effect Core**: effect, @effect/schema, @effect/platform-bun
- **RPC**: @effect/rpc, @effect/rpc-http
- **Database**: @effect/sql-pg, @effect/sql-drizzle, drizzle-orm (existing schemas)
- **Schema Gen**: @handfish/drizzle-effect
- **Testing**: bun:test (native)
- **Existing**: Next.js frontend, PostgreSQL, Drizzle ORM

## Features (in priority order)

### Feature 1: Effect Dependencies & Foundation

- [ ] Install effect deps: effect, @effect/schema, @effect/platform, @effect/platform-bun, @effect/sql, @effect/sql-pg, @effect/sql-drizzle, @effect/rpc, @effect/rpc-http, @handfish/drizzle-effect
- [ ] Remove: neverthrow from packages/api
- [ ] Create `packages/api/src/errors.ts` with Data.TaggedError types (NotFoundError, AlreadyExistsError, ValidationError, DatabaseError, SpritesApiError, etc.)
- [ ] Create `packages/api/src/context/tags.ts` with Context.Tag definitions (SpritesClientTag, EmailClientTag, LoggerTag, ServerConfigTag, SessionTag)
- [ ] Create `packages/db/src/effect.ts` with DrizzleLive layer using @effect/sql-drizzle
- [ ] Tests: Verify DrizzleLive layer works with PGlite
- [ ] Verify: `bun test packages/db` passes

### Feature 2: TypeIDs Migration (Zod → @effect/schema)

- [ ] Rewrite `packages/shared/src/typeid.ts` using Schema.brand() instead of z.string().brand()
- [ ] Export BoxId, UserId, SkillId, BoxEmailId, SecretId as @effect/schema types
- [ ] Update all imports across packages to use new typeid exports
- [ ] Tests: TypeID parsing works with decodeUnknownSync
- [ ] Verify: `bun run typecheck` passes

### Feature 3: SecretService Migration (First Service - Simplest)

- [ ] Rewrite `packages/api/src/services/secret.service.ts` using Effect pattern
- [ ] Use SqlDrizzle.SqlDrizzle for DB access
- [ ] Use Effect.fn() for tracing
- [ ] Create SecretServiceTag and SecretServiceLive Layer
- [ ] Create `packages/api/src/schemas/secret.schema.ts` using @handfish/drizzle-effect
- [ ] Tests: SecretService works with test layer
- [ ] Verify: `bun test packages/api/src/services/secret.service.test.ts` passes

### Feature 4: SkillService Migration

- [ ] Rewrite `packages/api/src/services/skill.service.ts` using Effect pattern
- [ ] Create SkillServiceTag and SkillServiceLive Layer
- [ ] Create `packages/api/src/schemas/skill.schema.ts`
- [ ] Tests: SkillService works with test layer
- [ ] Verify: `bun test packages/api/src/services/skill.service.test.ts` passes

### Feature 5: DB-Backed Job Queue

- [ ] Create `packages/db/src/schema/job/` with job_queue table (id, type, data, status, attempts, error, timestamps)
- [ ] Run `bun run db:generate` for migration
- [ ] Create `packages/api/src/queue/job-queue.ts` with JobQueueTag, Job types, JobQueueLive Layer
- [ ] Implement DB persistence + in-memory Effect.Queue for processing
- [ ] Implement resumePendingJobs for startup recovery
- [ ] Tests: Job enqueue persists to DB, job processing works
- [ ] Verify: `bun test packages/api/src/queue` passes

### Feature 6: EmailService Migration

- [ ] Rewrite `packages/api/src/services/email.service.ts` using Effect pattern
- [ ] Create EmailServiceTag and EmailServiceLive Layer
- [ ] Create `packages/api/src/schemas/email.schema.ts`
- [ ] Integrate with JobQueueTag for queueDelivery/queueSendEmail
- [ ] Tests: EmailService works with test layer
- [ ] Verify: `bun test packages/api/src/services/email.service.test.ts` passes

### Feature 7: BoxService Migration

- [ ] Rewrite `packages/api/src/services/box.service.ts` using Effect pattern
- [ ] Create BoxServiceTag and BoxServiceLive Layer
- [ ] Create `packages/api/src/schemas/box.schema.ts`
- [ ] Integrate with JobQueueTag, SkillServiceTag, SecretServiceTag
- [ ] Tests: BoxService works with test layer
- [ ] Verify: `bun test packages/api/src/services/box.service.test.ts` passes

### Feature 8: Job Processors (Replace Workers)

- [ ] Create `packages/api/src/queue/processors/deploy-box.processor.ts`
- [ ] Create `packages/api/src/queue/processors/delete-box.processor.ts`
- [ ] Create `packages/api/src/queue/processors/email-delivery.processor.ts`
- [ ] Create `packages/api/src/queue/processors/email-send.processor.ts`
- [ ] Wire processors into JobQueueLive
- [ ] Delete old `packages/api/src/workers/` directory
- [ ] Delete `packages/queue/` package
- [ ] Tests: Processors execute jobs correctly
- [ ] Verify: `bun test packages/api/src/queue/processors` passes

### Feature 9: Layer Composition

- [ ] Create `packages/api/src/layers/clients.ts` with external client layers
- [ ] Create `packages/api/src/layers/app.ts` with makeAppLayer composing all layers
- [ ] Create `packages/api/src/layers/test.ts` with makeTestLayer for testing
- [ ] Tests: AppLayer composes without errors
- [ ] Verify: Layer composition type-checks

### Feature 10: Effect Config (Replace process.env)

- [ ] Create `apps/server/src/config.ts` with AppConfig using Effect Config
- [ ] Use Config.redacted for sensitive values
- [ ] Remove Zod-based env parsing
- [ ] Tests: Config validation works
- [ ] Verify: Server starts with proper config validation

### Feature 11: @effect/rpc - Box RPC

- [ ] Create `packages/api/src/rpc/box.rpc.ts` with RpcGroup definitions
- [ ] Create `packages/api/src/rpc/handlers/box.handler.ts` with RpcServer.router
- [ ] Wire to BoxServiceTag
- [ ] Tests: Box RPC handlers work
- [ ] Verify: Can call box.list, box.create, box.delete via RPC

### Feature 12: @effect/rpc - Other RPCs

- [ ] Create `packages/api/src/rpc/secret.rpc.ts` and handler
- [ ] Create `packages/api/src/rpc/skill.rpc.ts` and handler
- [ ] Create `packages/api/src/rpc/api-key.rpc.ts` and handler
- [ ] Create `packages/api/src/rpc/box-api.rpc.ts` (for box-agent) and handler
- [ ] Create `packages/api/src/rpc/index.ts` combining all RpcGroups
- [ ] Tests: All RPC handlers work
- [ ] Verify: All endpoints callable via RPC

### Feature 13: HTTP Server (Replace Hono+ORPC)

- [ ] Rewrite `apps/server/src/server.ts` using @effect/platform-bun HttpServer
- [ ] Mount RPC handler at /rpc
- [ ] Add auth middleware extracting session to SessionTag
- [ ] Add webhooks routes (inbound email)
- [ ] Delete old ORPC routers in `packages/api/src/routers/`
- [ ] Remove @orpc/server dependency
- [ ] Tests: Server starts and handles requests
- [ ] Verify: `curl localhost:33000/rpc` returns valid response

### Feature 14: Frontend RPC Client

- [ ] Create `apps/web/src/utils/rpc-client.ts` with @effect/rpc-http client
- [ ] Delete `apps/web/src/utils/orpc.ts`
- [ ] Update hooks to use new RPC client
- [ ] Remove @orpc/client dependency
- [ ] Tests: Frontend can call backend
- [ ] Verify: Web app works end-to-end

### Feature 15: Form Validation (Zod → @effect/schema)

- [ ] Install @hookform/resolvers
- [ ] Update `apps/web/src/components/sign-up-form.tsx` to use effectResolver
- [ ] Update `apps/web/src/components/sign-in-form.tsx` to use effectResolver
- [ ] Remove zod from frontend
- [ ] Tests: Form validation works
- [ ] Verify: Sign up and sign in forms work

### Feature 16: Cleanup & Final Verification

- [ ] Remove remaining Zod imports across all packages
- [ ] Remove unused dependencies from all package.json
- [ ] Update CLAUDE.md with new patterns
- [ ] Run full test suite: `bun test`
- [ ] Run typecheck: `bun run typecheck`
- [ ] Tests: All tests pass
- [ ] Verify: `bun run dev` starts server and web, all features work

## Constraints

- Complete each feature end-to-end before starting next
- Run tests after each feature
- Commit after each working feature
- Don't break existing features when adding new ones
- Keep Drizzle schemas unchanged (just wrap with @effect/sql-drizzle)
- box-agent migration is out of scope (can be done later)

## Success Criteria

- All Effect dependencies installed and working
- All services migrated to Effect pattern
- BullMQ replaced with DB-backed Effect queue
- ORPC replaced with @effect/rpc
- Zod replaced with @effect/schema
- All tests passing
- App runs successfully end-to-end

## Completion Signal

When ALL features are done and verified, output:
<promise>PROJECT COMPLETE</promise>
