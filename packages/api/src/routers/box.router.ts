import { ORPCError } from "@orpc/server";
import { McpServerConfigSchema } from "@vps-claude/db";
import { BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  BoxCreateOutput,
  BoxListOutput,
  DevBoxCreateOutput,
  SuccessOutput,
} from "./schemas";

export const boxRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/box" })
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      })
    )
    .output(BoxListOutput)
    .handler(async ({ context }) => {
      context.wideEvent?.set({ op: "box.list" });
      const result = await context.boxService.listByUser(
        context.session.user.id
      );
      return result.match(
        (boxes) => ({ boxes }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/box" })
    .input(
      z.object({
        name: z.string().min(1).max(50),
        skills: z.array(z.string()).default([]),
        envVars: z.record(z.string(), z.string()).optional(),
        mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
      })
    )
    .output(BoxCreateOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.create",
        boxName: input.name,
        skillCount: input.skills?.length,
      });
      const result = await context.boxService.create(
        context.session.user.id,
        input
      );
      return result.match(
        (box) => ({ box }),
        (error) => {
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),

  createDev: protectedProcedure
    .route({ method: "POST", path: "/box/create-dev" })
    .input(
      z.object({
        name: z.string().min(1).max(50),
      })
    )
    .output(DevBoxCreateOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.createDev", boxName: input.name });
      const result = await context.boxService.createDev(
        context.session.user.id,
        input.name
      );
      return result.match(
        ({ box, agentSecret }) => ({ box, agentSecret }),
        (error) => {
          if (error.type === "FORBIDDEN") {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),

  deploy: protectedProcedure
    .route({ method: "POST", path: "/box/deploy" })
    .input(
      z.object({
        id: BoxId,
      })
    )
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.deploy", boxId: input.id });
      const result = await context.boxService.deploy(
        input.id,
        context.session.user.id
      );
      return result.match(
        () => ({ success: true as const }),
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),

  delete: protectedProcedure
    .route({ method: "DELETE", path: "/box/:id" })
    .input(z.object({ id: BoxId }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.delete", boxId: input.id });
      const result = await context.boxService.delete(
        input.id,
        context.session.user.id
      );
      return result.match(
        () => ({ success: true as const }),
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),
};
