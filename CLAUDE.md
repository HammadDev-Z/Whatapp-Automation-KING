# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A transactional WhatsApp Web bot that allocates one-time codes to authorized WhatsApp groups. It runs `whatsapp-web.js` (unofficial WhatsApp automation via headless Chromium/Puppeteer) plus an Express dashboard, backed by PostgreSQL. All inventory, authorization, dedup, audit history, and delivery outcomes live in Postgres — command code contains almost no business config.

`whatsapp-web.js` is unofficial and can break or get the number banned. Tests never log into WhatsApp; QR scan and real group delivery must be verified manually.

## Commands

```bash
npm start                 # run bot + HTTP server (src/index.js)
npm run dev                # same with --watch
npm run migrate            # apply migrations/*.sql in filename order (tracked in schema_migrations)
npm run import-codes -- ./codes.csv   # bulk CSV import (columns: category, code)
npm run groups -- detect              # log in with persistent session, list group IDs only (STOP the bot first)
npm run groups -- add "<id>@g.us" "Name" | list | enable <id> | disable <id>
npm run check             # node --check on src/index.js and src/app.js (fast syntax gate)
npm test                  # node --test --test-concurrency=1  (see note below)
npm run test:integration  # opt-in live-Postgres concurrency test, sets RUN_DB_TESTS=1
```

Local DB via Docker: `docker compose up -d postgres` then `npm run migrate`.

### Test suite caveat

`package.json` `test`/`test:integration` and the README point at a `tests/` directory that is **not present in the repo** (untracked / removed). `npm test` currently finds no tests. If you add tests, restore `tests/` and the opt-in `tests/allocation.integration.test.js` that `scripts/run-db-integration.js` expects (it needs `TEST_DATABASE_URL` pointing at a disposable database).

Only two files can ever be run standalone against WhatsApp: `src/index.js` (the app) and `scripts/manage-groups.js detect`. They share one `.wwebjs_auth` LocalAuth profile and **cannot run at the same time** — stop the bot before `groups -- detect`.

## Config discrepancies to be aware of

- Root `.env` uses `DATABASE_URL=...localhost:5432/whatsapp_codes` (NODE_ENV=development), but `docker-compose.yml` publishes Postgres on host port **5433**, names the DB `whatsapp_codes_king`, and its healthcheck still checks `whatsapp_codes`. Reconcile `.env` with however you actually run Postgres.
- `.env` is committed (contains real dev credentials). `.gitignore` was meant to exclude it; treat its secrets as compromised for anything real.

## Architecture

### Startup wiring (`src/index.js`)
`loadConfig()` → create pg `Pool` → construct services → `createMessageHandler(...)` → `createWhatsAppBot(...)` → `createApp(...)` listens on `PORT` → `bot.initialize()`. Graceful shutdown on SIGINT/SIGTERM closes server, then bot, then pool.

### Two independent surfaces share one pool
1. **WhatsApp bot** (`src/bot/client.js`): owns the `Client`, QR printing, `authenticated`/`ready`/`disconnected` events, and a single-attempt-at-a-time reconnect timer. Mutates a shared `botState` object that `/health` reads. Wires `client.on('message', messageHandler)`.
2. **Express dashboard** (`src/app.js` + `src/routes/dashboard.js`): session auth (Postgres-backed `connect-pg-simple`, table `dashboard_sessions`), CSRF on every mutating route, all output HTML-escaped, all displayed codes run through `maskCode`.

