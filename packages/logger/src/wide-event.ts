import type { Logger } from "./logger";

export interface WideEvent {
  set(ctx: Record<string, unknown>): WideEvent;
  error(err: Error | string, extra?: Record<string, unknown>): WideEvent;
  emit(): void;
}

export function createWideEvent(
  logger: Logger,
  initialContext: Record<string, unknown> = {}
): WideEvent {
  let context: Record<string, unknown> = { ...initialContext };
  let hasError = false;
  const startTime = performance.now();

  const event: WideEvent = {
    set(ctx) {
      Object.assign(context, ctx);
      return event;
    },

    error(err, extra) {
      hasError = true;
      const error = typeof err === "string" ? new Error(err) : err;

      // Extract slug from extra if provided
      const slug = extra?.slug as string | undefined;

      context.error = {
        message: error.message,
        type: error.name,
        ...(slug && { slug }),
        // First 5 lines of stack trace
        stack: error.stack?.split("\n").slice(0, 5).join("\n"),
      };

      // Merge remaining extra (excluding slug which goes in error)
      if (extra) {
        const { slug: _, ...rest } = extra;
        Object.assign(context, rest);
      }
      return event;
    },

    emit() {
      const durationMs = Math.round(performance.now() - startTime);
      const logFn = hasError ? logger.error : logger.info;
      logFn.call(logger, { ...context, durationMs });
    },
  };

  return event;
}
