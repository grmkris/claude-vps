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

        return boxResult.match(
          (boxRecord) => {
            if (!boxRecord) {
              throw new ORPCError("UNAUTHORIZED", {
                message: "Invalid box token",
              });
            }

            // Queue email send (fire and forget - errors handled by worker)
            void context.emailService.queueSendEmail(
              boxRecord.id,
              input.to,
              input.subject,
              input.body,
              input.inReplyTo
            );
            return { success: true as const };
          },
          (error) => {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error.message,
            });
          }
        );
      }),
  },
};
