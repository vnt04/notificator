import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../../src/util/logger.js";

// Binance giả: cùng shape payload, nhưng bơm được lỗi theo ý muốn.
// Trỏ app vào đây bằng BINANCE_WS_URL=ws://localhost:8081
//
//   FAKE_PORT      cổng lắng nghe                       (8081)
//   TICK_MS        nhịp gửi frame                       (250)
//   DROP_AFTER_MS  cắt kết nối sau bao lâu; 0 = không   (0)
//   DROP_MODE      close | terminate | reset            (terminate)
//
// Ba kiểu đứt cho ra ba hành vi khác nhau ở phía client — xem dropClient().

const log = logger.child({ src: "fake-binance" });

const DROP_MODES = ["close", "terminate", "reset"] as const;
type DropMode = (typeof DROP_MODES)[number];

const PORT = Number(process.env.FAKE_PORT ?? 8081);
const TICK_MS = Number(process.env.TICK_MS ?? 250);
const DROP_AFTER_MS = Number(process.env.DROP_AFTER_MS ?? 0);
const DROP_MODE: DropMode = (DROP_MODES as readonly string[]).includes(
    process.env.DROP_MODE ?? "",
)
    ? (process.env.DROP_MODE as DropMode)
    : "terminate";

const BASE_PRICE: Readonly<Record<string, number>> = {
    BTCUSDT: 92_000,
    ETHUSDT: 3_100,
};
const FALLBACK_PRICE = 100;
const JITTER = 0.001;

function symbolsFromUrl(rawUrl: string | undefined): readonly string[] {
    // WHATWG URL cần base tuyệt đối để parse một URL chỉ có path.
    const streams =
        new URL(rawUrl ?? "/", "ws://localhost").searchParams.get("streams") ??
        "";

    return streams
        .split("/")
        .map((stream) => stream.split("@")[0] ?? "")
        .filter((symbol) => symbol.length > 0)
        .map((symbol) => symbol.toUpperCase());
}

function tradeFrame(symbol: string): string {
    const base = BASE_PRICE[symbol] ?? FALLBACK_PRICE;
    const price = base * (1 + (Math.random() - 0.5) * JITTER);

    return JSON.stringify({
        stream: `${symbol.toLowerCase()}@trade`,
        data: { e: "trade", s: symbol, p: price.toFixed(2), T: Date.now() },
    });
}

function dropClient(socket: WebSocket, mode: DropMode): void {
    // close     → gửi close frame đúng nghi thức     (server bảo trì)
    // terminate → đóng TCP bằng FIN, không close frame (rớt mạng "êm")
    // reset     → gửi RST                             (rớt mạng thô, đứt cáp)
    if (mode === "close") {
        socket.close(1001, "going away");
        return;
    }
    if (mode === "terminate") {
        socket.terminate();
        return;
    }

    // `_socket` là net.Socket bên dưới; @types/ws không công khai nên phải ép kiểu.
    const raw = (socket as unknown as { _socket?: Socket })._socket;
    raw?.resetAndDestroy();
}

const server = new WebSocketServer({ port: PORT });

server.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const symbols = symbolsFromUrl(req.url);
    log.info({ symbols, tickMs: TICK_MS }, "client connected");

    const streaming = setInterval(() => {
        for (const symbol of symbols) socket.send(tradeFrame(symbol));
    }, TICK_MS);

    socket.on("close", (code: number, reason: Buffer) => {
        clearInterval(streaming);
        // code 1000 + reason ở đây = client đã gửi close frame đúng nghi thức.
        log.info({ code, reason: reason.toString() }, "client disconnected");
    });
    socket.on("error", (err) => log.error({ err }, "client socket error"));

    if (DROP_AFTER_MS > 0) {
        setTimeout(() => {
            clearInterval(streaming);
            log.warn({ mode: DROP_MODE }, "dropping client");
            dropClient(socket, DROP_MODE);
        }, DROP_AFTER_MS);
    }
});

server.on("listening", () =>
    log.info({ url: `ws://localhost:${PORT}` }, "fake Binance listening"),
);
