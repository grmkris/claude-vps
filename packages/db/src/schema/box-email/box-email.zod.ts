import { BoxEmailId, BoxEmailSettingsId, BoxId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { boxEmailSettings } from "./box-email-settings.db";
import { boxEmail, boxEmailStatusEnum } from "./box-email.db";

export const SelectBoxEmailSchema = createSelectSchema(boxEmail, {
  id: BoxEmailId,
  boxId: BoxId,
});
export type SelectBoxEmailSchema = z.infer<typeof SelectBoxEmailSchema>;

export const InsertBoxEmailSchema = createInsertSchema(boxEmail).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBoxEmailSchema = z.infer<typeof InsertBoxEmailSchema>;

export const BOX_EMAIL_STATUSES = boxEmailStatusEnum.enumValues;
export const BoxEmailStatus = z.enum(BOX_EMAIL_STATUSES);
export type BoxEmailStatus = z.infer<typeof BoxEmailStatus>;

export const SelectBoxEmailSettingsSchema = createSelectSchema(
  boxEmailSettings,
  {
    id: BoxEmailSettingsId,
    boxId: BoxId,
  }
);
export type SelectBoxEmailSettingsSchema = z.infer<
  typeof SelectBoxEmailSettingsSchema
>;

export const InsertBoxEmailSettingsSchema = createInsertSchema(
  boxEmailSettings
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBoxEmailSettingsSchema = z.infer<
  typeof InsertBoxEmailSettingsSchema
>;
