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

async function callAiEndpoint(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // Map tool name to endpoint path
  // BOX_API_URL already includes /box (e.g., http://server:33000/box)
  const endpointMap: Record<string, string> = {
    generate_image: "/ai/generate-image",
    text_to_speech: "/ai/text-to-speech",
    speech_to_text: "/ai/speech-to-text",
  };

  const endpoint = endpointMap[toolName];
  if (!endpoint) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const url = `${env.BOX_API_URL}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Box-Secret": env.BOX_API_TOKEN,
      "ngrok-skip-browser-warning": "true", // Skip ngrok interstitial page
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${response.status}): ${errorText}`);
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: AI_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await callAiEndpoint(name, args ?? {});
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
