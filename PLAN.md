# VPS-Claude Platform Plan

## Overview
Multi-tenant platform for deploying Claude Code environments via Coolify API. Users register, configure skills/MCP servers/permissions, and get dedicated subdomains.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Coolify Instance                         │
│   *.agents.grm.wtf → individual Claude Code containers          │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                    Deploy via API
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      VPS-Claude Platform                        │
├─────────────────────┬───────────────────────────────────────────┤
│  apps/server (Hono) │  apps/web (Next.js)                       │
│  - oRPC API         │  - Dashboard                              │
│  - Coolify client   │  - Environment config                     │
│  - Dockerfile gen   │  - Skills editor                          │
│  - Better-Auth      │  - MCP config                             │
└─────────────────────┴───────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │           PostgreSQL          │
              │  users, environments, skills  │
              └───────────────────────────────┘
```

## Monorepo Structure (following ai-stilist patterns)

```
vps-claude/
├── apps/
│   ├── server/              # Hono backend
│   │   ├── src/
│   │   │   ├── server.ts    # Entry point
│   │   │   └── env.ts       # Env schema
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/                 # Next.js frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── (app)/   # Protected routes
│       │   │   │   ├── dashboard/
│       │   │   │   ├── environments/
│       │   │   │   └── settings/
│       │   │   └── (public)/
│       │   │       ├── login/
│       │   │       └── register/
│       │   ├── components/
│       │   └── lib/
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── api/                 # oRPC routers & services
│   │   ├── src/
│   │   │   ├── routers/
│   │   │   │   ├── app-router.ts
│   │   │   │   ├── environment.router.ts
│   │   │   │   └── admin.router.ts
│   │   │   ├── services/
│   │   │   │   ├── coolify.service.ts
│   │   │   │   ├── environment.service.ts
│   │   │   │   └── dockerfile.service.ts
│   │   │   ├── context.ts
│   │   │   └── create-api.ts
│   │   └── package.json
│   ├── auth/                # Better-Auth config
│   ├── db/                  # Drizzle schema
│   │   └── src/schema/
│   │       ├── users.ts
│   │       ├── environments.ts
│   │       ├── skills.ts
│   │       └── mcp-configs.ts
│   ├── shared/              # Constants, types, TypeIds
│   └── coolify/             # Coolify API client
├── infra/                   # Docker compose for local dev
├── turbo.json
├── package.json
└── biome.json
```

## Database Schema (Following ai-stilist Patterns)

### packages/shared/src/typeid.schema.ts

```typescript
import { TypeID, typeid } from "typeid-js";
import { z } from "zod";

export const idTypesMapNameToPrefix = {
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
  environment: "env",
  skill: "skl",
  mcpConfig: "mcp",
  permission: "prm",
} as const;

export type IdTypePrefixNames = keyof typeof idTypesMapNameToPrefix;
export type TypeId<T extends IdTypePrefixNames> =
  `${(typeof idTypesMapNameToPrefix)[T]}_${string}`;

// Validator factory
export const typeIdValidator = <const T extends IdTypePrefixNames>(prefix: T) =>
  z.string().startsWith(`${idTypesMapNameToPrefix[prefix]}_`)
    .refine((input) => {
      try {
        TypeID.fromString(input).asType(idTypesMapNameToPrefix[prefix]);
        return true;
      } catch { return false; }
    }) as z.ZodType<TypeId<T>>;

// Generator
export const typeIdGenerator = <const T extends IdTypePrefixNames>(prefix: T) =>
  typeid(idTypesMapNameToPrefix[prefix]).toString() as TypeId<T>;

// Pre-made validators
export const UserId = typeIdValidator("user");
export const EnvironmentId = typeIdValidator("environment");
export const SkillId = typeIdValidator("skill");
export const McpConfigId = typeIdValidator("mcpConfig");
export const PermissionId = typeIdValidator("permission");

