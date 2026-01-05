import { type SkillId, typeIdGenerator, type UserId } from "@vps-claude/shared";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { user } from "../auth";

export const skill = pgTable(
  "skill",
  {
    id: typeId("skill", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("skill"))
      .$type<SkillId>(),
    userId: typeId("user", "user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    aptPackages: text("apt_packages").array().notNull().default([]),
    npmPackages: text("npm_packages").array().notNull().default([]),
    pipPackages: text("pip_packages").array().notNull().default([]),
    skillMdContent: text("skill_md_content"),
    ...baseEntityFields,
  },
  (table) => [
    uniqueIndex("skill_user_slug_unique_idx").on(table.userId, table.slug),
    index("skill_userId_idx").on(table.userId),
  ]
);

export type Skill = typeof skill.$inferSelect;
export type NewSkill = typeof skill.$inferInsert;
