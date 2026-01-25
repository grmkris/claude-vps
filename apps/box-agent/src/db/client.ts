import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { env } from "../env";
import * as schema from "./schema";

export const sqlite = new Database(env.BOX_DB_PATH, { create: true });

// Enable WAL mode for better performance
sqlite.run("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });
