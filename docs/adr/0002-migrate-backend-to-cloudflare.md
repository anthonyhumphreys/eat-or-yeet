# ADR 0002: Migrate the backend from Convex to Cloudflare

Date: 2026-10-14

Status: Accepted. Production cutover completed on 14 October 2026.

## Context

Eat or Yeet retains official warning payloads, compact matching projections, source-health ledgers, product metadata, rate-limit counters, expiring shares and managed Notion installation state. Daily imports and repeated dataset reads made database usage a material operating concern. The [Convex usage record](../convex-usage.md) documents the earlier measurements and optimisations; those billing units do not predict Cloudflare costs.

The application needs authenticated backend operations, atomic updates and durable background work. It does not depend on a browser-side Convex subscription API. Next.js already owns the website, deterministic matcher, public MCP endpoint and Notion OAuth/webhook routes on Vercel. Moving that application at the same time would widen the migration without being necessary to replace the backend.

Existing warning links, record relationships, creation timestamps and encrypted Notion credentials must survive the move. Missing, failed, incomplete or stale source coverage must continue to block negative food-check results.

## Decision

Replace the Convex runtime with Cloudflare Workers, D1, Queues and private R2. Keep Next.js on Vercel. The [architecture guide](../architecture.md) describes the resulting boundaries; the [deployment guide](../cloudflare-deployment.md) owns operational commands.

- A Worker exposes validated, authenticated operations. The website uses `BACKEND_SECRET`; operator tooling uses a separate `BACKEND_ADMIN_TOKEN`. USDA and FDA snapshot uploads each use a source-specific token. Administrative and upload tokens stay out of Vercel and browser bundles.
- D1 stores validated JSON records with opaque IDs, original creation timestamps and SQLite expression indexes. Keep the domain operations and generated typed references under `backend/`, backed by an application-owned runtime rather than the Convex SDK.
- Queries check the database revision around their reads. Mutations stage writes and scheduled jobs, then commit a D1 batch guarded by an optimistic revision check. Concurrent changes retry. This global revision serializes commits and is appropriate for the present write rate.
- Commit scheduled work to a D1 outbox with the domain mutation. Publish due jobs to a Queue, and use the minute cron to recover pending work and expired delivery leases. Lease tokens fence stale deliveries. Retry failures with bounded backoff and retain exhausted jobs as failed. External effects still require domain idempotency and current-state checks.
- Validate source snapshots before preparing bounded import batches in private R2. Queue work commits at most 25 notices per batch, including projections, progress and continuation. Fence superseded imports and delete committed objects; lifecycle rules clear abandoned objects.
- Keep FSA and openFDA food/drug fetching on Workers. Keep the external NAS importer for USDA FSIS and FDA announcements, whose hosted fetches were blocked or returned regional error content. It uploads validated snapshots with separate credentials and runs independently of managed Notion reviews.
- Keep local development account-free through Wrangler and local D1/R2/Queue emulation. Staging and production use separate resources and credentials. Deploy SQL migrations and the Worker separately from the Vercel build.

The matcher, qualified result language, 48-hour food-source freshness gate, revision-keyed caches and public integration contracts remain application responsibilities. Moving storage does not establish source completeness or food safety.

## Migration and verification

Freeze legacy scheduled writers and the old importer before taking the final private export. Restore into an empty D1 database, preserving IDs and timestamps; compare all table counts and relationships before routing traffic. Preserve the Notion encryption key and third-party credentials, generate separate backend/operator/upload credentials, and disable restore access after importing.

The [cutover record](../cloudflare-cutover-2026-10-14.md) records 19,625 restored records across 21 tables with matching counts and no broken warning projection/import-state links. It also records passing local checks and production browsing, matching, sharing, MCP and source-import checks. These are cutover observations, not checks rerun by this ADR. Live Notion OAuth/signed-event acceptance on Cloudflare and physical camera checks remain separate release work.

A frontend rollback should use a compatible Cloudflare-backed Vercel deployment so new D1 writes remain available. Returning to Convex requires stopping native writers and reconciling post-cutover data before restoring the old application, credentials and schedules together. Promoting an old frontend alone is not a complete backend rollback.

## Consequences

- The application owns its transaction adapter, typed operation registry, outbox, retry and recovery behaviour. These need regression coverage and operational monitoring that Convex previously supplied as a service.
- D1 revision contention and Worker invocation/query limits constrain throughput. Single-consumer imports, bounded batches and the SELF service binding keep current work within those boundaries. This is not an unlimited-write architecture.
- Queue redelivery is expected. Atomic database progress prevents duplicate committed batches; it does not make third-party HTTP effects exactly once.
- Database migrations, Worker releases and Vercel releases now have an explicit order. Preview isolation and matching secrets are operator responsibilities.
- Spending now depends on Worker requests/CPU, D1 reads/writes/storage, Queue operations and R2 operations/storage, alongside Vercel and the existing importer host. Measure a normal import cycle and representative traffic before claiming savings or free-tier capacity.
- A source that cannot be fetched from hosted infrastructure still needs the external importer and health monitoring. The migration does not remove that dependency.

## Alternatives considered

**Keep Convex and continue optimising.** This would retain its managed transaction/scheduling behaviour and avoid maintaining a runtime adapter. Caching, fingerprinted imports and removed indexes had already reduced usage, but the application would retain the same provider-specific operating model. Those optimisations remain useful on D1.

**Move the entire application to Cloudflare.** This could consolidate hosting, but would also require revalidating Next.js runtime behaviour, trusted-proxy identity, public MCP hosting and Notion callback configuration. Keeping Vercel limits the migration to the backend.

**Replace the data model and domain operations during migration.** A relational redesign could reduce adapter code, but would combine storage migration with changes to identifiers, relationships and operation behaviour. Preserve those contracts first; change the model later only for a measured benefit.

## Reconsideration

Revisit write coordination if revision retries or queue age show sustained contention. Revisit search/storage design if measured dataset scans or D1 costs dominate. Revisit the external fetcher only after complete official-source retrieval is verified from the intended hosted runtime. Any further hosting move must preserve source-health, privacy and integration boundaries.