export type UserId = z.infer<typeof UserId>;
export type EnvironmentId = z.infer<typeof EnvironmentId>;
export type SkillId = z.infer<typeof SkillId>;
export type McpConfigId = z.infer<typeof McpConfigId>;
export type PermissionId = z.infer<typeof PermissionId>;
```

### packages/db/src/utils/db-utils.ts

```typescript
import { customType, timestamp } from "drizzle-orm/pg-core";
import { typeIdFromUuid, typeIdToUuid, typeIdGenerator, type IdTypePrefixNames, type TypeId } from "@vps-claude/shared/typeid";

// TypeID stored as UUID in database
export const typeId = <const T extends IdTypePrefixNames>(
  prefix: T,
  columnName: string
) =>
  customType<{
    data: TypeId<T>;
    driverData: string;
  }>({
    dataType() { return "uuid"; },
    fromDriver(input: string): TypeId<T> {
      return typeIdFromUuid(prefix, input);
    },
    toDriver(input: TypeId<T>): string {
      return typeIdToUuid(input).uuid;
    }
  })(columnName);

// Base entity fields for all tables
export const baseEntityFields = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};
```

### Schema Tables

#### packages/db/src/schema/auth/auth.db.ts (Better-Auth managed)
```typescript
export const user = pgTable("user", {
  id: typeId("user", "id")
    .primaryKey()
    .$defaultFn(() => typeIdGenerator("user"))
    .$type<UserId>(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role").default("user"),
  ...baseEntityFields,
});

export const session = pgTable("session", {
  id: typeId("session", "id").primaryKey().$defaultFn(() => typeIdGenerator("session")),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  userId: typeId("user", "user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  ...baseEntityFields,
}, (t) => [index("session_user_id_idx").on(t.userId)]);
```

#### packages/db/src/schema/environment/environment.db.ts
```typescript
export const environmentStatusEnum = pgEnum("environment_status", [
  "pending", "deploying", "running", "stopped", "error"
]);

export const environmentsTable = pgTable("environments", {
  id: typeId("environment", "id")
    .primaryKey()
    .$defaultFn(() => typeIdGenerator("environment"))
    .$type<EnvironmentId>(),
  userId: typeId("user", "user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .$type<UserId>(),
  name: varchar("name", { length: 100 }).notNull(),
  subdomain: varchar("subdomain", { length: 63 }).notNull().unique(), // DNS limit
  coolifyUuid: text("coolify_uuid"), // Populated after Coolify deployment
  status: environmentStatusEnum("status").default("pending").notNull(),
  password: text("password").notNull(), // Encrypted code-server password
  config: jsonb("config").notNull().default({}).$type<EnvironmentConfig>(),
  errorMessage: text("error_message"),
  lastDeployedAt: timestamp("last_deployed_at", { withTimezone: true }),
  ...baseEntityFields,
}, (t) => [
  index("environments_user_id_idx").on(t.userId),
  index("environments_status_idx").on(t.status),
  index("environments_subdomain_idx").on(t.subdomain),
]);

// Type for config JSONB
export interface EnvironmentConfig {
  skillIds?: string[];
  mcpConfigIds?: string[];
  permissions?: {
    allowedTools?: string[];
    allowedHosts?: string[];
    filesystemPaths?: string[];
    maxTokens?: number;
  };
}
```

#### packages/db/src/schema/skill/skill.db.ts
```typescript
export const skillsTable = pgTable("skills", {
  id: typeId("skill", "id")
    .primaryKey()
    .$defaultFn(() => typeIdGenerator("skill"))
    .$type<SkillId>(),
  userId: typeId("user", "user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .$type<UserId>(),
  name: varchar("name", { length: 64 }).notNull(), // SKILL.md name field limit
  description: varchar("description", { length: 1024 }).notNull(), // SKILL.md description limit
  content: text("content").notNull(), // Full SKILL.md markdown content
  allowedTools: text("allowed_tools").array(), // Optional tool restrictions
  isGlobal: boolean("is_global").default(true).notNull(), // Available to all user's envs
  ...baseEntityFields,
}, (t) => [
  index("skills_user_id_idx").on(t.userId),
  uniqueIndex("skills_user_id_name_idx").on(t.userId, t.name),
]);
```

#### packages/db/src/schema/mcp/mcp.db.ts
```typescript
export const mcpTypeEnum = pgEnum("mcp_type", ["database", "custom"]);
export const mcpProviderEnum = pgEnum("mcp_provider", ["postgres", "mysql", "sqlite"]);

export const mcpConfigsTable = pgTable("mcp_configs", {
  id: typeId("mcpConfig", "id")
    .primaryKey()
    .$defaultFn(() => typeIdGenerator("mcpConfig"))
    .$type<McpConfigId>(),
  userId: typeId("user", "user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .$type<UserId>(),
  name: varchar("name", { length: 100 }).notNull(),
  type: mcpTypeEnum("type").notNull(),
  // For database type
  provider: mcpProviderEnum("provider"),
  connectionString: text("connection_string"), // Encrypted
  // For custom type
  url: text("url"),
  transportType: varchar("transport_type", { length: 20 }), // "stdio" | "http"
  isGlobal: boolean("is_global").default(true).notNull(),
  ...baseEntityFields,
}, (t) => [
  index("mcp_configs_user_id_idx").on(t.userId),
  uniqueIndex("mcp_configs_user_id_name_idx").on(t.userId, t.name),
]);
```

#### packages/db/src/schema/environment/environment.relations.ts
```typescript
export const environmentRelations = relations(environmentsTable, ({ one }) => ({
  user: one(user, {
    fields: [environmentsTable.userId],
    references: [user.id],
    relationName: "userEnvironments",
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  environments: many(environmentsTable, { relationName: "userEnvironments" }),
  skills: many(skillsTable, { relationName: "userSkills" }),
  mcpConfigs: many(mcpConfigsTable, { relationName: "userMcpConfigs" }),
}));
```

### packages/db/src/db.ts
```typescript
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import * as authSchema from "./schema/auth/auth.db";
import * as environmentSchema from "./schema/environment/environment.db";
import * as skillSchema from "./schema/skill/skill.db";
import * as mcpSchema from "./schema/mcp/mcp.db";

export const DB_SCHEMA = {
  ...authSchema,
  ...environmentSchema,
  ...skillSchema,
  ...mcpSchema,
};

export type Database = ReturnType<typeof drizzle<typeof DB_SCHEMA>>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Transaction;

export function createDatabase(url: string): Database {
  return drizzle(url, { schema: DB_SCHEMA });
}

export async function runMigrations(db: Database) {
  await migrate(db, { migrationsFolder: "./drizzle" });
}

export function withTransaction<T>(
  db: Database,
  callback: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(callback);
}
```

### packages/shared/src/services.schema.ts
```typescript
export type Environment = "dev" | "prod";

export const SERVICE_URLS: Record<Environment, {
  auth: string;
  api: string;
  web: string;
  authInternal: string;
  apiInternal: string;
  cookieDomain: string;
  coolify: string;
  agentsDomain: string;
}> = {
  dev: {
    auth: "http://localhost:3000",
    api: "http://localhost:3000",
    web: "http://localhost:3001",
    authInternal: "http://localhost:3000",
    apiInternal: "http://localhost:3000",
    cookieDomain: "localhost",
    coolify: "http://localhost:8000", // Local Coolify for testing
    agentsDomain: "localhost", // No wildcard in dev
  },
  prod: {
    auth: "https://api.vps-claude.grm.wtf",
    api: "https://api.vps-claude.grm.wtf",
    web: "https://vps-claude.grm.wtf",
    authInternal: "http://api.internal:3000",
    apiInternal: "http://api.internal:3000",
    cookieDomain: ".grm.wtf",
    coolify: "https://coolify.grm.wtf",
    agentsDomain: "agents.grm.wtf", // *.agents.grm.wtf
  },
};
```

### packages/shared/src/constants.ts
```typescript
export const ENVIRONMENT_STATUSES = [
  "pending", "deploying", "running", "stopped", "error"
] as const;
export type EnvironmentStatus = (typeof ENVIRONMENT_STATUSES)[number];

export const MCP_TYPES = ["database", "custom"] as const;
export type McpType = (typeof MCP_TYPES)[number];

export const MCP_PROVIDERS = ["postgres", "mysql", "sqlite"] as const;
export type McpProvider = (typeof MCP_PROVIDERS)[number];

export const FIELD_LIMITS = {
  skillName: 64,        // SKILL.md name limit
  skillDescription: 1024, // SKILL.md description limit
  subdomain: 63,        // DNS label limit
  envName: 100,
  mcpConfigName: 100,
};

export const API_LIMITS = {
  maxEnvironmentsPerUser: 10, // Soft limit, can be overridden
  maxSkillsPerUser: 50,
  maxMcpConfigsPerUser: 20,
};

export const POLLING_CONFIG = {
  deploymentCheckInterval: 5000, // 5s
  maxDeploymentWait: 300000,     // 5min
};
```

## oRPC API Architecture (Following ai-stilist Patterns)

### packages/api/src/api.ts - Procedure Definitions
```typescript
import { os } from "@orpc/server";
import type { Context } from "./context";

// Base procedure with context
const o = os.$context<Context>();

// Public - anyone can call
export const publicProcedure = o;

// Protected - requires authenticated session
export const protectedProcedure = publicProcedure.use(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
  }
  return next({ context });
});

// Admin - requires admin role
export const adminProcedure = protectedProcedure.use(async ({ context, next }) => {
  if (context.session.user.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }
  return next({ context });
});
```

### packages/api/src/context.ts - Request Context
```typescript
import type { UserId } from "@vps-claude/shared/typeid";

export interface TypedSession {
  user: { id: UserId; email: string; name: string; role: string };
  session: { id: string; expiresAt: Date };
}

export interface Context {
  session: TypedSession | null;
  // Services
  environmentService: EnvironmentService;
  skillService: SkillService;
  mcpService: McpService;
  coolifyService: CoolifyService;
  // Infra
  logger: Logger;
  requestId: string;
  appEnv: Environment;
}

export async function createContext(deps: ContextDeps): Promise<Context> {
  const session = await getSessionFromHeaders(deps.headers, deps.authClient);
  return {
    session: session ? {
      user: { ...session.user, id: UserId.parse(session.user.id) },
      session: session.session,
    } : null,
    environmentService: deps.environmentService,
    skillService: deps.skillService,
    mcpService: deps.mcpService,
    coolifyService: deps.coolifyService,
    logger: deps.logger.child({ requestId: deps.requestId }),
    requestId: deps.requestId,
    appEnv: deps.appEnv,
  };
}
```

### packages/api/src/routers/app-router.ts
```typescript
import { environmentRouter } from "./environment.router";
import { skillRouter } from "./skill.router";
import { mcpRouter } from "./mcp.router";
import { adminRouter } from "./admin.router";

export const appRouter = {
  environment: environmentRouter,
  skill: skillRouter,
  mcp: mcpRouter,
  admin: adminRouter,
};

export type AppRouter = typeof appRouter;
```

### packages/api/src/create-api.ts
```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { RPCHandler, OpenAPIHandler } from "@orpc/server/hono";
import { appRouter } from "./routers/app-router";
import { createContext } from "./context";

export async function createApi(deps: ApiDependencies) {
  // Create services
  const coolifyService = createCoolifyService({
    apiUrl: deps.coolifyApiUrl,
    token: deps.coolifyToken,
    projectUuid: deps.coolifyProjectUuid,
    serverUuid: deps.coolifyServerUuid,
  });
  const dockerfileService = createDockerfileService();
  const environmentService = createEnvironmentService({
    db: deps.db,
    coolifyService,
    dockerfileService
  });
  const skillService = createSkillService({ db: deps.db });
  const mcpService = createMcpService({ db: deps.db });

  // oRPC handlers
  const orpcHandler = RPCHandler(appRouter);
  const openApiHandler = OpenAPIHandler(appRouter, { path: "/api-reference" });

  // Hono app
  const app = new Hono();

  app.use("*", cors({ origin: deps.corsOrigin, credentials: true }));

  // Auth routes (Better-Auth)
  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.authClient.handler(c.req.raw));

  // oRPC routes
  app.use("/rpc/*", async (c) => {
    const context = await createContext({
      headers: c.req.raw.headers,
      authClient: deps.authClient,
      environmentService,
      skillService,
      mcpService,
      coolifyService,
      logger: deps.logger,
      requestId: typeIdGenerator("request"),
      appEnv: deps.appEnv,
    });
    return orpcHandler.handle(c.req.raw, { prefix: "/rpc", context });
  });

  // OpenAPI docs
  app.use("/api-reference/*", async (c) => openApiHandler.handle(c.req.raw));

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
```

### apps/web/src/lib/orpc.ts - Browser Client
```typescript
import { QueryClient, QueryCache } from "@tanstack/react-query";
import { createORPCClient, RPCLink } from "@orpc/client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouter } from "@vps-claude/api";

const handleError = (error: Error) => {
  toast.error(error.message);
};

export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: handleError }),
});

const link = new RPCLink({
  url: `${SERVICE_URLS[env].api}/rpc`,
  fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
});

export const client = createORPCClient<AppRouter>(link);
export const orpc = createTanstackQueryUtils(client);
```

### Usage in Components
```typescript
// Query
const { data: environments } = useQuery({
  ...orpc.environment.list.queryOptions(),
});

// Mutation
const createMutation = useMutation({
  mutationFn: (data: CreateEnvInput) => client.environment.create(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: orpc.environment.list.queryKey() });
    toast.success("Environment created");
  },
});
```

## Core Services

### 1. CoolifyService (`packages/coolify/`)

```typescript
interface CoolifyService {
  // Create new dockerfile-based application
  createApplication(params: {
    projectUuid: string;
    serverUuid: string;
    environmentName: string;
    name: string;
    dockerfile: string;
    domains: string;
    portsExposes: string;
    envVars: Record<string, string>;
    instantDeploy?: boolean;
  }): Promise<Result<{ uuid: string }, CoolifyError>>;

