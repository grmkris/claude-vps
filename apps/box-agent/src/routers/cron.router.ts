import { z } from "zod";

import { logger } from "../logger";
import { protectedProcedure } from "../procedures";
import { runWithSession } from "../utils/agent";

export const cronRouter = {
  trigger: protectedProcedure
    .route({ method: "POST", path: "/cron/trigger" })
    .input(
      z.object({
        cronjobId: z.string(),
        cronjobName: z.string(),
        prompt: z.string(),
      })
    )
    .output(
      z.object({ success: z.boolean(), sessionId: z.string().optional() })
    )
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "cron.trigger",
        cronjobId: input.cronjobId,
        cronjobName: input.cronjobName,
      });

      // Run Claude session with the cronjob prompt
      runWithSession({
        prompt: input.prompt,
        contextType: "cron",
        contextId: input.cronjobId,
        triggerType: "cron",
      }).catch((err) => {
        logger.error(
          { err, cronjobId: input.cronjobId },
          "Cronjob session failed"
        );
      });

      return { success: true, sessionId: input.cronjobId };
    }),
};
