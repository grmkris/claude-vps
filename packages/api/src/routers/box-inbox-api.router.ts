import { ORPCError } from "@orpc/server";
import { AgentInboxId, BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { boxProcedure } from "../index";
import { SuccessOutput } from "./schemas";

// Schemas for inbox
const InboxTypeEnum = z.enum(["email", "cron", "webhook", "message"]);
const InboxStatusEnum = z.enum(["pending", "delivered", "read"]);

const InboxItemOutput = z.object({
  id: z.string(),
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
  metadata: z.unknown().nullable(),
});

const NotificationOutput = z.object({
  id: z.string(),
  inboxId: z.string(),
  status: z.enum(["unread", "read"]),
  createdAt: z.date(),
  inbox: InboxItemOutput.optional(),
});

export const boxInboxApiRouter = {
  list: boxProcedure
    .route({ method: "GET", path: "/box/inbox" })
    .input(
      z.object({
        type: InboxTypeEnum.array().optional(),
        status: InboxStatusEnum.optional(),
        limit: z.number().min(1).max(100).optional(),
      })
    )
    .output(z.object({ items: z.array(InboxItemOutput) }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.inbox.list", type: input.type });
      const boxResult = await context.agentInboxService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", { message: "Invalid box token" });
      }

      const result = await context.agentInboxService.listByBox(boxRecord.id, {
        type: input.type?.[0],
        status: input.status,
        limit: input.limit,
      });

      return result.match(
        (items) => ({ items: items as z.infer<typeof InboxItemOutput>[] }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  get: boxProcedure
    .route({ method: "GET", path: "/box/inbox/{id}" })
    .input(z.object({ id: AgentInboxId }))
    .output(z.object({ item: InboxItemOutput.nullable() }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.inbox.get", inboxId: input.id });
      const boxResult = await context.agentInboxService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", { message: "Invalid box token" });
      }

      const result = await context.agentInboxService.getById(input.id);

      return result.match(
        (item) => {
          // Verify item belongs to this box
          if (item && item.boxId !== boxRecord.id) {
            throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
          }
          return { item: item as z.infer<typeof InboxItemOutput> | null };
        },
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  markRead: boxProcedure
    .route({ method: "POST", path: "/box/inbox/{id}/read" })
    .input(z.object({ id: AgentInboxId }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.inbox.markRead", inboxId: input.id });
      const boxResult = await context.agentInboxService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", { message: "Invalid box token" });
      }

      // Verify item exists and belongs to this box
      const itemResult = await context.agentInboxService.getById(input.id);
      if (itemResult.isErr() || !itemResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Inbox item not found" });
      }
      if (itemResult.value.boxId !== boxRecord.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
      }

      // Mark the item and its notifications as read
      await context.agentInboxService.markAsRead(input.id);
      await context.agentInboxService.markNotificationReadByInboxId(
        input.id,
        boxRecord.id
      );

      return { success: true as const };
    }),

  notifications: boxProcedure
    .route({ method: "GET", path: "/box/inbox/notifications" })
    .input(z.object({ sessionKey: z.string().optional() }))
    .output(z.object({ notifications: z.array(NotificationOutput) }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.inbox.notifications" });
      const boxResult = await context.agentInboxService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", { message: "Invalid box token" });
      }

      const result = await context.agentInboxService.getUnreadNotifications(
        boxRecord.id,
        input.sessionKey
      );

      return result.match(
        (notifications) => ({
          notifications: notifications as z.infer<typeof NotificationOutput>[],
        }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  send: boxProcedure
    .route({ method: "POST", path: "/box/inbox/send" })
    .input(
      z.object({
        to: z.array(
          z.object({
            box: z.string(),
            session: z.string().optional(),
          })
        ),
        content: z.string(),
        title: z.string().optional(),
        parentId: AgentInboxId.optional(),
      })
    )
    .output(z.object({ inboxId: z.string() }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.inbox.send",
        recipientCount: input.to.length,
      });
      const boxResult = await context.agentInboxService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", { message: "Invalid box token" });
      }

      // Resolve box subdomains to box IDs
      const recipients: { boxId: BoxId; sessionKey?: string }[] = [];
      for (const recipient of input.to) {
        // For now, recipient.box is the subdomain - would need to resolve to BoxId
        // This would require a lookup, simplified here
        recipients.push({
          boxId: recipient.box as BoxId, // TODO: Resolve subdomain to BoxId
          sessionKey: recipient.session,
        });
      }

      const result = await context.agentInboxService.sendMessage(
        boxRecord.id,
        recipients,
        input.content,
        { title: input.title, parentId: input.parentId }
      );

      return result.match(
        (inbox) => ({ inboxId: inbox.id }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),
};