  // Trigger deployment
  deploy(uuid: string, force?: boolean): Promise<Result<DeploymentInfo, CoolifyError>>;

  // Get application status
  getStatus(uuid: string): Promise<Result<AppStatus, CoolifyError>>;

  // Update environment variables
  updateEnvVars(uuid: string, envVars: EnvVar[]): Promise<Result<void, CoolifyError>>;

  // Stop/start application
  stop(uuid: string): Promise<Result<void, CoolifyError>>;
  start(uuid: string): Promise<Result<void, CoolifyError>>;

  // Delete application
  delete(uuid: string): Promise<Result<void, CoolifyError>>;
}
```

### 2. DockerfileService (`packages/api/services/`)

Dynamically generates Dockerfiles based on user configuration.

```typescript
interface DockerfileService {
  generate(config: {
    skills: Skill[];
    mcpConfigs: McpConfig[];
    permissions: ClaudePermission;
    password: string;
  }): string;
}
```

**Generated Dockerfile structure:**
```dockerfile
FROM codercom/code-server:latest

# Base tools (from grmkris/agent)
RUN apt-get update && apt-get install -y ...
RUN npm install -g typescript @anthropic-ai/claude-code

# MCP servers (based on user config)
RUN npm install -g @modelcontextprotocol/server-postgres  # if database MCP
# ... other MCP servers

