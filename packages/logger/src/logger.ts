import type { LoggerOptions } from "pino";

import { pino } from "pino";
import pkg from "pino-std-serializers";

export type Environment = "dev" | "staging" | "prod";

export interface LoggerConfig {
  level?: string;
  environment?: Environment;
  appName?: string;
}

export interface Logger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  fatal: (obj: Record<string, unknown>, msg?: string) => void;
  trace: (obj: Record<string, unknown>, msg?: string) => void;
}

export function createLogger(config: LoggerConfig = {}): Logger {
  const {
    level = "info",
    appName = "vps-claude",
    environment = "dev",
  } = config;

  const isDevelopment = environment === "dev";

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
      env: environment,
      app: appName,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  const logger = isDevelopment
    ? pino({
        ...loggerOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname,app,env",
            singleLine: true,
            messageFormat: "{msg}",
            sync: true,
          },
        },
      })
    : pino(loggerOptions);

  logger.info({
    msg: `Logger initialized in ${isDevelopment ? "development" : "production"} mode`,
  });

  return logger;
}
