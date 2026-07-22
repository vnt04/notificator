# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Notificator — a real-time crypto price-alert service. It ingests Binance WebSocket price ticks (BTC/ETH), evaluates threshold rules, and pushes alerts to Discord with queueing, retry, rate-limiting, and auto-reconnect. It is primarily a **learning project for deep Node.js** (backpressure, the event loop, async reliability); the crypto bot is the vehicle, not the goal. `README.md` is the design doc, `PLAN.md` is the milestone build plan.

## Commands

```bash
npm run dev            # tsx watch, hot-reload; loads .env if present
npm run build          # tsc -> dist/
npm start              # run built dist/index.js
npm run typecheck      # tsc --noEmit over src + test/config surface
npm test               # vitest run (once)
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest run with v8 coverage
```

Run a single test file or a single case by name:

```bash
npx vitest run test/env.test.ts
npx vitest run -t "throws when PORT is invalid"
```

Requires Node **>= 20.12**. `.env` is optional (copy `.env.example`); dev/start load it via Node's native `--env-file-if-exists`, so there is no `dotenv` dependency.

## Architecture

A decoupled pipeline — each stage is separated so ingest never blocks on delivery:

```
Binance WS -> priceService -> queue -> alertEngine -> rateLimiter -> Channel -> Discord
```

- **`Channel`** is a Strategy interface with multiple implementations (Console, Fake, Discord). `FakeChannel` simulates 429s to exercise retry and the rate limiter without hitting the real webhook. Adding a channel must not require editing existing code.
- Config is read **once at boot** in `src/config/env.ts` (Zod, fail-fast). Nothing else reads `process.env` — except `src/util/logger.ts`, deliberately (see Gotchas).
- Structured logging via pino (`src/util/logger.ts`). No `console.log`.

### Build order is milestone-driven — do not skip ahead

`PLAN.md` defines milestones M0 through M7. Each is small, runnable, and has explicit acceptance criteria that must pass before the next begins. Current state: **M0 done** (env + logger + entrypoint), **M1 next** (Binance WS client emitting `PriceTick`). Implement strictly in order.

### Gotchas

- **ESM:** `moduleResolution` is `NodeNext` and `package.json` is `"type":"module"` — relative imports MUST carry the `.js` extension even in `.ts` files (e.g. `import { loadEnv } from "./config/env.js"`).
- **Two tsconfigs:** `tsconfig.json` builds `src/**` only; `tsconfig.test.json` type-checks tests + `*.config.ts` with `noEmit`. `npm run typecheck` runs both.
- **Binance `@trade` payload:** `p` (price) is a **string** — always `parseFloat`. Symbols are lowercase in the stream URL but UPPERCASE in the payload.
- **Discord 429:** `retry_after` is in **seconds** (a float) inside the JSON body, not the headers.

## Conventions

Project coding rules live in `.claude/rules/` — read them before editing code.

- `.claude/rules/comments.md` — comment only what the code cannot show.
