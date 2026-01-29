import { ORPCError } from "@orpc/server";
import { BoxCronjobId, BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  CronjobExecutionListOutput,
  CronjobListOutput,
  CronjobOutput,
  SuccessOutput,
} from "./schemas";

const CreateCronjobInput = z.object({
  boxId: BoxId,
  name: z.string().min(1).max(100),
  schedule: z.string().min(1).max(100),
  prompt: z.string().min(1).max(10000),
});

const UpdateCronjobInput = z.object({
  id: BoxCronjobId,
  name: z.string().min(1).max(100).optional(),
  schedule: z.string().min(1).max(100).optional(),
  prompt: z.string().min(1).max(10000).optional(),
  enabled: z.boolean().optional(),
});

export const cronjobRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/box/:boxId/cronjobs" })
    .input(z.object({ boxId: BoxId }))
    .output(CronjobListOutput)
    .handler(async ({ context, input }) => {
      // Verify user owns the box
      const boxResult = await context.boxService.getById(input.boxId);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      const box = boxResult.value;
      if (!box || box.userId !== context.session.user.id) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }

      const result = await context.cronjobService.listByBox(input.boxId);
      return result.match(
        (cronjobs) => ({ cronjobs }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/box/:boxId/cronjobs" })
    .input(CreateCronjobInput)
    .output(CronjobOutput)
    .handler(async ({ context, input }) => {
      // Verify user owns the box
      const boxResult = await context.boxService.getById(input.boxId);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      const box = boxResult.value;
      if (!box || box.userId !== context.session.user.id) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }

      const result = await context.cronjobService.create(input.boxId, {
        name: input.name,
        schedule: input.schedule,
        prompt: input.prompt,
      });

      return result.match(
        (cronjob) => ({ cronjob }),
        (error) => {
          if (error.type === "VALIDATION_FAILED") {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  update: protectedProcedure
    .route({ method: "PUT", path: "/cronjob/:id" })
    .input(UpdateCronjobInput)
    .output(CronjobOutput)
    .handler(async ({ context, input }) => {
      // Verify ownership via cronjob -> box -> user
      const cronjobResult = await context.cronjobService.getById(input.id);
      if (cronjobResult.isErr() || !cronjobResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
      }

      const boxResult = await context.boxService.getById(
        cronjobResult.value.boxId
      );
      if (boxResult.isErr() || !boxResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (boxResult.value.userId !== context.session.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
      }

      const result = await context.cronjobService.update(input.id, {
        name: input.name,
        schedule: input.schedule,
        prompt: input.prompt,
        enabled: input.enabled,
      });

      return result.match(
        (cronjob) => ({ cronjob }),
        (error) => {
          if (error.type === "VALIDATION_FAILED") {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  delete: protectedProcedure
    .route({ method: "DELETE", path: "/cronjob/:id" })
    .input(z.object({ id: BoxCronjobId }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      // Verify ownership
      const cronjobResult = await context.cronjobService.getById(input.id);
      if (cronjobResult.isErr() || !cronjobResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
      }

      const boxResult = await context.boxService.getById(
        cronjobResult.value.boxId
      );
      if (boxResult.isErr() || !boxResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (boxResult.value.userId !== context.session.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
      }

      const result = await context.cronjobService.delete(input.id);
      return result.match(
        () => ({ success: true as const }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  toggle: protectedProcedure
    .route({ method: "POST", path: "/cronjob/:id/toggle" })
    .input(z.object({ id: BoxCronjobId }))
    .output(CronjobOutput)
    .handler(async ({ context, input }) => {
      // Verify ownership
      const cronjobResult = await context.cronjobService.getById(input.id);
      if (cronjobResult.isErr() || !cronjobResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
      }

      const boxResult = await context.boxService.getById(
        cronjobResult.value.boxId
      );
      if (boxResult.isErr() || !boxResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (boxResult.value.userId !== context.session.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
      }

      const result = await context.cronjobService.toggle(input.id);
      return result.match(
        (cronjob) => ({ cronjob }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  executions: protectedProcedure
    .route({ method: "GET", path: "/cronjob/:id/executions" })
    .input(
      z.object({
        id: BoxCronjobId,
        limit: z.number().min(1).max(100).optional(),
      })
    )
    .output(CronjobExecutionListOutput)
    .handler(async ({ context, input }) => {
      // Verify ownership
      const cronjobResult = await context.cronjobService.getById(input.id);
      if (cronjobResult.isErr() || !cronjobResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
      }

      const boxResult = await context.boxService.getById(
        cronjobResult.value.boxId
      );
      if (boxResult.isErr() || !boxResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (boxResult.value.userId !== context.session.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
      }

      const result = await context.cronjobService.listExecutions(
        input.id,
        input.limit
      );
      return result.match(
        (executions) => ({ executions }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),
};
