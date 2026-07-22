# Notificator — Plan Triển Khai

> Kế hoạch build chi tiết. Đọc kèm [`README.md`](./README.md).
> **Cấu hình đã chốt:** coin = **BTC + ETH** · kênh = **Discord (webhook)** · ngôn ngữ = **TypeScript**.
>
> _Cập nhật: 2026-07-21_

---

## 1. Phạm vi MVP (Definition of Scope)

Xây một service chạy 24/7:

1. Kết nối Binance WebSocket, nhận **giá BTC + ETH** real-time.
2. Cho phép đặt **luật alert** (vd "BTC > 92000", "ETH < 3000").
3. Khi giá **cắt ngưỡng** → gửi thông báo **Discord** (< 1s), có chống spam.
4. Chịu lỗi: tự reconnect, retry khi Discord 429, không mất/không gửi trùng.
5. Có **REST API** (quản lý alert + lịch sử) và **`/metrics`** (throughput/latency).

**Ngoài phạm vi MVP** (làm sau): multi-user + auth, nhiều sàn, dashboard web, Redis/BullMQ,
alert phức tạp (volume spike, % thay đổi). Bắt đầu **in-memory + SQLite**, đơn giản trước.

---

## 2. Chuẩn bị (Prerequisites)

### 2.1. Công cụ
- Node.js **20+**, npm.
- Editor có TypeScript (VS Code).

### 2.2. Lấy Discord Webhook URL (không cần bot)
1. Vào server Discord → **Server Settings** → **Integrations** → **Webhooks**.
2. **New Webhook** → chọn channel → **Copy Webhook URL**.
3. Dán vào `.env` (`DISCORD_WEBHOOK_URL=...`). **Không commit** file `.env`.

### 2.3. Binance (không cần API key cho market data)
- Endpoint: `wss://stream.binance.com:9443`
- Dùng **combined stream** cho BTC + ETH:
  ```
  wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade
  ```
- ⚠️ 1 kết nối **chỉ sống 24h** → phải reconnect. Server gửi **ping mỗi 3 phút** → phải trả pong
  (thư viện `ws` mặc định `autoPong: true`).

---

## 3. Cấu trúc thư mục

```
notificator/
├── README.md
├── PLAN.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── src/
│   ├── index.ts                 # entrypoint: wiring + graceful shutdown
│   ├── config/env.ts            # đọc + validate .env bằng Zod
│   ├── domain/
│   │   ├── types.ts             # PriceTick, AlertRule, Notification, Channel
│   │   └── alertEngine.ts       # đánh giá ngưỡng + crossing + cooldown
│   ├── ingest/
│   │   └── binancePriceService.ts   # WS client, phát PriceTick (EventEmitter)
│   ├── delivery/
│   │   ├── channel.ts           # interface Channel (Strategy)
│   │   ├── consoleChannel.ts
│   │   ├── fakeChannel.ts       # giả lập 429 để test
│   │   ├── discordChannel.ts    # gửi embed qua webhook + retry 429
│   │   ├── queue.ts             # hàng đợi bounded (backpressure)
│   │   └── rateLimiter.ts       # token bucket
│   ├── api/server.ts            # REST + /health + /metrics
│   ├── store/sqlite.ts          # lưu alert + lịch sử notification
│   ├── metrics/metrics.ts       # bộ đếm + latency percentile
│   └── util/
│       ├── backoff.ts           # exponential backoff + jitter
│       └── logger.ts            # pino
└── test/
    ├── alertEngine.test.ts
    ├── rateLimiter.test.ts
    ├── backoff.test.ts
    └── discordChannel.test.ts
```

---

## 4. Data contracts (TypeScript)

```ts
// --- Binance combined-stream trade payload ---
interface BinanceTradeMessage {
  stream: string;                 // "btcusdt@trade"
  data: {
    e: "trade"; E: number; s: string; t: number;
    p: string;                    // price — LƯU Ý: là string, phải parseFloat
    q: string; T: number; m: boolean; M: boolean;
  };
}

// --- Domain ---
type Symbol = "BTCUSDT" | "ETHUSDT";
interface PriceTick { symbol: Symbol; price: number; ts: number; }

type AlertCondition = "above" | "below";
interface AlertRule {
  id: string; symbol: Symbol; condition: AlertCondition;
  threshold: number; cooldownMs: number; enabled: boolean;
}

type NotificationStatus = "pending" | "sent" | "failed" | "throttled";
interface Notification {
  id: string; ruleId: string; symbol: Symbol; price: number;
  message: string; status: NotificationStatus; attempts: number;
  createdAt: number; sentAt?: number; error?: string;
}

// --- Strategy pattern cho kênh gửi ---
interface Channel {
  readonly name: string;
  send(n: Notification): Promise<void>;   // throw nếu lỗi vĩnh viễn
}
```

