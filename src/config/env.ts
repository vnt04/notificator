import { z } from "zod";

const LOG_LEVELS = [
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
] as const;

const envSchema = z.object({
    // `.optional()` accepts only undefined, so coerce the blank value shipped in
    // .env.example to undefined before url() runs. Required from M5 onward.
    DISCORD_WEBHOOK_URL: z.preprocess(
        (value) => (value === "" ? undefined : value),
        z.string().url().optional(),
    ),

    BINANCE_WS_URL: z.string().url().default("wss://stream.binance.com:9443"),

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

// Throws a single Error listing every invalid/missing variable at once.
export function loadEnv(
    source: Record<string, string | undefined> = process.env,
): Env {
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
