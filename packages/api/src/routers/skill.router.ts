import { ORPCError } from "@orpc/server";
import { SkillId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";

const slugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, {
    message: "Slug must be lowercase with hyphens only",
  });

export const skillRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const skills = await context.skillService.list(userId);
    return { skills };
  }),

  byId: protectedProcedure
    .input(z.object({ id: SkillId }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const result = await context.skillService.getById(input.id, userId);

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
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const result = await context.skillService.create(userId, input);

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
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { id, ...updates } = input;
      const result = await context.skillService.update(id, userId, updates);

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
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const result = await context.skillService.delete(input.id, userId);

      return result.match(
        () => ({ success: true }),
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
