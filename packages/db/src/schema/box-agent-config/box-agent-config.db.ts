import {
  type BoxAgentConfigId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { box } from "../box";

export const triggerTypeEnum = pgEnum("trigger_type", [
  "email",
  "cron",
  "webhook",
  "manual",
  "default",
]);

export interface McpServerConfigStdio {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerConfigSse {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpServerConfigStdio | McpServerConfigSse;

export interface AgentDefinition {
  name: string;
  description: string;
  tools?: string[];
}

export const boxAgentConfig = pgTable(
  "box_agent_config",
  {
    id: typeId("boxAgentConfig", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxAgentConfig"))
      .$type<BoxAgentConfigId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .$type<BoxId>(),

    // Trigger type - allows multiple configs per box
    triggerType: triggerTypeEnum("trigger_type").notNull().default("default"),

    // Optional friendly name for UI
    name: text("name"),

    // Claude Agent SDK options
    model: text("model").default("claude-sonnet-4-5-20250929"),
    systemPrompt: text("system_prompt"),
    appendSystemPrompt: text("append_system_prompt"),
    tools: text("tools").array(),
    allowedTools: text("allowed_tools").array(),
    disallowedTools: text("disallowed_tools").array(),
    permissionMode: text("permission_mode").default("bypassPermissions"),
    maxTurns: integer("max_turns"),
    maxBudgetUsd: numeric("max_budget_usd", { precision: 10, scale: 4 }),
    persistSession: boolean("persist_session").default(true),

    // MCP servers as JSON
    mcpServers: jsonb("mcp_servers").$type<Record<string, McpServerConfig>>(),

    // Custom agents as JSON
    agents: jsonb("agents").$type<Record<string, AgentDefinition>>(),

    ...baseEntityFields,
  },
  (table) => [
    uniqueIndex("box_agent_config_box_trigger_idx").on(
      table.boxId,
      table.triggerType
    ),
    index("box_agent_config_box_id_idx").on(table.boxId),
  ]
);

export type BoxAgentConfig = typeof boxAgentConfig.$inferSelect;
export type NewBoxAgentConfig = typeof boxAgentConfig.$inferInsert;
