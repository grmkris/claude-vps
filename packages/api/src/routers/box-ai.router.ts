/**
 * Box AI Router
 *
 * Endpoints for AI capabilities accessible from box-agent.
 * All routes use boxProcedure (X-Box-Secret token auth).
 *
 * Routes:
 * - POST /box/ai/generate-image
 * - POST /box/ai/text-to-speech
 * - POST /box/ai/speech-to-text
 */

import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { boxProcedure } from "../index";

export const boxAiRouter = {
  generateImage: boxProcedure
    .route({ method: "POST", path: "/box/ai/generate-image" })
    .input(
      z.object({
        prompt: z.string().min(1).max(10000),
        width: z.number().int().min(256).max(2048).optional(),
        height: z.number().int().min(256).max(2048).optional(),
      })
    )
    .output(
      z.object({
        url: z.string(),
        width: z.number(),
        height: z.number(),
      })
    )
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.ai.generateImage",
        promptLen: input.prompt.length,
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

      const result = await context.aiService.generateImage({
        userId: boxRecord.userId,
        boxId: boxRecord.id,
        prompt: input.prompt,
        width: input.width,
        height: input.height,
      });

      if (result.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.error.message,
        });
      }

      return result.value;
    }),

  textToSpeech: boxProcedure
    .route({ method: "POST", path: "/box/ai/text-to-speech" })
    .input(
      z.object({
        text: z.string().min(1).max(5000),
        voice: z.string().optional(),
      })
    )
    .output(
      z.object({
        audioUrl: z.string(),
        durationSeconds: z.number().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.ai.textToSpeech",
        textLen: input.text.length,
        voice: input.voice,
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

      const result = await context.aiService.textToSpeech({
        userId: boxRecord.userId,
        boxId: boxRecord.id,
        text: input.text,
        voice: input.voice,
      });

      if (result.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.error.message,
        });
      }

      return result.value;
    }),

  speechToText: boxProcedure
    .route({ method: "POST", path: "/box/ai/speech-to-text" })
    .input(
      z.object({
        audioUrl: z.string().url(),
        language: z.string().optional(),
      })
    )
    .output(
      z.object({
        text: z.string(),
        confidence: z.number().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.ai.speechToText",
        language: input.language,
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

      const result = await context.aiService.speechToText({
        userId: boxRecord.userId,
        boxId: boxRecord.id,
        audioUrl: input.audioUrl,
        language: input.language,
      });

      if (result.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: result.error.message,
        });
      }

      return result.value;
    }),
};
