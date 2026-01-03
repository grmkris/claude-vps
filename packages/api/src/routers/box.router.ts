import { ORPCError } from "@orpc/server";
import { env } from "@vps-claude/env/server";
import { BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";

export const boxRouter = {
	list: protectedProcedure.handler(async ({ context }) => {
		const userId = context.session.user.id;
		const boxes = await context.boxService.listByUser(userId);
		return { boxes };
	}),

	byId: protectedProcedure
		.input(z.object({ id: BoxId }))
		.handler(async ({ context, input }) => {
			const box = await context.boxService.getById(input.id);

			if (!box || box.userId !== context.session.user.id) {
				throw new ORPCError("NOT_FOUND", { message: "Box not found" });
			}

			return { box };
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
			const result = await context.boxService.create(userId, input);

			return result.match(
				(box) => ({ box }),
				(error) => {
					throw new ORPCError("BAD_REQUEST", { message: error.message });
				},
			);
		}),

	deploy: protectedProcedure
		.input(
			z.object({
				id: BoxId,
				password: z.string().min(8).max(100),
			}),
		)
		.handler(async ({ context, input }) => {
			const userId = context.session.user.id;
			const result = await context.boxService.deploy(input.id, userId, input.password);

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
		.input(z.object({ id: BoxId }))
		.handler(async ({ context, input }) => {
			const userId = context.session.user.id;
			const result = await context.boxService.delete(input.id, userId);

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
		.input(z.object({ id: BoxId }))
		.handler(async ({ context, input }) => {
			const box = await context.boxService.getById(input.id);

			if (!box || box.userId !== context.session.user.id) {
				throw new ORPCError("NOT_FOUND", { message: "Box not found" });
			}

			const url = `https://${box.subdomain}.${env.AGENTS_DOMAIN}`;
			return { url };
		}),
};
