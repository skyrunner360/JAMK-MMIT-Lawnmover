# Fieldwork — robotic lawnmower dashboard

A responsive Svelte 5 dashboard backed by SvelteKit 3, Prisma, and PostgreSQL. It displays live battery and motor charts, speed, area coverage, a selectable zone map, recent events, and session history. Pause/resume simulation, choose a chart window, filter events, expand session details, or export the displayed telemetry as CSV.

The dashboard and its data/control APIs **temporarily require no sign-in**, as requested for this demo. Existing Better Auth code is retained separately for later use. External device ingestion still uses its bearer token. Cross-origin control requests are rejected.

## Development with Docker PostgreSQL

Install Node 22.12+, Bun, and Docker, then run:

```sh
bun install
bun run dev
```

This command starts PostgreSQL 18 with Docker Compose, waits for its health check, generates the Prisma client, applies pending migrations, and starts the dashboard at **http://localhost:5173**. On a fresh workspace no manual database setup is needed. The first dashboard visit starts the simulator; reloading a paused simulation preserves its paused state.

Development intentionally uses the local Compose database (`root` / `mysecretpassword`, database `local`) regardless of a production `DATABASE_URL` in `.env`. Data persists in the existing `pgdata` volume. Stopping the development server leaves PostgreSQL running.

```sh
bun run dev:setup       # Start Docker DB and apply migrations, without the web server
bun run db:stop         # Stop PostgreSQL, preserving its volume
bun run dev -- --port 5174  # Use another app port; origin follows this port
```

Set `DEV_DB_PORT` if local port 5432 is occupied, or `DEV_ORIGIN` for a different development origin. `bun run dev:app` launches only Vite using your own database/environment configuration. Production still uses `DATABASE_URL`, `ORIGIN`, and `BETTER_AUTH_SECRET` from the environment or `.env` (see `.env.example`).

For an existing database containing the original Task and Better Auth tables but no Prisma migration history, first verify it matches `prisma/migrations/202610140001_initial/migration.sql`. Then baseline that migration before deploying the additive mower migration:

```sh
bunx prisma migrate resolve --applied 202610140001_initial
bun run db:deploy
```

Do not baseline a database with a different schema. The dashboard setup applies additive migrations and preserves existing data.

## Simulator

Opening `/api/stream` starts the simulator at speed 10 (one reading per wall-clock second). The dashboard uses `/api/stream?autostart=false` and controls startup explicitly, so reconnecting does not undo a pause. You can also start it with the control API. It keeps running when a browser disconnects and stops when explicitly requested or when persistence fails.

The supplied simulator is available through:

```ts
import { getSimulator } from '#lib/server/mower-simulator.js';
```

SvelteKit 3 uses `#lib` in this project. The server entry point exposes the same `getSimulator({ speed: 10 })` interface as the supplied example. The API uses a service around it so persistence is attached once, before simulation begins. Avoid calling `start()` separately from a page; use the API to retain ordered persistence.

`data/` contains **small synthetic demo fixtures, not the original course dataset**. They are sufficient to exercise the simulator, not to train or assess predictive models. Set `SIM_DATA_DIR` to use original `main_log*.csv`, `events*.csv`, `sessions*.csv`, and `zones*.csv` files. Restart the server after changing simulator configuration.

Each server restart creates a new run UUID when simulation starts, keeping reused numeric simulator IDs separate from old history. Stop/start in the same process continues the current session. If persistence fails or the 256-message queue fills, simulation stops, health becomes unavailable, and connected clients receive an error message. Fix the cause and restart the server; queued messages are not a durable recovery log.

## API

All endpoints return JSON except `/api/stream`. Errors use `{ "error": "..." }`; invalid inputs may also include `issues`. Dates are UTC ISO strings in responses. CSV input timestamps (`YYYY-MM-DD HH:mm:ss`) are interpreted as UTC; API time filters also accept ISO timestamps ending in `Z`.

| Method | Endpoint             | Purpose                                                         |
| ------ | -------------------- | --------------------------------------------------------------- |
| GET    | `/api/health`        | Public readiness; 200 `ok` or 503 `unavailable`                 |
| GET    | `/api/mower`         | Current persisted reading, session, zones, and simulator status |
| GET    | `/api/readings`      | Paginated measurements                                          |
| GET    | `/api/events`        | Paginated mower events                                          |
| GET    | `/api/sessions`      | Paginated mowing sessions                                       |
| GET    | `/api/sessions/[id]` | Session by database UUID, with reading/event counts             |
| GET    | `/api/zones`         | Paginated zone definitions and cumulative statistics            |
| GET    | `/api/simulator`     | Run UUID, running/healthy flags, pending writes                 |
| POST   | `/api/simulator`     | `{ "action": "start" }` or `{ "action": "stop" }`               |
| GET    | `/api/stream`        | Snapshot followed by persisted internal simulator messages      |
| POST   | `/api/ingest`        | Bearer-authenticated external simulator envelope                |

List responses use:

```json
{
	"data": [],
	"pagination": { "limit": 50, "offset": 0, "has_more": false }
}
```

`limit` defaults to 50 and is capped at 200; `offset` defaults to 0 and is capped at 1,000,000. History is sorted newest first with an ID tie-breaker. Zones are sorted by numeric zone ID. Offset pages can shift while new data arrives; use a fixed `to` timestamp for stable history exploration.

Filters:

