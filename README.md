# whatsapp-code-bot

A production-oriented MVP that allocates one-time codes to authorized WhatsApp groups through WhatsApp Web. Inventory, authorization, deduplication, audit history, and delivery outcomes live in PostgreSQL.

> **Important:** `whatsapp-web.js` is unofficial WhatsApp Web automation. It may violate WhatsApp's terms, stop working when WhatsApp changes, disconnect unexpectedly, or cause the account/number to be restricted. Use a separate WhatsApp number that you can afford to lose. For a terms-compliant production channel, migrate to the official Meta WhatsApp Business Platform.

## What it does

- Handles `/tag <category>` only in group chats; active categories and aliases are managed in PostgreSQL rather than command code.
- Supports atomic quantity requests such as `/tag 830 5x`; omitting the quantity issues one code. If fewer codes remain than requested, all remaining codes are issued and a separate stock-ended message is sent. Requests are capped by `MAX_CODES_PER_REQUEST`.
- Supports equivalent shorthand such as `830x5`, `830 x 5`, and `830 × 5`, with or without the `/tag` prefix.
- Authorizes groups from `allowed_groups`; joining a group never authorizes it.
- Atomically records the WhatsApp message and claims inventory with a PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`.
- Marks codes used/pending before attempting delivery. Uncertain or failed delivery stays used and appears in manual review.
- Supports `/help`, administrator-only `/groupid`, `/stock <category>`, and `/status`.
- Includes a session-protected, CSRF-protected dashboard for aggregate stock, multiline code entry, code lifecycle tracking, group toggles, masked audit data, and failed deliveries.
- Persists WhatsApp `LocalAuth`, emits structured logs without code values, rate-limits each group, reconnects safely, and shuts down gracefully.

## Requirements

- Node.js 20 or newer
- Docker Desktop (recommended) or PostgreSQL 14+
- A separate WhatsApp account/number

## Windows / PowerShell setup

```powershell
Copy-Item .env.example .env
# Edit .env and replace ADMIN_PASSWORD and SESSION_SECRET.
npm install
docker compose up -d postgres
npm run migrate
npm run import-codes -- .\examples\sample-codes.csv
npm start
```

Open `http://localhost:3000`. On first start, scan the QR code printed in the terminal using WhatsApp **Linked devices**. The session is stored in `.wwebjs_auth`; keep this directory private and persistent.

Do not commit `.env`, CSV inventory, `.wwebjs_auth`, or logs. The supplied `.gitignore` excludes them.

## Configure administrators

Set `ADMIN_NUMBERS` to comma-separated international numbers with country code and no leading `+`, for example `923001234567`. Formatting such as `+92 300...`, `00...`, and WhatsApp suffixes is normalized before comparison.

Add the bot number to the required customer groups. Stop the main bot before running group detection because the same `LocalAuth` profile cannot safely be opened twice:

```powershell
npm run groups -- detect
npm run groups -- add "120363000000000000@g.us" "Customer A"
npm run groups -- list
npm run groups -- disable "120363000000000000@g.us"
npm run groups -- enable "120363000000000000@g.us"
```

`detect` logs in with the persistent session and lists only group names and IDs. It does not authorize anything. An administrator can also send `/groupid` inside a group after the bot is running.

## Commands

| Command | Who | Result |
|---|---|---|
| `/tag 830`, `/tag 2320` | Member of an active group | Atomically allocates from that category |
| `/tag 830 5x` | Member of an active group | Atomically allocates up to five distinct codes and reports when stock is exhausted |
| `/tag 5150` or `/tag 5k` | Member of an active group | Both allocate from canonical category `5150` |
| `/tag 13k`, `/tag 27k`, `/tag 56k` | Member of an active group | Atomically allocates from that category |
| `/help` | Any group member | Shows supported commands |
| `/groupid` | Configured administrator | Shows the current group ID |
| `/stock <category>` | Configured administrator | Shows unused quantity; aliases are supported |
| `/status` | Configured administrator | Checks the bot process and database |

Messages from the bot, direct chats, malformed commands, and duplicate message IDs never allocate inventory. Rate limits are per group and configured with `GROUP_RATE_LIMIT` and `GROUP_RATE_WINDOW_MINUTES`.

## CSV imports

The only accepted columns are required `category` and `code` values (extra columns are ignored). Active categories are `830`, `2320`, `5150` (alias `5k`), `13k`, `27k`, and `56k`. Values are trimmed, aliases resolved, blank/invalid/unsupported rows rejected, duplicates within the file skipped, and existing database codes skipped. The import transaction either commits its inserts or rolls back on a database error. Reports show totals and row errors, never all code values.

```powershell
npm run import-codes -- .\path\to\codes.csv
```

The dashboard accepts one or more codes pasted into a multiline field after selecting a category. Put one code on each line; numbered lists such as `1. CODE` are also accepted. Duplicate codes are skipped. Dashboard history and lifecycle pages show masked values rather than complete codes.

## Docker Compose

For database-only local development:

```powershell
docker compose up -d postgres
npm run migrate
npm start
```

