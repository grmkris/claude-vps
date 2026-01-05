import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { boxProcedure } from "../internal-procedure";

// Box API routers - called by box-agent inside containers
// Auth: per-box token via boxProcedure

export const boxApiRouter = {
  email: {
    // Per-box auth: validates box by its unique token, prevents cross-box attacks
    send: boxProcedure
      .route({ method: "POST", path: "/box/email/send" })
      .input(
        z.object({
          // boxId derived from authenticated token, not user input
          to: z.string(),
          subject: z.string(),
          body: z.string(),
          inReplyTo: z
            .object({
              messageId: z.string(),
              from: z.string(),
              subject: z.string(),
            })
            .optional(),
        })
      )
      .output(z.object({ success: z.boolean() }))
      .handler(async ({ context, input }) => {
        // Look up box by the token from Authorization header
        const boxRecord = await context.emailService.getBoxByAgentSecret(
          context.boxToken!
        );

        if (!boxRecord) {
          throw new ORPCError("UNAUTHORIZED", { message: "Invalid box token" });
        }

        await context.emailService.queueSendEmail(
          boxRecord.id, // Use authenticated box ID, not user input
          input.to,
          input.subject,
          input.body,
          input.inReplyTo
        );
        return { success: true };
      }),
  },
};
