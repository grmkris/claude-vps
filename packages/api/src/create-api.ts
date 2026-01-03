import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { Database } from "@vps-claude/db";
import type { Logger } from "@vps-claude/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createContext, type Services } from "./context";
import { appRouter } from "./routers/index";

type HonoVariables = {
	requestId: string;
};

export interface CreateApiOptions {
	db: Database;
	logger: Logger;
	services: Services;
	auth: { handler: (req: Request) => Promise<Response> };
	corsOrigin: string;
}

export function createApi({
	logger,
	services,
	auth,
	corsOrigin,
}: CreateApiOptions) {
	const app = new Hono<{ Variables: HonoVariables }>();

	app.use(async (c, next) => {
		const requestId = crypto.randomUUID().slice(0, 8);
		const start = performance.now();

		c.set("requestId", requestId);

		await next();

		const duration = Math.round(performance.now() - start);
		const path = c.req.path;

		if (path === "/" || path === "/health") {
			return;
		}

		logger.info({
			requestId,
			method: c.req.method,
			path,
			status: c.res.status,
			durationMs: duration,
		});
	});

	app.use(
		"/*",
		cors({
			origin: corsOrigin,
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
			credentials: true,
		}),
	);

	app.onError((err, c) => {
		const requestId = c.get("requestId") ?? "unknown";

		logger.error({
			msg: "Server error",
			requestId,
			error: err,
			path: c.req.path,
			method: c.req.method,
		});

		return c.json({ error: "Internal Server Error", requestId }, 500);
	});

	app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
	app.get("/", (c) => c.text("OK"));
	app.get("/health", (c) => c.text("OK"));

	const apiHandler = new OpenAPIHandler(appRouter, {
		plugins: [
			new OpenAPIReferencePlugin({
				schemaConverters: [new ZodToJsonSchemaConverter()],
			}),
		],
		interceptors: [
			onError((error) => {
				logger.error({ msg: "API error", error });
			}),
		],
	});

	const rpcHandler = new RPCHandler(appRouter, {
		interceptors: [
			onError((error) => {
				logger.error({ msg: "RPC error", error });
			}),
		],
	});

	app.use("/*", async (c, next) => {
		const context = await createContext({ context: c, services });

		const rpcResult = await rpcHandler.handle(c.req.raw, {
			prefix: "/rpc",
			context,
		});

		if (rpcResult.matched) {
			return c.newResponse(rpcResult.response.body, rpcResult.response);
		}

		const apiResult = await apiHandler.handle(c.req.raw, {
			prefix: "/api-reference",
			context,
		});

		if (apiResult.matched) {
			return c.newResponse(apiResult.response.body, apiResult.response);
		}

		await next();
	});

	return { app };
}
