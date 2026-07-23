import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PriceTick } from "../src/domain/types.js";

interface FakeSocket {
    readonly url: string;
    closeCalls: number;
    emit(event: string, ...args: unknown[]): boolean;
}

const h = vi.hoisted(() => ({ sockets: [] as FakeSocket[] }));

vi.mock("ws", async () => {
    const { EventEmitter } = await import("node:events");

    class FakeWebSocket extends EventEmitter {
        readonly url: string;
        closeCalls = 0;

        constructor(url: string) {
            super();
            this.url = url;
            h.sockets.push(this);
        }

        close(): void {
            this.closeCalls += 1;
        }
    }

    return { WebSocket: FakeWebSocket };
});

vi.mock("../src/util/logger.js", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
    },
}));

const { BinancePriceService, REFRESH_AFTER_MS } =
    await import("../src/ingest/binancePriceService.js");

// Lần thử đầu nằm trong (800, 1000]; nhảy qua mốc này là chắc chắn đã reconnect.
const FIRST_ATTEMPT_CEILING_MS = 1_000;

function socketAt(index: number): FakeSocket {
    const socket = h.sockets[index];
    if (!socket) throw new Error(`no socket created at index ${index}`);
    return socket;
}

function tradeFrame(symbol = "BTCUSDT", price = "92145.30"): Buffer {
    return Buffer.from(
        JSON.stringify({
            stream: `${symbol.toLowerCase()}@trade`,
            data: { e: "trade", s: symbol, p: price, T: 1_699_999_999_990 },
        }),
    );
}

function newService(): InstanceType<typeof BinancePriceService> {
    return new BinancePriceService("ws://fake", ["btcusdt"]);
}

describe("BinancePriceService", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        h.sockets.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("opens a single socket with the combined-stream URL on start", () => {
        newService().start();

        expect(h.sockets).toHaveLength(1);
        expect(socketAt(0).url).toBe("ws://fake/stream?streams=btcusdt@trade");
    });

    it("reconnects after a backoff delay when the socket closes", () => {
        newService().start();
        socketAt(0).emit("close", 1006);

        // Không nối lại tức thì — phải chờ hết backoff.
        expect(h.sockets).toHaveLength(1);

        vi.advanceTimersByTime(700);
        expect(h.sockets).toHaveLength(1);

        vi.advanceTimersByTime(400);
        expect(h.sockets).toHaveLength(2);
    });

    it("grows the delay while attempts keep failing", () => {
        newService().start();

        socketAt(0).emit("close", 1006);
        vi.advanceTimersByTime(FIRST_ATTEMPT_CEILING_MS);
        expect(h.sockets).toHaveLength(2);

        // Lần 2 cần tới ~2s, nên 1s là chưa đủ.
        socketAt(1).emit("close", 1006);
        vi.advanceTimersByTime(FIRST_ATTEMPT_CEILING_MS);
        expect(h.sockets).toHaveLength(2);

        vi.advanceTimersByTime(1_100);
        expect(h.sockets).toHaveLength(3);
    });

    it("resets the delay after a successful open", () => {
        newService().start();

        socketAt(0).emit("close", 1006);
        vi.advanceTimersByTime(FIRST_ATTEMPT_CEILING_MS);
        socketAt(1).emit("open");

        socketAt(1).emit("close", 1006);
        vi.advanceTimersByTime(FIRST_ATTEMPT_CEILING_MS);
        expect(h.sockets).toHaveLength(3);
    });

    it("keeps emitting ticks from the socket created by a reconnect", () => {
        const service = newService();
        const ticks: PriceTick[] = [];
        service.on("tick", (tick) => ticks.push(tick));
        service.start();

        socketAt(0).emit("close", 1006);
        vi.advanceTimersByTime(FIRST_ATTEMPT_CEILING_MS);
        socketAt(1).emit("open");
        socketAt(1).emit("message", tradeFrame());

        expect(ticks).toEqual([
            { symbol: "BTCUSDT", price: 92145.3, ts: 1_699_999_999_990 },
        ]);
    });

    it("closes the socket before the 24h server limit so it can be refreshed", () => {
        newService().start();
        socketAt(0).emit("open");

        vi.advanceTimersByTime(REFRESH_AFTER_MS - 1);
        expect(socketAt(0).closeCalls).toBe(0);

        vi.advanceTimersByTime(1);
        expect(socketAt(0).closeCalls).toBe(1);
    });

    it("does not reconnect after stop()", async () => {
        const service = newService();
        service.start();

        const stopping = service.stop();
        socketAt(0).emit("close", 1006);
        await stopping;

        vi.advanceTimersByTime(60_000);

        expect(h.sockets).toHaveLength(1);
    });

    it("does not schedule a refresh after stop()", async () => {
        const service = newService();
        service.start();
        socketAt(0).emit("open");

        const stopping = service.stop();
        socketAt(0).emit("close", 1000);
        await stopping;

        vi.advanceTimersByTime(REFRESH_AFTER_MS * 2);

        // Chỉ đúng 1 lần close() do stop(), không có lần nào từ timer refresh.
        expect(socketAt(0).closeCalls).toBe(1);
        expect(h.sockets).toHaveLength(1);
    });

    it("stop() resolves only after the socket has finished closing", async () => {
        const service = newService();
        service.start();
        socketAt(0).emit("open");

        let settled = false;
        const stopping = service.stop().then(() => {
            settled = true;
        });

        // Đã yêu cầu đóng, nhưng socket chưa báo "close" → stop() phải còn treo.
        await Promise.resolve();
        expect(socketAt(0).closeCalls).toBe(1);
        expect(settled).toBe(false);

        socketAt(0).emit("close", 1000);
        await stopping;
        expect(settled).toBe(true);
    });

    it("stop() resolves immediately when no socket is open", async () => {
        await expect(newService().stop()).resolves.toBeUndefined();
    });
});
