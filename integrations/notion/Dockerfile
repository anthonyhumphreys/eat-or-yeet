FROM node:24-bookworm-slim
WORKDIR /app
COPY integrations/notion/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-package-lock && npm cache clean --force
COPY integrations/notion/main.mjs ./main.mjs
COPY integrations/notion/shopping-worker.ts ./shopping-worker.ts
ENV NODE_ENV=production NOTION_WORKER_CONFIG=/etc/eat-or-yeet/notion-worker.json
EXPOSE 3000
USER node
CMD ["node", "/app/main.mjs"]
