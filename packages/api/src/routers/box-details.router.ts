import { ORPCError } from "@orpc/server";
import { BoxEmailStatus } from "@vps-claude/db";
import { BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  BoxByIdOutput,
  BoxDeployProgressOutput,
  BoxDeployStepsOutput,
  BoxEmailListOutput,
  BoxExecOutput,
  BoxProxyOutput,
} from "./schemas";

export const boxDetailsRouter = {
  byId: protectedProcedure
    .route({ method: "GET", path: "/box/:id" })
    .input(z.object({ id: BoxId }))
    .output(BoxByIdOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.details.byId", boxId: input.id });
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

  deployProgress: protectedProcedure
    .route({ method: "GET", path: "/box/:id/deploy-progress" })
    .input(z.object({ id: BoxId }))
    .output(BoxDeployProgressOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.details.deployProgress",
        boxId: input.id,
      });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      if (
        !boxResult.value ||
        boxResult.value.userId !== context.session.user.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }

      const progressResult = await context.boxService.getDeployProgress(
        input.id
      );
      return progressResult.match(
        (progress) => ({ progress }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  deploySteps: protectedProcedure
    .route({ method: "GET", path: "/box/:id/deploy-steps" })
    .input(
      z.object({
        id: BoxId,
        attempt: z.number().int().min(1).optional(),
      })
    )
    .output(BoxDeployStepsOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.details.deploySteps",
        boxId: input.id,
      });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      if (
        !boxResult.value ||
        boxResult.value.userId !== context.session.user.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }

      const box = boxResult.value;
      const attempt = input.attempt ?? box.deploymentAttempt;

      const stepsResult = await context.deployStepService.getSteps(
        input.id,
        attempt
      );
      return stepsResult.match(
        (steps) => steps,
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
      context.wideEvent?.set({
        op: "box.details.getProxyDetails",
        boxId: input.id,
        port: input.port,
      });
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

  emails: protectedProcedure
    .route({ method: "GET", path: "/box/:id/emails" })
    .input(
      z.object({
        id: BoxId,
        status: BoxEmailStatus.optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .output(BoxEmailListOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.details.emails",
        boxId: input.id,
        status: input.status,
      });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      if (
        !boxResult.value ||
        boxResult.value.userId !== context.session.user.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }

      const emailsResult = await context.emailService.listByBox(input.id, {
        status: input.status,
        limit: input.limit,
      });

      return emailsResult.match(
        (emails) => ({ emails }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  exec: protectedProcedure
    .route({ method: "POST", path: "/box/:id/exec" })
    .input(
      z.object({
        id: BoxId,
        command: z.string().min(1).max(10000),
      })
    )
    .output(BoxExecOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.details.exec", boxId: input.id });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      if (
        !boxResult.value ||
        boxResult.value.userId !== context.session.user.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (boxResult.value.status !== "running" || !boxResult.value.spriteName) {
        throw new ORPCError("BAD_REQUEST", { message: "Box not running" });
      }

      return context.spritesClient.execShell(
        boxResult.value.spriteName,
        input.command
      );
    }),
};
