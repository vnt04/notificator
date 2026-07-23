import { loadEnv } from "./config/env.js";
import { logger } from "./util/logger.js";
import { BinancePriceService } from "./ingest/binancePriceService.js";

const SHUTDOWN_TIMEOUT_MS = 5_000;

function installProcessGuards(): void {
    // Promise reject không ai bắt: log rồi chạy tiếp — hiếm khi làm hỏng state.
    process.on("unhandledRejection", (reason: unknown) => {
        logger.error({ reason }, "Unhandled promise rejection");
    });

    // Exception lọt ra ngoài thì state không còn tin được. Thoát với mã KHÁC 0 để
    // supervisor restart — thoát 0 là "chết im", không ai cứu.
    process.on("uncaughtException", (err: unknown) => {
        logger.fatal({ err }, "Uncaught exception — exiting for restart");
        process.exit(1);
    });
}

function main(): void {
    installProcessGuards();

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

    installSignalHandlers(priceService);
}

// M6 sẽ nối thêm vào đây: drain queue, đóng DB, dừng HTTP server.
async function shutdown(
    signal: NodeJS.Signals,
    priceService: BinancePriceService,
): Promise<void> {
    logger.info({ signal }, "Shutting down gracefully…");

    // Chốt chặn: có handle treo thì vẫn phải thoát, và thoát ồn (mã ≠ 0).
    const guard = setTimeout(() => {
        logger.error(
            { timeoutMs: SHUTDOWN_TIMEOUT_MS },
            "Shutdown timed out — forcing exit",
        );
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    await priceService.stop();
    clearTimeout(guard);

    // Không gọi process.exit(): hết handle thì Node tự thoát, nhờ vậy close
    // frame kịp gửi đi và log kịp xả. exit() ở đây là cắt ngang cả hai.
    logger.info("Shutdown complete");
}

function installSignalHandlers(priceService: BinancePriceService): void {
    let shuttingDown = false;

    const onSignal = (signal: NodeJS.Signals): void => {
        if (shuttingDown) {
            logger.warn({ signal }, "Second signal — forcing exit");
            process.exit(1);
        }
        shuttingDown = true;

        shutdown(signal, priceService).catch((err: unknown) => {
            logger.fatal({ err }, "Shutdown failed");
            process.exit(1);
        });
    };

    process.on("SIGINT", () => onSignal("SIGINT"));
    process.on("SIGTERM", () => onSignal("SIGTERM"));
}

try {
    main();
} catch (err: unknown) {
    logger.fatal({ err }, "Fatal error during startup");
    process.exit(1);
}
