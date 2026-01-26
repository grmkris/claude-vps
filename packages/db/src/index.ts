import type { PGlite } from "@electric-sql/pglite";
import type { Logger } from "@vps-claude/logger";

import { BunSQLDatabase, drizzle as drizzleBunSQL } from "drizzle-orm/bun-sql";
import { migrate as migrateBunSql } from "drizzle-orm/bun-sql/migrator";
import { drizzle as drizzlePglite, PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePgLite } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";

import * as schema from "./schema";

export * from "./schema";
export { schema };
export { schema as DB_SCHEMA };

// Re-export common drizzle-orm operators for convenience
export { eq, ne, gt, gte, lt, lte, and, or, not, inArray } from "drizzle-orm";

export type Database =
  | BunSQLDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

type DbConfig =
  | { type: "bun-sql"; connectionString: string }
  | { type: "pglite"; client: PGlite };

export function createDb(config: DbConfig): Database {
  if (config.type === "bun-sql") {
    return drizzleBunSQL(config.connectionString, { schema });
  }
  return drizzlePglite(config.client, { schema });
}

export async function runMigrations(
  db: Database,
  logger?: Logger
): Promise<void> {
  logger?.info({}, "Running database migrations");

  const migrationsFolder = join(import.meta.dir, "../drizzle");

  if (db instanceof BunSQLDatabase) {
    await migrateBunSql(db, { migrationsFolder });
  } else if (db instanceof PgliteDatabase) {
    await migratePgLite(db, { migrationsFolder });
  }

  logger?.info({}, "Database migrations completed");
}
