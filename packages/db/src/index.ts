import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

import * as schema from "./schema";

export * from "./schema";
export { schema };
export { schema as DB_SCHEMA };

export type Database = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

type DbConfig =
  | { type: "node-postgres"; connectionString: string }
  | { type: "pglite"; client: PGlite };

export function createDb(config: DbConfig): Database {
  if (config.type === "node-postgres") {
    return drizzleNodePg(config.connectionString, { schema });
  }
  return drizzlePglite(config.client, { schema });
}

export async function runMigrations(db: Database): Promise<void> {
  const migrationsFolder = join(import.meta.dir, "../drizzle");
  if (db instanceof PgliteDatabase) {
    await migratePglite(db, { migrationsFolder });
  }
}
