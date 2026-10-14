# Mower Dashboard Implementation Plan

**Goal:** Add a responsive, accessible dashboard consuming the existing simulator API, temporarily without authentication, using Docker PostgreSQL for development.
**Architecture:** Svelte 5 client dashboard with bounded SSE readings, REST history hydration, reusable SVG charts and zone map. Keep Node/Prisma backend and device-ingestion credentials. Dashboard endpoints are public for this demo; origin checks remain on mutations.
**Design:** Light sage canvas, dark forest accents, compact navigation, live status/controls, four measurement cards, battery and motor charts, spatial zone visualization, events, and sessions. Mobile uses stacked panels and scrollable tables. Missing data is shown explicitly, never fabricated. Start on first visit; stop/resume controls remain usable without reconnect restarting a paused simulation.

- [ ] Add tested chart-data helpers and frontend types; bound, order, deduplicate live history.
- [ ] Remove dashboard authentication gates; retain token protection on device ingestion. SSE supports subscribing without auto-start for frontend control semantics. Update HTTP tests.
- [ ] Implement live dashboard and chart/map components, accessible responsive styles, honest error/retry/empty states, cleanup.
- [ ] Configure PostgreSQL 18 Compose health checks and one-command development setup; retain existing volume.
- [ ] Run Svelte MCP autofixer, Svelte checks, unit/HTTP tests, build and desktop/mobile browser checks.

Implementation is authorized by the user's request. Work in the existing checkout; preserve unrelated files and existing database data.
