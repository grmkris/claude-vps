import { relations } from "drizzle-orm";

import { user } from "../auth";
import { box } from "./box.db";

export const boxRelations = relations(box, ({ one }) => ({
	user: one(user, {
		fields: [box.userId],
		references: [user.id],
	}),
}));
