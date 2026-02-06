import type { Database, SelectBoxSchema } from "@vps-claude/db";
import type {
  AgentInboxId,
  AgentInboxNotificationId,
  BoxId,
} from "@vps-claude/shared";

import {
  agentInbox,
  agentInboxNotification,
  box,
  boxAgentSettings,
  DEFAULT_DELIVERY_CONFIG,
  type AgentInbox,
  type AgentInboxNotification,
  type BoxAgentSettings,
  type DeliveryConfig,
  type DeliveryMode,
} from "@vps-claude/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";
import { randomBytes } from "node:crypto";

export type AgentInboxServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "BOX_NOT_RUNNING"; message: string }
  | { type: "INBOX_DISABLED"; message: string }
  | { type: "INTERNAL_ERROR"; message: string };

interface AgentInboxServiceDeps {
  db: Database;
}

export type InboxType = "email" | "cron" | "webhook" | "message";

export interface CreateInboxItemInput {
  boxId: BoxId;
  type: InboxType;
  content: string;
  parentId?: AgentInboxId;
  sourceType: "external" | "box" | "system";
  sourceBoxId?: BoxId;
  sourceExternal?: {
    email?: string;
    name?: string;
    webhookUrl?: string;
  };
  metadata?: AgentInbox["metadata"];
}

export interface InboxRecipient {
  boxId: BoxId;
  sessionKey?: string; // "contextType:contextId" format
}

function generateAgentSecret(): string {
  return randomBytes(32).toString("hex");
}

