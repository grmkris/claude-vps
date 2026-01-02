import { ORPCError } from "@orpc/server";
import { env } from "@vps-claude/env/server";
import { EnvironmentId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";

export const environmentRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const environments = await context.environmentService.listByUser(userId);
    return { environments };
  }),

  byId: protectedProcedure
    .input(z.object({ id: EnvironmentId }))
    .handler(async ({ context, input }) => {
      const environment = await context.environmentService.getById(input.id);

      if (!environment || environment.userId !== context.session.user.id) {
        throw new ORPCError("NOT_FOUND", { message: "Environment not found" });
      }

      return { environment };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50),
        password: z.string().min(8).max(100),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const result = await context.environmentService.create(userId, input);

      return result.match(
        (environment) => ({ environment }),
        (error) => {
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        },
      );
    }),

  deploy: protectedProcedure
    .input(
      z.object({
        id: EnvironmentId,
        password: z.string().min(8).max(100),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const result = await context.environmentService.deploy(input.id, userId, input.password);

      return result.match(
        () => ({ success: true }),
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        },
      );
    }),

  delete: protectedProcedure
    .input(z.object({ id: EnvironmentId }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const result = await context.environmentService.delete(input.id, userId);

      return result.match(
        () => ({ success: true }),
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        },
      );
    }),

  getUrl: protectedProcedure
    .input(z.object({ id: EnvironmentId }))
    .handler(async ({ context, input }) => {
      const environment = await context.environmentService.getById(input.id);

      if (!environment || environment.userId !== context.session.user.id) {
        throw new ORPCError("NOT_FOUND", { message: "Environment not found" });
      }

      const url = `https://${environment.subdomain}.${env.AGENTS_DOMAIN}`;
      return { url };
    }),
};
