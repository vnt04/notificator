# Notificator — Real-time Crypto Alert Notification System

> **Tài liệu thiết kế kỹ thuật (technical design document).** Nên đọc trước khi bắt đầu triển khai.
> Tài liệu tổng hợp mục tiêu, phát biểu bài toán, các thách thức kỹ thuật cốt lõi, kiến trúc,
> đầu ra, roadmap và tài nguyên tham khảo của dự án.
>
> _Cập nhật: 2026-07-22_

---

## 0. Tóm tắt (executive summary)

Notificator là một hệ thống **monitoring & alerting real-time**. Hệ thống theo dõi luồng giá crypto
tần suất cao (Binance WebSocket), đánh giá các điều kiện do người dùng định nghĩa, và phát thông báo
tức thì (mục tiêu độ trễ < 1 giây) qua Telegram/Discord — với đầy đủ **queue, retry, chống spam và tự
phục hồi kết nối**. Kiến trúc được thiết kế tổng quát, áp dụng được cho mọi bài toán cảnh báo dựa trên
sự kiện (event-driven alerting).

---

## 1. Mục tiêu (goal)

Mục tiêu chính là **học sâu Node.js** thông qua một project thực tế, có tần suất dữ liệu cao.

Dự án được định vị như một bài tập kỹ thuật có chủ đích, không phải một sản phẩm hướng người dùng cuối.
Bot theo dõi giá crypto đóng vai trò **phương tiện (means), không phải mục đích (end)**: nó được lựa chọn
để tiếp cận trực tiếp những phần khó và sâu nhất của Node.js — những chủ đề mà các tutorial dạng "CRUD
với Express" hầu như không đề cập tới.

> Nói ngắn gọn: bài toán crypto chỉ là công cụ; mục tiêu thật sự là bộ năng lực backend có giá trị lâu
> dài, giữ lại sau khi dự án kết thúc.

Domain đã chọn: **Crypto / chứng khoán** (dữ liệu miễn phí, tần suất cao thực tế).

---

## 2. Phát biểu bài toán (problem statement)

**Con người không thể giám sát thị trường liên tục 24/7, trong khi các sự kiện quan trọng có thể xảy ra
bất cứ lúc nào và trôi qua rất nhanh.**

- Giá coin biến động liên tục, kể cả ngoài giờ theo dõi; đến khi người dùng mở ứng dụng thì cơ hội hoặc
  rủi ro thường đã qua.
- Các công cụ sẵn có chưa đáp ứng được yêu cầu độ trễ thấp:

  | Công cụ | Điểm yếu |
  |---------|----------|
  | Yahoo Finance alert | Polling 15 phút → biết tin khi đã muộn |
  | Robinhood push | Đẩy qua server bên thứ ba → trễ 10–47 giây |
  | TradingView free | Giới hạn 20 alert, dữ liệu delay |

- **Khoảng trống cần lấp:** thông báo tức thì (< 1s), không giới hạn số alert, và kiểm soát toàn bộ đường
  gửi thông báo.

### 2.1. Lớp bài toán tổng quát (giá trị cốt lõi)

Dự án không nên được nhìn nhận hẹp như "bot giá coin". Về bản chất, nó là một hiện thân cụ thể của lớp
bài toán **real-time monitoring & alerting**:

> tiếp nhận một luồng sự kiện tốc độ cao → đánh giá điều kiện → phát thông báo đáng tin cậy khi điều kiện
> được thỏa mãn.

Cùng một khuôn kiến trúc này áp dụng cho: DevOps/SRE (PagerDuty, Datadog), fraud detection, IoT sensor
monitoring, log anomaly detection, cảnh báo thiên tai, v.v. **Chỉ cần thay đổi nguồn dữ liệu đầu vào** —
kiến trúc được giữ nguyên.

---

## 3. Cơ sở lý do triển khai (rationale)

1. **Kỹ năng chuyển giao được** — async, queue, retry, và xử lý thất bại là những năng lực áp dụng được
   trong hầu hết mọi hệ thống backend.
2. **Bằng chứng năng lực cụ thể** — một sản phẩm nhìn thấy được, chạy được, quan sát được có giá trị
   thuyết phục cao hơn nhiều so với một dòng "biết Node.js" trong CV.
3. **Rèn luyện tư duy hệ thống** — chuyển từ tiêu chí "code chạy được" sang tiêu chí "code chịu được lỗi
   và tải".

> Mô hình **Express + CRUD** chỉ dạy cách dùng Node.js như một lớp trung chuyển request.
> **Dự án này** yêu cầu vận dụng Node.js đúng với bản chất của nó: một runtime **event-driven,
> non-blocking, xử lý I/O đồng thời dưới tải cao**.

