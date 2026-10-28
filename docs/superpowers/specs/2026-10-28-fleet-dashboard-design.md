# Fleet telemetry and property dashboard

## Intent and scope

Support machines reporting a 459-byte reading every ten seconds over intermittent domestic connections. Customers need to understand mowing progress across sixty property zones; engineers need session diagnostics and seasonal health trends. Implement both dashboard and supporting data architecture in the existing TypeScript, SvelteKit, Bun, Prisma and PostgreSQL application.

## Architecture decision

The user selected extending PostgreSQL with daily summaries. A separate operational and analytics database would offer stronger resource isolation but adds infrastructure without an established fleet-size requirement. Raw-only queries would be simpler but make seasonal scans compete with session detail. Use indexed raw session telemetry and incrementally maintained daily machine summaries; seasonal requests must never scan raw readings. Shared PostgreSQL still has shared resource limits: this is query separation, not guaranteed workload isolation.

## Machine identity and ingestion

Add persistent machine and property identities. Runs belong to machines; machines belong to the property. Provision per-machine credentials stored as hashes, with an explicit provisioning command; retain the existing simulator/demo path through a seeded demo machine. A run must belong to the authenticated machine, and clients cannot select another machine's run. Preserve existing run and session IDs in an additive migration and associate old runs with the demo machine.

External senders persist an ordered disk outbox before delivery, keep stable run identity across restarts, and remove acknowledged entries only after successful responses. Retry transport failures, timeouts, rate limits and server failures with bounded exponential backoff and jitter. Permanent invalid/authentication responses stop delivery and retain entries for repair. Bound disk buffering and stop with an explicit error at capacity; never silently discard readings. Server acknowledgement follows database commit. Existing uniqueness constraints make repeated delivery safe; summary updates happen only for newly inserted readings in the same transaction. Serialize writes per machine without a single global fleet queue.

Keep observation time separate from receipt time. Late data contributes to its original UTC day, and cannot move latest observation time backwards. Connectivity reflects recent receipt time; stale observations remain visibly stale even while a backlog uploads. Default stale threshold: sixty seconds, configurable. Ten-second cadence describes device sampling; retain clearly labelled accelerated simulation controls.

## Query paths and summaries

Provide bounded, machine-scoped APIs for fleet status, property zones, session detail and date-bounded daily trends. Session detail uses the selected session UUID and paginated raw readings/events. Add composite indexes for session and timestamp pagination. Daily summaries store sample count, anomaly count, motor-current sum/maximum, temperature maximum and battery statistics keyed by machine and UTC day. Compute means from sums/counts, including when grouping days. Trends use summaries with explicit date ranges and gaps; missing days are unknown rather than zero. Provide an idempotent, bounded backfill command for existing readings with a documented maintenance procedure that prevents racing live summary writes.

At the stated payload size, each continuously reporting machine produces 8,640 readings and 3,965,760 payload bytes per day, excluding transport, indexes and database overhead. Fleet size and retention are unspecified; document capacity assumptions and keep retention non-destructive in this change.

## Customer dashboard

Make the sixty-zone property map the first substantial panel. Use a responsive ten-column by six-row illustrative layout, selectable zones, clear coverage legend and selected-zone detail. Seed sixty synthetic zones for the demo without inventing measurements for existing real data. Label elapsed-time-derived coverage as an estimate, not verified grass condition. Missing coverage and stale data remain explicit. Property zones have stable identities independent of simulation restarts; run-local telemetry maps to these identities. Define the displayed coverage as the latest reported/estimated progress for the selected mowing cycle, not a lifetime maximum; show its observation time. Existing cumulative coverage must be labelled historical until a new cycle establishes fresh state.

## Engineer dashboard

Provide an audience switch, fleet machine selector, connection/freshness status, selected-session charts and paginated diagnostics, and a separate seasonal view driven by daily summaries. Show transparent diagnostic indicators such as anomaly rate, sustained motor load and temperature; label thresholds and insufficient data. Do not claim validated failure prediction or expose simulator ground-truth future-failure labels as predictions. The current demo has no customer account isolation; audience switching is presentation, not authorization, and existing public dashboard access remains explicitly documented.

## Constraints and validation

Preserve working simulator controls, CSV export and existing APIs where compatible; document intentional ingestion configuration changes. Use additive migrations with no deletion of existing telemetry. Do not deploy or change external services. Validate duplicate and late ingestion, machine isolation, restart/retry recovery, summary correctness and session/trend query separation. Run Bun tests, Prisma validation, Svelte/TypeScript checks and production build; run database/browser checks when the required local services are available and report any unverified paths. The requested Svelte MCP tools are not available in this session; use available compiler/checker validation and disclose that limitation.

## Implementation calls

Use one property initially with explicit machine/property models so additional properties do not require reassigning telemetry. Treat alert thresholds as configurable diagnostic heuristics. Keep all existing data; no automatic retention deletion. Measure query behavior against generated data and document the tested scale rather than promising arbitrary fleet performance.

Builder review resolved two additional implementation calls. A property mowing cycle starts explicitly through a cycle control and remains active until explicitly completed or replaced; machine sessions do not reset it. Preserve prior cycles. A run is assigned to the active cycle when created. If no active cycle exists, ingestion remains available for diagnostics under an unassigned run and does not create coverage; the customer explicitly starts a cycle. For multiple machines reporting the same zone, display the maximum reported per-machine coverage estimate for that cycle, never sum overlapping estimates; label this conservative aggregation and do not infer verified spatial coverage.

Each durable outbox envelope carries its original run identity. On sender process restart, drain persisted envelopes in order, then start a new producer run for newly generated simulator data, sending zones and session metadata first. This avoids reused numeric simulator session IDs colliding while preserving replay identity. Persisting full simulator execution checkpoints is outside this change.

## Implementation review decisions

- Cycle completion blocks resuming its internal simulator run. Late external observations may update coverage only inside that run's cycle observation window; raw telemetry and daily summaries remain available outside it. Cost: producers must begin a new run to contribute to a new cycle.
- Runs without an active cycle are explicitly unassigned rather than silently creating a cycle. Cost: mowing before an operator starts a cycle is visible in diagnostics but contributes no customer-cycle estimate.
- Trend results retain the requested date range, independent of subsequent form edits. Audience controls wait for hydration to prevent lost initial clicks.
- Delivery uses a local, single-owner disk outbox; corrupt metadata or PID reuse can require manual inspection. Full producer execution checkpoints and network-filesystem locking are outside scope.
- Shared PostgreSQL resources remain a capacity constraint. The measured 180-day fixture validates query separation, not production concurrency or an SLA.
