import { ORPCError } from "@orpc/server";
import { BoxCronjobId, BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { boxProcedure } from "../index";
import { SuccessOutput } from "./schemas";

// Inline schema to avoid TS7056 from drizzle-zod's createSelectSchema
const CronjobOutput = z.object({
  id: BoxCronjobId,
  boxId: BoxId,
  name: z.string(),
  description: z.string().nullable(),
  schedule: z.string(),
  prompt: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  bullmqJobKey: z.string().nullable(),
  lastRunAt: z.date().nullable(),
  nextRunAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const boxCronjobApiRouter = {
  list: boxProcedure
    .route({ method: "GET", path: "/box/cronjobs" })
    .output(z.object({ cronjobs: z.array(CronjobOutput) }))
    .handler(async ({ context }) => {
      context.wideEvent?.set({ op: "box.cronjob.list" });
      const boxResult = await context.emailService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Invalid box token",
        });
      }

      const result = await context.cronjobService.listByBox(boxRecord.id);
      return result.match(
        (cronjobs) => ({ cronjobs }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  create: boxProcedure
    .route({ method: "POST", path: "/box/cronjobs" })
    .input(
      z.object({
        name: z.string().min(1).max(100),
        schedule: z.string().min(1).max(100),
        prompt: z.string().min(1).max(10000),
      })
    )
    .output(z.object({ cronjob: CronjobOutput }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.cronjob.create",
        name: input.name,
        schedule: input.schedule,
      });
      const boxResult = await context.emailService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Invalid box token",
        });
      }

      const result = await context.cronjobService.create(boxRecord.id, {
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

  update: boxProcedure
    .route({ method: "PUT", path: "/box/cronjobs/{id}" })
    .input(
      z.object({
        id: BoxCronjobId,
        name: z.string().min(1).max(100).optional(),
        schedule: z.string().min(1).max(100).optional(),
        prompt: z.string().min(1).max(10000).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .output(z.object({ cronjob: CronjobOutput }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.cronjob.update",
        cronjobId: input.id,
      });
      const boxResult = await context.emailService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Invalid box token",
        });
      }

      // Verify cronjob belongs to this box
      const cronjobResult = await context.cronjobService.getById(input.id);
      if (cronjobResult.isErr() || !cronjobResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
      }
      if (cronjobResult.value.boxId !== boxRecord.id) {
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

  delete: boxProcedure
    .route({ method: "DELETE", path: "/box/cronjobs/{id}" })
    .input(z.object({ id: BoxCronjobId }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.cronjob.delete",
        cronjobId: input.id,
      });
      const boxResult = await context.emailService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Invalid box token",
        });
      }

      // Verify cronjob belongs to this box
      const cronjobResult = await context.cronjobService.getById(input.id);
      if (cronjobResult.isErr() || !cronjobResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
      }
      if (cronjobResult.value.boxId !== boxRecord.id) {
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

  toggle: boxProcedure
    .route({ method: "POST", path: "/box/cronjobs/{id}/toggle" })
    .input(z.object({ id: BoxCronjobId }))
    .output(z.object({ cronjob: CronjobOutput }))
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.cronjob.toggle",
        cronjobId: input.id,
      });
      const boxResult = await context.emailService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Invalid box token",
        });
      }

      // Verify cronjob belongs to this box
      const cronjobResult = await context.cronjobService.getById(input.id);
      if (cronjobResult.isErr() || !cronjobResult.value) {
        throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
      }
      if (cronjobResult.value.boxId !== boxRecord.id) {
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
};
