import { ORPCError } from "@orpc/server";
import { SkillId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  SkillByIdOutput,
  SkillCreateOutput,
  SkillListOutput,
  SkillUpdateOutput,
  SuccessOutput,
} from "./schemas";

const slugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, {
    message: "Slug must be lowercase with hyphens only",
  });

export const skillRouter = {
  list: protectedProcedure
    .output(SkillListOutput)
    .handler(async ({ context }) => {
      const result = await context.skillService.list(context.session.user.id);
      return result.match(
        (skills) => ({ skills }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  byId: protectedProcedure
    .input(z.object({ id: SkillId }))
    .output(SkillByIdOutput)
    .handler(async ({ context, input }) => {
      const result = await context.skillService.getById(
        input.id,
        context.session.user.id
      );
      return result.match(
        (skill) => ({ skill }),
        (error) => {
          throw new ORPCError("NOT_FOUND", { message: error.message });
        }
      );
    }),

  create: protectedProcedure
    .input(
      z.object({
        slug: slugSchema,
        name: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
        aptPackages: z.array(z.string()).default([]),
        npmPackages: z.array(z.string()).default([]),
        pipPackages: z.array(z.string()).default([]),
        skillMdContent: z.string().max(50000).optional(),
      })
    )
    .output(SkillCreateOutput)
    .handler(async ({ context, input }) => {
      const result = await context.skillService.create(
        context.session.user.id,
        input
      );
      return result.match(
        (skill) => ({ skill }),
        (error) => {
          if (error.type === "ALREADY_EXISTS") {
            throw new ORPCError("CONFLICT", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: SkillId,
        name: z.string().min(1).max(100).optional(),
        description: z.string().min(1).max(500).optional(),
        aptPackages: z.array(z.string()).optional(),
        npmPackages: z.array(z.string()).optional(),
        pipPackages: z.array(z.string()).optional(),
        skillMdContent: z.string().max(50000).nullable().optional(),
      })
    )
    .output(SkillUpdateOutput)
    .handler(async ({ context, input }) => {
      const { id, ...updates } = input;
      const result = await context.skillService.update(
        id,
        context.session.user.id,
        updates
      );
      return result.match(
        (skill) => ({ skill }),
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          if (error.type === "FORBIDDEN") {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),

  delete: protectedProcedure
    .input(z.object({ id: SkillId }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      const result = await context.skillService.delete(
        input.id,
        context.session.user.id
      );
      return result.match(
        () => ({ success: true as const }),
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          if (error.type === "FORBIDDEN") {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),
};
