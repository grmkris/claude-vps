/**
 * MCP Server for AI Tools
 *
 * When box-agent is run with `mcp` subcommand, it serves MCP over stdio.
 * This allows Claude to discover and use AI tools via the MCP protocol.
 *
 * Tools:
 * - generate_image: Generate images from text prompts
 * - text_to_speech: Convert text to audio
 * - speech_to_text: Transcribe audio to text
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
        description: {
          type: "string",
          description: "Optional description of what this cronjob does",
        },
        timezone: {
          type: "string",
          description: "Timezone for the schedule (default: UTC)",
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
];

interface EndpointConfig {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
}

async function callApiEndpoint(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // Map tool name to endpoint path and method
  // BOX_API_URL already includes /box (e.g., http://server:33000/box)
  const endpointMap: Record<string, EndpointConfig> = {
    // AI tools
    generate_image: { path: "/ai/generate-image", method: "POST" },
    text_to_speech: { path: "/ai/text-to-speech", method: "POST" },
    speech_to_text: { path: "/ai/speech-to-text", method: "POST" },
    // Cronjob tools
    cronjob_list: { path: "/cronjobs", method: "GET" },
    cronjob_create: { path: "/cronjobs", method: "POST" },
    cronjob_update: { path: `/cronjobs/${String(args.id)}`, method: "PUT" },
    cronjob_delete: { path: `/cronjobs/${String(args.id)}`, method: "DELETE" },
  };

  const config = endpointMap[toolName];
  if (!config) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const url = `${env.BOX_API_URL}${config.path}`;
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

  const allTools = [...AI_TOOLS, ...CRONJOB_TOOLS];

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
