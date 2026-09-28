# NexOne Quality Assistant — Team Edition
# Single-container Node/Express app with an embedded SQLite database.
# The SQLite file lives on a persistent volume mounted at /data so it
# survives container restarts and redeploys.

FROM node:22-bookworm-slim AS base

# better-sqlite3 ships prebuilt binaries for common platforms, but we keep
# basic build tools available as a fallback so `npm install` never fails
# on an unusual host architecture.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so Docker can cache this layer between builds
# when only application code changes.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Now copy the rest of the application (backend + prebuilt frontend).
COPY . .

# Persistent volume for the SQLite database. DATA_DIR tells the app where
# to put app.db; docker-compose (or your platform's volume mount) should
# point a persistent disk at this path.
RUN mkdir -p /data
ENV DATA_DIR=/data
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Basic container healthcheck against the app's own /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
