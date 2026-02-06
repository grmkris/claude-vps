import { ORPCError } from "@orpc/server";
import { AgentInboxId, BoxCronjobId, BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";

const InboxTypeEnum = z.enum(["email", "cron", "webhook", "message"]);
const InboxStatusEnum = z.enum(["pending", "delivered", "read"]);

const InboxMetadataOutput = z
  .object({
    // Email
    emailMessageId: z.string().optional(),
    from: z
      .object({ email: z.string(), name: z.string().optional() })
      .optional(),
    to: z.string().optional(),
    subject: z.string().optional(),
    htmlBody: z.string().optional(),
    inReplyTo: z.string().optional(),
    // Cron
    cronJobId: BoxCronjobId.optional(),
    cronSchedule: z.string().optional(),
    // Webhook
    webhookId: z.string().optional(),
    webhookPayload: z.record(z.string(), z.unknown()).optional(),
    callbackUrl: z.string().optional(),
    // Message
    title: z.string().optional(),
    // Delivery override
    spawnSession: z.boolean().optional(),
  })
  .nullable();

const InboxItemOutput = z.object({
  id: AgentInboxId,
  boxId: BoxId,
  type: InboxTypeEnum,
  status: InboxStatusEnum,
  content: z.string(),
  createdAt: z.date(),
  deliveredAt: z.date().nullable(),
  readAt: z.date().nullable(),
  sourceType: z.enum(["external", "box", "system"]),
  sourceBoxId: z.string().nullable(),
  sourceExternal: z
    .object({
      email: z.string().optional(),
      name: z.string().optional(),
      webhookUrl: z.string().optional(),
    })
    .nullable(),
  metadata: InboxMetadataOutput,
});

export const agentInboxRouter = {
  listByBox: protectedProcedure
    .route({ method: "GET", path: "/rpc/inbox/{boxId}" })
    .input(
      z.object({
        boxId: BoxId,
        type: InboxTypeEnum.array().optional(),
        status: InboxStatusEnum.optional(),
        limit: z.number().min(1).max(100).optional(),
      })
    )
    .output(z.object({ items: z.array(InboxItemOutput) }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "inbox.listByBox",
        boxId: input.boxId,
        type: input.type,
      });

      const boxResult = await context.boxService.getById(input.boxId);
      if (boxResult.isErr() || !boxResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (boxResult.value.userId !== context.session?.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
      }

      const result = await context.agentInboxService.listByBox(input.boxId, {
        type: input.type?.[0],
        status: input.status,
        limit: input.limit,
      });

      if (result.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.error.message,
        });
      }
      return { items: result.value };
    }),

  get: protectedProcedure
    .route({ method: "GET", path: "/rpc/inbox/item/{id}" })
    .input(z.object({ id: AgentInboxId }))
    .output(z.object({ item: InboxItemOutput.nullable() }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "inbox.get", inboxId: input.id });

      const result = await context.agentInboxService.getById(input.id);

      if (result.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.error.message,
        });
      }
      return { item: result.value ?? null };
    }),

  markRead: protectedProcedure
    .route({ method: "POST", path: "/rpc/inbox/item/{id}/read" })
    .input(z.object({ id: AgentInboxId }))
    .output(z.object({ boxId: BoxId, inboxId: AgentInboxId }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "inbox.markRead", inboxId: input.id });

      const result = await context.agentInboxService.markAsRead(input.id);

      if (result.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.error.message,
        });
      }
      return { boxId: result.value.boxId, inboxId: result.value.inboxId };
    }),

  getUnreadCounts: protectedProcedure
    .route({ method: "GET", path: "/rpc/inbox/{boxId}/counts" })
    .input(z.object({ boxId: BoxId }))
    .output(
      z.object({
        counts: z.object({
          email: z.number(),
          cron: z.number(),
          webhook: z.number(),
          message: z.number(),
          total: z.number(),
        }),
      })
    )
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "inbox.getUnreadCounts",
        boxId: input.boxId,
      });

      const boxResult = await context.boxService.getById(input.boxId);
      if (boxResult.isErr() || !boxResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (boxResult.value.userId !== context.session?.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
      }

      const result = await context.agentInboxService.listByBox(input.boxId, {
        status: "pending",
        limit: 100,
      });

      if (result.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.error.message,
        });
      }

      const items = result.value;
      const counts = {
        email: items.filter((i) => i.type === "email").length,
        cron: items.filter((i) => i.type === "cron").length,
        webhook: items.filter((i) => i.type === "webhook").length,
        message: items.filter((i) => i.type === "message").length,
        total: items.length,
      };

      return { counts };
    }),
};
