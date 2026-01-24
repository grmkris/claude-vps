import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { env } from "@/env/server";

import * as schema from "./schema";

const sqlite = new Database(env.DATABASE_URL);

export const db = drizzle({ client: sqlite, schema });
