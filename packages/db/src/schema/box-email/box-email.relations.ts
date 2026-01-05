import { relations } from "drizzle-orm";

import { box } from "../box";
import { boxEmailSettings } from "./box-email-settings.db";
import { boxEmail } from "./box-email.db";

export const boxEmailRelations = relations(boxEmail, ({ one }) => ({
  box: one(box, {
    fields: [boxEmail.boxId],
    references: [box.id],
  }),
}));

export const boxEmailSettingsRelations = relations(
  boxEmailSettings,
  ({ one }) => ({
    box: one(box, {
      fields: [boxEmailSettings.boxId],
      references: [box.id],
    }),
  })
);
