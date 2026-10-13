# Mower Backend Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store simulated mower telemetry and provide authenticated REST and SSE APIs.
**Architecture:** One persistent Node SvelteKit process, Prisma/PostgreSQL persistence, one serialized simulator service and independent SSE subscribers.
**Tech Stack:** TypeScript, Bun, SvelteKit 3, Prisma 6, Better Auth.
**Spec:** ../specs/2026-10-14-mower-backend-design.md

## Global Constraints

- Preserve authentication and unrelated existing files.
- One shared demo mower; separate UUID per simulation run.
- Snake_case payloads, UTC timestamps, default speed 10.
- Default page size 50, maximum 200; bounded ingestion and stream queues.
- No destructive database changes. No frontend changes.

## Review Focus

- Restarted simulator session IDs must not overwrite earlier runs.
- Failed persistence must stop simulation without claiming successful delivery.
- Malformed dates, numeric coercion, and excessive pagination must fail explicitly.
- Disconnected or slow SSE clients must release listeners.
- Authentication and ingestion credentials must be enforced before processing.

### Task 1: Schema, validation, and runtime

Files: prisma/schema.prisma, prisma/migrations, src/lib/server/mower/validation.ts, tests/validation.test.ts, package.json, vite.config.ts, tsconfig.json, src/app.d.ts.
Interfaces: parseMessage(unknown) returns a validated discriminated message; parseQuery(URLSearchParams) returns bounded filters.

- [x] Write validation tests for UTC, ranges, invalid bodies, pagination, and message variants; observe failure.
- [x] Add explicit schemas and validators, run tests to green.
- [x] Switch to Node adapter, generate Prisma client and additive migration; run schema validation and checks.

### Task 2: Simulator and ordered persistence

Files: src/lib/server/mower-simulator.js and .d.ts, src/lib/sim/mower-simulator.js, data/*.csv, src/lib/server/mower/{repository,queue,service}.ts, tests/{queue,simulator,persistence}.test.ts.
Interfaces: persistMessage(db, runId, message); getMowerService() exposes start, stop, status, snapshot, subscribe.

- [x] Write tests for ordered writes, failure/overflow, fixture generation and duplicate persistence.
- [x] Implement synthetic fixture, typed server export, serial bounded queue and database transactions.
- [x] Implement one shared lifecycle service, persist before broadcasting; test stop/start and failure behavior.

### Task 3: API and streaming

Files: src/lib/server/mower/{http,stream,queries}.ts, src/routes/api/**/+server.ts, src/hooks.server.ts, tests/{stream,http}.test.ts.
Interfaces: HTTP helpers authenticate and convert expected failures to JSON; createEventStream subscribes with bounded buffer and cleanup.

- [x] Write auth/body validation and stream cancellation/backpressure tests; observe failures.
- [x] Implement health, current state, readings, events, sessions/detail, zones, simulator controls, ingestion and stream routes.
- [x] Extend CLI HTTP sink with bearer token and ordered delivery; verify API filters and status codes.

### Task 4: Integration and documentation

Files: README.md, .env.example, tests/integration.test.ts.

- [x] Add opt-in PostgreSQL integration coverage for idempotency, completed sessions, run isolation and queries.
- [x] Run unit/integration tests, Svelte checks, Prisma validation, formatting and production build.
- [x] Smoke-test authenticated routes and simultaneous streams if database available.
- [x] Document setup, migration, tokens, API response shapes, fixture limitations and single-process deployment.

## Execution ledger

- User approved design and instructed execution. Continue inline without further permission gates.
- Repository is entirely untracked: preserve files in place; do not create a worktree or commit the user's initial project.

- Completed all four tasks inline. Reviewer found an old-zone-snapshot retry limitation; a failing database regression test reproduced it, and cumulative counters now survive old snapshot retries.
- Verification: 24/24 tests passed with PostgreSQL and HTTP integration enabled; Svelte check reports 0 errors and 0 warnings; Prisma schema validation, changed-file formatting, and Node production build pass.
- Database migrations were applied only to an isolated temporary PostgreSQL instance. Existing user environment and database were not modified.
- The supplied JavaScript simulator keeps a per-file TypeScript opt-out with typed server declarations and runtime message validation; the new backend code is strict TypeScript.

- Production smoke initially exposed Node adapter 6 defaulting to HTTPS when no origin is configured. Reproduced with the HTTP test; configured paths.origin from ORIGIN, rebuilt, and reran successfully. Standalone authenticated HTTP replay stored 150 readings and three completed sessions.
