import { PGlite } from "@electric-sql/pglite";
import { createDb, runMigrations, type Database, DB_SCHEMA } from "@vps-claude/db";

export async function createTestDatabase(): Promise<{
	db: Database;
	pgLite: PGlite;
}> {
	const pgLite = new PGlite();
	const db = createDb({ type: "pglite", client: pgLite });

	await runMigrations(db);

	return { db, pgLite };
}

export async function cleanupTestDatabase(db: Database): Promise<void> {
	await db.delete(DB_SCHEMA.box);
}

export type { Database };
