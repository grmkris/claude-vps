import { relations } from "drizzle-orm";

import { box } from "../box";
import { boxDeployStep } from "./box-deploy-step.db";

export const boxDeployStepRelations = relations(
  boxDeployStep,
  ({ one, many }) => ({
    box: one(box, {
      fields: [boxDeployStep.boxId],
      references: [box.id],
    }),
    parent: one(boxDeployStep, {
      fields: [boxDeployStep.parentId],
      references: [boxDeployStep.id],
      relationName: "parentChild",
    }),
    children: many(boxDeployStep, {
      relationName: "parentChild",
    }),
  })
);
