import { describe, it, expect } from "vitest";
import { parseTradeMessage } from "../src/ingest/binanceMessage.js";

const tracked: ReadonlySet<string> = new Set(["BTCUSDT", "ETHUSDT"]);

function tradeFrame(
    overrides: Partial<{ s: string; p: string; T: number }> = {},
): string {
    return JSON.stringify({
        stream: "btcusdt@trade",
        data: {
            e: "trade",
            s: "BTCUSDT",
            p: "92145.30",
            T: 1699999999990,
            ...overrides,
        },
    });
}

describe("parseTradeMessage", () => {
    it("parses a valid trade frame into a PriceTick with a numeric price", () => {
        const tick = parseTradeMessage(tradeFrame(), tracked);

        expect(tick).toEqual({
            symbol: "BTCUSDT",
            price: 92145.3,
            ts: 1699999999990,
        });
    });

    it("accepts a Buffer payload, not just a string", () => {
        const tick = parseTradeMessage(Buffer.from(tradeFrame()), tracked);

        expect(tick?.price).toBe(92145.3);
    });

    it("returns null for an untracked symbol", () => {
        const tick = parseTradeMessage(tradeFrame({ s: "BNBUSDT" }), tracked);

        expect(tick).toBeNull();
    });

    it("returns null when the price is not a finite number", () => {
        const tick = parseTradeMessage(
            tradeFrame({ p: "not-a-number" }),
            tracked,
        );

        expect(tick).toBeNull();
    });

    it("returns null for malformed JSON instead of throwing", () => {
        expect(() => parseTradeMessage("{not json", tracked)).not.toThrow();
        expect(parseTradeMessage("{not json", tracked)).toBeNull();
    });

    it("returns null for a non-trade control frame", () => {
        const controlFrame = JSON.stringify({ result: null, id: 1 });

        expect(parseTradeMessage(controlFrame, tracked)).toBeNull();
    });
});
