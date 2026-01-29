import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { env } from "../env";
import { logger } from "../logger";
import { protectedProcedure, publicProcedure } from "../procedures";
import { runWithSession } from "../utils/agent";
import {
  archiveEmail,
  buildEmailPrompt,
  InboundEmailSchema,
  listEmails,
  readEmail,
  writeEmailToInbox,
} from "../utils/inbox";

export const emailRouter = {
  receive: protectedProcedure
    .route({ method: "POST", path: "/email/receive" })
    .input(InboundEmailSchema)
    .output(z.object({ success: z.boolean(), filepath: z.string() }))
    .handler(async ({ input }) => {
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

  send: publicProcedure
    .route({ method: "POST", path: "/email/send" })
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
    .output(z.object({ success: z.boolean() }))
    .handler(async ({ input }) => {
      // Box identity is derived from BOX_API_TOKEN on server side (per-box auth)
      const response = await fetch(`${env.BOX_API_URL}/email/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Box-Secret": env.BOX_API_TOKEN,
        },
        body: JSON.stringify({
          to: input.to,
          subject: input.subject,
          body: input.body,
          inReplyTo: input.inReplyTo,
        }),
      });

      if (!response.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to send email",
        });
      }

      return { success: true };
    }),

  list: publicProcedure
    .route({ method: "GET", path: "/email/list" })
    .output(z.object({ emails: z.array(z.string()) }))
    .handler(async () => {
      const emails = await listEmails();
      return { emails };
    }),

  byId: publicProcedure
    .route({ method: "GET", path: "/email/{id}" })
    .input(z.object({ id: z.string() }))
    .output(InboundEmailSchema.nullable())
    .handler(async ({ input }) => {
      const email = await readEmail(input.id);
      if (!email) {
        throw new ORPCError("NOT_FOUND", { message: "Email not found" });
      }
      return email;
    }),

  markRead: publicProcedure
    .route({ method: "POST", path: "/email/{id}/read" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .handler(async ({ input }) => {
      const success = await archiveEmail(input.id);
      if (!success) {
        throw new ORPCError("NOT_FOUND", { message: "Email not found" });
      }
      return { success: true };
    }),
};
