// Existing
export { createLogger, type Logger, type LoggerConfig } from "./logger";

// New - Wide events
export { createWideEvent, type WideEvent } from "./wide-event";
export { wideEventMiddleware } from "./hono-middleware";

// New - Structured errors
export {
  errorTypeToStatus,
  parseError,
  type StructuredErrorFields,
} from "./structured-error";
