import type { LoggerOptions } from "pino";

import { pino } from "pino";
import pkg from "pino-std-serializers";

export type Environment = "dev" | "staging" | "prod" | "local";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerConfig {
  level?: LogLevel;
  environment?: Environment;
  appName?: string;
}

type LogFn = {
  (msg: string): void;
  (obj: Record<string, unknown>, msg?: string): void;
};

export interface Logger {
  info: LogFn;
  error: LogFn;
  warn: LogFn;
  debug: LogFn;
  fatal: LogFn;
  trace: LogFn;
}

export function createLogger(config: LoggerConfig = {}): Logger {
  const {
    level = (process.env.LOG_LEVEL as LogLevel) || "info",
    appName = "vps-claude",
    environment = (process.env.APP_ENV as Environment) || "dev",
  } = config;

  const isDevelopment = environment === "dev" || environment === "local";

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
