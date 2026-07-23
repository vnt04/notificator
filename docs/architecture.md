# Runtime Architecture (đã build)

> Tài liệu **luồng chạy thực tế** của code hiện tại, cập nhật theo từng milestone.
> Khác với [`README.md`](../README.md) (thiết kế mục tiêu, full system) và [`PLAN.md`](../PLAN.md) (kế hoạch build).
> Muốn hiểu **tại sao** Node hành xử như vậy — xem [`learning/`](./learning/).
>
> _Cập nhật: 2026-07-22 · đã triển khai tới **M1** — ingest giá Binance qua WebSocket._

## File hiện có

| File | Vai trò |
|------|---------|
| `src/index.ts` | Entrypoint: load env → tạo service → subscribe `tick` → graceful shutdown |
| `src/config/env.ts` | `loadEnv()` — đọc `.env`, validate bằng Zod, fail-fast |
| `src/util/logger.ts` | pino logger (JSON; pretty khi `NODE_ENV=development`) |
| `src/domain/types.ts` | `TradeSymbol`, `PriceTick` |
| `src/ingest/binanceMessage.ts` | `parseTradeMessage()` **pure** + type guard `isTradeMessage()` |
| `src/ingest/binancePriceService.ts` | `BinancePriceService` — WS client, emit `tick` |

## Pha khởi động (chạy 1 lần, tuần tự)

```
npm run dev  →  tsx watch --env-file-if-exists=.env src/index.ts
     │
     ▼
index.ts  →  try { main() } catch → logger.fatal + exit(1)
     ├─ loadEnv()                       // Zod validate; sai → throw → fatal exit
     ├─ logger.info("Notificator starting…")
     ├─ if (!DISCORD_WEBHOOK_URL) logger.warn(...)
     ├─ new BinancePriceService(BINANCE_WS_URL, SYMBOLS)
     │     • tracked = {"BTCUSDT","ETHUSDT"}   (HOA — để khớp payload)
     │     • url     = ".../stream?streams=btcusdt@trade/ethusdt@trade"  (thường — cho URL)
     ├─ priceService.on("tick", t => logger.info(t))   // đăng ký listener
     ├─ priceService.start()  → new WebSocket(url) + gắn handler open/message/error/close
     └─ process.on("SIGINT"/"SIGTERM", shutdown)
```

Sau khi `main()` `return`, **process không thoát**: WebSocket là một handle I/O đang mở → event loop được giữ sống để chờ sự kiện (không cần `while(true)`).

## Pha steady-state (hot path — có thể nghìn lần/giây)

```
Binance ── mỗi trade ──► socket "message" (Buffer)
                              │
                              ▼
              parseTradeMessage(data, tracked)
              ┌───────────────────────────────────┐
              │ 1. Buffer→toString→JSON.parse      │  JSON hỏng   → null
              │ 2. isTradeMessage()  (type guard)  │  frame khác  → null
              │ 3. symbol ∈ tracked?               │  symbol lạ   → null
              │ 4. parseFloat(p) hữu hạn?          │  NaN         → null
              │ 5. → PriceTick { symbol, price, ts}│
              └───────────────────────────────────┘
                              │ (≠ null)
                              ▼
              priceService.emit("tick", tick)
                              │
                              ▼
              listener (index.ts) → logger.info(tick)  → 1 dòng JSON mỗi tick
```

Mỗi trade là một vòng callback trên event loop đơn luồng. Vì trong vòng không có việc nặng/chặn nào, loop luôn kịp xử lý message kế tiếp → không rớt tick (bài học "đừng block event loop").

**2 gotcha Binance đã xử lý trong parser:** `data.p` là string → `parseFloat`; `data.s` viết HOA trong payload nhưng thường trong URL.

## 2 EventEmitter — một lớp dịch

| Emitter | Sự kiện | Tầng |
|---------|---------|------|
| `socket` (thư viện `ws`) | `open` / `message` / `error` / `close` | hạ tầng — biết WebSocket, Buffer |
| `BinancePriceService` | `tick` (`PriceTick`) | miền nghiệp vụ — không biết gì về WS |

`BinancePriceService` **dịch** `message` thô (Buffer + JSON Binance) thành `tick` sạch (`PriceTick` đã kiểm chứng). Nhờ vậy các tầng sau (queue → alertEngine) chỉ cần `service.on("tick", …)` mà **không cần biết dữ liệu đến từ Binance** → thay nguồn (Finnhub, CoinGecko…) không phải sửa alert engine.

## Mất kết nối & tắt máy (hành vi hiện tại)

```
socket "error" → logger.error(...)
socket "close" → logger.warn("... reconnect arrives in M2")   → DỪNG (chưa reconnect)

Ctrl+C → SIGINT → shutdown → logger.info → priceService.stop() (socket.close()) → exit(0)
```

⚠️ **M1 chưa reconnect:** khi socket đóng, handle I/O đó biến mất; `process.on(SIGINT/…)` **không** giữ event loop sống → nếu không còn handle nào, Node thoát lặng lẽ. Tức là hiện tại **rớt mạng = chương trình chết im** — đó là lý do M2 tồn tại.

## Gaps — mỗi milestone bồi thêm vào luồng này

| Milestone | Thêm vào luồng |
|-----------|----------------|
| **M2** | `close`/`error` → backoff + tự reconnect; timer reconnect trước mốc 24h; bắt `unhandledRejection`/`uncaughtException` |
| **M3** | Chèn giữa `tick` và log: `alertEngine` — chỉ bắn khi giá *cắt* ngưỡng + cooldown/dedup |
| **M4** | `tick` → **queue bounded** → rate limiter (backpressure) thay vì log thẳng |
| **M5** | Cuối luồng: `DiscordChannel.send()` (embed + retry 429) thay cho `logger.info` |
| **M6** | REST API + `/metrics`; graceful shutdown **drain queue**; SQLite lưu rule + lịch sử |
