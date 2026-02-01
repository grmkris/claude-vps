/**
 * MCP Server for Box Agent Tools
 *
 * Provides tools via MCP protocol:
 * - AI: generate_image, text_to_speech, speech_to_text
 * - Cronjob: cronjob_list, cronjob_create, cronjob_update, cronjob_delete, cronjob_toggle
 * - Email: email_send, email_list, email_read
 *
 * Supports both stdio (Claude SDK) and HTTP (inspector, remote) transports.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { env } from "./env";

interface EndpointConfig {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  local?: boolean;
}

async function callApiEndpoint(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const endpointMap: Record<string, EndpointConfig> = {
    // AI tools (remote - main API server)
    generate_image: { path: "/ai/generate-image", method: "POST" },
    text_to_speech: { path: "/ai/text-to-speech", method: "POST" },
    speech_to_text: { path: "/ai/speech-to-text", method: "POST" },
    // Cronjob tools (remote - main API server)
    cronjob_list: { path: "/cronjobs", method: "GET" },
    cronjob_create: { path: "/cronjobs", method: "POST" },
    cronjob_update: { path: `/cronjobs/${String(args.id)}`, method: "PUT" },
    cronjob_delete: { path: `/cronjobs/${String(args.id)}`, method: "DELETE" },
    cronjob_toggle: {
      path: `/cronjobs/${String(args.id)}/toggle`,
      method: "POST",
    },
    // Email tools (local - box-agent server)
    email_send: { path: "/rpc/email/send", method: "POST", local: true },
    email_list: { path: "/rpc/email/list", method: "GET", local: true },
    email_read: {
      path: `/rpc/email/${String(args.id)}`,
      method: "GET",
      local: true,
    },
  };

  const config = endpointMap[toolName];
  if (!config) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const baseUrl = config.local
    ? `http://localhost:${env.BOX_AGENT_PORT}`
    : env.BOX_API_URL;
  const url = `${baseUrl}${config.path}`;

  const response = await fetch(url, {
    method: config.method,
    headers: {
      "Content-Type": "application/json",
      "X-Box-Secret": env.BOX_API_TOKEN,
      "ngrok-skip-browser-warning": "true",
    },
    body: config.method !== "GET" ? JSON.stringify(args) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

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
    name: "ai-tools",
    version: "1.0.0",
  });

  // AI Tools
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
        return toolResult(await callApiEndpoint("generate_image", args));
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
        return toolResult(await callApiEndpoint("text_to_speech", args));
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
        return toolResult(await callApiEndpoint("speech_to_text", args));
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // Email Tools
  server.registerTool(
    "email_send",
    {
      description:
        "Send an email with markdown formatting. The body supports **bold**, *italic*, lists, links, headers, and code blocks.",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject line"),
        body: z
          .string()
          .describe(
            "Email body content. Supports markdown formatting: **bold**, *italic*, # headers, - lists, [links](url), `code`"
          ),
      }),
    },
    async (args) => {
      try {
        return toolResult(await callApiEndpoint("email_send", args));
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "email_list",
    {
      description: "List all emails in the inbox",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return toolResult(await callApiEndpoint("email_list", {}));
      } catch (e) {
        return toolError(e);
      }
    }
  );

  server.registerTool(
    "email_read",
    {
      description: "Read an email by its ID",
      inputSchema: z.object({
        id: z
          .string()
          .describe("The email ID (filename without .json extension)"),
      }),
    },
    async (args) => {
      try {
        return toolResult(await callApiEndpoint("email_read", args));
      } catch (e) {
        return toolError(e);
      }
    }
  );

  // Cronjob Tools
  server.registerTool(
    "cronjob_list",
    {
      description: "List all scheduled cronjobs for this box",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return toolResult(await callApiEndpoint("cronjob_list", {}));
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
        return toolResult(await callApiEndpoint("cronjob_create", args));
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
        return toolResult(await callApiEndpoint("cronjob_update", args));
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
        return toolResult(await callApiEndpoint("cronjob_delete", args));
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
        return toolResult(await callApiEndpoint("cronjob_toggle", args));
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
  console.error("AI Tools MCP server started");
}
