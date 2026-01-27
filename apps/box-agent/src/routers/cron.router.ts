import { z } from "zod";

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
    .handler(async ({ input }) => {
      console.log(
        `[cron.router] Triggering cronjob ${input.cronjobName} (${input.cronjobId})`
      );

      // Run Claude session with the cronjob prompt
      runWithSession({
        prompt: input.prompt,
        contextType: "cron",
        contextId: input.cronjobId,
      }).catch((error) => {
        console.error(
          `[cron.router] Cronjob session failed: ${input.cronjobId}`,
          error
        );
      });

      return { success: true, sessionId: input.cronjobId };
    }),
};
