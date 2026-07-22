import { loadEnv } from "./config/env.js";
import { logger } from "./util/logger.js";
import { BinancePriceService } from "./ingest/binancePriceService.js";

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

    const priceService = new BinancePriceService(
        env.BINANCE_WS_URL,
        env.SYMBOLS,
    );
    priceService.on("tick", (tick) => logger.info(tick, "tick"));
    priceService.start();

    // Skeleton only — real teardown (drain queue, close DB) lands in M6.
    const shutdown = (signal: NodeJS.Signals): void => {
        logger.info({ signal }, "Shutting down gracefully…");
        priceService.stop();
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
