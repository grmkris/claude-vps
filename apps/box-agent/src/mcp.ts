/**
 * MCP Server for Box Agent Tools
 *
 * When box-agent is run with `mcp` subcommand, it serves MCP over stdio.
 * This allows Claude to discover and use tools via the MCP protocol.
 *
 * Tools:
 * - AI: generate_image, text_to_speech, speech_to_text
 * - Cronjob: cronjob_list, cronjob_create, cronjob_update, cronjob_delete, cronjob_toggle
 * - Email: email_send, email_list, email_read
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { env } from "./env";

const AI_TOOLS = [
  {
    name: "generate_image",
    description:
      "Generate an image from a text prompt using AI. Returns a URL to the generated image.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Text description of the image to generate",
        },
        width: {
          type: "number",
          description: "Image width in pixels (256-2048, default 1024)",
        },
        height: {
          type: "number",
          description: "Image height in pixels (256-2048, default 1024)",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "text_to_speech",
    description:
      "Convert text to speech audio using AI. Returns a URL or base64 data URL of the audio.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "Text to convert to speech",
        },
        voice: {
          type: "string",
          description:
            "Voice ID to use (optional, uses default if not specified)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "speech_to_text",
    description:
      "Transcribe audio to text using AI. Accepts a URL to an audio file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        audioUrl: {
          type: "string",
          description: "URL to the audio file to transcribe",
        },
        language: {
          type: "string",
          description:
            "Language code (e.g., 'en-US', 'es', 'fr'). Auto-detected if not specified.",
        },
      },
      required: ["audioUrl"],
    },
  },
];

const EMAIL_TOOLS = [
  {
    name: "email_send",
    description:
      "Send an email with markdown formatting. The body supports **bold**, *italic*, lists, links, headers, and code blocks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description:
            "Email body content. Supports markdown formatting: **bold**, *italic*, # headers, - lists, [links](url), `code`",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "email_list",
    description: "List all emails in the inbox",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "email_read",
    description: "Read an email by its ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The email ID (filename without .json extension)",
        },
      },
      required: ["id"],
    },
  },
];

const CRONJOB_TOOLS = [
  {
    name: "cronjob_list",
    description: "List all scheduled cronjobs for this box",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "cronjob_create",
    description: "Create a scheduled task that runs Claude with a prompt",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the cronjob (e.g., 'Daily backup')",
        },
        schedule: {
          type: "string",
          description:
            "Cron expression (e.g., '0 9 * * *' for 9am daily, '*/5 * * * *' for every 5 min)",
        },
        prompt: {
          type: "string",
          description: "What Claude should do when the cronjob triggers",
        },
      },
      required: ["name", "schedule", "prompt"],
    },
  },
  {
    name: "cronjob_update",
    description: "Update a cronjob's schedule, prompt, or enabled status",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The cronjob ID to update",
        },
        name: {
          type: "string",
          description: "New name for the cronjob",
        },
        schedule: {
          type: "string",
          description: "New cron expression",
        },
        prompt: {
          type: "string",
          description: "New prompt for Claude to execute",
        },
        enabled: {
          type: "boolean",
          description: "Enable or disable the cronjob",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "cronjob_delete",
    description: "Delete a cronjob",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The cronjob ID to delete",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "cronjob_toggle",
    description:
      "Toggle a cronjob's enabled status (enable if disabled, disable if enabled)",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The cronjob ID to toggle",
        },
      },
      required: ["id"],
    },
  },
];

interface EndpointConfig {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  local?: boolean; // If true, use local box-agent server instead of BOX_API_URL
}

async function callApiEndpoint(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // Map tool name to endpoint path and method
  // BOX_API_URL already includes /box (e.g., http://server:33000/box)
  // Local endpoints use localhost:BOX_AGENT_PORT (box-agent's own server)
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

  // Use local box-agent server for email, remote BOX_API_URL for others
  const baseUrl = config.local
    ? `http://localhost:${env.BOX_AGENT_PORT}`
    : env.BOX_API_URL;
  const url = `${baseUrl}${config.path}`;

  const response = await fetch(url, {
    method: config.method,
    headers: {
      "Content-Type": "application/json",
      "X-Box-Secret": env.BOX_API_TOKEN,
      "ngrok-skip-browser-warning": "true", // Skip ngrok interstitial page
    },
    body: config.method !== "GET" ? JSON.stringify(args) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function startMcpServer() {
  const server = new Server(
    {
      name: "ai-tools",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const allTools = [...AI_TOOLS, ...CRONJOB_TOOLS, ...EMAIL_TOOLS];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await callApiEndpoint(name, args ?? {});
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP protocol on stdout
  console.error("AI Tools MCP server started");
}
