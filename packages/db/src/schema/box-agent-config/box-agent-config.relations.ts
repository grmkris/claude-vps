import { relations } from "drizzle-orm";

import { box } from "../box";
import { boxAgentConfig } from "./box-agent-config.db";

export const boxAgentConfigRelations = relations(boxAgentConfig, ({ one }) => ({
  box: one(box, {
    fields: [boxAgentConfig.boxId],
    references: [box.id],
  }),
}));
