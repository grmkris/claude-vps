# Fix: Box-Agent Health Check 404

## Existing Pattern

The main server already uses explicit Hono routes for health (see `packages/api/src/create-api.ts:117-118`):

```typescript
app.get("/", (c) => c.text("OK"));
app.get("/health", (c) => c.text("OK"));
```

Box-agent should follow the same pattern.

## Root Cause

The health check returns 404 because of how ORPC handles spread routers.

**Flow:**

1. Nginx receives `GET /health` → proxies to `box-agent:33002/health`
2. Box-agent's ORPC `OpenAPIHandler` doesn't match the route
3. Falls through to catch-all: `c.text("Not Found", 404)`

**Why ORPC doesn't match:**

In `apps/box-agent/src/server.ts`:

```typescript
const appRouter = {
  ...healthRouter, // spreads: { root, health }
  cron: cronRouter,
  email: emailRouter,
  session: sessionRouter,
};
```

When `healthRouter` is spread, ORPC's `OpenAPIHandler` treats `health` as a **procedure name**, not an HTTP route. The `.route({ path: "/health" })` declaration may not be honored when spread.

**Evidence:**

- `res.status === 404` means box-agent received the request but no route matched
- The same nginx config works for `/email/*` and `/sessions/*` because those are namespaced (not spread)

---

## Fix Options

### Option A: Add explicit Hono routes before ORPC (Recommended)

Add direct Hono handlers for health before the ORPC catch-all.

**File:** `apps/box-agent/src/server.ts`

```typescript
const app = new Hono();

// Direct health routes (bypass ORPC)
app.get("/health", (c) => c.json({ status: "ok", agent: "box-agent" }));
app.get("/", (c) => c.text("OK"));

// ORPC handler for everything else
app.all("/*", async (c) => {
  // ... existing ORPC handler
});
```

### Option B: Namespace health router

Don't spread, namespace it instead.

```typescript
const appRouter = {
  health: healthRouter, // /health/health, /health/root
  cron: cronRouter,
  // ...
};
```

(Requires updating nginx to `/health/health`)

### Option C: Remove health router, use inline Hono

Delete `health.router.ts`, just use Hono directly.

---

## Recommended: Option A

Simplest fix, no nginx changes needed, health checks work immediately.

**Files to modify:**
| File | Change |
|------|--------|
| `apps/box-agent/src/server.ts` | Add explicit Hono routes for `/health` and `/` |

---

## Implementation

```typescript
// apps/box-agent/src/server.ts
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Hono } from "hono";

import { env } from "./env";
import { logger } from "./logger";
import { cronRouter } from "./routers/cron.router";
import { emailRouter } from "./routers/email.router";
import { sessionRouter } from "./routers/session.router";

const appRouter = {
  cron: cronRouter,
  email: emailRouter,
  session: sessionRouter,
};

const apiHandler = new OpenAPIHandler(appRouter, {});

const app = new Hono();

// Health endpoints - explicit Hono routes (bypass ORPC)
app.get("/health", (c) => c.json({ status: "ok", agent: "box-agent" }));
app.get("/", (c) => c.text("OK"));

// ORPC handler for API routes
app.all("/*", async (c) => {
  const context = {
    boxSecretHeader: c.req.header("X-Box-Secret"),
  };

  const result = await apiHandler.handle(c.req.raw, {
    prefix: "/",
    context,
  });

  if (result.matched) {
    return c.newResponse(result.response.body, result.response);
  }

  return c.text("Not Found", 404);
});

logger.info(`Box agent starting on port ${env.BOX_AGENT_PORT}...`);

export default {
  port: env.BOX_AGENT_PORT,
  fetch: app.fetch,
};
```

---

## Verification

1. **Local test:**

   ```bash
   cd apps/box-agent && bun run dev
   curl http://localhost:33002/health
   # Should return: {"status":"ok","agent":"box-agent"}
   ```

2. **Re-run integration test:**

   ```bash
   SPRITES_TOKEN=xxx bun test ./packages/api/src/workers/deploy/deploy-flow.integration.test.ts --test-name-pattern "agent config"
   ```

3. Health check should pass, deployment should complete to "running" status.
