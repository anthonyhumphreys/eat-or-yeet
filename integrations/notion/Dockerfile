FROM node:24-bookworm-slim
WORKDIR /app/integrations/notion
COPY integrations/notion/package.json ./package.json
COPY integrations/notion/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force && mkdir /data && chown node:node /data
COPY integrations/notion/main.mjs ./main.mjs
COPY integrations/notion/shopping-worker.ts ./shopping-worker.ts
COPY integrations/notion/shopping-core.ts ./shopping-core.ts
ENV NODE_ENV=production
ENV NOTION_WORKER_CONFIG=/etc/eat-or-yeet/notion-worker.json
EXPOSE 3000
USER node
CMD ["node", "/app/integrations/notion/main.mjs"]