To run both containers, create `.env`, then:

```powershell
docker compose up -d postgres
docker compose run --rm app node scripts/migrate.js
docker compose --profile app up -d --build
docker compose --profile app logs -f app
```

Named volumes `postgres_data`, `whatsapp_auth`, and `whatsapp_cache` preserve database and WhatsApp state. Do not use `docker compose down -v` unless intentionally deleting both inventories and sessions.

## Tests

```powershell
npm test
npm run check
```

The default suite covers parsing, normalization, admin checks, authorization responses, admin commands, out-of-stock, duplicate messages, CSV validation, masking, rate limiting, and failed delivery recording without WhatsApp.

The PostgreSQL concurrency test deliberately modifies the configured test database. Use a disposable database:

```powershell
$env:TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/whatsapp_codes_test"
# Create whatsapp_codes_test first, then:
npm run test:integration
```

It starts concurrent allocations, asserts distinct codes, and replays a message ID to prove deduplication. Never point it at production.

## Health and operations

`GET /health` returns service, database, and WhatsApp readiness booleans without secrets. HTTP readiness depends on PostgreSQL; WhatsApp state is reported separately so the dashboard remains diagnosable during a disconnect. Application logs are one-line JSON and intentionally omit fields whose names could contain codes, passwords, credentials, or secrets.

Delivery flow is intentionally conservative:

1. In one transaction, verify the group, insert `processed_messages`, lock an unused code, mark it `used`/`pending`, and write an audit row.
2. Reply in the originating group.
3. Update delivery to `sent`; on any error, update to `failed` and retain the used code for manual review.

Never manually reset a failed code to unused unless a human has confirmed it was not delivered.

## Ubuntu VPS deployment

Install Docker Engine plus the Compose plugin, copy the project to a non-root service directory, create a protected `.env` (`chmod 600 .env`), and set long random dashboard/session credentials. Put the dashboard behind an HTTPS reverse proxy such as Caddy or nginx; production cookies are `Secure`, HTTP-only, and `SameSite=Strict`, so plain HTTP login will not work in production mode.

```bash
docker compose up -d postgres
docker compose run --rm app node scripts/migrate.js
docker compose --profile app up -d --build
docker compose --profile app logs -f app
```

Scan the first QR from the logs. Restrict port 3000 with a firewall or bind it only through the reverse proxy. Keep the session and database named volumes on persistent storage. Apply OS and image updates regularly, and protect access to backups because they contain live codes and session material.

## Backup and restore

Logical PostgreSQL backup (recommended):

```bash
docker compose exec -T postgres pg_dump -U postgres -d whatsapp_codes_king -Fc > whatsapp_codes.dump
docker compose exec -T postgres pg_restore -U postgres -d whatsapp_codes_king --clean --if-exists < whatsapp_codes.dump
```

Back up the `whatsapp_auth` Docker volume using your host/volume backup system while the app container is stopped. Restoring only PostgreSQL does not restore the WhatsApp login; restoring only the session does not restore inventory. Encrypt backups and test restoration on a disposable host.

## Troubleshooting

- **QR expires:** restart the app and scan the newest QR promptly. If the account shows a stale linked device, remove it in WhatsApp and retry.
- **Authentication failure:** stop the app, preserve a backup, remove only the affected `.wwebjs_auth/session-<WHATSAPP_CLIENT_ID>` profile, then start and scan again. This logs that client out.
- **Disconnected:** check internet access and the phone/account state. The bot schedules one safe reconnect attempt at a time. Repeated failures may indicate a WhatsApp restriction or upstream Web change.
- **Chromium fails on a VPS:** use the supplied image; it installs Chromium and required fonts. Ensure the container has adequate shared memory/RAM.
- **Puppeteer browser download fails on Windows:** set `PUPPETEER_SKIP_DOWNLOAD=true` while running `npm ci`, then set `PUPPETEER_EXECUTABLE_PATH` in `.env` to an installed Chrome or Edge executable. Both the bot and group-detection CLI honor this setting.
- **Database unavailable:** check `docker compose ps`, `docker compose logs postgres`, `DATABASE_URL`, and run `npm run migrate`.
- **No reply:** confirm the message is in a group, the group is active in the dashboard/CLI, inventory exists for the normalized category, and the per-group limit is not exhausted.

## Project map

- `migrations/001_initial.sql` — constrained schema and indexes
- `src/services/code-allocation.js` — atomic allocation and delivery outcome transaction logic
- `src/commands/message-handler.js` — testable WhatsApp-independent command behavior
- `src/bot/client.js` — `LocalAuth`, QR, lifecycle, reconnect events
- `src/routes/dashboard.js` — dashboard, filters, upload, and group controls
- `scripts/` — migrations, secure CSV import, and group management
- `tests/` — unit coverage plus opt-in live PostgreSQL concurrency test

## Known boundary

Automated tests do not log in to WhatsApp. QR scanning, receipt in a real group, and persistence against an actual WhatsApp account must be verified manually because they require an interactive account and are subject to WhatsApp Web behavior.
