import { loadEnv } from "./config/env.js";
import { logger } from "./util/logger.js";

function main(): void {
  const env = loadEnv();

  logger.info(
    { symbols: env.SYMBOLS, port: env.PORT },
    "Notificator starting…",
  );

  if (!env.DISCORD_WEBHOOK_URL) {
    logger.warn(
      "Discord webhook not configured — notifications disabled (set DISCORD_WEBHOOK_URL in .env)",
    );
  }

  // Graceful-shutdown skeleton (real teardown — queue flush, WS close — lands in M6).
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "Shutting down gracefully…");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

try {
  main();
} catch (err: unknown) {
  logger.fatal({ err }, "Fatal error during startup");
  process.exit(1);
}
