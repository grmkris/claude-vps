import { ORPCError } from "@orpc/server";
import {
  AgentInboxMetadataSchema,
  AgentInboxNotificationStatus,
  AgentInboxSourceExternalSchema,
  AgentInboxSourceType,
  AgentInboxStatus,
  AgentInboxType,
} from "@vps-claude/db";
import {
  AgentInboxId,
  AgentInboxNotificationId,
  BoxId,
} from "@vps-claude/shared";
import { z } from "zod";

import { boxProcedure } from "../index";
import { SuccessOutput } from "./schemas";

const InboxItemOutput = z.object({
  id: AgentInboxId,
  type: AgentInboxType,
  status: AgentInboxStatus,
  content: z.string(),
  createdAt: z.date(),
  deliveredAt: z.date().nullable(),
  readAt: z.date().nullable(),
  sourceType: AgentInboxSourceType,
  sourceBoxId: BoxId.nullable(),
  sourceExternal: AgentInboxSourceExternalSchema,
  metadata: AgentInboxMetadataSchema.nullable(),
});

const NotificationOutput = z.object({
  id: AgentInboxNotificationId,
  inboxId: AgentInboxId,
  status: AgentInboxNotificationStatus,
  createdAt: z.date(),
  inbox: InboxItemOutput.optional(),
});

export const boxInboxApiRouter = {
  list: boxProcedure
    .route({ method: "GET", path: "/box/inbox" })
    .input(
      z.object({
        type: AgentInboxType.array().optional(),
        status: AgentInboxStatus.optional(),
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
        (items) => ({
          items,
        }),
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
          if (item && item.boxId !== boxRecord.id) {
            throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
          }
          return {
            item,
          };
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

      const itemResult = await context.agentInboxService.getById(input.id);
      if (itemResult.isErr() || !itemResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Inbox item not found" });
      }
      if (itemResult.value.boxId !== boxRecord.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
      }

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
          notifications,
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

      const recipients: { boxId: BoxId; sessionKey?: string }[] = [];
      for (const recipient of input.to) {
        recipients.push({
          boxId: recipient.box as BoxId,
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