### Command path (the core flow)
`src/commands/message-handler.js` is deliberately WhatsApp-API-independent and is where testable command behavior lives.
- `parseCommand` (`src/utilities/commands.js`) recognizes `/tag <cat>`, quantity shorthands (`830 5x`, `830x5`, `830 × 5`, with/without `/tag`), `/help`, `/groupid`, `/stock`, `/status`. Unknown-but-command-shaped input → `{name:'invalid'}`; everything else → `null` (ignored).
- Ignores non-group chats, `fromMe`, and non-command bodies. Dedups in-process via `inFlight` Set keyed by a serialized message ID.
- Admin commands (`groupid`/`stock`/`status`) resolve the real sender (handles `@lid` addresses via `resolveSender`) and check `AdminRepository.isAllowed` (the `admin_numbers` table; `ADMIN_NUMBERS` env only seeds it on boot).
- Category resolution goes through `CategoryRepository.resolve` (alias → canonical, active only). Categories/aliases are DB rows (`code_categories`, `category_aliases`), seeded in `migrations/002`.
- Rate limit is per-group, in-memory (`GroupRateLimiter`), sized by `GROUP_RATE_LIMIT` / `GROUP_RATE_WINDOW_MINUTES`. A pre-check `SELECT` against `processed_messages` short-circuits replays before they burn quota.

### Allocation transaction (`src/services/code-allocation.js`) — the safety-critical part
`allocate()` in ONE transaction: `SELECT ... FOR SHARE` the group (unauthorized → rollback), `INSERT ... ON CONFLICT DO NOTHING` into `processed_messages` (conflict → `duplicate`), then `SELECT ... FROM codes WHERE status='unused' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $qty`. If fewer rows than requested → `partial` allocation (all remaining issued + a `partial_allocation` audit row). Selected codes are marked `used`/`delivery_status='pending'` and audited, then COMMIT.

Then, outside the transaction: random delay (`TAG_RESPONSE_DELAY_MIN/MAX_SECONDS`), `message.reply(...)` with the codes, then `recordDelivery({success:true})` flips `delivery_status` to `sent`. Any send/record error → `recordDelivery({success:false})` sets `failed` and the code **stays `used`** for manual review on `/dashboard/failed`.

Invariant: never reset a `failed` code back to `unused` unless a human confirmed it was not delivered.

### Data model (`migrations/`, applied in order)
- `001` — `codes` (unique `code`, status `unused|reserved|used`, `delivery_status pending|sent|failed`, CHECK ties them together), `allowed_groups`, `processed_messages`, `audit_logs`, `dashboard_sessions`. Partial indexes for the available-code lookup and delivery queue.
- `002` — `code_categories` + `category_aliases`, seeds `830 2320 5150 13k 27k 56k` and alias `5k→5150`.
- `003` — backfills `code_imported` / `group_registered` audit rows so the dashboard ledger is complete historically.
- `004` — `admin_numbers` table (dashboard-managed admin list).

### Conventions
- Structured one-line JSON logs via `src/utilities/logger.js`; it **drops any field whose key matches `/code|password|secret|credential/i`** and flattens `Error` to its message. Don't log raw code values — put them in a differently-named field only if truly needed, and prefer not to.
- `src/utilities/normalization.js`: `normalizeCategory` (lowercase, `^[a-z0-9_-]+$`), `normalizePhone` (strip non-digits, drop leading `00`, strip `@...` suffix) — phone comparison for admins always goes through this.
- Dashboard timestamps render in `Asia/Karachi`; audit period filters do the TZ math in SQL.
- Many `src/` files are intentionally written dense/single-line (`app.js`, `bot/client.js`, `index.js`, `middleware/security.js`, `scripts/manage-groups.js`). Match the local style of the file you edit.
- Production mode (`NODE_ENV=production`) enforces strong `ADMIN_PASSWORD` and a ≥32-char `SESSION_SECRET`, sets `trust proxy`, and makes the session cookie `Secure` — plain-HTTP login fails, so it must sit behind an HTTPS reverse proxy.

## Deploy

Docker image (`Dockerfile`) is `node:20-bookworm-slim` + system Chromium, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, runs as `node`. `docker compose --profile app up -d --build` runs the app container; named volumes `postgres_data`, `whatsapp_auth`, `whatsapp_cache` hold all persistent state — never `docker compose down -v` unless you mean to wipe inventory and the WhatsApp login.

## Other agent configs present

`~/.codex/` (OpenAI Codex) and `~/.gemini/` (Gemini CLI) configs exist on this machine. To import their MCP servers / slash commands / subagents / skills / instructions into Claude Code, reply `/import` (then `/import --yes=<digest>`), or run `claude import` from a terminal.
