import { ORPCError } from "@orpc/server";
import { BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { BoxCreateOutput, BoxListOutput, SuccessOutput } from "./schemas";

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
      })
    )
    .output(BoxCreateOutput)
    .handler(async ({ context, input }) => {
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
    .output(BoxCreateOutput)
    .handler(async ({ context, input }) => {
      const result = await context.boxService.createDev(
        context.session.user.id,
        input.name
      );
      return result.match(
        (box) => ({ box }),
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
