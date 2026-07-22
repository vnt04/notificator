import pino, { type Logger } from "pino";

// Reads LOG_LEVEL from process.env directly, not from env.ts, to avoid an
// import cycle (env.ts logs; logger must not depend on env.ts). Unknown values
// fall back to the default so a bad LOG_LEVEL can't crash pino.

const LOG_LEVELS = [
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_LOG_LEVEL: LogLevel = "info";

function resolveLevel(raw: string | undefined): LogLevel {
    return (LOG_LEVELS as readonly string[]).includes(raw ?? "")
        ? (raw as LogLevel)
        : DEFAULT_LOG_LEVEL;
}

const level = resolveLevel(process.env.LOG_LEVEL);

// pino-pretty for local dev only. Gate on an explicit "development" signal so a
// prod/omit-dev install (no pino-pretty) never tries to load the transport when
// NODE_ENV is unset.
const isDevelopment = process.env.NODE_ENV === "development";

export const logger: Logger = pino({
    level,
    ...(isDevelopment
        ? {
              transport: {
                  target: "pino-pretty",
                  options: {
                      colorize: true,
                      translateTime: "SYS:standard",
                      ignore: "pid,hostname",
                  },
              },
          }
        : {}),
});