# Skills (copied into container)
COPY skills/ /home/coder/.claude/skills/

# Claude config (permissions, settings)
COPY claude-settings.json /home/coder/.claude/settings.json

# MCP config
COPY mcp-config.json /home/coder/.claude/mcp.json

EXPOSE 8080 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "password"]
```

### 3. EnvironmentService (`packages/api/services/`)

```typescript
interface EnvironmentService {
  create(userId: UserId, input: CreateEnvInput): Promise<Result<Environment, Error>>;
  deploy(envId: EnvId): Promise<Result<DeploymentInfo, Error>>;
  stop(envId: EnvId): Promise<Result<void, Error>>;
  start(envId: EnvId): Promise<Result<void, Error>>;
  delete(envId: EnvId): Promise<Result<void, Error>>;
  getStatus(envId: EnvId): Promise<Result<EnvStatus, Error>>;
  list(userId: UserId): Promise<Result<Environment[], Error>>;
  update(envId: EnvId, input: UpdateEnvInput): Promise<Result<Environment, Error>>;
}
```

## API Routers (oRPC)

### environment.router.ts
```typescript
export const environmentRouter = {
  // List user's environments
  list: protectedProcedure.handler(/* ... */),

  // Get single environment with full config
  get: protectedProcedure.input(z.object({ id: EnvId })).handler(/* ... */),

  // Create new environment
  create: protectedProcedure.input(CreateEnvSchema).handler(/* ... */),

  // Update environment config (triggers redeploy)
  update: protectedProcedure.input(UpdateEnvSchema).handler(/* ... */),

  // Deploy/redeploy
  deploy: protectedProcedure.input(z.object({ id: EnvId })).handler(/* ... */),

  // Start stopped environment
  start: protectedProcedure.input(z.object({ id: EnvId })).handler(/* ... */),

  // Stop running environment
  stop: protectedProcedure.input(z.object({ id: EnvId })).handler(/* ... */),

  // Delete environment
  delete: protectedProcedure.input(z.object({ id: EnvId })).handler(/* ... */),

  // Get real-time status
  status: protectedProcedure.input(z.object({ id: EnvId })).handler(/* ... */),
};
```

### skills.router.ts
```typescript
export const skillsRouter = {
  list: protectedProcedure.handler(/* ... */),
  create: protectedProcedure.input(CreateSkillSchema).handler(/* ... */),
  update: protectedProcedure.input(UpdateSkillSchema).handler(/* ... */),
  delete: protectedProcedure.input(z.object({ id: SkillId })).handler(/* ... */),
};
```

### mcp.router.ts
```typescript
export const mcpRouter = {
  list: protectedProcedure.handler(/* ... */),
  create: protectedProcedure.input(CreateMcpSchema).handler(/* ... */),
  update: protectedProcedure.input(UpdateMcpSchema).handler(/* ... */),
  delete: protectedProcedure.input(z.object({ id: McpId })).handler(/* ... */),
  test: protectedProcedure.input(z.object({ id: McpId })).handler(/* test connection */),
};
```

## Frontend Pages

### Dashboard (`/dashboard`)
- List all user environments with status badges
- Quick actions: start, stop, open in browser
- Usage stats (if applicable)

### Create Environment (`/environments/new`)
- Name & subdomain input
- Skills selector (multi-select from user's skills)
- MCP configs selector
- Claude permissions form:
  - Tool restrictions checkboxes
  - Network access whitelist
  - Filesystem path additions
- Password for code-server

### Environment Detail (`/environments/[id]`)
- Status & URL to access
- Configuration overview
- Logs viewer (if available from Coolify)
- Edit/redeploy/delete actions

### Skills Manager (`/skills`)
- Create/edit skills with markdown editor
- Preview SKILL.md format
- Set allowed-tools restrictions

### MCP Configs (`/settings/mcp`)
- Add database connections (with connection string input)
- Add custom MCP server URLs
- Test connection button

## Domain Configuration

**Wildcard DNS**: `*.agents.grm.wtf` → Coolify server IP

**Per-environment subdomain**:
- User creates env "my-project"
- System generates unique subdomain: `{username}-{envname}.agents.grm.wtf`
- Or user-specified: `my-custom-name.agents.grm.wtf` (check uniqueness)

**Coolify domains field**: Set to full domain when creating application via API

## Environment Variables (Server)

```env
# Database
DATABASE_URL=postgresql://...

