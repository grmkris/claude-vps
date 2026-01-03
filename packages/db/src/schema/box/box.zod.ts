import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { box, boxStatusEnum } from "./box.db";

export const BoxSelectSchema = createSelectSchema(box);
export const BoxInsertSchema = createInsertSchema(box, {
	name: z.string().min(1).max(50),
	subdomain: z.string().min(1).max(100),
});

export const BOX_STATUSES = boxStatusEnum.enumValues;
export const BoxStatus = z.enum(BOX_STATUSES);
export type BoxStatus = z.infer<typeof BoxStatus>;
