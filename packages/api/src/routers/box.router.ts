import { ORPCError } from "@orpc/server";
import { BoxId, SkillId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  BoxByIdOutput,
  BoxCreateOutput,
  BoxListOutput,
  BoxProxyOutput,
  BoxUrlOutput,
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

  byId: protectedProcedure
    .route({ method: "GET", path: "/box/:id" })
    .input(z.object({ id: BoxId }))
    .output(BoxByIdOutput)
    .handler(async ({ context, input }) => {
      const result = await context.boxService.getById(input.id);
      return result.match(
        (box) => {
          if (!box || box.userId !== context.session.user.id) {
            throw new ORPCError("NOT_FOUND", { message: "Box not found" });
          }
          return { box };
        },
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
        password: z.string().min(8).max(100),
        skills: z.array(SkillId).default([]),
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

  deploy: protectedProcedure
    .route({ method: "POST", path: "/box/deploy" })
    .input(
      z.object({
        id: BoxId,
        password: z.string().min(8).max(100),
      })
    )
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      const result = await context.boxService.deploy(
        input.id,
        context.session.user.id,
        input.password
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

  getUrl: protectedProcedure
    .route({ method: "GET", path: "/box/:id/url" })
    .input(z.object({ id: BoxId }))
    .output(BoxUrlOutput)
    .handler(async ({ context, input }) => {
      const result = await context.boxService.getById(input.id);
      return result.match(
        (box) => {
          if (!box || box.userId !== context.session.user.id) {
            throw new ORPCError("NOT_FOUND", { message: "Box not found" });
          }
          return {
            url: `https://${box.subdomain}.${context.config.agentsDomain}`,
          };
        },
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  getProxyDetails: protectedProcedure
    .route({ method: "GET", path: "/box/:id/proxy-details" })
    .input(
      z.object({
        id: BoxId,
        port: z.number().int().min(1).max(65535).default(22),
      })
    )
    .output(BoxProxyOutput)
    .handler(async ({ context, input }) => {
      const result = await context.boxService.getById(input.id);
      return result.match(
        (box) => {
          if (!box || box.userId !== context.session.user.id) {
            throw new ORPCError("NOT_FOUND", { message: "Box not found" });
          }

          if (!box.spriteName || box.status !== "running") {
            throw new ORPCError("BAD_REQUEST", {
              message: "Box is not running",
            });
          }

          return {
            proxyUrl: context.spritesClient.getProxyUrl(box.spriteName),
            token: context.spritesClient.getToken(),
            host: "localhost",
            port: input.port,
          };
        },
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),
};

// NOTE: agentConfigRouter removed from appRouter to fix TS7056 type explosion.
// Box-agent fetches config via boxApiRouter.getAgentConfig endpoint.
// Re-add when admin UI for agent configs is needed.
