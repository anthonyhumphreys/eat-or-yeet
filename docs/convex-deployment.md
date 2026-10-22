# Previous Convex deployment

The backend has moved to Cloudflare Workers, D1, Queues and R2. Follow [Cloudflare deployment](cloudflare-deployment.md) for the current commands, migration and rollback. Vercel builds now build Next.js only. Production cutover completed on 14 October 2026. Retained Convex resources are frozen migration/rollback material, not an active runtime. Returning to them requires pausing native writers and reconciling new D1 data; promoting a legacy frontend alone is insufficient. See [ADR 0002](adr/0002-migrate-backend-to-cloudflare.md).
