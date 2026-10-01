FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --omit=dev
COPY . .
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium NODE_ENV=production
RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache && chown -R node:node /app
USER node
EXPOSE 3000
# Clear any stale Chromium SingletonLock left by a previous container that was
# killed before whatsapp-web.js could shut down cleanly (e.g. on `up -d --build`
# or `restart: unless-stopped`), then start normally. Self-healing: harmless
# when there's nothing to clean, no-op if the auth volume is empty.
CMD ["sh","-c","rm -f /app/.wwebjs_auth/session-*/Singleton* ; exec node src/index.js"]