- Readings: `run_id`, `session_id`, `zone_id`, `mode`, `is_anomaly`, `from`, `to`.
- Events: `run_id`, `session_id`, `zone_id`, `event_type`, `from`, `to`.
- Sessions: `run_id`, `session_id`, `from`, `to` (filters session start time).
- Zones: `run_id`, `zone_id`; defaults to the internal run, or the newest stored run if the internal simulator has not started.

All lists accept `limit` and `offset`. Unknown, duplicated, malformed, and endpoint-inapplicable query parameters return 400. `session_id` **in query strings is the database session UUID** returned as `id` by `/api/sessions`; `session_id` inside simulator payloads is its numeric source ID. Readings/events additionally expose `session_ref` and `zone_ref` database UUIDs.

Examples (no sign-in required):

```sh
curl -H 'Content-Type: application/json' \
  -d '{"action":"start"}' http://localhost:5173/api/simulator

curl 'http://localhost:5173/api/readings?limit=20&is_anomaly=true'
curl -N http://localhost:5173/api/stream
```

Browser usage:

```js
const events = new EventSource('/api/stream');
events.onmessage = ({ data }) => {
	const message = JSON.parse(data);
	// snapshot, reading, event, session_start, session_end, zones, or error
	console.log(message.type, message.data);
	if (message.type === 'error') events.close();
};
// On component cleanup:
// events.close();
```

Streams send heartbeat comments every 15 seconds. Disconnecting removes that listener and its timer. Slow clients are disconnected after their bounded buffer fills. SSE reconnects receive a new snapshot; there is no event replay cursor. Query REST history for missed measurements. The database is committed before telemetry is broadcast, and adding viewers does not add persistence listeners.

## External HTTP ingestion

Set `MOWER_INGEST_TOKEN` to a random secret and `MOWER_EXTERNAL_RUN_ID` to a UUID on the server. Supply the same token to the CLI process. Start the server again after changing these values. Generate a **new run UUID before starting a new independent CLI simulation** so repeated numeric IDs cannot collide.

```sh
# Set MOWER_INGEST_TOKEN in this shell without committing it.
node src/lib/sim/mower-simulator.js \
  --sink http --url http://localhost:5173/api/ingest --speed 10 --fresh
```

The CLI sends initial zones, then ordered `{ "type", "data" }` envelopes. Supported types are `zones`, `session_start`, `reading`, `event`, and `session_end`. Send zones and session metadata before dependent telemetry; otherwise the API returns 409. It enforces a 256 KiB JSON body limit. The HTTP sink stops on rejected requests or queue overflow instead of silently dropping samples. Reads use `(session, timestamp)` uniqueness; events use `(session, timestamp, event_type)`. Retrying telemetry does not duplicate rows or zone counters. Older zone snapshots cannot roll back cumulative totals.

External run data is available through REST filters using `run_id`. `/api/stream` specifically streams the internal simulator. Do not run both producers for the same run identity. Machine ingestion returns `{ "accepted": true, "inserted": true, "run_id": "..." }`; duplicate reading/event retries return `inserted: false`.

## Schema and code layout

- `prisma/schema.prisma`: `SimulationRun`, `MowingSession`, `Reading`, `MowerEvent`, `Zone`, and retained authentication models.
- `src/lib/server/mower/validation.ts`: request/message schemas and UTC conversion.
- `repository.ts`: transactional writes and idempotent counters.
- `service.ts` / `queue.ts`: process lifecycle and bounded ordered persistence.
- `stream.ts`: SSE framing and cleanup.
- `src/routes/api/`: thin SvelteKit handlers.
- `src/lib/sim/`: supplied simulator with stop/resume fixes and authenticated ordered HTTP delivery.

## Verification

```sh
bun test                       # unit tests; DB/HTTP tests skip unless configured
bun run check                  # TypeScript and Svelte diagnostics
bunx prisma validate
bun run build
```

Database tests need a dedicated migrated PostgreSQL test database. They create and remove only their own run IDs:

```sh
DATABASE_URL='postgresql://.../mower_test' bun run test:integration
```

The HTTP test needs a running app and creates simulated data. It verifies the public API and leaves the simulator paused:

```sh
MOWER_TEST_URL='http://localhost:5173' bun test tests/e2e.test.ts
```

Browser tests cover desktop (1440 px) and mobile (390 px), live data, pause/resume, paused reloads, zone selection, CSV downloads, session details, and horizontal overflow:

```sh
bunx playwright install chromium --only-shell
bun run test:browser  # With bun run dev already running
```

## Deployment

```sh
bun install --frozen-lockfile
bun run db:generate
bun run db:deploy
bun run build
bun run start
```

Keep `data/` (or the directory at `SIM_DATA_DIR`) alongside the deployment and run from the project root. Set `DATABASE_URL`, `ORIGIN`, and `BETTER_AUTH_SECRET` in the environment or `.env`; the start command loads `.env` if present. Set the same `ORIGIN` during build and runtime: SvelteKit 3 uses it as `paths.origin` in the built Node adapter. Rebuild after changing the deployment URL. This follows the [Node adapter origin configuration](https://svelte.dev/docs/kit/adapter-node#Environment-variables-PROTOCOL_HEADER-HOST_HEADER-and-PORT_HEADER). Use one Node process, configure the proxy to allow long-lived unbuffered SSE responses, and terminate the process cleanly when deploying. Multiple replicas need shared orchestration and a shared message transport before this simulator architecture can scale across them.
