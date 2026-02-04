import { relations } from "drizzle-orm";

import { box } from "../box";
import { agentInboxNotification } from "./agent-inbox-notification.db";
import { agentInbox } from "./agent-inbox.db";
import { boxAgentSettings } from "./box-agent-settings.db";

export const agentInboxRelations = relations(agentInbox, ({ one, many }) => ({
  box: one(box, {
    fields: [agentInbox.boxId],
    references: [box.id],
  }),
  sourceBox: one(box, {
    fields: [agentInbox.sourceBoxId],
    references: [box.id],
    relationName: "sourceBox",
  }),
  parent: one(agentInbox, {
    fields: [agentInbox.parentId],
    references: [agentInbox.id],
    relationName: "replies",
  }),
  replies: many(agentInbox, {
    relationName: "replies",
  }),
  notifications: many(agentInboxNotification),
}));

export const agentInboxNotificationRelations = relations(
  agentInboxNotification,
  ({ one }) => ({
    inbox: one(agentInbox, {
      fields: [agentInboxNotification.inboxId],
      references: [agentInbox.id],
    }),
    targetBox: one(box, {
      fields: [agentInboxNotification.targetBoxId],
      references: [box.id],
    }),
  })
);

export const boxAgentSettingsRelations = relations(
  boxAgentSettings,
  ({ one }) => ({
    box: one(box, {
      fields: [boxAgentSettings.boxId],
      references: [box.id],
    }),
  })
);
