import pino, { type Logger } from "pino";

/**
 * Configured pino logger.
 *
 * Reads LOG_LEVEL directly from process.env (rather than importing the env
 * module) to avoid an import cycle: env.ts may want to log, and logger.ts must
 * not depend on env.ts. The raw value is still validated against the same level
 * list env.ts uses, falling back to the default on any mismatch so an invalid
 * LOG_LEVEL cannot crash pino at construction time.
 */

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_LOG_LEVEL: LogLevel = "info";

function resolveLevel(raw: string | undefined): LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(raw ?? "")
    ? (raw as LogLevel)
    : DEFAULT_LOG_LEVEL;
}

const level = resolveLevel(process.env.LOG_LEVEL);

// Pretty output for local development only; JSON everywhere else. Gating on an
// explicit "development" signal (rather than !== "production") keeps a
// production/omit-dev install — where pino-pretty is not present — from trying
// to resolve the transport target when NODE_ENV is unset.
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
