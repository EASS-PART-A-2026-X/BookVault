# syntax=docker/dockerfile:1

# ---- Build: install deps and produce the static bundle with Node -------------
FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, from the lockfile only, so this layer is cached until
# package.json / package-lock.json change. Playwright's browsers aren't needed here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY . .

# Where the browser sends API calls. "/api" = same origin: nginx (below) proxies it
# to the backend container, so no CORS and no hostname baked into the bundle.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- Runtime: nginx serves the bundle and proxies /api -----------------------
FROM nginx:1.30-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/healthz || exit 1
