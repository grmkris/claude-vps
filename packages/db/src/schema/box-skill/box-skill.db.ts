import {
  type BoxId,
  type BoxSkillId,
  type SkillId,
  typeIdGenerator,
} from "@vps-claude/shared";
import { index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { box } from "../box";
import { skill } from "../skill";

export const boxSkill = pgTable(
  "box_skill",
  {
    id: typeId("boxSkill", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxSkill"))
      .$type<BoxSkillId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .$type<BoxId>(),
    skillId: typeId("skill", "skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" })
      .$type<SkillId>(),
    ...baseEntityFields,
  },
  (table) => [
    index("box_skill_boxId_idx").on(table.boxId),
    index("box_skill_skillId_idx").on(table.skillId),
    uniqueIndex("box_skill_unique_idx").on(table.boxId, table.skillId),
  ]
);

export type BoxSkill = typeof boxSkill.$inferSelect;
export type NewBoxSkill = typeof boxSkill.$inferInsert;
