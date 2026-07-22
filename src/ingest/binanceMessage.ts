import type { PriceTick, TradeSymbol } from "../domain/types.js";

// Binance combined-stream trade frame. `data.p` is a string; `data.s` is UPPERCASE.
export interface BinanceTradeMessage {
    stream: string;
    data: {
        e: "trade";
        s: string;
        p: string;
        T: number;
    };
}

// One bad frame must never crash ingest: control frames, untracked symbols, or
// malformed data all resolve to null so the caller simply skips them.
export function parseTradeMessage(
    raw: Buffer | string,
    tracked: ReadonlySet<string>,
): PriceTick | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
        return null;
    }

    if (!isTradeMessage(parsed)) return null;

    const { s, p, T } = parsed.data;
    if (!tracked.has(s)) return null;

    const price = Number.parseFloat(p);
    if (!Number.isFinite(price)) return null;

    return { symbol: s as TradeSymbol, price, ts: T };
}

function isTradeMessage(value: unknown): value is BinanceTradeMessage {
    if (typeof value !== "object" || value === null) return false;
    const data = (value as { data?: unknown }).data;
    if (typeof data !== "object" || data === null) return false;

    const d = data as Record<string, unknown>;
    return (
        d.e === "trade" &&
        typeof d.s === "string" &&
        typeof d.p === "string" &&
        typeof d.T === "number"
    );
}
