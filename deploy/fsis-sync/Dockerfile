FROM node:24-bookworm-slim

WORKDIR /app
COPY deploy/fsis-sync/package.json deploy/fsis-sync/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY tsconfig.json ./
COPY scripts/sync-fsis.ts scripts/fsis-sync-worker.ts ./scripts/
COPY scripts/lib/fsis-sync.ts scripts/lib/fsis-worker.ts scripts/lib/fda-sync.ts scripts/lib/snapshot-upload.ts scripts/lib/food-source-sync.ts ./scripts/lib/
COPY src/lib/incidents/fsis.ts src/lib/incidents/fda-announcements.ts src/lib/incidents/serialise.ts src/lib/incidents/date-bounds.ts src/lib/incidents/source-text.ts src/lib/incidents/official-source-http.ts ./src/lib/incidents/
COPY src/lib/matching/normalise.ts ./src/lib/matching/
COPY src/lib/domain/gtin.ts ./src/lib/domain/
COPY src/lib/http/bounded-response.ts ./src/lib/http/

RUN mkdir -p /var/lib/fsis-sync && chown node:node /var/lib/fsis-sync
USER node
ENV NODE_ENV=production FSIS_STATE_DIR=/var/lib/fsis-sync
ENTRYPOINT ["node", "--import", "tsx", "scripts/fsis-sync-worker.ts"]
