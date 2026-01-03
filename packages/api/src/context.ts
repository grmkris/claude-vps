import type { Context as HonoContext } from "hono";

import { auth } from "@vps-claude/auth";

import type { BoxService } from "./services/box.service";

export interface Services {
	boxService: BoxService;
}

export type CreateContextOptions = {
	context: HonoContext;
	services: Services;
};

export async function createContext({ context, services }: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		session,
		...services,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