# Coolify API
COOLIFY_API_URL=https://coolify.grm.wtf/api/v1
COOLIFY_API_TOKEN=your-bearer-token
COOLIFY_PROJECT_UUID=project-uuid
COOLIFY_SERVER_UUID=server-uuid
COOLIFY_ENVIRONMENT_NAME=production

# Domain
WILDCARD_DOMAIN=agents.grm.wtf

# Auth
BETTER_AUTH_SECRET=...

# App
APP_ENV=dev|prod
PORT=3000
```

## Root Configuration Files

### package.json
```json
{
  "name": "vps-claude",
  "private": true,
  "workspaces": {
    "packages": ["apps/*", "packages/*"],
    "catalog": {
      "hono": "^4.11.0",
      "@orpc/server": "^1.12.3",
      "@orpc/client": "^1.12.3",
      "@orpc/tanstack-query": "^1.12.3",
      "@tanstack/react-query": "^5.90.11",
      "better-auth": "^1.4.9",
      "drizzle-orm": "^0.44.6",
      "zod": "^4.1.11",
      "typeid-js": "^1.3.0",
      "pino": "^9.10.0"
    }
  },
  "scripts": {
    "dev": "turbo run dev",
    "dev:server": "turbo run dev --filter=@vps-claude/server",
    "dev:web": "turbo run dev --filter=@vps-claude/web",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "biome lint .",
    "fix": "biome lint --fix . && biome format --write .",
    "db:generate": "turbo run db:generate --filter=@vps-claude/db",
    "db:push": "turbo run db:push --filter=@vps-claude/db"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.10.1",
    "turbo": "^2.7.2",
    "typescript": "^5.8.3"
  },
  "packageManager": "bun@1.3.5"
}
```

### turbo.json
```json
{
  "$schema": "https://turbo.build/schema.v2.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "db:generate": {
      "cache": false
    },
    "db:push": {
      "cache": false
    }
  }
}
```

### biome.json
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "javascript": {
    "formatter": { "quoteStyle": "double", "semicolons": "always" }
  }
}
```

