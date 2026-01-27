import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { SecretListOutput, SuccessOutput } from "./schemas";

const keySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Z_][A-Z0-9_]*$/, {
    message: "Key must be uppercase with underscores (e.g., API_KEY)",
  });

export const secretRouter = {
  list: protectedProcedure
    .output(SecretListOutput)
    .handler(async ({ context }) => {
      const result = await context.secretService.list(context.session.user.id);
      return result.match(
        (secrets) => ({ secrets }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  set: protectedProcedure
    .input(z.object({ key: keySchema, value: z.string().min(1).max(10000) }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      const result = await context.secretService.set(
        context.session.user.id,
        input.key,
        input.value
      );
      return result.match(
        async () => {
          // Sync to running boxes (fire and forget)
          void context.secretService.syncToRunningBoxes(
            context.session.user.id
          );
          return { success: true as const };
        },
        (error) => {
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),

  delete: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      const result = await context.secretService.delete(
        context.session.user.id,
        input.key
      );
      return result.match(
        async () => {
          // Sync to running boxes (fire and forget)
          void context.secretService.syncToRunningBoxes(
            context.session.user.id
          );
          return { success: true as const };
        },
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),
};
