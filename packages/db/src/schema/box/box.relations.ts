import { relations } from "drizzle-orm";

import { user } from "../auth";
import { boxAgentConfig } from "../box-agent-config";
import { boxDeployStep } from "../box-deploy-step";
import { boxEmail, boxEmailSettings } from "../box-email";
import { box } from "./box.db";

export const boxRelations = relations(box, ({ one, many }) => ({
  user: one(user, {
    fields: [box.userId],
    references: [user.id],
  }),
  boxEmails: many(boxEmail),
  boxEmailSettings: one(boxEmailSettings, {
    fields: [box.id],
    references: [boxEmailSettings.boxId],
  }),
  boxAgentConfigs: many(boxAgentConfig),
  boxDeploySteps: many(boxDeployStep),
}));
