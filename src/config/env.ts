import { z } from "zod";

/**
 * Environment schema for Notificator (milestone M0).
 *
 * Fail-fast: `loadEnv` validates the provided source and throws an Error whose
 * message clearly lists every invalid or missing variable.
 */

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

const envSchema = z.object({
  // Optional at M0 so the service can boot without notifications configured.
  // M5 will make this required. A blank value (as shipped in .env.example) is
  // coerced to `undefined` first, because `.optional()` permits only
  // `undefined` — an empty string would otherwise fail url() validation.
  DISCORD_WEBHOOK_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),

  BINANCE_WS_URL: z.string().url().default("wss://stream.binance.com:9443"),

  // Comma-separated symbol list -> lowercased, trimmed, de-blanked string[].
  SYMBOLS: z
    .string()
    .default("btcusdt,ethusdt")
    .transform((raw) =>
      raw
        .split(",")
        .map((symbol) => symbol.trim().toLowerCase())
        .filter((symbol) => symbol.length > 0),
    ),

  PORT: z.coerce.number().int().positive().default(3000),

  SEND_RATE_PER_SEC: z.coerce.number().positive().default(1),

  QUEUE_MAX: z.coerce.number().int().positive().default(1000),

  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate environment variables and return a strongly-typed Env.
 * Throws an Error listing all invalid/missing variables on failure.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const { fieldErrors, formErrors } = result.error.flatten();

    const fieldLines = Object.entries(fieldErrors).map(
      ([key, messages]) => `  - ${key}: ${(messages ?? []).join(", ")}`,
    );
    const formLines = formErrors.map((message) => `  - ${message}`);
    const details = [...fieldLines, ...formLines].join("\n");

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
