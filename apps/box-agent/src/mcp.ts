/**
 * MCP Server for Box Agent Tools
 *
 * Provides tools via MCP protocol:
 * - AI: generate_image, text_to_speech, speech_to_text
 * - Cronjob: cronjob_list, cronjob_create, cronjob_update, cronjob_delete, cronjob_toggle
 * - Email: email_send
 * - Inbox: list, send, reply, mark_read (unified inbox for all message types)
 *
 * Supports both stdio (Claude SDK) and HTTP (inspector, remote) transports.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentInboxId, BoxCronjobId } from "@vps-claude/shared";
import { z } from "zod";

import { boxApi } from "./box-api-client";
import {
  countUnreadByType,
  formatNotificationSummary,
  type InboxType,
} from "./utils/agent-inbox";

function toolResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Create a configured MCP server.
 * Used by both stdio mode (Claude SDK) and HTTP mode (inspector, remote access).
 */
export function createMcpServer() {
  const server = new McpServer({
    name: "agent-tools",
    version: "2.0.0",
  });

  // ===== AI Tools (via boxApi.ai.*) =====

  server.registerTool(
    "generate_image",
    {
      description:
        "Generate an image from a text prompt using AI. Returns a URL to the generated image.",
      inputSchema: z.object({
        prompt: z
          .string()
          .describe("Text description of the image to generate"),
        width: z
          .number()
          .optional()
          .describe("Image width in pixels (256-2048, default 1024)"),
        height: z
          .number()
          .optional()
          .describe("Image height in pixels (256-2048, default 1024)"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.ai.generateImage(args);
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "text_to_speech",
    {
      description:
        "Convert text to speech audio using AI. Returns a URL or base64 data URL of the audio.",
      inputSchema: z.object({
        text: z.string().describe("Text to convert to speech"),
        voice: z
          .string()
          .optional()
          .describe(
            "Voice ID to use (optional, uses default if not specified)"
          ),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.ai.textToSpeech(args);
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "speech_to_text",
    {
      description:
        "Transcribe audio to text using AI. Accepts a URL to an audio file.",
      inputSchema: z.object({
        audioUrl: z.string().describe("URL to the audio file to transcribe"),
        language: z
          .string()
          .optional()
          .describe(
            "Language code (e.g., 'en-US', 'es', 'fr'). Auto-detected if not specified."
          ),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.ai.speechToText(args);
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ===== Email Tools (local functions + boxApi.email.send) =====

  server.registerTool(
    "email_send",
    {
      description:
        "Send an email with markdown formatting. The body supports **bold**, *italic*, lists, links, headers, and code blocks. When replying to an email, include inReplyTo with the original messageId for proper email threading.",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject line"),
        body: z
          .string()
          .describe(
            "Email body content. Supports markdown formatting: **bold**, *italic*, # headers, - lists, [links](url), `code`"
          ),
        inReplyTo: z
          .object({
            messageId: z
              .string()
              .describe("The messageId of the email being replied to"),
          })
          .optional()
          .describe("Include when replying to an email to maintain threading"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.email.send({
          to: args.to,
          subject: args.subject,
          body: args.body,
          inReplyTo: args.inReplyTo
            ? {
                messageId: args.inReplyTo.messageId,
                from: args.to,
                subject: args.subject,
              }
            : undefined,
        });
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ===== Inbox Tools (unified inbox for all message types) =====

  server.registerTool(
    "list",
    {
      description:
        "List inbox items (emails, cron triggers, webhooks, messages). Items are stored in ~/.agent-inbox/{type}/. You can also use 'ls ~/.agent-inbox/' and 'cat' to browse directly.",
      inputSchema: z.object({
        type: z
          .array(z.enum(["email", "cron", "webhook", "message"]))
          .optional()
          .describe("Filter by type(s). Omit to list all types."),
        status: z
          .enum(["pending", "delivered", "read"])
          .optional()
          .describe("Filter by status"),
        limit: z.number().optional().describe("Maximum items to return"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.inbox.list({
          type: args.type as InboxType[] | undefined,
          status: args.status,
          limit: args.limit,
        });
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "send",
    {
      description:
        "Send a message to another agent/box. Use this for inter-agent communication (NOT for sending emails - use email_send for that).",
      inputSchema: z.object({
        to: z
          .array(
            z.object({
              box: z.string().describe("Target box subdomain"),
              session: z
                .string()
                .optional()
                .describe("Target specific session (contextType:contextId)"),
            })
          )
          .describe("Recipients - one or more boxes/sessions"),
        content: z.string().describe("Message content (markdown supported)"),
        title: z.string().optional().describe("Optional message title"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.inbox.send({
          to: args.to,
          content: args.content,
          title: args.title,
        });
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "reply",
    {
      description:
        "Reply to an inbox item. For emails, this sends an email reply. For messages, this creates a linked message.",
      inputSchema: z.object({
        inboxId: z.string().describe("ID of the inbox item to reply to"),
        content: z.string().describe("Reply content"),
      }),
    },
    async (args) => {
      try {
        // First get the original item to determine type
        const itemResult = await boxApi.inbox.get({
          id: AgentInboxId.parse(args.inboxId),
        });

        if (!itemResult.item) {
          throw new Error(`Inbox item not found: ${args.inboxId}`);
        }

        const item = itemResult.item;

        // Route based on type
        if (item.type === "email" && item.metadata) {
          // Reply via email
          const metadata = item.metadata as {
            emailMessageId?: string;
            subject?: string;
          };
          const sourceExternal = item.sourceExternal as {
            email?: string;
          } | null;

          if (!sourceExternal?.email) {
            throw new Error("Cannot reply to email: missing sender address");
          }

          const result = await boxApi.email.send({
            to: sourceExternal.email,
            subject: `Re: ${metadata.subject || ""}`,
            body: args.content,
            inReplyTo: metadata.emailMessageId
              ? {
                  messageId: metadata.emailMessageId,
                  from: sourceExternal.email,
                  subject: metadata.subject || "",
                }
              : undefined,
          });
          return toolResult({ ...result, replyType: "email" });
        }

        // For messages, create a linked message
        const result = await boxApi.inbox.send({
          to: [{ box: item.sourceBoxId as string }],
          content: args.content,
          parentId: AgentInboxId.parse(args.inboxId),
        });
        return toolResult({ ...result, replyType: "message" });
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "mark_read",
    {
      description: "Mark an inbox item as read",
      inputSchema: z.object({
        inboxId: z.string().describe("ID of the inbox item to mark as read"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.inbox.markRead({
          id: AgentInboxId.parse(args.inboxId),
        });
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "notifications_check",
    {
      description:
        "Check for unread notifications. Returns a summary of new items in your inbox.",
      inputSchema: z.object({
        sessionKey: z
          .string()
          .optional()
          .describe("Filter notifications for a specific session"),
      }),
    },
    async (args) => {
      try {
        // Get counts from local filesystem
        const counts = await countUnreadByType();
        const summary = formatNotificationSummary(counts);

        // Also get from server for any pending notifications
        const serverNotifications = await boxApi.inbox.notifications({
          sessionKey: args.sessionKey,
        });

        return toolResult({
          summary: summary || "No new items.",
          counts,
          serverNotifications: serverNotifications.notifications,
        });
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // ===== Cronjob Tools (via boxApi.cronjob.*) =====

  server.registerTool(
    "cronjob_list",
    {
      description: "List all scheduled cronjobs for this box",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await boxApi.cronjob.list({});
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "cronjob_create",
    {
      description: "Create a scheduled task that runs Claude with a prompt",
      inputSchema: z.object({
        name: z.string().describe("Name of the cronjob (e.g., 'Daily backup')"),
        schedule: z
          .string()
          .describe(
            "Cron expression (e.g., '0 9 * * *' for 9am daily, '*/5 * * * *' for every 5 min)"
          ),
        prompt: z
          .string()
          .describe("What Claude should do when the cronjob triggers"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.cronjob.create(args);
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "cronjob_update",
    {
      description: "Update a cronjob's schedule, prompt, or enabled status",
      inputSchema: z.object({
        id: z.string().describe("The cronjob ID to update"),
        name: z.string().optional().describe("New name for the cronjob"),
        schedule: z.string().optional().describe("New cron expression"),
        prompt: z
          .string()
          .optional()
          .describe("New prompt for Claude to execute"),
        enabled: z
          .boolean()
          .optional()
          .describe("Enable or disable the cronjob"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.cronjob.update({
          ...args,
          id: BoxCronjobId.parse(args.id),
        });
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "cronjob_delete",
    {
      description: "Delete a cronjob",
      inputSchema: z.object({
        id: z.string().describe("The cronjob ID to delete"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.cronjob.delete({
          id: BoxCronjobId.parse(args.id),
        });
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "cronjob_toggle",
    {
      description:
        "Toggle a cronjob's enabled status (enable if disabled, disable if enabled)",
      inputSchema: z.object({
        id: z.string().describe("The cronjob ID to toggle"),
      }),
    },
    async (args) => {
      try {
        const result = await boxApi.cronjob.toggle({
          id: BoxCronjobId.parse(args.id),
        });
        return toolResult(result);
      } catch (e) {
        return toolError(e);
      }
    }
  );

  return server;
}

/**
 * Start MCP server over stdio (for Claude SDK subprocess spawning).
 */
export async function startMcpServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP protocol on stdout
  console.error("Agent Tools MCP server started");
}