export function createAgentInboxService({
  deps,
}: {
  deps: AgentInboxServiceDeps;
}) {
  const { db } = deps;

  const getSettings = async (
    boxId: BoxId
  ): Promise<Result<BoxAgentSettings | null, AgentInboxServiceError>> => {
    const result = await db.query.boxAgentSettings.findFirst({
      where: eq(boxAgentSettings.boxId, boxId),
    });
    return ok(result ?? null);
  };

  const getOrCreateSettings = async (
    boxId: BoxId
  ): Promise<Result<BoxAgentSettings, AgentInboxServiceError>> => {
    const existingResult = await getSettings(boxId);
    if (existingResult.isErr()) return err(existingResult.error);
    if (existingResult.value) return ok(existingResult.value);

    const result = await db
      .insert(boxAgentSettings)
      .values({
        boxId,
        agentSecret: generateAgentSecret(),
        deliveryConfig: DEFAULT_DELIVERY_CONFIG,
      })
      .returning();

    const created = result[0];
    if (!created) {
      return err({
        type: "INTERNAL_ERROR",
        message: "Failed to create agent settings",
      });
    }

    return ok(created);
  };

  const getDeliveryMode = (
    settings: BoxAgentSettings,
    type: InboxType,
    itemOverride?: boolean
  ): DeliveryMode => {
    if (itemOverride !== undefined) {
      return itemOverride ? "spawn" : "notify";
    }
    const config = settings.deliveryConfig as DeliveryConfig;
    return config[type] ?? DEFAULT_DELIVERY_CONFIG[type];
  };

  const create = async (
    input: CreateInboxItemInput
  ): Promise<Result<AgentInbox, AgentInboxServiceError>> => {
    const result = await db
      .insert(agentInbox)
      .values({
        boxId: input.boxId,
        type: input.type,
        content: input.content,
        parentId: input.parentId,
        sourceType: input.sourceType,
        sourceBoxId: input.sourceBoxId,
        sourceExternal: input.sourceExternal,
        metadata: input.metadata,
        status: "pending",
      })
      .returning();

    const created = result[0];
    if (!created) {
      return err({
        type: "INTERNAL_ERROR",
        message: "Failed to create inbox item",
      });
    }

    return ok(created);
  };

  const createWithNotifications = async (
    input: CreateInboxItemInput,
    recipients: InboxRecipient[]
  ): Promise<
    Result<
      { inbox: AgentInbox; notifications: AgentInboxNotification[] },
      AgentInboxServiceError
    >
  > => {
    const inboxResult = await create(input);
    if (inboxResult.isErr()) return err(inboxResult.error);

    const inbox = inboxResult.value;
    const notificationValues = recipients.map((r) => ({
      inboxId: inbox.id,
      targetBoxId: r.boxId,
      targetSessionKey: r.sessionKey,
      status: "unread" as const,
    }));

    const notifications = await db
      .insert(agentInboxNotification)
      .values(notificationValues)
      .returning();

    return ok({ inbox, notifications });
  };

  const getById = async (
    id: AgentInboxId
  ): Promise<Result<AgentInbox | null, AgentInboxServiceError>> => {
    const result = await db.query.agentInbox.findFirst({
      where: eq(agentInbox.id, id),
    });
    return ok(result ?? null);
  };

  const listByBox = async (
    boxId: BoxId,
    options?: {
      type?: InboxType | InboxType[];
      status?: AgentInbox["status"];
      limit?: number;
    }
  ): Promise<Result<AgentInbox[], AgentInboxServiceError>> => {
    const conditions = [eq(agentInbox.boxId, boxId)];

    if (options?.type) {
      const types = Array.isArray(options.type) ? options.type : [options.type];
      conditions.push(inArray(agentInbox.type, types));
    }

    if (options?.status) {
      conditions.push(eq(agentInbox.status, options.status));
    }

    const items = await db.query.agentInbox.findMany({
      where: and(...conditions),
      orderBy: desc(agentInbox.createdAt),
      limit: options?.limit ?? 50,
    });

    return ok(items);
  };

  const updateStatus = async (
    id: AgentInboxId,
    status: AgentInbox["status"]
  ): Promise<
    Result<{ boxId: BoxId; inboxId: AgentInboxId }, AgentInboxServiceError>
  > => {
    const updates: Partial<AgentInbox> = { status };
    if (status === "delivered") {
      updates.deliveredAt = new Date();
    }
    if (status === "read") {
      updates.readAt = new Date();
    }

    const result = await db
      .update(agentInbox)
      .set(updates)
      .where(eq(agentInbox.id, id))
      .returning();
    const row = result[0];
    if (!row) {
      return err({
        type: "INTERNAL_ERROR",
        message: "Failed to update inbox item",
      });
    }
    return ok({ boxId: row.boxId, inboxId: row.id });
  };

  const markAsRead = async (
    id: AgentInboxId
  ): Promise<
    Result<{ boxId: BoxId; inboxId: AgentInboxId }, AgentInboxServiceError>
  > => {
    return updateStatus(id, "read");
  };

  const getUnreadNotifications = async (
    boxId: BoxId,
    sessionKey?: string
  ): Promise<Result<AgentInboxNotification[], AgentInboxServiceError>> => {
    const conditions = [
      eq(agentInboxNotification.targetBoxId, boxId),
      eq(agentInboxNotification.status, "unread"),
    ];

    if (sessionKey) {
      conditions.push(eq(agentInboxNotification.targetSessionKey, sessionKey));
    }

    const notifications = await db.query.agentInboxNotification.findMany({
      where: and(...conditions),
      with: {
        inbox: true,
      },
      orderBy: desc(agentInboxNotification.createdAt),
    });

    return ok(notifications);
  };

  const markNotificationRead = async (
    notificationId: AgentInboxNotificationId
  ): Promise<Result<void, AgentInboxServiceError>> => {
    await db
      .update(agentInboxNotification)
      .set({ status: "read", readAt: new Date() })
      .where(eq(agentInboxNotification.id, notificationId));
    return ok(undefined);
  };

  const markNotificationReadByInboxId = async (
    inboxId: AgentInboxId,
    boxId: BoxId
  ): Promise<Result<void, AgentInboxServiceError>> => {
    await db
      .update(agentInboxNotification)
      .set({ status: "read", readAt: new Date() })
      .where(
        and(
          eq(agentInboxNotification.inboxId, inboxId),
          eq(agentInboxNotification.targetBoxId, boxId)
        )
      );
    return ok(undefined);
  };

  const getBoxByAgentSecret = async (
    agentSecret: string
  ): Promise<Result<SelectBoxSchema | null, AgentInboxServiceError>> => {
    const settings = await db.query.boxAgentSettings.findFirst({
      where: eq(boxAgentSettings.agentSecret, agentSecret),
    });

    if (!settings?.boxId) return ok(null);

    const boxResult = await db.query.box.findFirst({
      where: eq(box.id, settings.boxId),
    });

    return ok(boxResult ?? null);
  };

  const processInbound = async (
    subdomain: string,
    type: InboxType,
    content: string,
    options: {
      sourceType: "external" | "box" | "system";
      sourceBoxId?: BoxId;
      sourceExternal?: CreateInboxItemInput["sourceExternal"];
      metadata?: AgentInbox["metadata"];
      sessionKey?: string; // Target specific session
    }
  ): Promise<
    Result<
      {
        inbox: AgentInbox;
        settings: BoxAgentSettings;
        deliveryMode: DeliveryMode;
      },
      AgentInboxServiceError
    >
  > => {
    // Find box by subdomain
    const boxResult = await db.query.box.findFirst({
      where: eq(box.subdomain, subdomain),
    });

    if (!boxResult) {
      return err({ type: "NOT_FOUND", message: "Box not found" });
    }

    if (boxResult.status !== "running") {
      return err({ type: "BOX_NOT_RUNNING", message: "Box is not running" });
    }

    if (!boxResult.instanceUrl) {
      return err({
        type: "BOX_NOT_RUNNING",
        message: "Box not ready (no instance URL)",
      });
    }

    // Get or create settings
    const settingsResult = await getOrCreateSettings(boxResult.id);
    if (settingsResult.isErr()) return err(settingsResult.error);

    const settings = settingsResult.value;
    if (!settings.enabled) {
      return err({
        type: "INBOX_DISABLED",
        message: "Inbox is disabled for this box",
      });
    }

    // Create inbox item with notification
    const result = await createWithNotifications(
      {
        boxId: boxResult.id,
        type,
        content,
        sourceType: options.sourceType,
        sourceBoxId: options.sourceBoxId,
        sourceExternal: options.sourceExternal,
        metadata: options.metadata,
      },
      [{ boxId: boxResult.id, sessionKey: options.sessionKey }]
    );

    if (result.isErr()) return err(result.error);

    const deliveryMode = getDeliveryMode(
      settings,
      type,
      options.metadata?.spawnSession
    );

    return ok({
      inbox: result.value.inbox,
      settings,
      deliveryMode,
    });
  };

  const sendMessage = async (
    senderBoxId: BoxId,
    recipients: InboxRecipient[],
    content: string,
    options?: {
      title?: string;
      parentId?: AgentInboxId;
    }
  ): Promise<Result<AgentInbox, AgentInboxServiceError>> => {
    // Get sender box info
    const senderBox = await db.query.box.findFirst({
      where: eq(box.id, senderBoxId),
    });

    if (!senderBox) {
      return err({ type: "NOT_FOUND", message: "Sender box not found" });
    }

    const uniqueBoxIds = [...new Set(recipients.map((r) => r.boxId))];

    const results: AgentInbox[] = [];

    for (const targetBoxId of uniqueBoxIds) {
      const recipientsForBox = recipients.filter(
        (r) => r.boxId === targetBoxId
      );

      const result = await createWithNotifications(
        {
          boxId: targetBoxId,
          type: "message",
          content,
          parentId: options?.parentId,
          sourceType: "box",
          sourceBoxId: senderBoxId,
          metadata: {
            title: options?.title,
          },
        },
        recipientsForBox
      );

      if (result.isErr()) return err(result.error);
      results.push(result.value.inbox);
    }

    return ok(results[0]!);
  };

  return {
    getSettings,
    getOrCreateSettings,
    getDeliveryMode,
    getBoxByAgentSecret,
    updateSettings: async (
      boxId: BoxId,
      updates: Partial<
        Pick<
          BoxAgentSettings,
          "enabled" | "identityName" | "notificationMode" | "deliveryConfig"
        >
      >
    ): Promise<Result<BoxAgentSettings, AgentInboxServiceError>> => {
      const settingsResult = await getSettings(boxId);
      if (settingsResult.isErr()) return err(settingsResult.error);
      if (!settingsResult.value) {
        return err({ type: "NOT_FOUND", message: "Settings not found" });
      }

      const result = await db
        .update(boxAgentSettings)
        .set(updates)
        .where(eq(boxAgentSettings.boxId, boxId))
        .returning();

      return ok(result[0]!);
    },

    create,
    createWithNotifications,
    getById,
    listByBox,
    updateStatus,
    markAsRead,

    getUnreadNotifications,
    markNotificationRead,
    markNotificationReadByInboxId,

    processInbound,
    sendMessage,

    getInboxWithNotifications: async (
      boxId: BoxId,
      options?: { type?: InboxType | InboxType[]; limit?: number }
    ): Promise<
      Result<
        (AgentInbox & { notification?: AgentInboxNotification })[],
        AgentInboxServiceError
      >
    > => {
      const items = await db.query.agentInbox.findMany({
        where: options?.type
          ? and(
              eq(agentInbox.boxId, boxId),
              inArray(
                agentInbox.type,
                Array.isArray(options.type) ? options.type : [options.type]
              )
            )
          : eq(agentInbox.boxId, boxId),
        orderBy: desc(agentInbox.createdAt),
        limit: options?.limit ?? 50,
        with: {
          notifications: {
            where: eq(agentInboxNotification.targetBoxId, boxId),
            limit: 1,
          },
        },
      });

      return ok(
        items.map((item) => ({
          ...item,
          notification: item.notifications[0],
        }))
      );
    },
  };
}

export type AgentInboxService = ReturnType<typeof createAgentInboxService>;
