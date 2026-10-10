FROM node:24-bookworm-slim AS base
WORKDIR /app/integrations/notion
COPY integrations/notion/package.json ./package.json
COPY integrations/notion/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force && mkdir /data && chown node:node /data
COPY integrations/notion/main.mjs ./main.mjs
COPY integrations/notion/shopping-worker.ts ./shopping-worker.ts
ENV NODE_ENV=production
EXPOSE 3000
USER node

FROM base AS managed
COPY integrations/notion/managed ./managed
COPY integrations/notion/template/provision.mjs ./template/provision.mjs
ENV NOTION_MANAGED_CONFIG=/etc/eat-or-yeet/notion-managed.json
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD node --input-type=module -e "const r = await fetch('http://127.0.0.1:3000/health'); if (!r.ok) process.exit(1);"
CMD ["node", "/app/integrations/notion/managed/main.mjs"]

FROM base AS worker
ENV NOTION_WORKER_CONFIG=/etc/eat-or-yeet/notion-worker.json
CMD ["node", "/app/integrations/notion/main.mjs"]