---

## 4. Các thách thức kỹ thuật cốt lõi và lợi ích

Điểm chung của các thách thức dưới đây: **duy trì tính đúng đắn và ổn định của hệ thống khi dữ liệu đầu
vào có tốc độ cao và mọi thành phần đều có thể lỗi.** Đây chính là ranh giới phân biệt giữa "người biết
code" và kỹ sư hệ thống.

| # | Thách thức | Độ khó | Kết quả học được |
|---|------------|:------:|------------------|
| 1 | **Backpressure** — đầu vào nhanh (nghìn msg/s), đầu ra chậm (Telegram ~1 msg/s). Không xử lý → cạn RAM hoặc gửi alert đã lỗi thời | Cao | Bài toán lõi của mọi hệ throughput cao (Kafka, log pipeline, streaming). Tư duy senior |
| 2 | **Không block event loop** — Node.js đơn luồng; một vòng lặp nặng có thể làm rớt hàng trăm message | Cao | Hiểu bản chất hiệu năng của Node.js và cách bảo vệ nó (CPU-bound vs I/O-bound) |
| 3 | **Gửi đáng tin cậy qua kênh hay lỗi + rate limit (429)** — retry + backoff + jitter, tôn trọng `Retry-After`, idempotency, dead-letter | Cao | Tư duy reliability: at-least-once / at-most-once / exactly-once |
| 4 | **Kết nối tự phục hồi** — Binance ngắt kết nối sau 24h, cộng với rớt mạng bất chợt; reconnect không được sót hoặc trùng message | Trung bình cao | Thiết kế hệ tự phục hồi, đảm bảo correctness dưới lỗi cục bộ |
| 5 | **Đánh giá điều kiện hiệu quả ở quy mô lớn** — nghìn luật × nghìn tick/s; O(n) scan không khả thi | Trung bình cao | Performance thực tế: lựa chọn cấu trúc dữ liệu (sorted set, chỉ kiểm tra khi "cắt" ngưỡng) |
| 6 | **State đúng theo thời gian** — lưu trạng thái trước đó để tránh spam; xử lý race condition | Trung bình cao | Lập luận về state machine và concurrency |
| 7 | **Kiểm thử thành phần async + thời gian + mạng** — test "reconnect sau 24h", "429 retry", "1000 msg/s" | Cao | Kiểm thử hành vi bất định một cách xác định (fake timers, mock WS/HTTP) |

---

## 5. Kiến trúc hệ thống (architecture)

> 📄 Sơ đồ dưới là **thiết kế mục tiêu (full system)**. Luồng **đã build thực tế** (cập nhật theo milestone) — xem [`docs/architecture.md`](./docs/architecture.md).

```
Binance WebSocket (1 kết nối, firehose)     ← cái khó #2, #4
        │
        ▼
  priceService        ← ingest, parse, lọc in-process (non-blocking)
        │
        ▼
  Event bus / Queue   ← tách ingest khỏi gửi (backpressure)   ← cái khó #1
        │
        ▼
  alertEngine         ← tra ngưỡng hiệu quả + cooldown/dedup  ← cái khó #5, #6
        │
        ▼
  Rate limiter        ← chủ động giới hạn tốc độ gửi          ← cái khó #3
        │
        ▼
  Channel (Strategy)  ← TelegramChannel / DiscordChannel / ConsoleChannel / FakeChannel
        │
        ▼
      Người dùng (điện thoại nhận thông báo)
```

**Nguyên tắc thiết kế:**

- **Channel abstraction** (Strategy pattern): một interface `Channel` với nhiều implementation. Việc bổ
  sung kênh mới không yêu cầu sửa đổi code hiện có.
- **Tách tầng (decoupling):** tầng ingest không bao giờ chờ tầng gửi. Gửi chậm không làm nghẽn tiếp nhận.
- **`FakeChannel`** giả lập rate limit và random 429 để kiểm thử retry và rate limiter mà không bị ban ở
  kênh thật.
- **Cấu hình qua biến môi trường** (`.env`), validate bằng Zod. Không hardcode secret.

---

## 6. Đầu ra bàn giao (deliverables)

Sắp xếp theo thứ tự từ "gây ấn tượng ngay" đến "chứng minh chiều sâu kỹ thuật":

1. **Thông báo thực tế trên thiết bị di động** — video demo 10 giây: giá chạm ngưỡng → điện thoại nhận
   thông báo sau khoảng 0.5 giây.
