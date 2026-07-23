import { EventEmitter, once } from "node:events";
import { WebSocket } from "ws";
import type { PriceTick } from "../domain/types.js";
import { parseTradeMessage } from "./binanceMessage.js";
import { backoffDelay } from "../util/backoff.js";
import { logger } from "../util/logger.js";

// Binance cắt mọi kết nối ở mốc 24h. Làm mới sớm hơn để tự chọn thời điểm đứt
// thay vì bị đứt vào lúc không lường trước.
export const REFRESH_AFTER_MS = 23 * 60 * 60 * 1_000;

interface PriceServiceEvents {
    tick: (tick: PriceTick) => void;
}

// Declaration merging gives typed on()/emit() over the untyped EventEmitter base.
export interface BinancePriceService {
    on<E extends keyof PriceServiceEvents>(
        event: E,
        listener: PriceServiceEvents[E],
    ): this;
    emit<E extends keyof PriceServiceEvents>(
        event: E,
        ...args: Parameters<PriceServiceEvents[E]>
    ): boolean;
}

export class BinancePriceService extends EventEmitter {
    private socket: WebSocket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private refreshTimer: NodeJS.Timeout | null = null;
    private attempt = 0;
    private stopped = false;

    private readonly url: string;
    // Payload symbols are UPPERCASE; the stream URL wants them lowercase.
    private readonly tracked: ReadonlySet<string>;

    constructor(baseUrl: string, symbols: readonly string[]) {
        super();
        this.tracked = new Set(symbols.map((s) => s.toUpperCase()));
        const streams = symbols
            .map((s) => `${s.toLowerCase()}@trade`)
            .join("/");
        this.url = `${baseUrl}/stream?streams=${streams}`;
    }

    start(): void {
        this.stopped = false;
        this.connect();
    }

    /** Chờ tới khi socket đóng xong, để caller kịp tắt máy êm thay vì cắt ngang. */
    async stop(): Promise<void> {
        this.stopped = true;
        this.clearReconnectTimer();
        this.clearRefreshTimer();

        const socket = this.socket;
        if (!socket) return;

        // Listener giữ nguyên: gỡ hết rồi mà socket còn emit "error" thì
        // EventEmitter sẽ throw. Cờ `stopped` mới là thứ chặn reconnect.
        const closed = once(socket, "close");
        socket.close(1000, "shutting down");

        // once() reject nếu "error" đến trước "close"; lỗi lúc đang đóng thì
        // vẫn coi như đã đóng.
        await closed.catch(() => undefined);
    }

    private connect(): void {
        const socket = new WebSocket(this.url);
        this.socket = socket;

        socket.on("open", () => {
            this.attempt = 0;
            logger.info({ url: this.url }, "Binance WS connected");
            this.scheduleRefresh();
        });

        socket.on("message", (data: Buffer) => {
            const tick = parseTradeMessage(data, this.tracked);
            if (tick) this.emit("tick", tick);
        });

        // Đo ở docs/learning/m2.md: mất kết nối đang chạy KHÔNG bắn "error" (dù
        // FIN hay RST) — "error" chỉ bắn khi bắt tay thất bại. "close" là sự kiện
        // duy nhất luôn xảy ra, nên reconnect phải drive từ nó.
        socket.on("error", (err) => logger.error({ err }, "Binance WS error"));
        socket.on("close", (code) => this.handleClose(code));
    }

    private handleClose(code: number): void {
        this.clearRefreshTimer();
        this.socket = null;

        if (this.stopped) {
            logger.info({ code }, "Binance WS closed after stop()");
            return;
        }

        this.attempt += 1;
        const delayMs = backoffDelay(this.attempt);

        logger.warn(
            { code, attempt: this.attempt, delayMs },
            "Binance WS closed — reconnecting",
        );

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delayMs);
    }

    private scheduleRefresh(): void {
        this.clearRefreshTimer();

        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            logger.info("Refreshing Binance WS ahead of the 24h server limit");
            this.socket?.close(1000, "scheduled refresh");
        }, REFRESH_AFTER_MS);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    private clearRefreshTimer(): void {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
    }
}
