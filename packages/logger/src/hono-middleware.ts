import type { MiddlewareHandler } from "hono";
import type { Logger as PinoLogger } from "pino";

import type { Logger } from "./logger";

import { createWideEvent } from "./wide-event";

export function wideEventMiddleware(opts: {
  logger: Logger;
  skipPaths?: string[];
  serviceName?: string;
  serviceVersion?: string;
}): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (opts.skipPaths?.includes(path)) return next();

    const requestId = crypto.randomUUID().slice(0, 8);
    // Cast to PinoLogger - our Logger interface is a compatible subset
    const event = createWideEvent(opts.logger as unknown as PinoLogger, {
      main: true,
      service: {
        name: opts.serviceName || "api",
        env: process.env.APP_ENV || "dev",
        ...(opts.serviceVersion && { version: opts.serviceVersion }),
      },
      requestId,
      method: c.req.method,
      path,
    });

    c.set("requestId", requestId);
    c.set("wideEvent", event);

    try {
      await next();
      event.set({ status: c.res.status });
      event.emit();
    } catch (err) {
      event.error(err as Error, { status: 500 });
      event.emit();
      throw err;
    }
  };
}