2. **REST API** — `POST /alerts`, `GET /alerts`, `GET /notifications`, `GET /health`. Các trạng thái
   `sent / failed / throttled / retried` là bằng chứng cho việc xử lý retry và rate limit.
3. **`GET /metrics`** — các chỉ số định lượng chứng minh tính chất "tần suất cao":
   - Message ingest/giây (ví dụ ~3.200/s trong giai đoạn biến động)
   - Số message đã gửi / throttle / fail / retry
   - Độ trễ end-to-end (WS → điện thoại) p50/p95
   - WebSocket uptime và số lần reconnect
4. **Dashboard web** (tùy chọn) — ticker giá live, danh sách alert, feed thông báo, biểu đồ throughput.
5. **Artifact phát triển** — log có cấu trúc, báo cáo test và coverage (~80%), README kèm sơ đồ kiến trúc.

> Ba đầu ra có sức thuyết phục cao nhất: **(1)** video thông báo trên thiết bị di động · **(2)** trang
> metrics throughput/latency · **(3)** README kèm sơ đồ kiến trúc và coverage đạt chuẩn.

---

## 7. Tech stack

| Thành phần | Lựa chọn | Ghi chú |
|------------|----------|---------|
| Runtime | **Node.js 20+** | native `fetch`, ESM |
| Ngôn ngữ | **TypeScript** (khuyến nghị) / JS | TS bổ sung type-safety cho hệ async |
| WebSocket client | **`ws`** | thư viện chuẩn cho Node |
| HTTP API | **Express** hoặc **Fastify** | |
| Validation | **Zod** | validate config + input ở biên |
| Queue | In-memory (giai đoạn đầu) → **BullMQ + Redis** | bắt đầu đơn giản |
| Telegram | **grammY** hoặc gọi Bot API trực tiếp | |
| Discord | Webhook (POST JSON) hoặc **discord.js** | webhook = nhanh nhất |
| DB | **SQLite** (better-sqlite3) | đủ dùng, không cần DB server |
| Test | **Vitest** + fake timers | test async + time |
| Logger | **pino** / Winston | log có cấu trúc |

**Ba quyết định cần chốt trước khi triển khai:** coin theo dõi? · Telegram hay Discord? · TypeScript hay JavaScript?

---

## 8. Roadmap theo tầng (mỗi tầng tương ứng một thách thức)

Nguyên tắc triển khai: xây dựng **theo tầng**. Mỗi tầng nhỏ, chạy được, và được hiểu thấu đáo trước khi
chuyển sang tầng kế tiếp (theo tinh thần TDD).

