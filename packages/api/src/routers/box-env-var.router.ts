import { ORPCError } from "@orpc/server";
import { BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { BoxEnvVarListOutput, SuccessOutput } from "./schemas";

const keySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Z_][A-Z0-9_]*$/, {
    message: "Key must be uppercase with underscores (e.g., API_KEY)",
  });

const envVarTypeSchema = z.enum(["literal", "credential_ref"]);

export const boxEnvVarRouter = {
  list: protectedProcedure
    .input(z.object({ boxId: BoxId }))
    .output(BoxEnvVarListOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "boxEnvVar.list", boxId: input.boxId });
      const result = await context.boxEnvVarService.list(
        input.boxId,
        context.session.user.id
      );
      return result.match(
        (envVars) => ({ envVars }),
        (error) => {
          if (error.type === "NOT_AUTHORIZED") {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          if (error.type === "BOX_NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  set: protectedProcedure
    .input(
      z.object({
        boxId: BoxId,
        key: keySchema,
        type: envVarTypeSchema,
        value: z.string().max(10000).optional(),
        credentialKey: z.string().max(100).optional(),
      })
    )
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "boxEnvVar.set",
        boxId: input.boxId,
        key: input.key,
        type: input.type,
      });
      const result = await context.boxEnvVarService.set(
        input.boxId,
        context.session.user.id,
        {
          key: input.key,
          type: input.type,
          value: input.value,
          credentialKey: input.credentialKey,
        }
      );
      return result.match(
        () => ({ success: true as const }),
        (error) => {
          if (error.type === "NOT_AUTHORIZED") {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          if (error.type === "BOX_NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          if (error.type === "INVALID_CREDENTIAL") {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  delete: protectedProcedure
    .input(z.object({ boxId: BoxId, key: z.string().min(1) }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "boxEnvVar.delete",
        boxId: input.boxId,
        key: input.key,
      });
      const result = await context.boxEnvVarService.delete(
        input.boxId,
        context.session.user.id,
        input.key
      );
      return result.match(
        () => ({ success: true as const }),
        (error) => {
          if (error.type === "NOT_AUTHORIZED") {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          if (error.type === "BOX_NOT_FOUND" || error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  bulkSet: protectedProcedure
    .input(
      z.object({
        boxId: BoxId,
        envVars: z.array(
          z.object({
            key: keySchema,
            type: envVarTypeSchema,
            value: z.string().max(10000).optional(),
            credentialKey: z.string().max(100).optional(),
          })
        ),
      })
    )
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "boxEnvVar.bulkSet",
        boxId: input.boxId,
        count: input.envVars.length,
      });
      const result = await context.boxEnvVarService.bulkSet(
        input.boxId,
        context.session.user.id,
        input.envVars
      );
      return result.match(
        () => ({ success: true as const }),
        (error) => {
          if (error.type === "NOT_AUTHORIZED") {
            throw new ORPCError("FORBIDDEN", { message: error.message });
          }
          if (error.type === "BOX_NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          if (error.type === "INVALID_CREDENTIAL") {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),
};
