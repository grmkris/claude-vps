import { BoxId, UserId } from "@vps-claude/shared";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { box, boxStatusEnum } from "./box.db";

export const SelectBoxSchema = createSelectSchema(box, {
  id: BoxId,
  userId: UserId,
});
export type SelectBoxSchema = z.infer<typeof SelectBoxSchema>;

export const InsertBoxSchema = createSelectSchema(box).omit({
  id: true,
  status: true,
  coolifyApplicationUuid: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBoxSchema = z.infer<typeof InsertBoxSchema>;

export const BOX_STATUSES = boxStatusEnum.enumValues;
export const BoxStatus = z.enum(BOX_STATUSES);
export type BoxStatus = z.infer<typeof BoxStatus>;
