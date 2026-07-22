import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import type { PriceTick } from "../domain/types.js";
import { parseTradeMessage } from "./binanceMessage.js";
import { logger } from "../util/logger.js";

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
        const socket = new WebSocket(this.url);
        this.socket = socket;

        socket.on("open", () =>
            logger.info({ url: this.url }, "Binance WS connected"),
        );
        socket.on("message", (data: Buffer) => {
            const tick = parseTradeMessage(data, this.tracked);
            if (tick) this.emit("tick", tick);
        });
        socket.on("error", (err) => logger.error({ err }, "Binance WS error"));
        socket.on("close", (code) =>
            logger.warn(
                { code },
                "Binance WS closed (reconnect arrives in M2)",
            ),
        );
    }

    stop(): void {
        this.socket?.close();
        this.socket = null;
    }
}
