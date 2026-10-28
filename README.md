# Fieldwork — property and mower fleet

A Svelte 5 / SvelteKit dashboard backed by PostgreSQL and Prisma. The customer view centres on a sixty-zone property map. The engineer view separates detailed session telemetry from seasonal trends and shows connection status, observation freshness, and transparent health indicators.

The dashboard/control APIs remain a **public demo without sign-in**. Customer/engineer switching changes presentation; it is not an authorization boundary. Device ingestion uses per-machine credentials. Existing Better Auth code remains available for future account isolation.

## Development

Use Bun, Node 22.12+ and Docker:

```sh
bun install
bun run dev
```

This starts the local PostgreSQL 18 Compose service, generates Prisma, applies additive migrations, and starts http://localhost:5173. Existing telemetry is preserved. The development script always targets the local Compose database regardless of a production `DATABASE_URL` in `.env`.

```sh
bun run dev:setup              # Database setup only
bun run db:stop                # Stop DB, keep data
bun run dev -- --port 5174
bun run dev:app                # Vite only, uses your DATABASE_URL
```

`DEV_DB_PORT` and `DEV_ORIGIN` override local development settings. Production uses `DATABASE_URL`, `ORIGIN` and `BETTER_AUTH_SECRET`; see `.env.example`.

## Property coverage and cycles

The demo property has sixty synthetic 150 m² zones. These are definitions, not fabricated observations. Original course data can be supplied with `SIM_DATA_DIR`; `data/` contains small synthetic fixtures, not training or evaluation data.

Start a **new mowing cycle** in the customer view to establish fresh progress. It ends explicitly through **Complete cycle** or when a replacement cycle starts. First ingestion does not start a cycle: runs created without an active cycle retain telemetry for diagnostics but contribute no cycle coverage. Starting a cycle rolls the internal demo into a fresh run; external producers join on their next new run. Queued envelopes keep their old run/cycle identity. Completed demo cycles cannot be resumed.

Property zone identities survive run restarts. Coverage is a capped estimate from mowing speed × ten-second cadence × a 0.25 m cutting width divided by zone area. It does not detect repeated passes, so overlap can overstate actual coverage. When machines overlap, the map uses the highest per-machine estimate, never their sum. The map is an illustrative ten-column/six-row layout, not a surveyed site map. Hatching means unknown. Selecting a zone shows its observation time; disconnected/stale machine counts remain visible. Buffered data can update a completed cycle only when its observation time falls inside that cycle.

Old runs are associated with a historical demo cycle without changing their telemetry. Historical coverage is not treated as new work. No retention deletion is performed.

## Machine provisioning and delivery

Provision a machine locally against the intended database:

```sh
bun run machine:provision 'North mower'
# Optional third argument: property UUID (defaults to the demo property)
bun run machine:provision 'West mower' PROPERTY_UUID
```

The command prints a machine ID and a random credential once. The database stores only its SHA-256 hash. Keep the credential on the device. Machines and runs have persistent UUIDs; authenticated machines cannot write another machine's run. Property zones share the property's numeric zone IDs; define additional properties through the database before provisioning against them.

Run the standalone simulator/device sender:

```sh
# Set MOWER_MACHINE_ID and MOWER_MACHINE_TOKEN in the device environment.
node src/lib/sim/mower-simulator.js \
  --sink http --url http://localhost:5173/api/ingest \
  --outbox-dir ./mower_outbox --speed 1 --fresh
```

At speed 1, a reading is generated every ten wall-clock seconds. The in-app **demo** runs at 10× speed. Its service is process-wide and continues when browsers disconnect; pause/start is explicit. Do not run multiple app replicas to control the same internal simulator.

The CLI HTTP sender writes ordered envelopes to an fsynced disk outbox before delivery. Each carries its original run UUID. On restart it drains old envelopes before producing a new run, avoiding reused source session IDs. Only a matching committed server acknowledgement removes an envelope. Retryable network errors, timeouts, HTTP 429 and server errors use exponential backoff with jitter capped at 30 seconds. Authentication/validation/conflict errors stop delivery and preserve the queue for repair. The queue stops the producer explicitly at 100,000 messages or 128 MiB; it never silently drops accepted entries. These are sender-library options for deployments needing different bounds. SIGINT stops production and retains unacknowledged entries.

Use one process per outbox on a local filesystem supporting atomic rename and fsync. A live owner lock prevents concurrent senders; a dead PID lock can be reclaimed after a crash. The outbox binds to one machine and endpoint. Retain it when repairing credentials; do not edit or delete queued envelopes. If a damaged/incomplete lock or identity file prevents startup, stop the sender and inspect/repair that metadata while preserving all `.json` envelopes. Protect outbox files as device location data; the default directory is git-ignored.

