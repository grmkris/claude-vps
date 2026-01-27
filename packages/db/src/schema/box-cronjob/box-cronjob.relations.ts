import { relations } from "drizzle-orm";

import { box } from "../box";
import { boxCronjob, boxCronjobExecution } from "./box-cronjob.db";

export const boxCronjobRelations = relations(boxCronjob, ({ one, many }) => ({
  box: one(box, {
    fields: [boxCronjob.boxId],
    references: [box.id],
  }),
  executions: many(boxCronjobExecution),
}));

export const boxCronjobExecutionRelations = relations(
  boxCronjobExecution,
  ({ one }) => ({
    cronjob: one(boxCronjob, {
      fields: [boxCronjobExecution.cronjobId],
      references: [boxCronjob.id],
    }),
  })
);
