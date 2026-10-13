# Robotic lawnmower backend

A TypeScript SvelteKit 3 backend using Prisma 6, PostgreSQL, and Better Auth. It stores simulated mower readings, events, sessions, and zone statistics and streams live updates with Server-Sent Events (SSE).

The application runs as a **single persistent Node process**. The simulator reads local CSV files and maintains a process-wide loop; the project now uses the Node adapter instead of Cloudflare Workers. Node 22.12+ and Bun are required.

## Setup

```sh
bun install
# If .env does not exist yet, copy .env.example to .env.
# Set DATABASE_URL, ORIGIN, and a random BETTER_AUTH_SECRET (32+ characters).
bun run db:start
```

The database command runs Docker Compose in the foreground. In another terminal, for a **new, empty database**:

```sh
bun run db:generate
bun run db:deploy
bun run dev
```

For an existing database containing the original Task and Better Auth tables but no Prisma migration history, first verify it matches `prisma/migrations/202610140001_initial/migration.sql`. Then baseline that migration before deploying the additive mower migration:

```sh
bunx prisma migrate resolve --applied 202610140001_initial
bun run db:deploy
```

Do not baseline a database with a different schema. No migration resets or deletes the existing authentication or Task tables. Tests during implementation used a separate temporary database; your `.env` and configured database were not changed.

Register/sign in at `/demo/better-auth/login` or use Better Auth's `/api/auth/sign-up/email` and `/api/auth/sign-in/email` endpoints. This is a shared student demo: **every registered user can see the same mower and start/stop simulation**. The health endpoint is public; machine ingestion has a separate bearer credential.

## Simulator

Opening `/api/stream` while authenticated starts the simulator at speed 10 (one reading per wall-clock second). You can also start it with the control API. It keeps running when a browser disconnects and stops when explicitly requested or when persistence fails.

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

Example using a cookie saved from sign-in:

```sh
curl -c /tmp/mower-cookies -H 'Content-Type: application/json' \
  -d '{"email":"student@example.com","password":"your-password"}' \
  http://localhost:5173/api/auth/sign-in/email

curl -b /tmp/mower-cookies -H 'Content-Type: application/json' \
  -d '{"action":"start"}' http://localhost:5173/api/simulator

curl -b /tmp/mower-cookies 'http://localhost:5173/api/readings?limit=20&is_anomaly=true'
curl -N -b /tmp/mower-cookies http://localhost:5173/api/stream
```

Browser usage after signing in:

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

The HTTP test needs a running app pointing to a disposable test database with `MOWER_INGEST_TOKEN` configured. It creates a test account and simulated data:

```sh
MOWER_TEST_URL='http://localhost:5173' bun test tests/e2e.test.ts
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
