# Robotic lawnmower backend design

## Outcome and scope

Implement a student-friendly TypeScript SvelteKit backend that stores mower measurements in PostgreSQL and exposes historical REST queries and live server-sent events. Keep the existing Prisma and Better Auth setup. The course slides describe receiving, storing, and serving real-time measurements; they do not prescribe a specific endpoint contract.

Source: https://student.labranet.jamk.fi/~pelju/mmoi_material/robotic_lawnmover_AI_FS_part_slides.html#/13

This design assumes one shared demonstration mower. Authenticated users can view its data and control simulation. Machine ingestion uses a separate server-side bearer token. Frontend dashboards and machine learning are outside this backend task.

## Runtime alternatives

1. Recommended: run SvelteKit with the Node adapter and the supplied simulator in the same persistent process. This supports its filesystem reads, EventEmitter, timers, and process singleton with the least complexity.
2. Retain Cloudflare Workers and run the simulator as a separate Node service posting to ingestion. This requires separate deployment and a shared streaming mechanism, plus a Workers-compatible PostgreSQL connection strategy.
3. Replace the simulator with a Workers-specific implementation. This adds substantial work and diverges from the requested simulator integration.

The implementation will use option 1. Deploy one application process for this student demo; process-local simulator state is not shared across replicas.

## Database

Preserve existing authentication models and unrelated models. Add:

- SimulationRun: UUID identifying each simulator instance/run so restarted simulations cannot overwrite earlier sessions with matching numeric identifiers.
- MowingSession: run ID and simulator session ID, start/end timestamps, weather, bearing wear, battery summaries, duration, covered area, current summaries, anomaly count, and failure fields. Completion fields remain nullable while active.
- Reading: session relation, UTC timestamp, position, speed, heading, mode, battery measurements, motor measurements, slope, grass load, environment measurements, zone relation, and anomaly flag.
- MowerEvent: session and zone relations, UTC timestamp, position, event type, and nullable error code.
- Zone: run-scoped numeric zone ID, terrain properties and accumulated statistics matching simulator zone data.

Use compound uniqueness for run/session IDs and session/reading timestamps; events use session/timestamp/type uniqueness to tolerate ingestion retries. Index historical queries by timestamp, session, and zone. Prisma field names may be camelCase; API payloads retain simulator snake_case keys. Treat simulator timestamps without offsets as UTC.

## Simulator and persistence

Expose the requested import at `src/lib/server/mower-simulator.js` while preserving CLI usability of the supplied implementation. Add explicit TypeScript declarations for its payloads and public API.

The four required CSVs are absent. Include a clearly labelled small synthetic fixture dataset suitable for demo generation, with all 26 referenced zones, multiple sessions, charging observations, weather samples, and supported event types. Support overriding it with SIM_DATA_DIR for the course dataset. Never claim the fixture is the original course data.

A process-wide service owns the simulator and one persistence subscription, independent of connected browser count. Attach listeners before starting. Default speed is 10, giving approximately one reading per wall-clock second. Serialize database writes in message order with a bounded queue. On persistence failure or queue overflow, stop simulation and expose an unhealthy status rather than silently dropping data. Start a new run after process restart; resuming a stopped in-memory run preserves its identity.

Initialize zones before session/reading writes. Persist session starts, readings, events, session completion, and updated zone summaries. Publish live messages after successful persistence. Multiple SSE connections must not duplicate database writes.

## API contract

All data/query/control endpoints require a Better Auth session. Return JSON errors with meaningful 400, 401, 404, 409, and 503 responses. Validate incoming data, query parameters, enum values, numeric ranges, and timestamps; reject invalid bodies before writing.

| Method | Route              | Behavior                                                                                         |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------ |
| GET    | /api/health        | Minimal readiness response, no configuration secrets                                             |
| GET    | /api/mower         | Current persisted mower state and simulator status                                               |
| GET    | /api/readings      | Paginated history; optional session, zone, mode, anomaly and time filters                        |
| GET    | /api/events        | Paginated events; optional session, zone, type and time filters                                  |
| GET    | /api/sessions      | Paginated mowing sessions                                                                        |
| GET    | /api/sessions/[id] | One session summary, 404 if absent                                                               |
| GET    | /api/zones         | Zone definitions/statistics for the current or specified run                                     |
| GET    | /api/stream        | Start simulation idempotently; send snapshot followed by live simulator envelopes                |
| GET    | /api/simulator     | Running state and persistence health                                                             |
| POST   | /api/simulator     | Validated start/stop action                                                                      |
| POST   | /api/ingest        | Bearer-token authenticated simulator envelope ingestion using a configured external run identity |

Use bounded pagination (default 50, maximum 200) and deterministic sorting. Document UTC timestamp serialization and response envelopes. Ingestion uses the same validation and persistence service as the internal simulator. The existing CLI HTTP sink requires a small extension to send its configured ingestion token.

SSE uses `text/event-stream`, disables caching, sends heartbeat comments, and removes listeners/timers on cancellation or request abort. Slow clients have bounded buffers and disconnect when necessary. Stream errors signal failure and close safely. Stopping one browser subscription must not stop the shared simulator.

## Verification and delivery

Add meaningful Bun tests for validation, timestamp conversion, duplicate ingestion, persistence ordering, failed writes, and stream cleanup. Add database integration tests for relations, uniqueness, filters, and session completion where PostgreSQL is available. Smoke-test two simultaneous SSE clients and confirm a single stored reading per simulator tick.

Run Prisma validation/generation, TypeScript/Svelte checks, relevant tests, formatting checks for changed files, and the production build. Report checks blocked by environment or unavailable database honestly. Do not apply destructive schema changes to an existing database.

Document environment variables, migration commands, demo dataset limitations, authentication, curl examples, EventSource usage, simulator controls, and persistent Node deployment in README.
