import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "./client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "migrations");

// Only run migrations if folder exists (allows first-time setup)
if (existsSync(migrationsFolder)) {
  migrate(db, { migrationsFolder });
}
