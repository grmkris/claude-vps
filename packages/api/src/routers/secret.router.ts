import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";

export const secretRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const secrets = await context.secretService.list(userId);
    return { secrets };
  }),

  set: protectedProcedure
    .input(
      z.object({
        key: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[A-Z_][A-Z0-9_]*$/, {
            message: "Key must be uppercase with underscores (e.g., API_KEY)",
          }),
        value: z.string().min(1).max(10000),
      })
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const result = await context.secretService.set(
        userId,
        input.key,
        input.value
      );

      return result.match(
        () => ({ success: true }),
        (error) => {
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),

  delete: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const result = await context.secretService.delete(userId, input.key);

      return result.match(
        () => ({ success: true }),
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),
};