### `.env.example`
```
DISCORD_WEBHOOK_URL=
BINANCE_WS_URL=wss://stream.binance.com:9443
SYMBOLS=btcusdt,ethusdt
PORT=3000
SEND_RATE_PER_SEC=1
QUEUE_MAX=1000
LOG_LEVEL=info
```

---

## 5. Lộ trình theo tầng (Milestones)

> Nguyên tắc: mỗi tầng **nhỏ, chạy được, có test/nghiệm thu** rồi mới sang tầng sau.

### ✅ M0 — Setup & tooling
**Mục tiêu:** khung TypeScript chạy được. **Khái niệm:** TS project, ESM, tooling.
- [ ] `npm init`, cài `typescript ws zod pino express better-sqlite3` + dev `tsx vitest @types/*`.
- [ ] `tsconfig.json` bật `strict: true`, `module: NodeNext`.
- [ ] Scripts: `dev` (`tsx watch src/index.ts`), `build` (`tsc`), `test` (`vitest`), `lint`.
- [ ] `.gitignore` (node_modules, dist, .env, *.sqlite), `.env.example`.
- [ ] `src/config/env.ts`: đọc `.env`, validate bằng Zod, fail-fast nếu thiếu `DISCORD_WEBHOOK_URL`.
- **Nghiệm thu:** `npm run dev` in "Notificator starting…"; `npm test` chạy (dù 0 test).

---

### M1 — Kết nối Binance WS, in giá BTC/ETH  🔴 event loop
**Mục tiêu:** thấy giá live chạy ra màn hình. **Khái niệm:** event loop, EventEmitter, Buffer, WS events.
- [x] `binancePriceService.ts`: kết nối combined stream `btcusdt@trade/ethusdt@trade`.
- [x] Xử lý events `open` / `message` / `error` / `close`.
- [x] Parse `BinanceTradeMessage`, `parseFloat(data.p)`, emit `PriceTick` qua EventEmitter.
- [x] `index.ts`: subscribe và `logger.info` mỗi tick.
- **Nghiệm thu:** chạy → thấy giá BTC + ETH cập nhật liên tục (nhiều lần/giây).

---

### M2 — Resilience: reconnect + backoff + 24h  🟠 async error / stability
**Mục tiêu:** không bao giờ chết. **Khái niệm:** xử lý lỗi async, process ổn định.
- [ ] `util/backoff.ts`: exponential backoff + jitter (1s → tối đa 30s).
- [ ] Tự reconnect khi `close`/`error`; reset backoff khi `open` thành công.
- [ ] Chủ động reconnect **trước mốc 24h** (đặt timer ~23h).
- [ ] Bắt `unhandledRejection` / `uncaughtException` để log, không crash âm thầm.
- **Nghiệm thu:** ngắt mạng / force close → tự reconnect, log rõ; test backoff bằng **fake timers**.

---

### M3 — Alert engine + crossing + cooldown  🟠 state machine
**Mục tiêu:** báo đúng, không spam. **Khái niệm:** state, closure, timers, dedup, crossing.
- [ ] `alertEngine.ts`: nhận `PriceTick` + danh sách `AlertRule`, trả về notification cần bắn.
- [ ] **Chỉ bắn khi giá "cắt" ngưỡng** (nhớ `lastState` trên/dưới của mỗi rule) — không bắn mỗi tick.
- [ ] Cooldown: sau khi bắn, im lặng `cooldownMs` cho rule đó.
- [ ] Rule store in-memory (hard-code vài rule BTC/ETH để test).
- **Nghiệm thu (unit test):** cắt ngưỡng bắn **1 lần**; ở yên trên ngưỡng **không** bắn lại;
      cooldown được tôn trọng.

---

### M4 — Queue + rate limiter  🔴 backpressure
**Mục tiêu:** vào nhanh — ra chậm mà không sập. **Khái niệm:** backpressure, producer/consumer.
- [ ] `queue.ts`: hàng đợi **bounded** (`QUEUE_MAX`). Khi đầy → drop-oldest (hoặc coalesce) + **log số bị bỏ**.
- [ ] `rateLimiter.ts`: token bucket `SEND_RATE_PER_SEC` (khớp giới hạn Discord).
- [ ] Worker rút queue theo nhịp rate limiter, gọi channel.send().
- **Nghiệm thu:** bơm 1000 alert giả → queue rút đúng tốc độ, RAM không phình, số drop được log.

---