### Device contract

POST `/api/ingest` with JSON `{ "type", "data" }` and:

- `Authorization: Bearer MACHINE_TOKEN`
- `X-Machine-Id: MACHINE_UUID`
- `X-Run-Id: RUN_UUID`
- `X-Message-Id: MESSAGE_UUID` (stable for every retry of this envelope)

Send `zones`, then `session_start`, before dependent `reading`/`event` envelopes. `session_end` completes the source session. Timestamp input accepts UTC ISO or CSV `YYYY-MM-DD HH:mm:ss` (interpreted as UTC). Bodies are limited to 256 KiB. A successful production-sender response is `{ "accepted": true, "inserted": true|false, "run_id": "...", "message_id": "..." }` after commit. The sender removes a record only when both run and message IDs match the acknowledgement. Retrying a reading or event does not duplicate raw rows, counters or daily summaries.

Each queued envelope receives a UUID before its first transmission. That UUID survives restarts and reconnects. Older outbox files derive the same stable UUID from their existing filename. Deploy the upgraded receiver before the sender: an acknowledgement missing its message ID is rejected and the queued record is retained.

The receiver records a transactional `delivery_receipt` keyed by machine ID and message ID. Identical replays return success with `inserted: false`, including after a receiver restart. Reusing an ID with a different payload or run returns HTTP 409; it never overwrites the original telemetry. Receipt records must be retained for the required deduplication horizon; no automatic receipt deletion is configured. Legacy callers may omit the message-ID header and retain natural reading/event uniqueness, but the production CLI always sends it.

The legacy single-run ingest contract still works **for the demo machine only** when `MOWER_INGEST_TOKEN` and `MOWER_EXTERNAL_RUN_ID` are configured, with no machine headers. The CLI uses the per-machine contract. Do not assign two producers the same run identity.

## Query architecture and APIs

Raw readings/events are indexed by session UUID, observation timestamp and ID. Session queries are paginated. **Seasonal queries read `daily_summary` exclusively**; they do not load raw session readings. Summary counts, anomaly counts, current sums/maxima, temperature maxima and battery statistics update transactionally only for a newly inserted reading. Observation time determines the UTC summary day, even for late delivery. Means use sums/counts rather than averages of averages.

Database advisory locks serialize a machine's writes across processes without one global fleet queue. Summary backfills use an exclusive maintenance lock while ordinary ingestion takes the shared counterpart. Different machines can ingest concurrently. PostgreSQL resources are still shared; this architecture separates query work, not hardware or workload quotas.

