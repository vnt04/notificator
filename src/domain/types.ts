// Named TradeSymbol (not Symbol) to avoid shadowing the built-in global Symbol.
export type TradeSymbol = "BTCUSDT" | "ETHUSDT";

export interface PriceTick {
    symbol: TradeSymbol;
    price: number;
    ts: number;
}
