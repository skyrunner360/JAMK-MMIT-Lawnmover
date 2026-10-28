# Fleet Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver property coverage, fleet diagnostics, reliable device delivery and independent seasonal queries.
**Architecture:** Extend PostgreSQL with machine/property/cycle identities and transactional daily summaries. Preserve raw session detail and existing demo controls. Use a disk outbox on external senders.
**Tech Stack:** TypeScript, Bun, Svelte 5, SvelteKit, Prisma, PostgreSQL.
**Spec:** docs/superpowers/specs/2026-10-28-fleet-dashboard-design.md

## Global Constraints

- Additive migrations; preserve existing telemetry and legacy API compatibility where safe.
- Sixty demo zones; ten-second device cadence; 459-byte payload capacity assumption.
- Seasonal reads use daily summaries only; observation time and receipt time are distinct.
- Public demo audience switching is presentation, not authorization.
- No destructive retention, deployment or external service changes.

## Review Focus

- Duplicate and concurrent deliveries must not double count or cross machine boundaries.
- Late backlog must update the original day without making stale observations look fresh.
- Restart during acknowledgement must replay stable envelopes without reused source IDs colliding.
- Cycle changes and overlapping coverage must not claim cumulative historical progress as fresh work.
- Stale requests and audience/machine changes must not show another selection's data.

### Task 1: Fleet schema and transactional persistence

**Files:** prisma/schema.prisma, additive migration, src/lib/server/mower/{fleet,repository,service}.ts; tests/fleet.test.ts, tests/integration.test.ts.
**Interfaces:** ensureDemoFleet(db), persistMessage(db, runId, message), daily summary keyed by machine/day, per-machine authenticated runs and explicit property cycles.

- [x] Write failing tests for summary projection, freshness and sixty-zone layout; run with Bun and confirm missing implementation.
- [x] Add property, machine, cycle, property-zone, zone-progress and daily-summary models. Associate existing runs to historical demo identity; add session/reading/event indexes.
- [x] Increment daily summaries only after unique insert, lock per run/zone for concurrency, track receipt and maximum observation time, preserve current-cycle coverage separately.
- [x] Verify Prisma validation/generation and Bun tests, including DB tests when available.

### Task 2: Machine APIs and independent query paths

**Files:** src/routes/api/{fleet,cycles,trends,machines}/**, src/lib/server/mower/{fleet,validation,queries}.ts, scripts/{provision-machine,backfill-summaries,benchmark-fleet}.ts; tests/fleet-api.test.ts.
**Interfaces:** GET /api/fleet, GET/POST /api/cycles, GET /api/trends?machine_id&from&to, GET /api/machines/:id/{state,sessions}; machine_id filters on raw telemetry/session APIs.

- [x] Add failing tests for date range bounds, credential hashing, diagnostic thresholds and weighted summary means.
- [x] Implement hashed per-machine provisioning/authentication and ownership-safe run creation, transactional cycle switching and property coverage API.
- [x] Implement bounded trends using summaries exclusively and paginated machine/session diagnostics; provide maintenance backfill and reproducible query benchmark.
- [x] Verify tests, query plans and machine isolation in integration tests.

### Task 3: Durable sender

**Files:** src/lib/sim/{durable-sink,http-sink,mower-simulator}.js; tests/durable-sink.test.ts.
**Interfaces:** createDurableSink(options) with send, flush, close; stable run_id on every stored envelope, new run after restart backlog drains.

- [x] Test transient retry ordering, permanent rejection retention, capacity and crash/restart replay; observe failure.
- [x] Persist atomic/fsynced ordered spool, ownership lock, bounded storage, acknowledgement-only removal, bounded exponential backoff/jitter; wire CLI to drain before producer startup.
- [x] Verify sender tests and preserve existing sink tests.

### Task 4: Customer map and engineer dashboard

**Files:** src/routes/+page.svelte, src/routes/layout.css, src/lib/components/{ZoneMap,FleetDashboard}.svelte, src/lib/dashboard/{data,dashboard.svelte}.ts, data/zones.csv; tests/dashboard.test.ts, browser tests.
**Interfaces:** customer/engineer audience switch, machine selector, separate cycle coverage and session/trend loading state.

- [x] Test arbitrary zone positions, stale data, missing trend days and selection isolation.
- [x] Lead with sixty-zone map, explicit estimate/unknown labels, cycle control and observation dates; keep demo controls and export.
- [x] Add fleet diagnostics, paginated selected session readings/events and seasonal summary charts with configurable labelled thresholds and explicit gaps.
- [x] Verify Svelte compiler/checker, responsive browser flow and production build.

### Task 5: Validation and documentation

**Files:** README.md, .env.example, package.json, design/plan progress.

- [x] Document provisioning, sender recovery, maintenance backfill, API changes, capacity and tested query scale.
- [x] Run Bun suite, Prisma validate, Svelte check, build and available DB/browser tests.
- [x] Obtain fresh whole-change review, address material findings, record limitations; leave concrete reviewable changes locally.

## Execution record

- Approved design; execute inline in the user's checkout so IDE paths stay stable. No new approval gate for routine implementation. No commits or publishing required by user.

## Completion evidence

- Full Bun suite with database, HTTP fleet and legacy streaming integration enabled: **45 passed, 0 failed, 0 skipped**.
- Playwright: **4 passed**, desktop 1440 px, mobile 390 px, delayed trend date editing, completed-cycle resume rejection.
- `bun run check`: **0 errors, 0 warnings**; `bunx prisma validate`: valid; `bun run build`: passed; changed source formatting and `git diff --check`: passed.
- PostgreSQL 18 clean additive migration applied on dedicated `mower_fleet_test`; existing user database was not changed.
- Summary backfill repaired an intentionally incorrect summary, remained idempotent and produced exact totals during concurrent ingestion.
- Sender tests cover transient ordering, permanent rejection retention, queue bounds, ownership, sudden process exit and lost acknowledgement replay.
- Query benchmark: 1,555,200 raw readings plus 180 summaries; session index used (0.037 ms execution), seasonal query touched summary table only (0.027 ms). Temporary benchmark fixture removed.
- Fresh independent review identified implicit cycle creation, completed-cycle resumption and mutable trend date labels. All addressed with regression tests. An additional browser timing issue was traced to clicks before hydration and corrected; test setup now starts explicit cycles for repeatability.
- Ruling: execute inline in the user checkout and leave changes uncommitted, preserving IDE paths and avoiding unsolicited branch/commit operations.
- Ruling: initial ingestion without an active cycle stays unassigned rather than creating a cycle; diagnostics continue, but coverage awaits an explicit cycle. See design review decisions for costs.
- No deferred material findings. Svelte MCP unavailable; local compiler/checker used.
