import { relations } from "drizzle-orm";

import { boxEnvVar } from "./box-env-var.db";
import { box } from "./box.db";

export const boxEnvVarRelations = relations(boxEnvVar, ({ one }) => ({
  box: one(box, {
    fields: [boxEnvVar.boxId],
    references: [box.id],
  }),
}));
