import type { Logger } from "pino";

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
      context.error = { message: error.message, name: error.name };
      if (extra) Object.assign(context, extra);
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
