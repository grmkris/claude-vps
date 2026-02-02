import { ORPCError } from "@orpc/server";
import { BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { FsListOutput, FsReadOutput, FsWriteOutput } from "./schemas";

export const boxFsRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/box/:id/fs/list" })
    .input(
      z.object({
        id: BoxId,
        path: z.string().default("/home/sprite"),
      })
    )
    .output(FsListOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.fs.list",
        boxId: input.id,
        path: input.path,
      });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      const box = boxResult.value;
      if (!box || box.userId !== context.session.user.id) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (box.status !== "running" || !box.instanceName) {
        throw new ORPCError("BAD_REQUEST", { message: "Box is not running" });
      }

      try {
        const entries = await context.spritesClient.listDir(
          box.instanceName,
          input.path
        );
        return { entries, currentPath: input.path };
      } catch (error) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message:
            error instanceof Error ? error.message : "Failed to list directory",
        });
      }
    }),

  read: protectedProcedure
    .route({ method: "GET", path: "/box/:id/fs/read" })
    .input(
      z.object({
        id: BoxId,
        path: z.string(),
      })
    )
    .output(FsReadOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.fs.read",
        boxId: input.id,
        path: input.path,
      });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      const box = boxResult.value;
      if (!box || box.userId !== context.session.user.id) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (box.status !== "running" || !box.instanceName) {
        throw new ORPCError("BAD_REQUEST", { message: "Box is not running" });
      }

      try {
        const buffer = await context.spritesClient.readFile(
          box.instanceName,
          input.path
        );
        // Limit to 5MB
        if (buffer.length > 5 * 1024 * 1024) {
          throw new ORPCError("BAD_REQUEST", {
            message: "File too large (max 5MB)",
          });
        }
        return {
          content: buffer.toString("base64"),
          size: buffer.length,
        };
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message:
            error instanceof Error ? error.message : "Failed to read file",
        });
      }
    }),

  write: protectedProcedure
    .route({ method: "POST", path: "/box/:id/fs/write" })
    .input(
      z.object({
        id: BoxId,
        path: z.string(),
        content: z.string(), // base64
        mkdir: z.boolean().default(true),
      })
    )
    .output(FsWriteOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.fs.write",
        boxId: input.id,
        path: input.path,
        size: input.content.length,
      });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      const box = boxResult.value;
      if (!box || box.userId !== context.session.user.id) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (box.status !== "running" || !box.instanceName) {
        throw new ORPCError("BAD_REQUEST", { message: "Box is not running" });
      }

      const buffer = Buffer.from(input.content, "base64");
      // Limit to 10MB
      if (buffer.length > 10 * 1024 * 1024) {
        throw new ORPCError("BAD_REQUEST", {
          message: "File too large (max 10MB)",
        });
      }

      try {
        await context.spritesClient.writeFile(
          box.instanceName,
          input.path,
          buffer,
          {
            mkdir: input.mkdir,
          }
        );
        return { success: true as const, path: input.path };
      } catch (error) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message:
            error instanceof Error ? error.message : "Failed to write file",
        });
      }
    }),
};