| Method   | Endpoint                                                    | Purpose                                                                                 |
| -------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET      | `/api/fleet?property_id=UUID&limit=50&offset=0`             | Property, latest cycle, zone coverage and paginated machine diagnostics; no credentials |
| POST     | `/api/cycles`                                               | `{ "property_id": "UUID", "action": "start"                                             | "complete" }` |
| GET      | `/api/machines/UUID/state`                                  | Latest run/state for a machine                                                          |
| GET      | `/api/trends?machine_id=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily trend values, maximum 366 inclusive UTC days; missing days are null               |
| GET      | `/api/sessions?machine_id=UUID`                             | Machine-scoped paginated session history across runs                                    |
| GET      | `/api/sessions/UUID?machine_id=UUID`                        | One session and reading/event counts, scoped to machine                                 |
| GET      | `/api/readings?machine_id=UUID&session_id=UUID`             | Paginated session readings                                                              |
| GET      | `/api/events?machine_id=UUID&session_id=UUID`               | Paginated session events                                                                |
| GET      | `/api/zones`                                                | Legacy run-local cumulative zone statistics                                             |
| GET      | `/api/mower`                                                | Internal demo state; simulator flags                                                    |
| GET/POST | `/api/simulator`                                            | Status / `{ "action": "start"                                                           | "stop" }`     |
| GET      | `/api/stream?autostart=false`                               | Demo SSE snapshot followed by committed updates                                         |
| GET      | `/api/health`                                               | Readiness (200/503)                                                                     |

History APIs retain `run_id`, `session_id`, `from`, `to`, `limit` and `offset`. Readings additionally support `zone_id`, `mode`, `is_anomaly`; events support `zone_id`, `event_type`; zones support `run_id`, `zone_id`. Limits default to 50 and cap at 200; offsets cap at 1,000,000. Query `session_id` is the database UUID, while payload `session_id` is the producer's numeric ID. Lists return `{data, pagination:{limit,offset,has_more}}`. Use fixed `to` timestamps for stable offset history during live ingestion.

The browser loads session detail and trends independently on demand; changing selection discards outdated responses. Charts/CSV export cover the current bounded reading page, with separate controls for older readings and events. Missing trend days remain gaps. Machine receipt time controls connection status; observation time controls freshness, so uploading an old backlog does not look live. Raw readings/events expose immutable capture `timestamp` and server-assigned first-arrival `received_at` separately; legacy receipt times remain `null` because they are unknown. Historical queries and summaries use capture time. Replays update communication freshness without changing the original reading arrival/capture times. The dashboard explicitly labels “Last captured” and “Last received”, shows full UTC capture dates on session charts, and ages connection/freshness locally even if polling fails. “Dashboard connected” describes the browser connection, not the machine's current physical state.

Health indicators are configurable diagnostic heuristics, **not validated failure predictions**. They assess the latest observed UTC day with at least 30 readings: inspect at anomaly rate ≥5%, mean motor current ≥5 A, or peak battery temperature ≥50°C. The UI shows the sample day, thresholds and freshness separately. Configure environment thresholds using `.env.example`.

## Existing-data summary backfill

New readings update summaries automatically. For historical raw telemetry, run a bounded, idempotent backfill per machine and date range (at most 366 days):

```sh
bun run summaries:backfill MACHINE_UUID 2026-04-01 2026-09-27
```

Each UTC day is rebuilt atomically from raw readings under the exclusive maintenance lock, preventing races/double-counting with live ingestion. Ingestion briefly waits per day; run during a maintenance window, allow the sender to buffer, and pause the internal demo for large datasets. Restarting/repeating the command is safe. Empty days remain absent rather than fake zero samples. It does not rewrite source readings or coverage.

## Capacity and measured query behavior

At the specified 459 bytes every ten seconds, a continuously reporting machine produces 8,640 readings and **3,965,760 payload bytes/day** (about 714 MB over 180 days), before JSON/envelope, network, database and index overhead. Actual encoded payloads vary. Fleet size and retention remain deployment choices; this change imposes no automatic deletion.

```sh
bun run benchmark:fleet
```

Use a dedicated test database. This non-destructive command creates its own temporary property with 1,555,200 raw readings (180 continuous days) and 180 daily summaries, runs `EXPLAIN (ANALYZE, BUFFERS)`, and removes its fixture in `finally`. The local PostgreSQL 18 test measured 0.037 ms execution for a 200-row session page using `reading_session_ref_timestamp_id_idx`, and 0.027 ms for 180 summary rows. These are query-only timings on local storage with warm caches, excluding network, ingestion contention and production concurrency. They demonstrate bounded, separate query paths, not a production SLA.

## Verification

```sh
bun test
bun run check
bunx prisma validate
bun run build
```

Use a dedicated migrated database for DB/HTTP tests:

```sh
DATABASE_URL='postgresql://.../mower_test' bun run db:deploy
DATABASE_URL='postgresql://.../mower_test' RUN_DB_TESTS=1 bun test tests
# Start the app against that database, then enable HTTP fleet tests:
DATABASE_URL='postgresql://.../mower_test' RUN_DB_TESTS=1 \
  MOWER_FLEET_TEST_URL='http://localhost:5174' bun test tests
MOWER_TEST_URL='http://localhost:5174' bun run test:browser
```

Tests cover duplicate/late/concurrent readings, machine ownership, summary correctness, disk-outbox recovery, simulator lifecycle, sixty zones, mobile/desktop audience switching, selected-session CSV, seasonal gaps, explicit cycles and delayed trend responses. Svelte MCP tools were unavailable during this implementation; local Svelte compiler/checker validation is used.

## Deployment

```sh
bun install --frozen-lockfile
bun run db:generate
bun run db:deploy
bun run build
bun run start
```

Keep `data/` (or `SIM_DATA_DIR`) available and run from the project root. Set `DATABASE_URL`, `ORIGIN` and `BETTER_AUTH_SECRET`; set the same `ORIGIN` during build/runtime. Use one Node process for the internal demo and a proxy allowing unbuffered SSE. Streams heartbeat every 15 seconds; reconnects get a new snapshot, with REST history for missed data. Slow clients and persistence queues are bounded. Internal demo persistence failure stops the simulator and requires a server restart after repairing the cause.

If adopting migrations on an existing pre-migration database, verify its schema against `prisma/migrations/202610140001_initial/migration.sql` before baselining with `prisma migrate resolve --applied 202610140001_initial`; then deploy additive migrations. Do not baseline a different schema.
