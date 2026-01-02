import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LoggerOptions } from "pino";
import { pino } from "pino";
import pkg from "pino-std-serializers";
import { z } from "zod";

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "api.log");

export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export const LogLevel = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevel>;

export interface LoggerConfig {
  level?: LogLevel;
  appName?: string;
  isDev?: boolean;
}

export function createLogger(config: LoggerConfig = {}) {
  const { level = "info", appName = "vps-claude", isDev = true } = config;

  const loggerOptions: LoggerOptions = {
    level,
    redact: {
      paths: [
        "*.password",
        "*.token",
        "*.accessToken",
        "*.refreshToken",
        "*.secret",
        "*.apiKey",
        "*.authorization",
        "req.headers.authorization",
        "req.headers.cookie",
      ],
      remove: true,
    },
    serializers: {
      err: pkg.errWithCause,
      error: pkg.errWithCause,
      req: pkg.wrapRequestSerializer,
      res: pkg.wrapResponseSerializer,
    },
    base: {
      app: appName,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  mkdirSync(LOG_DIR, { recursive: true });

  const logger = isDev
    ? pino({
        ...loggerOptions,
        transport: {
          targets: [
            {
              target: "pino-pretty",
              level,
              options: {
                colorize: true,
                translateTime: "HH:MM:ss Z",
                ignore: "pid,hostname,app",
                singleLine: true,
                messageFormat: "{msg}",
              },
            },
            {
              target: "pino/file",
              level: "debug",
              options: {
                destination: LOG_FILE,
                append: true,
              },
            },
          ],
        },
      })
    : pino(loggerOptions);

  return logger;
}

export type Logger = ReturnType<typeof createLogger>;
