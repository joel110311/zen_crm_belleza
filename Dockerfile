# ---- Dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Dummy DATABASE_URL for build (Prisma generate needs it, actual connection at runtime)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

# Generate Prisma Client
RUN npx prisma generate
RUN npx prisma generate --config prisma.control.config.ts

# Build Next.js in standalone mode
RUN npm run build

# ---- Runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Start: Fix required for Prisma on Alpine + ffmpeg for audio conversion
RUN apk add --no-cache openssl ffmpeg
# End: Fix

# Copy public assets
# Copy public assets
COPY --from=builder /app/public ./public
# Create uploads directory and set permissions (ensures volume inherits this owner)
RUN mkdir -p ./public/uploads && chown -R nextjs:nodejs ./public

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy full node_modules so the future tenant-provisioning job can run Prisma migrations.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy Prisma schema + runtime client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/prisma.config.js ./
COPY --from=builder /app/prisma.tenant.config.ts ./
COPY --from=builder /app/prisma.control.config.ts ./

# The web runtime never changes the schema; a separate provisioner invokes these scripts.
COPY --from=builder /app/scripts/startup.mjs ./startup.mjs
COPY --from=builder /app/scripts/migrate-tenant.mjs ./migrate-tenant.mjs
COPY --from=builder /app/scripts/seed-tenant.mjs ./seed-tenant.mjs
COPY --from=builder /app/scripts/migrate-control-plane.mjs ./migrate-control-plane.mjs
COPY --from=builder /app/scripts/provision-tenant.mjs ./provision-tenant.mjs
COPY --from=builder /app/scripts/tenant-work-worker.mjs ./tenant-work-worker.mjs

USER nextjs

EXPOSE 3000

# Standard web runtime; tenant provisioning runs separately before this service starts.
CMD ["node", "startup.mjs"]

# Build this target as a separately deployed worker. It receives the administrative PostgreSQL
# URL; the web target must never receive that URL. The interim AES key is required by the web
# runtime only to decrypt tenant runtime credentials until KMS envelope encryption replaces it.
FROM runner AS provisioner
CMD ["node", "provision-tenant.mjs", "--drain"]

# The worker receives the control-plane URL and the tenant runtime decryption key, but neither
# the legacy DATABASE_URL nor a public/uploads volume. It is the only process that applies queued webhooks.
FROM runner AS tenant-worker
CMD ["node", "tenant-work-worker.mjs", "--drain"]

# Keep the normal web image as the default Docker build target. Compose selects the named worker
# targets explicitly, so an ordinary `docker build .` can never become a queue consumer.
FROM runner AS web
