FROM node:20-bookworm-slim
# The `chromium` package here is installed ONLY for the shared libraries it
# pulls in (libnss3, libatk, libgtk, etc.) that any Chromium binary needs to
# run on Debian — it is never executed directly. puppeteer downloads and runs
# its OWN tested Chromium build below; pointing it at the system package
# instead broke once Debian's `chromium` drifted to a newer major version
# than this puppeteer release speaks the same DevTools protocol with
# ("Cannot read properties of null (reading 'Socket')" at launch).
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache && chown -R node:node /app
USER node
EXPOSE 3000
# Clear any stale Chromium SingletonLock left by a previous container that was
# killed before whatsapp-web.js could shut down cleanly (e.g. on `up -d --build`
# or `restart: unless-stopped`), then start normally. Self-healing: harmless
# when there's nothing to clean, no-op if the auth volume is empty.
CMD ["sh","-c","rm -f /app/.wwebjs_auth/session-*/Singleton* ; exec node src/index.js"]