### infra/docker-compose.yml (Local Dev)
```yaml
services:
  postgres:
    image: postgres:15
    ports:
      - "54324:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: vps_claude
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6384:6379"

volumes:
  postgres_data:
```

## Implementation Phases

### Phase 1: Foundation
1. Initialize monorepo with Turborepo
2. Set up packages structure (db, auth, shared, api, coolify)
3. Implement database schema with Drizzle
4. Set up Better-Auth with email/password
5. Create basic Hono server with health endpoint

### Phase 2: Coolify Integration
1. Implement CoolifyService with API client
2. Create DockerfileService for dynamic generation
3. Implement EnvironmentService
4. Create environment.router with CRUD + deploy

### Phase 3: Skills & MCP
1. Implement skills management (CRUD)
2. Implement MCP config management
3. Integrate skills/MCP into Dockerfile generation
4. Add permissions system

### Phase 4: Frontend
1. Set up Next.js app with auth pages
2. Implement dashboard page
3. Create environment management pages
4. Add skills editor with MDX/markdown support
5. Add MCP configuration UI

### Phase 5: Polish
1. Real-time status updates (polling/websocket)
2. Logs viewer integration
3. Error handling & user feedback
4. Rate limiting & quotas
5. Admin panel for user management

## Key Files to Create (Priority Order)

