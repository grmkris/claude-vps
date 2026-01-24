import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { boxProcedure } from "../index";
import { SuccessOutput } from "./schemas";

export const boxApiRouter = {
  email: {
    send: boxProcedure
      .route({ method: "POST", path: "/box/email/send" })
      .input(
        z.object({
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
      .output(SuccessOutput)
      .handler(async ({ context, input }) => {
        const boxResult = await context.emailService.getBoxByAgentSecret(
          context.boxToken!
        );

        if (boxResult.isErr()) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: boxResult.error.message,
          });
        }

        const boxRecord = boxResult.value;
        if (!boxRecord) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Invalid box token",
          });
        }

        // Queue email send - await to surface queue errors
        await context.emailService.queueSendEmail(
          boxRecord.id,
          input.to,
          input.subject,
          input.body,
          input.inReplyTo
        );

        return { success: true as const };
      }),
  },
};
