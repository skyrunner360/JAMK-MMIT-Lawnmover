# Domestic connectivity verification

The followup request was audited against the existing fleet implementation and completed in the same checkout.

- Production CLI delivery uses an fsynced, ordered disk outbox. Transient network/429/server failures back off exponentially with jitter capped at 30 seconds. Permanent rejection and capacity limits retain unsent records and stop explicitly.
- Every new envelope persists a message UUID before first transmission. Older queued files use their filename UUID. Authenticated machine identity and message ID scope receiver deduplication across reconnects and both sender/receiver restarts.
- Server receipts commit in the same transaction as telemetry and summaries. Identical retries return a matching acknowledgement without additional samples. Conflicting ID reuse returns 409. Queue removal requires matching run and message IDs.
- Raw capture timestamps retain their original historical position. Server arrival timestamps are distinct, first-arrival values. Migration leaves historical unknown arrival times null instead of inventing them.
- Machine communication freshness and captured-state freshness remain independent. Dashboard labels distinguish last capture from last receipt and browser connectivity. Full capture dates appear on historical charts. Local aging continues when fleet requests fail.

Validation: 48 Bun tests passed with database, HTTP ingestion, streaming and backfill enabled; five Playwright tests passed including stale backlog and failed polling. Svelte check reported zero errors/warnings; production build, Prisma validation and formatting passed. Independent scope review found no material issues. The new additive migration was applied only to the dedicated test database; normal development applies it through `bun run dev`. Svelte MCP remains unavailable, so local compiler/checker validation was used.
