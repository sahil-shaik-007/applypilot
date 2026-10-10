# ApplyPilot Cloud: API server + built PWA in one image.
# Build from the REPOSITORY ROOT (the server reuses electron/connectors and electron/data):
#   docker build -f web/Dockerfile -t applypilot-cloud .
#   docker run -p 8787:8787 -v applypilot-data:/data \
#     -e APP_ORIGIN=https://app.example.com -e GOOGLE_CLIENT_ID=... applypilot-cloud

# ---------- 1. build the PWA (web/client → web/client/dist)
FROM node:24-slim AS client
WORKDIR /app/web/client
COPY web/client/package.json web/client/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY web/shared /app/web/shared
# gen-icons.mjs (npm run build) renders the PWA icons from the desktop icon
COPY build/icon.png /app/build/icon.png
COPY web/client/ ./
RUN npm run build

# ---------- 2. production server dependencies only
FROM node:24-slim AS deps
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 3. runtime
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=/data/applypilot.db \
    CLIENT_DIST=/app/web/client/dist
WORKDIR /app/web

# Only what the server needs: no keys/, no desktop app, no dev tooling.
COPY --from=deps /app/web/node_modules ./node_modules
COPY web/package.json ./package.json
COPY web/server ./server
COPY web/shared ./shared
COPY --from=client /app/web/client/dist ./client/dist
COPY electron/connectors /app/electron/connectors
COPY electron/data /app/electron/data

RUN rm -rf ./server/test ./server/data \
 && mkdir -p /data \
 && chown -R node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