- [ ] **Tầng 1 — Kết nối 1 WebSocket Binance, in giá ra**
      → tiếp cận event loop, EventEmitter, Buffer _(cái khó #2)_
- [ ] **Tầng 2 — Reconnect + backoff khi rớt kết nối / sau 24h**
      → xử lý lỗi async, đảm bảo process không dừng _(cái khó #4)_
- [ ] **Tầng 3 — Alert engine + cooldown/dedup**
      → timers, state, closure, "chỉ báo khi cắt ngưỡng" _(cái khó #5, #6)_
- [ ] **Tầng 4 — Queue + rate limiter cho tầng gửi**
      → backpressure, producer/consumer _(cái khó #1)_
- [ ] **Tầng 5 — Gửi Telegram/Discord thực tế + retry 429**
      → I/O thực tế, retry + backoff + idempotency _(cái khó #3)_
- [ ] **Tầng 6 — Metrics + graceful shutdown (SIGTERM)**
      → process lifecycle, observability
- [ ] **Tầng 7 — Kiểm thử async toàn diện (~80% coverage)**
      → fake timers, mock WS/HTTP _(cái khó #7)_

---

## 9. Nguồn dữ liệu đầu vào (data sources)

### 9.1. Binance WebSocket — nguồn chính, miễn phí, không yêu cầu API key cho market data

- Docs: <https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md>
- **Endpoint:** `wss://stream.binance.com:9443` (hoặc `:443`); market-data-only: `wss://data-stream.binance.vision`
- **Stream cho alert giá** (symbol viết thường):
  - `btcusdt@trade` — từng giao dịch (tần suất cao nhất)
  - `btcusdt@miniTicker` / `btcusdt@ticker` — tóm tắt giá, nhẹ hơn
  - `btcusdt@bookTicker` — best bid/ask, cập nhật mỗi thay đổi
  - `!ticker@arr` — **toàn bộ thị trường** trong 1 stream (firehose)
- **Combined stream:** `wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade`
- **Lưu ý:** một kết nối chỉ tồn tại 24h rồi bị ngắt → bắt buộc reconnect. Trong giai đoạn biến động,
  lưu lượng có thể đạt hàng nghìn msg/giây → yêu cầu xử lý backpressure.

### 9.2. Nguồn thay thế / bổ sung

| Nguồn | Dùng cho | Link |
|-------|----------|------|
| Finnhub (WS) | Cổ phiếu Mỹ, free 30 mã, `wss://ws.finnhub.io` | <https://finnhub.io/docs/api/websocket-trades> |
| CoinGecko | Giá 12.000+ coin, WS + REST | <https://www.coingecko.com/en/api/websocket> |
| Pyth Hermes | Oracle giá on-chain, SSE, `hermes.pyth.network` | <https://gist.github.com/Sugoidao/7e986e07c78d9a56aad1448ccb526d20> |
| TerminalFeed | API tổng hợp, **no-auth**, test nhanh | <https://terminalfeed.io/developers> |
| So sánh free crypto WS | Nhiều sàn | <https://apidog.com/blog/free-crypto-websocket-api/> |

---

## 10. Repo tham khảo (học kiến trúc)

### 10.1. Enmilo-dev/kairos-quantum — tham chiếu sát nhất với mục tiêu

<https://github.com/Enmilo-dev/kairos-quantum>

Monitor 2000+ cặp Binance qua **1 WebSocket** → Redis Pub/Sub → alert engine (Redis Sorted Set, tra
ngưỡng O(log n)) → Telegram. TS + PM2 + Winston + Prisma. Nên đọc kỹ phần "Key Technical Decisions".

| Repo | Điểm học được |
|------|---------------|
| <https://github.com/toth2000/alertWave> | Stock alert microservices: gateway, auth, subscription, scheduler, notification qua queue |
| <https://github.com/Pratham-Dabhane/Glide> | Monitor + multi-channel alert (Slack/email), cron, tách `services/` sạch |
| <https://github.com/unish6123/social-pulse> | Ingest nhiều nguồn → spike detection → alert; Kafka + Redis |

---

## 11. Blog / bài viết tham khảo (có code)

- **Free Real-Time Stock Alert System with Finnhub WebSockets** (Node.js + WS + Telegram, ~150 dòng).
  Đọc kỹ phần "gotchas": reconnect backoff 1s→30s, chỉ lấy trade cuối trong batch, cooldown, lọc giờ.
  <https://orthogonal.info/free-real-time-stock-alert-system-finnhub-websockets/>
- Building a Real-Time Earthquake Alert System (BOT + API + DB), dedup `ON CONFLICT DO NOTHING`.
  <https://dev.to/naimurrahmannahid/building-a-real-time-earthquake-alert-system-using-bot-api-database-1376>
- Build a Real-Time News Sentiment API (Node.js) — ingest + spike + webhook, bàn về BullMQ.
  <https://atlassignal.in/posts/build-a-real-time-news-sentiment-api-tracking-political-keyw/>
- 10 realtime data sources you won't believe are free.
  <https://ably.com/blog/10-realtime-data-sources-you-wont-believe-are-free>

### 11.1. Tài nguyên chuyên sâu về Node.js (khái niệm nền tảng)

- Backpressuring in Streams (docs chính thức): <https://nodejs.org/learn/modules/backpressuring-in-streams>
- Your Node.js Streams Aren't Backpressuring (Frontend Masters):
  <https://frontendmasters.com/blog/your-node-js-streams-arent-backpressuring-theyre-silently-eating-your-memory/>
- Node.js Graceful Shutdown: The Right Way (SIGTERM, draining):
  <https://dev.to/axiom_agent/nodejs-graceful-shutdown-the-right-way-sigterm-connection-draining-and-kubernetes-fp8>

---

## 12. Danh mục tổng hợp (mở rộng nguồn dữ liệu)

- **conduktor/public-streaming-api** — 70+ nguồn real-time miễn phí, phần lớn không cần key, có WS viewer:
  <https://github.com/conduktor/public-streaming-api>
- **bytewax/awesome-public-real-time-datasets** — tuyển tập dataset real-time:
  <https://github.com/bytewax/awesome-public-real-time-datasets>

---

## 13. Tài liệu ưu tiên đọc trước (top 3)

1. [Binance WS docs](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md) — danh sách stream và định dạng dữ liệu.
2. [kairos-quantum README](https://github.com/Enmilo-dev/kairos-quantum) — tham chiếu về một kiến trúc "đúng".
3. [Bài Finnhub](https://orthogonal.info/free-real-time-stock-alert-system-finnhub-websockets/) — code thực tế kèm các bẫy thường gặp.