1. `package.json` (root) - monorepo config
2. `turbo.json` - build pipeline
3. `packages/shared/src/typeid.schema.ts` - TypeId definitions
4. `packages/shared/src/services.schema.ts` - Service URLs
5. `packages/db/src/schema/*.ts` - Database schema
6. `packages/auth/src/auth-config.ts` - Better-Auth setup
7. `packages/coolify/src/coolify-client.ts` - API client
8. `packages/api/src/services/dockerfile.service.ts` - Docker generation
9. `packages/api/src/services/environment.service.ts` - Core logic
10. `packages/api/src/routers/environment.router.ts` - API routes
11. `apps/server/src/server.ts` - Server entry
12. `apps/web/` - Frontend app

## Resolved Configuration

- **Wildcard domain**: `*.agents.grm.wtf` (each env gets `{subdomain}.agents.grm.wtf`)
- **Persistence**: Yes - volumes for `/workspace`, `.config`, `.local`, `.cache` persist across redeploys
- **Quotas**: No limits for MVP (add admin-configurable limits later)
- **Coolify credentials**: Will be provided during setup (`COOLIFY_PROJECT_UUID`, `COOLIFY_SERVER_UUID`)
- **Skills**: Claude Code Skills (SKILL.md files) + MCP servers + permissions
- **Stack**: Hono backend + Next.js frontend (separate apps)
- **Auth**: Better-Auth (email/password)
- **Patterns**: Following ai-stilist monorepo structure
