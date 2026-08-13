# ── Frontend: Next.js 16 (App Router) ─────────────────────────────────────────
# Multi-stage: builder compiles; runtime serves `next start` (SSR, not static).
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first for caching. Use npm ci for lockfile fidelity.
COPY package.json package-lock.json ./
RUN npm ci

# Pass NEXT_PUBLIC_API_BASE_URL at BUILD time (Next.js inlines NEXT_PUBLIC_
# vars into the client bundle at build, so changing it later requires a rebuild).
# Default matches the README dev convention; override via build arg per env.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY . .
RUN npm run build

# ── Runtime ──
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOST=0.0.0.0
EXPOSE 3000

# Copy only what's needed to run `next start`.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs .
COPY --from=builder /app/jsconfig.json .
COPY --from=builder /app/postcss.config.mjs .

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

CMD ["npm", "start"]