### M5 — Discord channel thật + retry 429  🔴 reliability
**Mục tiêu:** gửi thật, đáng tin. **Khái niệm:** I/O thật, retry, idempotency, at-least-once.
- [ ] `channel.ts` (interface) + `consoleChannel.ts` + `fakeChannel.ts` (random 429 + delay).
- [ ] `discordChannel.ts`: POST **embed** tới webhook.
  - Body embed: `{ embeds: [{ title, description, color, timestamp, fields }] }`.
  - Màu theo hướng: xanh (above) / đỏ (below).
- [ ] Xử lý **429**: đọc `retry_after` (giây, trong body JSON), chờ đúng số đó rồi retry (+ backoff/jitter).
- [ ] Retry tối đa N lần → `failed` + dead-letter (log). Idempotency: không gửi trùng khi retry.
- **Nghiệm thu:** test với `FakeChannel` chứng minh retry hoạt động; webhook Discord **nhận được embed thật**.

---

### M6 — REST API + metrics + graceful shutdown  🟠 lifecycle/observability
**Mục tiêu:** quản lý được + đo được + tắt êm. **Khái niệm:** process lifecycle, observability.
- [ ] `store/sqlite.ts`: lưu `AlertRule` + lịch sử `Notification`.
- [ ] `api/server.ts` (Express):
  - `POST /alerts` (Zod validate), `GET /alerts`, `PATCH /alerts/:id`, `DELETE /alerts/:id`
  - `GET /notifications?limit=` — lịch sử + trạng thái
  - `GET /health` — trạng thái WS + bộ đếm
  - `GET /metrics` — ingest/s, sent/throttled/failed/retried, latency p50/p95, uptime, reconnect count
- [ ] Graceful shutdown `SIGTERM`/`SIGINT`: ngừng nhận → drain queue → đóng WS → đóng DB → exit.
- **Nghiệm thu:** `/health` phản ánh đúng; gửi SIGTERM → drain sạch, không mất tin đang trong queue.

---

### M7 — Test & coverage ~80%  🔴 test async + time
**Mục tiêu:** tin được là nó đúng. **Khái niệm:** test cái bất định một cách xác định.
- [ ] Unit: alertEngine (crossing/cooldown), rateLimiter, backoff, discordChannel (retry 429 qua fetch mock).
- [ ] Integration: mock WS → engine → fakeChannel end-to-end.
- [ ] Dùng **fake timers** cho cooldown / backoff / reconnect.
- **Nghiệm thu:** `npm test -- --coverage` ≥ **80%** trên phần logic lõi.

---

## 6. Chi tiết kỹ thuật cần nhớ

### Binance `@trade` payload (combined stream)
```json
{ "stream": "btcusdt@trade",
  "data": { "e":"trade","E":1699999999999,"s":"BTCUSDT","t":123,
            "p":"92145.30","q":"0.01","T":1699999999990,"m":true,"M":true } }
```
- `p` (giá) là **string** → luôn `parseFloat`.
- Symbol trong URL viết **thường** (`btcusdt`), trong payload viết **hoa** (`BTCUSDT`).

### Discord webhook — rate limit & 429
- Giới hạn ~**5 request / 2 giây** mỗi webhook (đó là lý do có rate limiter M4).
- Khi vượt → **HTTP 429**, body: `{ "message": "...", "retry_after": 0.53, "global": false }`
  → `retry_after` tính bằng **giây** (số thực). Chờ đúng số đó rồi retry.
- Có headers `X-RateLimit-Remaining`, `X-RateLimit-Reset-After` để chủ động điều tiết.

---

## 7. Definition of Done (toàn dự án)

- [ ] Chạy `npm run dev` → nhận giá BTC/ETH, đặt được alert, giá cắt ngưỡng → **Discord rung thật**.
- [ ] Tự reconnect khi rớt; retry khi Discord 429; không gửi trùng, không spam (cooldown).
- [ ] `/metrics` cho số thật; `/health` đúng trạng thái; SIGTERM tắt êm.
- [ ] Test coverage ≥ 80% phần logic lõi.
- [ ] README có sơ đồ kiến trúc; `.env.example` đầy đủ; không lộ secret.

---

## 8. Bắt đầu từ đâu

**Bước 1 = M0** (setup TypeScript + tooling), rồi **M1** (kết nối WS in giá BTC/ETH — ~30 phút là thấy giá chạy).

> Khi bắt đầu code: làm **tuần tự M0 → M7**, mỗi tầng xong nghiệm thu trước khi qua tầng kế.
> Không nhảy cóc — cái hay của project nằm ở việc chinh phục **từng cái khó** một cách trọn vẹn.
