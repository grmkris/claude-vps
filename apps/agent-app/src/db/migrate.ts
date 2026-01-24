import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { env } from "@/env/server";

const sqlite = new Database(env.DATABASE_URL);
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./src/db/migrations" });
