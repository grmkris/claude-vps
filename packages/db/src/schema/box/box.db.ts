import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { typeIdGenerator } from "@vps-claude/shared";
import { user } from "../auth";

export const boxStatusEnum = pgEnum("box_status", [
	"pending",
	"deploying",
	"running",
	"error",
	"deleted",
]);

export const box = pgTable(
	"box",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => typeIdGenerator("box")),
		name: text("name").notNull(),
		subdomain: text("subdomain").notNull().unique(),
		status: boxStatusEnum("status").notNull().default("pending"),
		coolifyApplicationUuid: text("coolify_application_uuid"),
		errorMessage: text("error_message"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("box_userId_idx").on(table.userId),
		index("box_subdomain_idx").on(table.subdomain),
		index("box_status_idx").on(table.status),
	],
);

export type Box = typeof box.$inferSelect;
export type NewBox = typeof box.$inferInsert;
