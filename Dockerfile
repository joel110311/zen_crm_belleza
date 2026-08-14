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

# Copy full node_modules from builder so Prisma CLI can run db push during startup
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy Prisma schema + runtime client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/prisma.config.js ./

# Copy SaaS startup script
COPY --from=builder /app/scripts/startup.mjs ./startup.mjs

USER nextjs

EXPOSE 3000

# SaaS-ready startup: schema push → auto-seed → server
CMD ["node", "startup.mjs"]
