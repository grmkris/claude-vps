import { z } from "zod";

import { logger } from "../logger";
import { protectedProcedure } from "../procedures";
import { runWithSession } from "../utils/agent";
import {
  buildEmailPrompt,
  InboundEmailSchema,
  writeEmailToInbox,
} from "../utils/inbox";

export const emailRouter = {
  /** Receive inbound email from main server (delivery worker) */
  receive: protectedProcedure
    .route({ method: "POST", path: "/email/receive" })
    .input(InboundEmailSchema)
    .output(z.object({ success: z.boolean(), filepath: z.string() }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "email.receive",
        emailId: input.messageId,
        from: input.from.email,
      });
      const filepath = await writeEmailToInbox(input);
      const prompt = buildEmailPrompt(input, filepath);

      runWithSession({
        prompt,
        contextType: "email",
        contextId: input.messageId,
        triggerType: "email",
      }).catch((err) => logger.error({ err }, "Email session failed"));

      return { success: true, filepath };
    }),
};
